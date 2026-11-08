import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ZodError } from "zod";
import {
  BRIDGE_MARKER,
  AssetExportInput,
  SceneInspectInput,
  SceneModifyInput,
  SceneRenderInput,
  buildBridgeScript,
  buildExportBridgeConfig,
  dependentFileMediaType,
  expectationsFromOperations,
  resolveBridgeRoot,
  resolveWorkspacePath,
  verifySceneReport,
  type ObjectSummary,
  type SceneSummary,
} from "./typed-ops.js";

/**
 * Blender execution layer.
 *
 * Every invocation spawns the real executable with an argument array
 * (`shell: false`), a bounded timeout that kills the whole process tree, and
 * bounded output collection. Bridge communication is data-only: a JSON input
 * file goes in, a JSON report file comes out (pointed at by a stdout marker).
 */

export const DEFAULT_TIMEOUT_MS = 300_000;
export const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

export interface RunBlenderOptions {
  /** Kill the process tree after this many milliseconds. */
  timeoutMs?: number;
  /** Working directory for the Blender process. */
  cwd?: string;
  /** Cap on collected stdout/stderr bytes (default 8 MiB; excess is drained). */
  maxOutputBytes?: number;
  /** AbortSignal-style handle: aborting kills the process tree. */
  signal?: AbortSignal;
}

export interface BlenderRun {
  exitStatus: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
  killed: boolean;
  aborted: boolean;
  spawnError: string | null;
}

export interface EngineFailure {
  ok: false;
  code: string;
  message: string;
  details?: unknown;
}

export interface BootstrapSuccess {
  ok: true;
  blendFile: string;
  bytes: number;
  sha256: string;
}

export interface InspectSuccess {
  ok: true;
  blendFile: string;
  blenderVersion: string;
  sceneCount: number;
  scenes: SceneSummary[];
}

export interface ModifyVerification {
  ok: boolean;
  failures: string[];
  inspectedObjects: number;
}

export interface ModifySuccess {
  ok: true;
  blendFile: string;
  applied: unknown[];
  saved: boolean;
  sha256: string | null;
  verification: ModifyVerification;
}

export interface RenderSuccess {
  ok: true;
  outputPath: string;
  bytes: number;
  sha256: string;
  engine: string;
  device: string | null;
  resolution: { x: number; y: number };
  cameraProvisioned: boolean;
}

/** Interchange semantics actually applied by the exporter (echoed by the bridge, not assumed). */
export interface AppliedExportInterchange {
  readonly format: "fbx" | "glb" | "obj";
  readonly handedness: "left" | "right";
  readonly upAxis: "y" | "z";
  readonly forwardAxis?: string;
  readonly units: string;
  readonly scaleFactor?: number;
  readonly appliedTransforms?: string;
  readonly materials?: {
    readonly referenced: readonly string[];
    readonly embedded: boolean;
  };
}

/** A dependent/sidecar file written by the export and re-verified by the engine. */
export interface ExportDependentFileRecord {
  readonly path: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly sha256: string;
}

export interface ExportSuccess {
  ok: true;
  outputPath: string;
  bytes: number;
  sha256: string;
  format: string;
  selection: string[] | null;
  /** Exact Blender version string from the executing engine (manifest source provenance). */
  readonly blenderVersion: string;
  /** sha256 of the source .blend file as exported (manifest source provenance). */
  readonly sourceSha256: string;
  /** Scene unit scale (1.0 = meter) observed by the bridge. */
  readonly unitScale: number;
  /** The interchange semantics actually applied by the exporter. */
  readonly appliedInterchange: AppliedExportInterchange;
  /** Engine-verified dependent/sidecar files (e.g. OBJ .mtl, copied textures). */
  readonly dependentFiles: readonly ExportDependentFileRecord[];
}

// ---------------------------------------------------------------------------
// Headless process runner
// ---------------------------------------------------------------------------

