import { existsSync, readdirSync, statSync } from "node:fs";
import { copyFile, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseGodotExecutableVersion } from "./discovery.js";
import {
  AssetImportInput,
  ProjectInspectInput,
  ProjectRunInput,
  SceneInspectInput,
  SceneModifyInput,
  ScriptCheckInput,
  engineVersionInfoMatches,
  resolveProjectPath,
  resolveWorkspacePath,
  scanCrashLines,
  toResPath,
  verifySceneReadback,
  type ModifyOperation,
  type ReadbackResult,
  type AppliedOperation,
  type BridgeEngineVersionInfo,
  type BridgePlan,
} from "./typed-ops.js";
import {
  OP_TIMEOUTS,
  SCRIPT_PARSE_DIAGNOSTIC,
  type EngineFailure,
  excerpt,
  invalidInput,
  pathFailure,
  resolveProjectRoot,
  sha256File,
} from "./engine-shared.js";
import { runGodotHeadless, type RunGodotOptions, type GodotRun } from "./engine-run.js";
import { loadBridgeReport, runBridge } from "./bridge-report.js";
import { projectBuild, type ProjectBuildSuccess } from "./engine-build.js";

/**
 * Godot execution layer (M4 WP-2) — the registration surface.
 *
 * Every invocation spawns the real executable with an argument array
 * (`shell: false`), a bounded timeout that kills the whole process group
 * (`detached: true`, `kill(-pid)`), and bounded output collection. Bridge
 * communication is data-only: a JSON input file goes in, a JSON report file
 * comes out (pointed at by a stdout marker).
 *
 * Verification is never exit-code trust (verified engine facts: a failed
 * `--export-release` still exits 0; a run without a main scene exits 0;
 * `--check-only` parse errors exit 0): mutations are re-loaded in a FRESH
 * engine process, exports are proven by artifact hashes and size bounds,
 * runs are proven by exit code AND zero crash lines.
 *
 * The implementation lives in sibling modules (engine-shared / engine-run /
 * bridge-report / engine-build — the lint-forced module split; code moved
 * VERBATIM) and is re-exported here so the public API is unchanged.
 */

export {
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS,
  OP_TIMEOUTS,
  type EngineFailure,
  excerpt,
  invalidInput,
  pathFailure,
  resolveProjectRoot,
  sha256File,
} from "./engine-shared.js";
export { runGodotHeadless, type RunGodotOptions, type GodotRun } from "./engine-run.js";
export { loadBridgeReport, runBridge } from "./bridge-report.js";
export { projectBuild, type ProjectBuildSuccess } from "./engine-build.js";
export type { ReadbackResult, AppliedOperation, BridgeEngineVersionInfo, BridgePlan } from "./typed-ops.js";

export interface ProjectInspectSuccess {
  ok: true;
  projectRoot: string;
  godotVersion: string;
  configVersion: number;
  projectName: string;
  configFeatures: string[];
  hasScripts: string[];
  mainScene: string | null;
}

export interface SceneModifySuccess {
  ok: true;
  projectRoot: string;
  scenePath: string;
  applied: { nodePath: string; property: string; verifiedValue: unknown; previousValue: unknown }[];
  failures: [];
  sceneSha256: string;
  snapshotPath: string;
  verification: { ok: boolean; failures: string[]; queries: number };
}

export interface ScriptCheckSuccess {
  ok: true;
  projectRoot: string;
  scriptPath: string;
  checkOk: boolean;
  parseErrors: { line: number | null; column: number | null; message: string }[];
  engineVersion: string;
}

export interface AssetImportSuccess {
  ok: true;
  projectRoot: string;
  targetAssetPath: string;
  importedFiles: string[];
  importMetadataPath: string;
  sourceSha256: string;
}

export interface ProjectRunSuccess {
  ok: true;
  projectRoot: string;
  scene: string | null;
  exitCode: number;
  stdoutTail: string;
  stderrTail: string;
  crashLines: [];
}

