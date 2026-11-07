import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ZodError } from "zod";
import {
  BRIDGE_FILES,
  DEFAULT_SCENE_PATH,
  ProjectBuildInput,
  ProjectInspectInput,
  SceneModifyInput,
  SUPPORTED_BUILD_TARGETS,
  UNITY_EXECUTE_METHODS,
  parseUnityVersionOutput,
  resolveBridgeRoot,
  resolveWorkspacePath,
  type SceneOperation,
  type StructuredFailure,
} from "./typed-ops.js";
import { inspectUnityProject, type ProjectMetadata } from "./project.js";

/**
 * Unity execution layer.
 *
 * Every invocation spawns the real Unity Editor with an argument array
 * (`shell: false`) in batch mode (`-batchmode -nographics -projectPath …
 * -logFile -`), detached into its own process group, with bounded timeouts
 * (SIGTERM then SIGKILL process-tree kill on expiry), bounded output
 * collection and AbortSignal cancellation. Bridge communication is data-only:
 * a JSON params file goes in (`-gamosParams`), a JSON result file comes out
 * (`-gamosResult`), written by the fixed, committed, reviewed C# Editor
 * scripts copied into `<projectRoot>/Assets/Editor/Gamos/`.
 *
 * LICENSE HONESTY: licensing is never probed by discovery (slow) and never
 * fabricated. When a real batch invocation fails with Unity's license error
 * output, the operation returns the structured `license-required` failure —
 * an external, user-controlled prerequisite. "It looks like another Unity
 * instance is running" is a DIFFERENT failure class (editor-lock), never
 * license-required.
 */

export const DEFAULT_TIMEOUT_MS = 600_000; // 10 min bounded batch invocation (first import can be slow)
export const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const TERM_GRACE_MS = 5_000; // SIGTERM → SIGKILL escalation grace for the process tree

/**
 * The honest license-failure reason. Unity Editor licensing (Personal/Pro
 * activation) is an external, user-controlled prerequisite: credentials are
 * provided by the runner owner, never fabricated by this plugin.
 */
export const LICENSE_REQUIRED_REASON =
  "Unity Editor license required — an external, user-controlled prerequisite (provide credentials/license on the runner; never fabricated)";

// Unity's license failure output patterns ("It looks like another Unity
// instance is running" is deliberately NOT among them — different failure).
const LICENSE_FAILURE_PATTERNS: readonly RegExp[] = [
  /no valid Unity Editor license/i,
  /license could not be/i,
  /Licens[^\n]{0,120}fail/i, // e.g. "Licensing client check failed" (bounded to one line)
  /fail[^\n]{0,120}licens/i, // e.g. "Failed to activate license: no entitlement"
];
const ANOTHER_INSTANCE_PATTERN = /another Unity instance is running/i;

/**
 * Classify Unity batch output for the two failure classes that must never be
 * confused: an unlicensed editor (`license-required`) vs. a project lock held
 * by another editor instance (`editor-lock`). Normal output classifies as null.
 */
