/**
 * Godot execution layer (M4 WP-2) — RED stub.
 *
 * Every invocation spawns the real executable with an argument array
 * (`shell: false`), a bounded timeout that kills the whole process group,
 * and bounded output collection. Bridge communication is data-only: a JSON
 * input file goes in, a JSON report file comes out (pointed at by a stdout
 * marker). Verification is never exit-code trust: mutations are re-loaded in
 * a FRESH engine process, exports are proven by artifact hashes, runs are
 * proven by exit code AND zero crash lines.
 */

export const DEFAULT_TIMEOUT_MS = 300_000;
export const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

export interface RunGodotOptions {
  timeoutMs?: number;
  cwd?: string;
  maxOutputBytes?: number;
  signal?: AbortSignal;
  env?: Record<string, string | undefined>;
}

export interface GodotRun {
  exitStatus: number | null;
  signal: string | null;
  /** Child pid (own process group leader) — enables no-orphan assertions after kills. */
  pid: number | null;
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

export interface ProjectBuildSuccess {
  ok: true;
  projectRoot: string;
  preset: string;
  artifactPath: string;
  artifactSha256: string;
  artifactBytes: number;
  templatesVersion: string;
  pck: { mode: "separate" | "embedded" | "none"; path: string | null; sha256: string | null; bytes: number | null };
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

function notImplemented(what: string): never {
  throw new Error(`gamos/godot-engine-plugin: not implemented yet (RED): ${what}`);
}

export function loadBridgeReport(reportPath: string): Promise<{ ok: true; report: Record<string, unknown> } | { ok: false; failure: EngineFailure }> {
  return notImplemented("loadBridgeReport");
}

export function runGodotHeadless(executable: string, args: string[], options: RunGodotOptions = {}): Promise<GodotRun> {
  return notImplemented("runGodotHeadless");
}

export function projectInspect(executable: string, input: unknown, workspaceRoot: string, options: RunGodotOptions = {}): Promise<ProjectInspectSuccess | EngineFailure> {
  return notImplemented("projectInspect");
}

export function sceneModify(executable: string, input: unknown, workspaceRoot: string, options: RunGodotOptions = {}): Promise<SceneModifySuccess | EngineFailure> {
  return notImplemented("sceneModify");
}

export function sceneInspect(executable: string, input: unknown, workspaceRoot: string, options: RunGodotOptions = {}): Promise<{ ok: true; scenePath: string; results: ReadbackResult[] } | EngineFailure> {
  return notImplemented("sceneInspect");
}

export function scriptCheck(executable: string, input: unknown, workspaceRoot: string, options: RunGodotOptions = {}): Promise<ScriptCheckSuccess | EngineFailure> {
  return notImplemented("scriptCheck");
}

export function assetImport(executable: string, input: unknown, workspaceRoot: string, options: RunGodotOptions = {}): Promise<AssetImportSuccess | EngineFailure> {
  return notImplemented("assetImport");
}

export function projectBuild(executable: string, input: unknown, workspaceRoot: string, options: RunGodotOptions = {}): Promise<ProjectBuildSuccess | EngineFailure> {
  return notImplemented("projectBuild");
}

export function projectRun(executable: string, input: unknown, workspaceRoot: string, options: RunGodotOptions = {}): Promise<ProjectRunSuccess | EngineFailure> {
  return notImplemented("projectRun");
}

export type ReadbackResult = { nodePath?: string; property?: string; value?: unknown; error?: string };