// ---------------------------------------------------------------------------
// godot/project.inspect — engine re-parse of the real project.godot
// ---------------------------------------------------------------------------

export async function projectInspect(
  executable: string,
  input: unknown,
  workspaceRoot: string,
  options: RunGodotOptions = {},
): Promise<ProjectInspectSuccess | EngineFailure> {
  const parsed = ProjectInspectInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const root = resolveProjectRoot(parsed.data, workspaceRoot);
  if (!root.ok) return root.failure;

  // The verification contract: `--version` AND config read-back by the real
  // engine run. The version line comes from THIS run's --version probe; the
  // config comes from the bridge's engine-loaded ProjectSettings.
  const versionRun = await runGodotHeadless(executable, ["--version"], { ...options, timeoutMs: options.timeoutMs ?? 60_000 });
  if (versionRun.spawnError !== null || versionRun.exitStatus !== 0) {
    return {
      ok: false,
      code: "godot-run-failed",
      message: `--version probe failed (exit ${String(versionRun.exitStatus)}): ${excerpt(versionRun.stderr || versionRun.stdout)}`,
    };
  }
  const rawVersion = (versionRun.stdout || versionRun.stderr).trim().split(/\r?\n/)[0]?.trim() ?? "";
  const versionParsed = parseGodotExecutableVersion(rawVersion);
  if (!versionParsed.ok) {
    return { ok: false, code: "godot-version-unparseable", message: `engine reported an unparseable version: ${rawVersion}` };
  }

  const outcome = await runBridge(executable, "project_inspect.gd", root.projectRoot, {}, options, OP_TIMEOUTS.projectInspect);
  if (!outcome.ok) return outcome.failure;
  const report = outcome.report;

  const info = report.engineVersionInfo as BridgeEngineVersionInfo | undefined;
  if (!info || !engineVersionInfoMatches(rawVersion, info)) {
    return {
      ok: false,
      code: "engine-version-mismatch",
      message: `the bridge's engine version does not match the probed --version (${rawVersion})`,
      details: { probed: rawVersion, bridge: info },
    };
  }

  const configFeatures = Array.isArray(report.configFeatures)
    ? report.configFeatures.filter((f): f is string => typeof f === "string")
    : [];
  const hasScripts = Array.isArray(report.hasScripts)
    ? report.hasScripts.filter((s): s is string => typeof s === "string")
    : [];
  const mainScene = typeof report.mainScene === "string" && report.mainScene !== "" ? report.mainScene : null;

  return {
    ok: true,
    projectRoot: root.projectRoot,
    godotVersion: rawVersion,
    configVersion: typeof report.configVersion === "number" ? report.configVersion : -1,
    projectName: typeof report.projectName === "string" ? report.projectName : "",
    configFeatures,
    hasScripts,
    mainScene,
  };
}

// ---------------------------------------------------------------------------
// godot/scene.modify — typed mutation + FRESH-process read-back verification
// ---------------------------------------------------------------------------