export function classifyUnityBatchOutput(output: string): "license-required" | "editor-lock" | null {
  if (ANOTHER_INSTANCE_PATTERN.test(output)) {
    return "editor-lock";
  }
  for (const pattern of LICENSE_FAILURE_PATTERNS) {
    if (pattern.test(output)) {
      return "license-required";
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Bounded batch process runner
// ---------------------------------------------------------------------------

export interface UnityBatchRun {
  exitStatus: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
  killed: boolean;
  aborted: boolean;
  spawnError: string | null;
  durationMs: number;
}

export interface RunUnityOptions {
  /** Kill the process tree after this many milliseconds (0 disables). */
  timeoutMs?: number;
  /** Working directory for the Unity process. */
  cwd?: string;
  /** Cap on collected stdout/stderr bytes (default 8 MiB; excess is drained). */
  maxOutputBytes?: number;
  /** AbortSignal-style handle: aborting SIGTERMs (then SIGKILLs) the process tree. */
  signal?: AbortSignal;
}

/**
 * Run a Unity batch invocation to completion:
 * `[exe, "-batchmode", "-nographics", "-projectPath", projectRoot, "-logFile", "-", ...args]`.
 * `-logFile -` routes the editor log to stdout so license/lock output is
 * capturable. Bounded timeout kills the whole process tree with SIGTERM and
 * escalates to SIGKILL after a bounded grace period.
 */
export async function runUnityBatch(
  exe: string,
  projectRoot: string,
  args: readonly string[],
  options: RunUnityOptions = {},
): Promise<UnityBatchRun> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const fullArgs = [
    "-batchmode",
    "-nographics",
    "-projectPath",
    projectRoot,
    "-logFile",
    "-",
    ...args,
  ];
  const startedAt = Date.now();

  return await new Promise<UnityBatchRun>((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(exe, fullArgs, {
        cwd: options.cwd,
        shell: false,
        detached: true, // own process group so the whole tree can be killed
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });
    } catch (error) {
      resolve({
        exitStatus: 127,
        signal: null,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        truncated: false,
        timedOut: false,
        killed: false,
        aborted: false,
        spawnError: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      });
      return;
    }

    let timedOut = false;
    let aborted = false;
    let truncated = false;
    let settled = false;
    let spawnError: string | null = null;
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    const killTree = () => {
      const pid = child.pid;
      if (pid === undefined) return;
      // SIGTERM first (cancellation contract), then bounded SIGKILL escalation
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        // process group already gone
      }
      try {
        child.kill("SIGTERM");
      } catch {
        // child already gone
      }
      setTimeout(() => {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          // process group already gone
        }
        try {
          child.kill("SIGKILL");
        } catch {
          // child already gone
        }
      }, TERM_GRACE_MS).unref?.();
    };

    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            killTree();
          }, timeoutMs)
        : null;

    const onAbort = () => {
      aborted = true;
      killTree();
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    const collect = (stream: NodeJS.ReadableStream | null, chunks: Buffer[]) => {
      if (!stream) return;
      let bytes = 0;
      stream.on("data", (chunk: Buffer) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        if (bytes < maxBytes) {
          const remaining = maxBytes - bytes;
          chunks.push(remaining >= buffer.length ? buffer : buffer.subarray(0, remaining));
          if (remaining < buffer.length) {
            truncated = true;
          }
        } else if (buffer.length > 0) {
          truncated = true;
        }
        bytes += buffer.length;
      });
    };
    collect(child.stdout, outChunks);
    collect(child.stderr, errChunks);

    const finish = (exitStatus: number | null, signal: string | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      resolve({
        exitStatus,
        signal,
        stdout: Buffer.concat(outChunks).toString("utf8"),
        stderr: Buffer.concat(errChunks).toString("utf8"),
        truncated,
        timedOut,
        killed: timedOut || aborted || signal === "SIGKILL" || signal === "SIGTERM",
        aborted,
        spawnError,
        durationMs: Date.now() - startedAt,
      });
    };

    child.once("error", (error) => {
      spawnError = error instanceof Error ? error.message : String(error);
      finish(127, null);
    });
    child.once("close", (code, sig) => finish(code ?? null, sig ?? null));
  });
}