export async function runBlenderHeadless(
  executable: string,
  args: string[],
  options: RunBlenderOptions = {},
): Promise<BlenderRun> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  return await new Promise<BlenderRun>((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(executable, args, {
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
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // process group already gone
        }
        try {
          child.kill("SIGKILL");
        } catch {
          // child already gone
        }
      }
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
        killed: timedOut || aborted || signal === "SIGKILL",
        aborted,
        spawnError,
      });
    };

    child.once("error", (error) => {
      spawnError = error instanceof Error ? error.message : String(error);
      finish(127, null);
    });
    child.once("close", (code, sig) => finish(code ?? null, sig ?? null));
  });
}

// ---------------------------------------------------------------------------
// Bridge protocol helpers
// ---------------------------------------------------------------------------

export function extractBridgeReportPath(stdout: string): string | null {
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith(BRIDGE_MARKER)) {
      const reportPath = trimmed.slice(BRIDGE_MARKER.length).trim();
      return reportPath.length > 0 ? reportPath : null;
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function tail(text: string, limit = 2000): string {
  return text.length <= limit ? text : text.slice(text.length - limit);
}

async function sha256File(file: string): Promise<string> {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function withTempDir<T>(work: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "gamos-blender-"));
  try {
    return await work(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function bridgeScript(name: string): string {
  return path.join(resolveBridgeRoot(), name);
}

function invalidInput(error: ZodError): EngineFailure {
  return {
    ok: false,
    code: "invalid-input",
    message: error.issues
      .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
      .join("; "),
    details: error.issues,
  };
}

function pathFailure(error: unknown): EngineFailure {
  return {
    ok: false,
    code: "path-safety",
    message: error instanceof Error ? error.message : String(error),
  };
}

interface BridgeOutcome {
  failure?: EngineFailure;
  run: BlenderRun;
  report?: Record<string, unknown> | null;
}

async function runBridge(
  executable: string,
  args: string[],
  options: RunBlenderOptions,
  label: string,
): Promise<BridgeOutcome> {
  const run = await runBlenderHeadless(executable, args, options);
  if (run.timedOut) {
    return {
      run,
      failure: {
        ok: false,
        code: "timeout",
        message: `Blender ${label} timed out after ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms and the process tree was killed`,
        details: { killed: run.killed, truncated: run.truncated },
      },
    };
  }
  if (run.aborted) {
    return {
      run,
      failure: {
        ok: false,
        code: "aborted",
        message: `Blender ${label} was aborted and the process tree was killed`,
      },
    };
  }
  if (run.spawnError) {
    return {
      run,
      failure: {
        ok: false,
        code: "spawn-error",
        message: `failed to run Blender for ${label}: ${run.spawnError}`,
      },
    };
  }

  const reportPath = extractBridgeReportPath(run.stdout);
  let report: Record<string, unknown> | null = null;
  if (reportPath && existsSync(reportPath)) {
    try {
      const parsed: unknown = JSON.parse(await readFile(reportPath, "utf8"));
      if (isRecord(parsed)) {
        report = parsed;
      }
    } catch {
      report = null;
    }
  }

  if (run.exitStatus !== 0) {
    return {
      run,
      report,
      failure: {
        ok: false,
        code: "blender-exit",
        message: `Blender ${label} exited with ${
          run.exitStatus === null ? `signal ${run.signal ?? "unknown"}` : `code ${run.exitStatus}`
        }`,
        details: { stderr: tail(run.stderr), report },
      },
    };
  }
  if (!report) {
    return {
      run,
      failure: {
        ok: false,
        code: "bridge-protocol",
        message: `bridge did not produce a valid report for ${label}`,
        details: { stdoutTail: tail(run.stdout), stderrTail: tail(run.stderr) },
      },
    };
  }
  if (report.ok !== true) {
    return {
      run,
      report,
      failure: {
        ok: false,
        code: "bridge-error",
        message: typeof report.error === "string" ? report.error : `bridge ${label} failed`,
        details: report,
      },
    };
  }
  return { run, report };
}

function numTriple(value: unknown): number[] | undefined {
  if (
    Array.isArray(value) &&
    value.length >= 3 &&
    value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
  ) {
    return [value[0] as number, value[1] as number, value[2] as number];
  }
  return undefined;
}

function parseScenes(value: unknown): SceneSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const scenes: SceneSummary[] = [];
  for (const scene of value) {
    if (!isRecord(scene)) continue;
    const objects: ObjectSummary[] = [];
    if (Array.isArray(scene.objects)) {
      for (const object of scene.objects) {
        if (!isRecord(object)) continue;
        const materialColor = numTriple(object.materialColor);
        objects.push({
          name: typeof object.name === "string" ? object.name : "",
          type: typeof object.type === "string" ? object.type : "",
          location: numTriple(object.location),
          rotation: numTriple(object.rotation),
          scale: numTriple(object.scale),
          materialColor: materialColor ?? null,
        });
      }
    }
    scenes.push({
      name: typeof scene.name === "string" ? scene.name : "",
      objectCount: typeof scene.objectCount === "number" ? scene.objectCount : objects.length,
      objects,
    });
  }
  return scenes;
}

// ---------------------------------------------------------------------------
// Typed operations
// ---------------------------------------------------------------------------

/** Save an empty scene (reviewed bridge: `save_empty.py`) to bootstrap workspaces. */
export async function bootstrapEmptyScene(
  executable: string,
  outputPath: string,
  options: RunBlenderOptions = {},
): Promise<BootstrapSuccess | EngineFailure> {
  if (typeof outputPath !== "string" || !path.isAbsolute(outputPath)) {
    return {
      ok: false,
      code: "invalid-input",
      message: `outputPath must be absolute: ${String(outputPath)}`,
    };
  }
  await mkdir(path.dirname(outputPath), { recursive: true });
  return withTempDir(async (tmp) => {
    const inputPath = path.join(tmp, "save-input.json");
    const reportPath = path.join(tmp, "save-report.json");
    await writeFile(inputPath, JSON.stringify({ outputPath }));
    const args = [
      "-b",
      "--factory-startup",
      "--python",
      bridgeScript("save_empty.py"),
      "--",
      inputPath,
      reportPath,
    ];
    const { failure } = await runBridge(executable, args, options, "scene bootstrap");
    if (failure) {
      return failure;
    }
    if (!existsSync(outputPath)) {
      return {
        ok: false,
        code: "bootstrap-artifact-missing",
        message: `bootstrap did not produce ${outputPath}`,
      };
    }
    const bytes = (await stat(outputPath)).size;
    if (bytes <= 0) {
      return {
        ok: false,
        code: "bootstrap-artifact-empty",
        message: `bootstrap artifact is empty: ${outputPath}`,
      };
    }
    return { ok: true, blendFile: outputPath, bytes, sha256: await sha256File(outputPath) };
  });
}

export async function sceneInspect(
  executable: string,
  input: unknown,
  workspaceRoot: string,
  options: RunBlenderOptions = {},
): Promise<InspectSuccess | EngineFailure> {
  const parsed = SceneInspectInput.safeParse(input);
  if (!parsed.success) {
    return invalidInput(parsed.error);
  }
  let blendFile: string;
  try {
    blendFile = resolveWorkspacePath(parsed.data.blendFile, workspaceRoot);
  } catch (error) {
    return pathFailure(error);
  }
  if (!existsSync(blendFile)) {
    return {
      ok: false,
      code: "blend-file-missing",
      message: `blend file not found: ${blendFile}`,
    };
  }
  return withTempDir(async (tmp) => {
    const inputPath = path.join(tmp, "inspect-input.json");
    const reportPath = path.join(tmp, "inspect-report.json");
    await writeFile(inputPath, JSON.stringify({}));
    const args = ["-b", blendFile, "--python", bridgeScript("inspect.py"), "--", inputPath, reportPath];
    const { failure, report } = await runBridge(executable, args, options, "scene inspect");
    if (failure) {
      return failure;
    }
    const scenes = parseScenes(report?.scenes);
    const blenderVersion =
      report && typeof report.blenderVersion === "string" ? report.blenderVersion : "unknown";
    return { ok: true, blendFile, blenderVersion, sceneCount: scenes.length, scenes };
  });
}

export async function sceneModify(
  executable: string,
  input: unknown,
  workspaceRoot: string,
  options: RunBlenderOptions = {},
): Promise<ModifySuccess | EngineFailure> {
  const parsed = SceneModifyInput.safeParse(input);
  if (!parsed.success) {
    return invalidInput(parsed.error);
  }
  let blendFile: string;
  try {
    blendFile = resolveWorkspacePath(parsed.data.blendFile, workspaceRoot);
  } catch (error) {
    return pathFailure(error);
  }
  if (!existsSync(blendFile)) {
    return {
      ok: false,
      code: "blend-file-missing",
      message: `blend file not found: ${blendFile}`,
    };
  }
  const save = parsed.data.save === true;
  return withTempDir(async (tmp) => {
    const opsPath = path.join(tmp, "ops.json");
    const reportPath = path.join(tmp, "apply-report.json");
    await writeFile(opsPath, JSON.stringify({ blendFile, operations: parsed.data.operations, save }));
    // the plan references the FIXED committed template; only the JSON data path varies
    const plan = buildBridgeScript(opsPath);
    const args = ["-b", blendFile, "--python", plan.scriptPath, "--", ...plan.args, reportPath];
    const { failure, report } = await runBridge(executable, args, options, "scene modify");
    if (failure) {
      return failure;
    }
    const applied = Array.isArray(report?.applied) ? report!.applied : [];
    const saved = report?.saved === true;
    const sha256 = saved ? await sha256File(blendFile) : null;

    // VERIFICATION (engine-query): re-open the saved scene headlessly and assert
    // the expected object state — the exit code alone proves nothing.
    let verification: ModifyVerification;
    if (!saved) {
      verification = {
        ok: false,
        failures: ["verification skipped: operations were not saved (save=false)"],
        inspectedObjects: 0,
      };
    } else {
      const inspectOutcome = await sceneInspect(executable, { blendFile }, workspaceRoot, options);
      if (!inspectOutcome.ok) {
        verification = {
          ok: false,
          failures: [
            `verification inspect failed (${inspectOutcome.code}): ${inspectOutcome.message}`,
          ],
          inspectedObjects: 0,
        };
      } else {
        const expected = expectationsFromOperations(parsed.data.operations);
        const check = verifySceneReport({ scenes: inspectOutcome.scenes }, expected);
        verification = {
          ok: check.ok,
          failures: check.failures,
          inspectedObjects: inspectOutcome.scenes.reduce((count, scene) => count + scene.objects.length, 0),
        };
      }
    }
    if (!verification.ok) {
      return {
        ok: false,
        code: "verification-failed",
        message: "post-modification scene verification failed",
        details: { applied, saved, sha256, verification },
      };
    }
    return { ok: true, blendFile, applied, saved, sha256, verification };
  });
}

export async function sceneRender(
  executable: string,
  input: unknown,
  workspaceRoot: string,
  options: RunBlenderOptions = {},
): Promise<RenderSuccess | EngineFailure> {
  const parsed = SceneRenderInput.safeParse(input);
  if (!parsed.success) {
    return invalidInput(parsed.error);
  }
  let blendFile: string;
  let outputPath: string;
  try {
    blendFile = resolveWorkspacePath(parsed.data.blendFile, workspaceRoot);
    outputPath = resolveWorkspacePath(parsed.data.outputPath, workspaceRoot);
  } catch (error) {
    return pathFailure(error);
  }
  if (!existsSync(blendFile)) {
    return {
      ok: false,
      code: "blend-file-missing",
      message: `blend file not found: ${blendFile}`,
    };
  }
  await mkdir(path.dirname(outputPath), { recursive: true });
  return withTempDir(async (tmp) => {
    const configPath = path.join(tmp, "render-config.json");
    const reportPath = path.join(tmp, "render-report.json");
    await writeFile(
      configPath,
      JSON.stringify({
        outputPath,
        engine: parsed.data.engine ?? "CYCLES",
        resolution: parsed.data.resolution ?? null,
      }),
    );
    const args = ["-b", blendFile, "--python", bridgeScript("set_render.py"), "--", configPath, reportPath];
    const { failure, report } = await runBridge(executable, args, options, "scene render");
    if (failure) {
      return failure;
    }
    const writtenTo = report && typeof report.writtenTo === "string" ? report.writtenTo : outputPath;
    if (!existsSync(writtenTo)) {
      return {
        ok: false,
        code: "render-artifact-missing",
        message: `render artifact missing: ${writtenTo}`,
      };
    }
    const bytes = (await stat(writtenTo)).size;
    if (bytes <= 0) {
      return {
        ok: false,
        code: "render-artifact-empty",
        message: `render artifact is empty: ${writtenTo}`,
      };
    }
    return {
      ok: true,
      outputPath: writtenTo,
      bytes,
      sha256: await sha256File(writtenTo),
      engine: report && typeof report.engine === "string" ? report.engine : parsed.data.engine ?? "CYCLES",
      device: report && typeof report.device === "string" ? report.device : null,
      resolution: {
        x: resolutionAxis(report?.resolutionX, 1920),
        y: resolutionAxis(report?.resolutionY, 1080),
      },
      cameraProvisioned: report?.cameraProvisioned === true,
    };
  });
}

function resolutionAxis(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Re-verify bridge-reported dependent files against the filesystem (trust but
 * verify): every record must exist, be non-empty, and its recomputed size and
 * sha256 must match the bridge report exactly. Exported for failure-path tests.
 */
export async function verifyExportDependentFileRecords(
  records: readonly unknown[],
): Promise<{ ok: true; records: readonly ExportDependentFileRecord[] } | EngineFailure> {
  const verified: ExportDependentFileRecord[] = [];
  for (const entry of records) {
    if (!entry || typeof entry !== "object" || typeof (entry as Record<string, unknown>).path !== "string" || typeof (entry as Record<string, unknown>).sha256 !== "string") {
      return {
        ok: false,
        code: "export-dependent-file-invalid",
        message: `bridge reported a malformed dependent file record: ${JSON.stringify(entry)}`,
      };
    }
    const record = entry as { path: string; sha256: string; bytes?: unknown };
    if (!existsSync(record.path)) {
      return {
        ok: false,
        code: "export-dependent-file-missing",
        message: `dependent file reported by the bridge is missing: ${record.path}`,
      };
    }
    const dependentBytes = (await stat(record.path)).size;
    if (dependentBytes <= 0) {
      return {
        ok: false,
        code: "export-dependent-file-empty",
        message: `dependent file is empty: ${record.path}`,
      };
    }
    const dependentSha = await sha256File(record.path);
    if (dependentSha !== record.sha256 || dependentBytes !== record.bytes) {
      return {
        ok: false,
        code: "export-dependent-file-hash-mismatch",
        message: `dependent file integrity mismatch (reported bytes=${String(record.bytes)} sha256=${record.sha256}, observed bytes=${dependentBytes} sha256=${dependentSha}): ${record.path}`,
      };
    }
    verified.push({
      path: record.path,
      mediaType: dependentFileMediaType(record.path),
      byteLength: dependentBytes,
      sha256: dependentSha,
    });
  }
  return { ok: true, records: verified };
}

export async function assetExport(
  executable: string,
  input: unknown,
  workspaceRoot: string,
  options: RunBlenderOptions = {},
): Promise<ExportSuccess | EngineFailure> {
  const parsed = AssetExportInput.safeParse(input);
  if (!parsed.success) {
    return invalidInput(parsed.error);
  }
  let blendFile: string;
  let outputPath: string;
  try {
    blendFile = resolveWorkspacePath(parsed.data.blendFile, workspaceRoot);
    outputPath = resolveWorkspacePath(parsed.data.outputPath, workspaceRoot);
  } catch (error) {
    return pathFailure(error);
  }
  if (!existsSync(blendFile)) {
    return {
      ok: false,
      code: "blend-file-missing",
      message: `blend file not found: ${blendFile}`,
    };
  }
  // Source provenance: hash the .blend as exported (the export never mutates the source).
  const sourceSha256 = await sha256File(blendFile);
  await mkdir(path.dirname(outputPath), { recursive: true });
  return withTempDir(async (tmp) => {
    const configPath = path.join(tmp, "export-config.json");
    const reportPath = path.join(tmp, "export-report.json");
    await writeFile(
      configPath,
      JSON.stringify(
        buildExportBridgeConfig({
          outputPath,
          format: parsed.data.format,
          selection: parsed.data.selection,
          interchange: parsed.data.interchange,
        }),
      ),
    );
    const args = ["-b", blendFile, "--python", bridgeScript("export_asset.py"), "--", configPath, reportPath];
    const { failure, report } = await runBridge(executable, args, options, "asset export");
    if (failure) {
      return failure;
    }
    const writtenTo = report && typeof report.writtenTo === "string" ? report.writtenTo : outputPath;
    if (!existsSync(writtenTo)) {
      return {
        ok: false,
        code: "export-artifact-missing",
        message: `export artifact missing: ${writtenTo}`,
      };
    }
    const bytes = (await stat(writtenTo)).size;
    if (bytes <= 0) {
      return {
        ok: false,
        code: "export-artifact-empty",
        message: `export artifact is empty: ${writtenTo}`,
      };
    }

    // Dependent files: trust but verify — re-hash every bridge-reported sidecar.
    const dependent = await verifyExportDependentFileRecords(
      Array.isArray(report?.dependentFiles) ? report.dependentFiles : [],
    );
    if (!dependent.ok) {
      return dependent;
    }
    const dependentFiles = dependent.records;

    const blenderVersion =
      report && typeof report.blenderVersion === "string" && report.blenderVersion.length > 0
        ? report.blenderVersion
        : "";
    if (blenderVersion === "") {
      return {
        ok: false,
        code: "export-provenance-missing",
        message: "the bridge did not report the executing Blender version (manifest source provenance is mandatory)",
      };
    }
    const unitScale =
      report && typeof report.unitScale === "number" && Number.isFinite(report.unitScale) ? report.unitScale : 1;
    const applied =
      report && typeof report.applied === "object" && report.applied !== null
        ? (report.applied as Record<string, unknown>)
        : {};
    const appliedUpAxis = applied.axisUp === "z" ? "z" : "y";
    const appliedForwardAxis =
      typeof applied.axisForward === "string" && applied.axisForward.length > 0 ? applied.axisForward : undefined;
    const appliedScale =
      typeof applied.globalScale === "number" && Number.isFinite(applied.globalScale) && applied.globalScale > 0
        ? applied.globalScale
        : 1;
    const materialNames = Array.isArray(report?.materialNames)
      ? (report.materialNames as unknown[]).filter((name): name is string => typeof name === "string")
      : [];

    const canonicalFormat =
      parsed.data.format === "FBX" ? "fbx" : parsed.data.format === "GLTF" ? "glb" : "obj";
    const appliedInterchange: AppliedExportInterchange = {
      format: canonicalFormat,
      handedness: "right",
      upAxis: appliedUpAxis,
      ...(appliedForwardAxis !== undefined ? { forwardAxis: appliedForwardAxis } : {}),
      units: unitScale === 1 ? "meter" : `blender-scene-unit:${unitScale}`,
      ...(appliedScale !== undefined ? { scaleFactor: appliedScale } : {}),
      appliedTransforms: `blender-native z-up converted to ${appliedUpAxis}-up${appliedForwardAxis !== undefined ? ` (${appliedForwardAxis} forward)` : ""}; global scale ${appliedScale} applied`,
      materials: {
        referenced: materialNames,
        embedded: canonicalFormat !== "obj",
      },
    };

    return {
      ok: true,
      outputPath: writtenTo,
      bytes,
      sha256: await sha256File(writtenTo),
      format: report && typeof report.format === "string" ? report.format : parsed.data.format,
      selection: parsed.data.selection ?? null,
      blenderVersion,
      sourceSha256,
      unitScale,
      appliedInterchange,
      dependentFiles,
    };
  });
}