export async function sceneModify(
  executable: string,
  input: unknown,
  workspaceRoot: string,
  options: RunGodotOptions = {},
): Promise<SceneModifySuccess | EngineFailure> {
  const parsed = SceneModifyInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const root = resolveProjectRoot(parsed.data, workspaceRoot);
  if (!root.ok) return root.failure;

  let scenePath: string;
  let sceneRes: string;
  try {
    scenePath = resolveProjectPath(parsed.data.scenePath, root.projectRoot);
    sceneRes = toResPath(scenePath, root.projectRoot);
  } catch (error) {
    return pathFailure(error);
  }
  if (!existsSync(scenePath)) {
    return { ok: false, code: "scene-file-missing", message: `scene file not found: ${scenePath}` };
  }

  // Pre-mutation snapshot staged in workspace temp (the recovery contract).
  const snapshotDir = await mkdtemp(path.join(os.tmpdir(), "gamos-godot-snapshot-"));
  const snapshotPath = path.join(snapshotDir, `${path.basename(scenePath)}.pre-mutation`);
  await copyFile(scenePath, snapshotPath);

  {
    // Apply through the data-only bridge (atomic: any failed operation leaves
    // the file byte-identical — proven by the bridge's two-pass validation).
    const payload = {
      scenePath: sceneRes,
      operations: parsed.data.operations,
    };
    const outcome = await runBridge(executable, "scene_modify.gd", root.projectRoot, payload, options, OP_TIMEOUTS.sceneModify);
    if (!outcome.ok) {
      if (outcome.failure.code === "godot-bridge-failed") {
        return { ...outcome.failure, message: "the typed scene operation failed (nothing was applied — atomic)" };
      }
      return outcome.failure;
    }
    const appliedRaw = Array.isArray(outcome.report.applied) ? outcome.report.applied : [];
    const applied: { nodePath: string; property: string; previousValue: unknown }[] = [];
    for (const entry of appliedRaw) {
      if (typeof entry === "object" && entry !== null) {
        const record = entry as Record<string, unknown>;
        if (typeof record.nodePath === "string" && typeof record.property === "string") {
          applied.push({ nodePath: record.nodePath, property: record.property, previousValue: record.previousValue });
        }
      }
    }

    // VERIFICATION (engine-query): re-load the saved scene in a FRESH engine
    // process and assert every applied value — the exit code proved nothing.
    const queries = applied.map((a) => ({ nodePath: a.nodePath, property: a.property }));
    const expectedValues = new Map(parsed.data.operations.map((op: ModifyOperation) => [`${op.nodePath}\u0000${op.property}`, op.value]));
    const inspectOutcome = await sceneInspectInternal(
      executable,
      { projectRoot: root.projectRoot, scenePath, queries },
      options,
    );
    if (!inspectOutcome.ok) {
      return {
        ok: false,
        code: "verification-failed",
        message: `post-modification read-back could not run (${inspectOutcome.failure.code}): ${inspectOutcome.failure.message}`,
        details: { applied },
      };
    }
    const readback: ReadbackResult[] = inspectOutcome.results;
    const verificationInput: AppliedOperation[] = applied.map((a) => ({
      nodePath: a.nodePath,
      property: a.property,
      value: expectedValues.get(`${a.nodePath}\u0000${a.property}`) ?? null,
    }));
    const verification = verifySceneReadback(verificationInput, readback);
    const sceneSha256 = await sha256File(scenePath);

    if (!verification.ok) {
      return {
        ok: false,
        code: "verification-failed",
        message: "post-modification scene verification failed (fresh-process read-back)",
        details: { applied, verification, sceneSha256, snapshotPath },
      };
    }

    const verifiedApplied = applied.map((a) => {
      const entry = readback.find((r) => r.nodePath === a.nodePath && r.property === a.property);
      return {
        nodePath: a.nodePath,
        property: a.property,
        verifiedValue: entry?.value ?? null,
        previousValue: a.previousValue,
      };
    });

    return {
      ok: true,
      projectRoot: root.projectRoot,
      scenePath,
      applied: verifiedApplied,
      failures: [],
      sceneSha256,
      snapshotPath,
      verification: { ok: true, failures: [], queries: queries.length },
    };
  }
  // The snapshot is deliberately NOT deleted: it is the staged recovery
  // artifact. It lives in os.tmpdir() and is reaped by the OS.
}

// ---------------------------------------------------------------------------
// scene inspect (internal read-back authority; not a registered capability)
// ---------------------------------------------------------------------------

async function sceneInspectInternal(
  executable: string,
  input: { projectRoot: string; scenePath: string; queries: { nodePath: string; property: string }[] },
  options: RunGodotOptions,
): Promise<{ ok: true; results: ReadbackResult[] } | { ok: false; failure: EngineFailure }> {
  const sceneRes = toResPath(input.scenePath, input.projectRoot);
  const payload = { scenePath: sceneRes, queries: input.queries };
  const outcome = await runBridge(executable, "scene_inspect.gd", input.projectRoot, payload, options, OP_TIMEOUTS.sceneInspect);
  if (!outcome.ok) return outcome;
  const resultsRaw = Array.isArray(outcome.report.results) ? outcome.report.results : [];
  const results: ReadbackResult[] = [];
  for (const entry of resultsRaw) {
    if (typeof entry === "object" && entry !== null) {
      results.push(entry as ReadbackResult);
    }
  }
  return { ok: true, results };
}