/** Invocation evidence: the exact argument array handed to the executable. */
export function unityBatchInvocation(exe: string, projectRoot: string, args: readonly string[]): string[] {
  return [exe, "-batchmode", "-nographics", "-projectPath", projectRoot, "-logFile", "-", ...args];
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function invalidInput(error: ZodError): StructuredFailure {
  return {
    ok: false,
    code: "invalid-input",
    reason: error.issues
      .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
      .join("; "),
    details: error.issues,
  };
}

function pathFailure(error: unknown): StructuredFailure {
  return {
    ok: false,
    code: "path-safety",
    reason: error instanceof Error ? error.message : String(error),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tail(text: string, limit = 2000): string {
  return text.length <= limit ? text : text.slice(text.length - limit);
}

async function sha256File(file: string): Promise<string> {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

/**
 * Probe the exact editor version with the batch-safe `-version` flag
 * (bounded, tolerated failure → null — reported honestly, never guessed).
 */
function probeEditorVersionSync(exe: string): string | null {
  const probe = spawnSync(exe, ["-version"], {
    encoding: "utf8",
    timeout: 20_000,
    maxBuffer: 1024 * 1024,
    shell: false,
    windowsHide: true,
  });
  if (probe.error || probe.status !== 0) {
    return null;
  }
  return parseUnityVersionOutput(probe.stdout ?? "")?.raw ?? null;
}

interface ProjectRootResolution {
  projectRoot?: string;
  failure?: StructuredFailure;
}

function resolveProjectRoot(inputPath: string, workspaceRoot: string): ProjectRootResolution {
  try {
    return { projectRoot: resolveWorkspacePath(inputPath, workspaceRoot) };
  } catch (error) {
    return { failure: pathFailure(error) };
  }
}

/**
 * Copy the fixed, committed, reviewed C# bridge templates into
 * `<projectRoot>/Assets/Editor/Gamos/` (idempotent: always overwrite with the
 * reviewed content). Returns sha256 evidence per copied file.
 */
async function copyBridgeScripts(projectRoot: string): Promise<Array<{ name: string; sha256: string }>> {
  const bridgeRoot = resolveBridgeRoot();
  const destinationDir = path.join(projectRoot, "Assets", "Editor", "Gamos");
  await mkdir(destinationDir, { recursive: true });
  const copied: Array<{ name: string; sha256: string }> = [];
  for (const name of BRIDGE_FILES) {
    const source = path.join(bridgeRoot, name);
    const destination = path.join(destinationDir, name);
    await copyFile(source, destination);
    copied.push({ name, sha256: await sha256File(destination) });
  }
  return copied;
}

async function readJsonReport(reportPath: string): Promise<Record<string, unknown> | null> {
  if (!existsSync(reportPath)) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(await readFile(reportPath, "utf8"));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

interface BatchOutcome {
  failure?: StructuredFailure;
  run: UnityBatchRun;
  report: Record<string, unknown> | null;
}

/**
 * Run one bridged batch operation and reduce it to a structured outcome:
 * timeout → aborted → spawn-error → license-required / editor-lock →
 * bridge-error (the executed method's own failure report) → unity-exit →
 * bridge-protocol (no report) → success.
 */
async function runUnityOperation(
  exe: string,
  projectRoot: string,
  args: readonly string[],
  resultPath: string,
  options: RunUnityOptions,
  label: string,
): Promise<BatchOutcome> {
  const run = await runUnityBatch(exe, projectRoot, args, options);
  const report = await readJsonReport(resultPath);

  if (run.timedOut) {
    return {
      run,
      report,
      failure: {
        ok: false,
        code: "timeout",
        reason: `Unity batch ${label} timed out after ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms and the process tree was killed (SIGTERM then SIGKILL)`,
        details: { killed: run.killed, truncated: run.truncated },
      },
    };
  }
  if (run.aborted) {
    return {
      run,
      report,
      failure: {
        ok: false,
        code: "aborted",
        reason: `Unity batch ${label} was aborted and the process tree was killed`,
      },
    };
  }
  if (run.spawnError) {
    return {
      run,
      report,
      failure: {
        ok: false,
        code: "spawn-error",
        reason: `failed to run the Unity Editor for ${label}: ${run.spawnError}`,
      },
    };
  }

  const combinedOutput = `${run.stdout}\n${run.stderr}`;
  const classification = classifyUnityBatchOutput(combinedOutput);
  if (classification === "license-required") {
    return {
      run,
      report,
      failure: {
        ok: false,
        code: "license-required",
        reason: LICENSE_REQUIRED_REASON,
        details: { exitStatus: run.exitStatus, outputTail: tail(combinedOutput) },
      },
    };
  }
  if (classification === "editor-lock") {
    return {
      run,
      report,
      failure: {
        ok: false,
        code: "editor-lock",
        reason:
          "another Unity instance appears to be running with this project open (project Temp lock) — not a license failure; retry after the other instance closes",
        details: { exitStatus: run.exitStatus, outputTail: tail(combinedOutput) },
      },
    };
  }

  if (report && report.ok !== true) {
    return {
      run,
      report,
      failure: {
        ok: false,
        code: "bridge-error",
        reason:
          typeof report.error === "string" && report.error.length > 0
            ? `the executed Unity method failed: ${report.error}`
            : `the executed Unity method reported failure for ${label}`,
        details: { report, stderrTail: tail(run.stderr) },
      },
    };
  }

  if (run.exitStatus !== 0) {
    return {
      run,
      report,
      failure: {
        ok: false,
        code: "unity-exit",
        reason: `Unity batch ${label} exited with ${
          run.exitStatus === null ? `signal ${run.signal ?? "unknown"}` : `code ${run.exitStatus}`
        }`,
        details: { outputTail: tail(combinedOutput), report },
      },
    };
  }

  if (!report) {
    return {
      run,
      report,
      failure: {
        ok: false,
        code: "bridge-protocol",
        reason: `the executed Unity method did not produce a valid result report for ${label} (expected ${resultPath})`,
        details: { stdoutTail: tail(run.stdout), stderrTail: tail(run.stderr) },
      },
    };
  }

  return { run, report };
}

// ---------------------------------------------------------------------------
// project_inspect (NO editor needed — pure project-marker inspection)
// ---------------------------------------------------------------------------

export type ProjectInspectSuccess = ProjectMetadata;
export type ProjectInspectOutcome = ProjectInspectSuccess | StructuredFailure;

/**
 * Inspect a Unity project's real markers. The capability's availability is
 * conditional on the project root only — no Unity Editor is required or
 * probed, and a passing inspection is NOT editor-availability evidence.
 */
export async function projectInspect(
  input: unknown,
  workspaceRoot: string,
): Promise<ProjectInspectOutcome> {
  const parsed = ProjectInspectInput.safeParse(input);
  if (!parsed.success) {
    return invalidInput(parsed.error);
  }
  const resolved = resolveProjectRoot(parsed.data.projectRoot, workspaceRoot);
  if (resolved.failure) {
    return resolved.failure;
  }
  const metadata = inspectUnityProject(resolved.projectRoot as string);
  if (!metadata.ok) {
    return metadata;
  }
  return metadata;
}

// ---------------------------------------------------------------------------
// scene_modify
// ---------------------------------------------------------------------------

export interface SceneModifyVerification {
  sceneFileExists: boolean;
  methodReportedSuccess: boolean;
  exitStatusZero: boolean;
}

export interface SceneModifySuccess {
  ok: true;
  projectRoot: string;
  operation: SceneOperation;
  executeMethod: string;
  invocation: string[];
  editor: { executable: string; rawVersion: string | null };
  exitStatus: number | null;
  applied: boolean;
  /** Project-relative scene path (add-cube only; null for set-active-build-target). */
  scenePath: string | null;
  changedScene: { path: string; sha256Before: string | null; sha256After: string | null } | null;
  bridgeFiles: Array<{ name: string; sha256: string }>;
  verification: SceneModifyVerification;
  resultReport: Record<string, unknown> | null;
  durationMs: number;
}

/** Params JSON shape the reviewed C# bridges deserialize (JsonUtility). */
interface AddCubeParamsFile {
  name: string;
  location: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
  scenePath: string;
}

function vec3Object(tuple: readonly [number, number, number] | undefined, fallback: readonly [number, number, number]): { x: number; y: number; z: number } {
  const source = tuple ?? fallback;
  return { x: source[0], y: source[1], z: source[2] };
}

export async function sceneModify(
  exe: string,
  input: unknown,
  workspaceRoot: string,
  options: RunUnityOptions = {},
): Promise<SceneModifySuccess | StructuredFailure> {
  const parsed = SceneModifyInput.safeParse(input);
  if (!parsed.success) {
    return invalidInput(parsed.error);
  }
  const resolved = resolveProjectRoot(parsed.data.projectRoot, workspaceRoot);
  if (resolved.failure) {
    return resolved.failure;
  }
  const projectRoot = resolved.projectRoot as string;

  // fail closed: only operate on directories that ARE Unity projects
  const metadata = inspectUnityProject(projectRoot);
  if (!metadata.ok) {
    return metadata;
  }

  const operation = parsed.data.operation;
  const executeMethod = UNITY_EXECUTE_METHODS[operation];
  const parameters = parsed.data.parameters ?? {};
  const editorVersion = probeEditorVersionSync(exe);

  // 1. copy the reviewed bridge templates into the project (idempotent)
  const bridgeFiles = await copyBridgeScripts(projectRoot);

  // 2. write the typed params JSON (data-only bridge communication)
  const gamosDir = path.join(projectRoot, "Gamos");
  await mkdir(gamosDir, { recursive: true });
  const paramsPath = path.join(gamosDir, "params.json");
  const resultPath = path.join(gamosDir, "result.json");

  let scenePathRelative: string | null = null;
  let sceneFileAbsolute: string | null = null;
  let sha256Before: string | null = null;

  if (operation === "scene.add-cube") {
    const addCube = parameters as {
      name?: string;
      location?: [number, number, number];
      scale?: [number, number, number];
      scenePath?: string;
    };
    scenePathRelative = addCube.scenePath ?? DEFAULT_SCENE_PATH;
    sceneFileAbsolute = path.join(projectRoot, ...scenePathRelative.split("/"));
    if (existsSync(sceneFileAbsolute)) {
      sha256Before = await sha256File(sceneFileAbsolute);
    }
    const paramsFile: AddCubeParamsFile = {
      name: typeof addCube.name === "string" && addCube.name.length > 0 ? addCube.name : "GamosCube",
      location: vec3Object(addCube.location, [0, 0, 0]),
      scale: vec3Object(addCube.scale, [1, 1, 1]),
      scenePath: scenePathRelative,
    };
    await writeFile(paramsPath, JSON.stringify(paramsFile, null, 2));
  } else {
    const buildTargetFile = parameters as { buildTarget?: string };
    const buildTarget = buildTargetFile.buildTarget ?? SUPPORTED_BUILD_TARGETS[0];
    await writeFile(paramsPath, JSON.stringify({ buildTarget }, null, 2));
  }

  // 3. run the real editor in batch mode with the reviewed executeMethod
  const args = [
    "-quit",
    "-executeMethod",
    executeMethod,
    "-gamosParams",
    paramsPath,
    "-gamosResult",
    resultPath,
  ];
  const label = `scene modify (${operation})`;
  const { failure, run, report } = await runUnityOperation(exe, projectRoot, args, resultPath, options, label);
  if (failure) {
    return failure;
  }

  // 4. VERIFICATION (honest, engine-side): the executed method's result JSON,
  //    exit status 0, and — for add-cube — the saved scene file on disk with
  //    its sha256 recorded. Full scene re-inspection happens through the same
  //    batch path on licensed runners (the result JSON is the executed
  //    method's post-state report).
  const verification: SceneModifyVerification = {
    sceneFileExists: sceneFileAbsolute === null ? false : existsSync(sceneFileAbsolute),
    methodReportedSuccess: report?.ok === true,
    exitStatusZero: run.exitStatus === 0,
  };

  let changedScene: SceneModifySuccess["changedScene"] = null;
  if (operation === "scene.add-cube") {
    const sceneFile = sceneFileAbsolute as string;
    if (!verification.sceneFileExists) {
      return {
        ok: false,
        code: "verification-failed",
        reason: `the scene file was not written by the executed method: ${scenePathRelative}`,
        details: { verification, report },
      };
    }
    const sha256After = await sha256File(sceneFile);
    changedScene = {
      path: scenePathRelative as string,
      sha256Before,
      sha256After,
    };
  }

  return {
    ok: true,
    projectRoot,
    operation,
    executeMethod,
    invocation: unityBatchInvocation(exe, projectRoot, args),
    editor: { executable: exe, rawVersion: editorVersion },
    exitStatus: run.exitStatus,
    applied: report?.ok === true,
    scenePath: scenePathRelative,
    changedScene,
    bridgeFiles,
    verification,
    resultReport: report,
    durationMs: run.durationMs,
  };
}

// ---------------------------------------------------------------------------
// project_build
// ---------------------------------------------------------------------------

export interface ProjectBuildSuccess {
  ok: true;
  projectRoot: string;
  buildTarget: string;
  executeMethod: string;
  invocation: string[];
  editor: { executable: string; rawVersion: string | null };
  scenes: string[];
  buildDir: string;
  artifact: { path: string; bytes: number; sha256: string } | null;
  bridgeFiles: Array<{ name: string; sha256: string }>;
  exitStatus: number | null;
  resultReport: Record<string, unknown> | null;
  durationMs: number;
}

export async function projectBuild(
  exe: string,
  input: unknown,
  workspaceRoot: string,
  options: RunUnityOptions = {},
): Promise<ProjectBuildSuccess | StructuredFailure> {
  const parsed = ProjectBuildInput.safeParse(input);
  if (!parsed.success) {
    return invalidInput(parsed.error);
  }
  const resolved = resolveProjectRoot(parsed.data.projectRoot, workspaceRoot);
  if (resolved.failure) {
    return resolved.failure;
  }
  const projectRoot = resolved.projectRoot as string;

  // fail closed: only operate on directories that ARE Unity projects
  const metadata = inspectUnityProject(projectRoot);
  if (!metadata.ok) {
    return metadata;
  }
  if (metadata.sceneFiles.length === 0) {
    return {
      ok: false,
      code: "no-scenes",
      reason: `the Unity project at ${projectRoot} has no Assets/**/*.unity scene to build`,
    };
  }

  const buildTarget = parsed.data.buildTarget;
  const executeMethod = UNITY_EXECUTE_METHODS["project.build"];
  const editorVersion = probeEditorVersionSync(exe);

  // 1. copy the reviewed bridge templates into the project (idempotent)
  const bridgeFiles = await copyBridgeScripts(projectRoot);

  // 2. write the typed params JSON: build target + the inspected scene list
  const gamosDir = path.join(projectRoot, "Gamos");
  await mkdir(gamosDir, { recursive: true });
  const paramsPath = path.join(gamosDir, "params.json");
  const resultPath = path.join(gamosDir, "result.json");
  await writeFile(paramsPath, JSON.stringify({ buildTarget, scenes: metadata.sceneFiles }, null, 2));

  // 3. run the real editor in batch mode with the reviewed executeMethod
  const args = [
    "-quit",
    "-executeMethod",
    executeMethod,
    "-gamosParams",
    paramsPath,
    "-gamosResult",
    resultPath,
  ];
  const label = `project build (${buildTarget})`;
  const { failure, run, report } = await runUnityOperation(exe, projectRoot, args, resultPath, options, label);
  if (failure) {
    return failure;
  }

  // 4. VERIFICATION: the build artifact directory exists and the main artifact
  //    is present, non-empty, and hashed.
  const buildDir = path.join(projectRoot, "Builds", buildTarget);
  if (!existsSync(buildDir)) {
    return {
      ok: false,
      code: "verification-failed",
      reason: `the build directory was not written by the executed method: ${buildDir}`,
      details: { report },
    };
  }

  let artifact: ProjectBuildSuccess["artifact"] = null;
  const reportedArtifactPath = typeof report?.artifactPath === "string" ? report.artifactPath : "";
  if (reportedArtifactPath.length > 0) {
    if (!existsSync(reportedArtifactPath)) {
      return {
        ok: false,
        code: "verification-failed",
        reason: `the reported build artifact does not exist: ${reportedArtifactPath}`,
        details: { report },
      };
    }
    const bytes = (await stat(reportedArtifactPath)).size;
    if (bytes <= 0) {
      return {
        ok: false,
        code: "verification-failed",
        reason: `the build artifact is empty: ${reportedArtifactPath}`,
        details: { report },
      };
    }
    artifact = { path: reportedArtifactPath, bytes, sha256: await sha256File(reportedArtifactPath) };
  }

  return {
    ok: true,
    projectRoot,
    buildTarget,
    executeMethod,
    invocation: unityBatchInvocation(exe, projectRoot, args),
    editor: { executable: exe, rawVersion: editorVersion },
    scenes: metadata.sceneFiles,
    buildDir,
    artifact,
    bridgeFiles,
    exitStatus: run.exitStatus,
    resultReport: report,
    durationMs: run.durationMs,
  };
}