export async function sceneInspect(
  executable: string,
  input: unknown,
  workspaceRoot: string,
  options: RunGodotOptions = {},
): Promise<{ ok: true; scenePath: string; results: ReadbackResult[] } | EngineFailure> {
  const parsed = SceneInspectInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const root = resolveProjectRoot(parsed.data, workspaceRoot);
  if (!root.ok) return root.failure;
  let scenePath: string;
  try {
    scenePath = resolveProjectPath(parsed.data.scenePath, root.projectRoot);
  } catch (error) {
    return pathFailure(error);
  }
  if (!existsSync(scenePath)) {
    return { ok: false, code: "scene-file-missing", message: `scene file not found: ${scenePath}` };
  }
  const outcome = await sceneInspectInternal(executable, { ...parsed.data, scenePath }, options);
  if (!outcome.ok) return outcome.failure;
  return { ok: true, scenePath, results: outcome.results };
}

// ---------------------------------------------------------------------------
// godot/script.check -- --check-only exit code AND parse-error text
// ---------------------------------------------------------------------------

export async function scriptCheck(
  executable: string,
  input: unknown,
  workspaceRoot: string,
  options: RunGodotOptions = {},
): Promise<ScriptCheckSuccess | EngineFailure> {
  const parsed = ScriptCheckInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const root = resolveProjectRoot(parsed.data, workspaceRoot);
  if (!root.ok) return root.failure;
  let scriptPath: string;
  let scriptRes: string;
  try {
    scriptPath = resolveProjectPath(parsed.data.scriptPath, root.projectRoot);
    scriptRes = toResPath(scriptPath, root.projectRoot);
  } catch (error) {
    return pathFailure(error);
  }
  if (!existsSync(scriptPath)) {
    return { ok: false, code: "script-file-missing", message: `script file not found: ${scriptPath}` };
  }

  const run = await runGodotHeadless(
    executable,
    ["--headless", "--path", root.projectRoot, "--check-only", "--script", scriptRes],
    { ...options, timeoutMs: options.timeoutMs ?? OP_TIMEOUTS.scriptCheck },
  );
  if (run.spawnError !== null) {
    return { ok: false, code: "godot-run-failed", message: `failed to spawn ${executable}: ${run.spawnError}` };
  }
  if (run.timedOut) {
    return { ok: false, code: "godot-runaway", message: "script check exceeded the bounded time and the process group was killed" };
  }

  const combined = `${run.stdout}\n${run.stderr}`;
  const parseErrors = extractParseErrors(combined);

  // Verified engine fact: parse errors are reported as SCRIPT ERROR text while
  // the process STILL exits 0 — the verdict needs BOTH the clean exit AND zero
  // parse-error text (neither alone suffices).
  const crashLines = scanCrashLines(combined);
  const checkOk = run.exitStatus === 0 && parseErrors.length === 0 && crashLines.length === 0;

  const engineVersion = await probeVersion(executable, options);
  return {
    ok: true,
    projectRoot: root.projectRoot,
    scriptPath,
    checkOk,
    parseErrors,
    engineVersion,
  };
}

/** Extract structured parse errors from the engine's own reported text. */
function extractParseErrors(output: string): { line: number | null; column: number | null; message: string }[] {
  const errors: { line: number | null; column: number | null; message: string }[] = [];
  const lines = output.split(/\r?\n/);
  let pending: string | null = null;
  for (const line of lines) {
    const trimmed = line.trim();
    const scriptError = /^SCRIPT ERROR: (?:Parse Error: )?(.*)$/.exec(trimmed);
    if (scriptError) {
      pending = scriptError[1] ?? "";
      continue;
    }
    const at = /^at:\s+\S+\s+\((.*?):(\d+)\)/.exec(trimmed);
    if (at && pending !== null) {
      errors.push({ line: Number(at[2]), column: null, message: pending });
      pending = null;
      continue;
    }
    const failedToLoad = /ERROR: Failed to load script "([^"]+)" with error "([^"]+)"/.exec(trimmed);
    if (failedToLoad) {
      errors.push({ line: null, column: null, message: failedToLoad[2] ?? "" });
      continue;
    }
    if (pending !== null && trimmed === "") {
      pending = null;
    }
  }
  return errors;
}

async function probeVersion(executable: string, options: RunGodotOptions): Promise<string> {
  const run = await runGodotHeadless(executable, ["--version"], { ...options, timeoutMs: 60_000 });
  return (run.stdout || run.stderr).trim().split(/\r?\n/)[0]?.trim() ?? "";
}

// ---------------------------------------------------------------------------
// godot/asset.import -- staged copy + real --import pass + filesystem probe
// ---------------------------------------------------------------------------

export async function assetImport(
  executable: string,
  input: unknown,
  workspaceRoot: string,
  options: RunGodotOptions = {},
): Promise<AssetImportSuccess | EngineFailure> {
  const parsed = AssetImportInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const root = resolveProjectRoot(parsed.data, workspaceRoot);
  if (!root.ok) return root.failure;

  let sourcePath: string;
  let targetAssetPath: string;
  try {
    sourcePath = resolveWorkspacePath(parsed.data.sourcePath, workspaceRoot);
    targetAssetPath = resolveProjectPath(parsed.data.targetAssetPath, root.projectRoot);
  } catch (error) {
    return pathFailure(error);
  }
  if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
    return { ok: false, code: "source-file-missing", message: `source asset not found: ${sourcePath}` };
  }
  const targetDir = path.dirname(targetAssetPath);
  if (!existsSync(targetDir) || !statSync(targetDir).isDirectory()) {
    return { ok: false, code: "target-dir-missing", message: `import target directory not found: ${targetDir}` };
  }

  const sourceSha256 = await sha256File(sourcePath);
  await copyFile(sourcePath, targetAssetPath);

  const run = await runGodotHeadless(
    executable,
    ["--headless", "--path", root.projectRoot, "--import"],
    { ...options, timeoutMs: options.timeoutMs ?? OP_TIMEOUTS.assetImport },
  );
  if (run.spawnError !== null) {
    return { ok: false, code: "godot-run-failed", message: `failed to spawn ${executable}: ${run.spawnError}` };
  }
  if (run.timedOut) {
    return { ok: false, code: "godot-runaway", message: "import pass exceeded the bounded time and the process group was killed" };
  }

  // Fail closed on ENGINE-level crashes during the import pass. Script parse
  // diagnostics describe PRE-EXISTING project script state (any project may
  // legitimately contain scripts that do not compile — script.check is the
  // capability that reports them) and are surfaced as scriptDiagnostics, not
  // import failures; the FILESYSTEM PROBE below stays the sole import verdict
  // authority (capability contract: asset.import = filesystem-probe — exit 0
  // alone never proves an import).
  const crashLines = scanCrashLines(`${run.stdout}\n${run.stderr}`);
  const scriptDiagnostics = crashLines.filter((line) => SCRIPT_PARSE_DIAGNOSTIC.test(line));
  const fatalCrashLines = crashLines.filter((line) => !SCRIPT_PARSE_DIAGNOSTIC.test(line));
  if (run.exitStatus !== 0 || fatalCrashLines.length > 0) {
    return {
      ok: false,
      code: "import-run-failed",
      message: `the headless import pass failed (exit ${String(run.exitStatus)})`,
      details: { crashLines: fatalCrashLines, scriptDiagnostics },
    };
  }

  // Filesystem-probe verification: .godot/imported artifacts + .import metadata
  // exist AND the source sha256 is unchanged (a staged file alone proves nothing).
  const importedRoot = path.join(root.projectRoot, ".godot", "imported");
  const base = path.basename(targetAssetPath);
  const importedFiles: string[] = [];
  if (existsSync(importedRoot)) {
    for (const entry of readdirSync(importedRoot)) {
      if (entry.startsWith(`${base}-`) && !entry.endsWith(".md5")) {
        importedFiles.push(path.join(importedRoot, entry));
      }
    }
  }
  const importMetadataPath = `${targetAssetPath}.import`;
  if (importedFiles.length === 0 || !existsSync(importMetadataPath)) {
    return {
      ok: false,
      code: "import-not-verified",
      message: "the engine import pass produced no .godot/imported artifacts or .import metadata for the target — the import is not verified",
      details: { importedFiles, importMetadataPath },
    };
  }
  const afterSha = await sha256File(sourcePath);
  if (afterSha !== sourceSha256) {
    return {
      ok: false,
      code: "source-mutated",
      message: "the source asset changed during the import — refusing to claim a clean import",
      details: { before: sourceSha256, after: afterSha },
    };
  }

  return {
    ok: true,
    projectRoot: root.projectRoot,
    targetAssetPath,
    importedFiles: importedFiles.sort(),
    importMetadataPath,
    sourceSha256,
  };
}

// ---------------------------------------------------------------------------
// godot/project.run -- exit 0 AND zero crash lines
// ---------------------------------------------------------------------------

export async function projectRun(
  executable: string,
  input: unknown,
  workspaceRoot: string,
  options: RunGodotOptions = {},
): Promise<ProjectRunSuccess | EngineFailure> {
  const parsed = ProjectRunInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const root = resolveProjectRoot(parsed.data, workspaceRoot);
  if (!root.ok) return root.failure;

  const args: string[] = ["--headless", "--path", root.projectRoot];
  let scene: string | null = null;
  if (parsed.data.scene !== undefined) {
    try {
      // Path-safety confinement only — NO existence pre-flight: a missing
      // scene is the ENGINE's verdict to render (verified fact: Godot exits 0
      // with an "ERROR: Cannot open file" line; the crash-line scan below is
      // the authority, mirroring the exit-0-AND-zero-crash-lines discipline).
      const sceneAbs = resolveProjectPath(parsed.data.scene, root.projectRoot);
      scene = toResPath(sceneAbs, root.projectRoot);
      args.push(scene);
    } catch (error) {
      return pathFailure(error);
    }
  }
  args.push("--quit-after", String(parsed.data.quitAfterFrames));

  const run = await runGodotHeadless(executable, args, {
    ...options,
    timeoutMs: options.timeoutMs ?? OP_TIMEOUTS.projectRun,
  });
  if (run.spawnError !== null) {
    return { ok: false, code: "godot-run-failed", message: `failed to spawn ${executable}: ${run.spawnError}` };
  }
  if (run.timedOut) {
    return { ok: false, code: "godot-runaway", message: "the headless run exceeded the bounded time and the process group was killed" };
  }

  // Verified engine facts: a run without a main scene exits 0 with only an
  // "Error: Can't run project" line; a missing explicit scene exits 0 with only
  // an "ERROR: Cannot open file" line — the crash-line scan is the authority.
  const combined = `${run.stdout}\n${run.stderr}`;
  const crashLines = scanCrashLines(combined);
  if (run.exitStatus !== 0 || crashLines.length > 0) {
    return {
      ok: false,
      code: "run-crash-detected",
      message: `the headless run did not verify clean (exit ${String(run.exitStatus)}, ${crashLines.length} crash lines)`,
      details: { crashLines, stdoutTail: excerpt(run.stdout), stderrTail: excerpt(run.stderr) },
    };
  }

  return {
    ok: true,
    projectRoot: root.projectRoot,
    scene,
    exitCode: run.exitStatus ?? -1,
    stdoutTail: excerpt(run.stdout, 8192),
    stderrTail: excerpt(run.stderr, 8192),
    crashLines: [],
  };
}
