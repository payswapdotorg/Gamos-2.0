import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, realpathSync, statSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { get as httpGet } from "node:http";
import { createServer as createNetServer } from "node:net";
import path from "node:path";
import type { ZodError } from "zod";
import {
  ProjectBuildInput,
  ProjectInspectInput,
  ProjectRunInput,
  detectHtmlMount,
  resolveWorkspacePath,
  type HtmlMount,
  type StructuredFailure,
} from "./typed-ops.js";
import {
  EXECUTABLE_BUILD_SCRIPTS,
  EXECUTABLE_RUN_SCRIPTS,
  detectPackageManager,
  inspectProject,
  resolveViteOutDir,
  validateScriptName,
  type PackageManagerName,
  type ProjectMetadata,
} from "./project.js";

/**
 * Babylon execution layer.
 *
 * Every invocation spawns real executables with argument arrays (`shell:
 * false`), bounded timeouts that kill the whole process group (detached spawn
 * + `kill(-pid)`), and bounded output collection. Only scripts declared in
 * the project's package.json AND allowlisted (`build`; `dev`/`start`) are ever
 * executed — script names are never inferred from model text.
 */

export const DEFAULT_BUILD_TIMEOUT_MS = 600_000; // 10 min bounded build/install
export const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
export const DEFAULT_RUN_HEALTH_DEADLINE_MS = 60_000;
export const DEFAULT_RUN_POLL_INTERVAL_MS = 500;
const HEALTH_REQUEST_TIMEOUT_MS = 2_000;
const STOP_TERM_GRACE_MS = 5_000;
const STOP_KILL_GRACE_MS = 2_000;

// ---------------------------------------------------------------------------
// Shared result shapes
// ---------------------------------------------------------------------------

export interface NodeCommandRun {
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

export interface RunNodeOptions {
  /** Kill the process group after this many milliseconds (0 disables). */
  timeoutMs?: number;
  /** Working directory for the spawned process. */
  cwd?: string;
  /** Cap on collected stdout/stderr bytes (default 8 MiB; excess is drained). */
  maxOutputBytes?: number;
  /** Environment for the spawned process (defaults to `process.env`). */
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  /** Streaming stdout observer (called per chunk; storage stays bounded). */
  onStdout?: (chunk: string) => void;
  /** AbortSignal-style handle: aborting kills the process group. */
  signal?: AbortSignal;
}

export interface PackageManagerCommand {
  ok: true;
  name: PackageManagerName;
  /** Executable to spawn (the discovered node when the pm ships a JS entry). */
  command: string;
  /** Leading arguments that select this package manager. */
  args: string[];
}

// ---------------------------------------------------------------------------
// Bounded headless process runner
// ---------------------------------------------------------------------------

/**
 * Run a command to completion with a bounded timeout, bounded output and
 * process-group kill on expiry. The child is spawned detached (own process
 * group) so `kill(-pid)` reliably reaps the whole tree — killing only the
 * package-manager pid demonstrably leaves vite running (the stale-server
 * adversarial case).
 */
export async function runNodeCommand(
  exe: string,
  args: string[],
  options: RunNodeOptions = {},
): Promise<NodeCommandRun> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_BUILD_TIMEOUT_MS;
  const maxBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const startedAt = Date.now();

  return await new Promise<NodeCommandRun>((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(exe, args, {
        cwd: options.cwd,
        shell: false,
        detached: true, // own process group so the whole tree can be killed
        stdio: ["ignore", "pipe", "pipe"],
        env: options.env ?? process.env,
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
    if (options.onStdout && child.stdout) {
      child.stdout.on("data", (chunk: Buffer) => {
        options.onStdout!(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
      });
    }

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

// ---------------------------------------------------------------------------
// Package-manager command resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the package manager launcher to an absolute real path. When the
 * launcher is a JS entry (npm/pnpm ship `npm-cli.js`-style files), it is
 * executed through the discovered, version-gated node executable so the
 * toolchain that runs is the toolchain that was probed.
 */
export async function resolvePackageManagerCommand(
  name: PackageManagerName,
  nodeExecutable: string,
): Promise<PackageManagerCommand | StructuredFailure> {
  const searchPath = process.env.PATH ?? "";
  const candidates: string[] = [];
  for (const dir of searchPath.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    if (isExecutableFile(candidate)) {
      candidates.push(candidate);
    }
  }
  if (candidates.length === 0) {
    return {
      ok: false,
      code: "package-manager-missing",
      reason: `no ${name} executable found on PATH — cannot run project scripts`,
    };
  }
  const real = realpathSync(candidates[0] as string);
  if (/\.(c?js|mjs)$/i.test(real)) {
    return { ok: true, name, command: nodeExecutable, args: [real] };
  }
  return { ok: true, name, command: real, args: [] };
}

// ---------------------------------------------------------------------------
// project_inspect
// ---------------------------------------------------------------------------

export interface ProjectInspectSuccess {
  ok: true;
  projectRoot: string;
  node: {
    executable: string;
    rawVersion: string | null;
    parsed: { major: number; minor: number; patch: number } | null;
  };
  packageManager: {
    name: PackageManagerName;
    lockfile: string | null;
    version: string | null;
    versionProbeError?: string;
  };
  package: { name: string | null; version: string | null; type: string | null };
  babylon: { dependencies: Array<{ name: string; version: string }> };
  scripts: Record<string, string>;
  engines: { node: string | null };
  viteConfig: boolean;
  nodeModulesPresent: boolean;
}

export async function projectInspect(
  nodeExecutable: string,
  input: unknown,
  workspaceRoot: string,
  options: { timeoutMs?: number; maxOutputBytes?: number } = {},
): Promise<ProjectInspectSuccess | StructuredFailure> {
  const parsed = ProjectInspectInput.safeParse(input);
  if (!parsed.success) {
    return invalidInput(parsed.error);
  }
  const projectRoot = resolveProjectRoot(parsed.data.projectRoot, workspaceRoot);
  if (isFailure(projectRoot)) {
    return projectRoot;
  }
  const metadata = inspectProject(projectRoot);
  if (isFailure(metadata)) {
    return metadata;
  }

  // probe the real node toolchain version (never trust the caller's claim)
  const nodeProbe = await runNodeCommand(nodeExecutable, ["--version"], {
    timeoutMs: options.timeoutMs ?? 20_000,
    maxOutputBytes: options.maxOutputBytes,
  });
  const nodeVersion = parseNodeVersionOutput(nodeProbe.stdout);

  // probe the real package-manager version (tolerated failure: inspect still
  // succeeds and reports the probe error honestly)
  const pm: ProjectInspectSuccess["packageManager"] = {
    name: metadata.packageManager,
    lockfile: metadata.lockfile,
    version: null,
  };
  const pmPlan = await resolvePackageManagerCommand(metadata.packageManager, nodeExecutable);
  if (pmPlan.ok) {
    const pmProbe = await runNodeCommand(pmPlan.command, [...pmPlan.args, "--version"], {
      timeoutMs: options.timeoutMs ?? 20_000,
      maxOutputBytes: options.maxOutputBytes,
    });
    const version = pmProbe.exitStatus === 0 ? pmProbe.stdout.trim().split("\n").pop()?.trim() : undefined;
    if (version && /^\d+\.\d+/.test(version)) {
      pm.version = version;
    } else {
      pm.versionProbeError = `package-manager --version probe failed (exit ${String(pmProbe.exitStatus)})`;
    }
  } else {
    pm.versionProbeError = pmPlan.reason;
  }

  return {
    ok: true,
    projectRoot,
    node: {
      executable: nodeExecutable,
      rawVersion: nodeVersion?.raw ?? null,
      parsed: nodeVersion?.parsed ?? null,
    },
    packageManager: pm,
    package: {
      name: metadata.packageName,
      version: metadata.packageVersion,
      type: metadata.packageType,
    },
    babylon: metadata.babylon,
    scripts: metadata.scripts,
    engines: metadata.engines,
    viteConfig: metadata.viteConfig,
    nodeModulesPresent: metadata.nodeModulesPresent,
  };
}

function parseNodeVersionOutput(stdout: string): { raw: string; parsed: { major: number; minor: number; patch: number } } | null {
  const match = /v(\d+)\.(\d+)\.(\d+)/.exec(stdout);
  if (!match) {
    return null;
  }
  return {
    raw: `${match[1]}.${match[2]}.${match[3]}`,
    parsed: {
      major: Number.parseInt(match[1] ?? "0", 10),
      minor: Number.parseInt(match[2] ?? "0", 10),
      patch: Number.parseInt(match[3] ?? "0", 10),
    },
  };
}

// ---------------------------------------------------------------------------
// project_build
// ---------------------------------------------------------------------------

export interface ProjectBuildSuccess {
  ok: true;
  projectRoot: string;
  packageManager: PackageManagerName;
  script: "build";
  installed: boolean;
  lockfileSha256Before: string | null;
  lockfileSha256After: string | null;
  exitStatus: 0;
  durationMs: number;
  buildLogTail: string;
  outDirFromConfig: boolean;
  artifact: { path: string; bytes: number; sha256: string };
}

export interface BuildOptions {
  timeoutMs?: number;
  maxOutputBytes?: number;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  signal?: AbortSignal;
}

export async function projectBuild(
  nodeExecutable: string,
  input: unknown,
  workspaceRoot: string,
  options: BuildOptions = {},
): Promise<ProjectBuildSuccess | StructuredFailure> {
  const parsed = ProjectBuildInput.safeParse(input);
  if (!parsed.success) {
    return invalidInput(parsed.error);
  }
  const projectRoot = resolveProjectRoot(parsed.data.projectRoot, workspaceRoot);
  if (isFailure(projectRoot)) {
    return projectRoot;
  }
  const metadata = inspectProject(projectRoot);
  if (isFailure(metadata)) {
    return metadata;
  }
  // Only the declared `build` script is ever executed (allowlist-enforced).
  const script = validateScriptName(metadata.scripts, "build", EXECUTABLE_BUILD_SCRIPTS);
  if (!script.ok) {
    return { ok: false, code: script.code ?? "script-invalid", reason: script.reason ?? "build script unavailable" };
  }
  const plan = await resolvePackageManagerCommand(metadata.packageManager, nodeExecutable);
  if (!plan.ok) {
    return plan;
  }

  const lockfile = metadata.lockfile ? path.join(projectRoot, metadata.lockfile) : null;
  const lockfileSha256Before = lockfile ? await sha256File(lockfile) : null;

  // Declared dependency fetch: when node_modules is missing, install first
  // (bounded by the same timeout budget). This is the only network-touching
  // step and it is recorded via the lockfile hash.
  let installed = false;
  if (!metadata.nodeModulesPresent) {
    const install = await runNodeCommand(plan.command, [...plan.args, "install"], {
      cwd: projectRoot,
      timeoutMs: options.timeoutMs ?? DEFAULT_BUILD_TIMEOUT_MS,
      maxOutputBytes: options.maxOutputBytes,
      env: options.env,
      signal: options.signal,
    });
    if (install.timedOut) {
      return timeoutFailure("install", options.timeoutMs ?? DEFAULT_BUILD_TIMEOUT_MS, install);
    }
    if (install.spawnError) {
      return { ok: false, code: "spawn-error", reason: `failed to run ${plan.name} install: ${install.spawnError}` };
    }
    if (install.exitStatus !== 0) {
      return {
        ok: false,
        code: "install-failed",
        reason: `${plan.name} install exited with code ${String(install.exitStatus)}`,
        details: { logTail: tail(combineOutput(install)) },
      };
    }
    installed = true;
  }

  const build = await runNodeCommand(plan.command, [...plan.args, "run", "build"], {
    cwd: projectRoot,
    timeoutMs: options.timeoutMs ?? DEFAULT_BUILD_TIMEOUT_MS,
    maxOutputBytes: options.maxOutputBytes,
    env: options.env,
    signal: options.signal,
  });
  if (build.timedOut) {
    return timeoutFailure("build", options.timeoutMs ?? DEFAULT_BUILD_TIMEOUT_MS, build);
  }
  if (build.spawnError) {
    return { ok: false, code: "spawn-error", reason: `failed to run ${plan.name} build: ${build.spawnError}` };
  }
  if (build.exitStatus !== 0) {
    return {
      ok: false,
      code: "build-failed",
      reason: `${plan.name} run build exited with ${
        build.exitStatus === null ? `signal ${build.signal ?? "unknown"}` : `code ${build.exitStatus}`
      }`,
      details: { exitStatus: build.exitStatus, logTail: tail(combineOutput(build)) },
    };
  }

  // Artifact verification: locate the vite outDir and verify the entry HTML.
  const { outDir, fromConfig } = resolveViteOutDir(projectRoot);
  const artifactPath = path.join(outDir, "index.html");
  if (!existsSync(artifactPath)) {
    return {
      ok: false,
      code: "build-artifact-missing",
      reason: `build exited 0 but no index.html artifact was produced at ${artifactPath}`,
      details: { logTail: tail(combineOutput(build)) },
    };
  }
  const bytes = (await stat(artifactPath)).size;
  if (bytes <= 0) {
    return {
      ok: false,
      code: "build-artifact-empty",
      reason: `build artifact is empty: ${artifactPath}`,
    };
  }

  const lockfileSha256After = lockfile ? await sha256File(lockfile) : null;
  return {
    ok: true,
    projectRoot,
    packageManager: metadata.packageManager,
    script: "build",
    installed,
    lockfileSha256Before,
    lockfileSha256After,
    exitStatus: 0,
    durationMs: build.durationMs,
    buildLogTail: tail(combineOutput(build), 4000),
    outDirFromConfig: fromConfig,
    artifact: { path: artifactPath, bytes, sha256: await sha256File(artifactPath) },
  };
}

// ---------------------------------------------------------------------------
// project_run + tracked runtimes
// ---------------------------------------------------------------------------

interface TrackedRuntime {
  pid: number;
  child: ChildProcess;
  port: number;
  runtimeUrl: string;
  script: string;
  projectRoot: string;
  packageManager: PackageManagerName;
  startedAtMs: number;
  stopped: boolean;
  exitStatus: number | null;
  closed: boolean;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

const runtimes = new Map<number, TrackedRuntime>();

export interface RuntimeSummary {
  pid: number;
  port: number;
  runtimeUrl: string;
  script: string;
  projectRoot: string;
  packageManager: PackageManagerName;
  startedAtMs: number;
  stopped: boolean;
  exitStatus: number | null;
}

/** Live (and recently stopped) runtimes started by `projectRun`. */
export function listRuntimes(): RuntimeSummary[] {
  const summaries: RuntimeSummary[] = [];
  runtimes.forEach((runtime) => {
    summaries.push({
      pid: runtime.pid,
      port: runtime.port,
      runtimeUrl: runtime.runtimeUrl,
      script: runtime.script,
      projectRoot: runtime.projectRoot,
      packageManager: runtime.packageManager,
      startedAtMs: runtime.startedAtMs,
      stopped: runtime.stopped,
      exitStatus: runtime.exitStatus,
    });
  });
  return summaries;
}

export interface ProjectRunSuccess {
  ok: true;
  projectRoot: string;
  started: true;
  runtimeUrl: string;
  port: number;
  portMode: "requested" | "auto";
  pid: number;
  script: string;
  packageManager: PackageManagerName;
  healthChecked: true;
  htmlBytes: number;
  htmlSha256: string;
  htmlMount: HtmlMount;
  startedAtMs: number;
  readyMs: number;
}

export interface RunOptions {
  /** Deadline for the headless HTTP health check (default 60s). */
  healthDeadlineMs?: number;
  /** Poll interval for the health check (default 500ms). */
  pollIntervalMs?: number;
  maxOutputBytes?: number;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}

export async function projectRun(
  nodeExecutable: string,
  input: unknown,
  workspaceRoot: string,
  options: RunOptions = {},
): Promise<ProjectRunSuccess | StructuredFailure> {
  const parsed = ProjectRunInput.safeParse(input);
  if (!parsed.success) {
    return invalidInput(parsed.error);
  }
  const projectRoot = resolveProjectRoot(parsed.data.projectRoot, workspaceRoot);
  if (isFailure(projectRoot)) {
    return projectRoot;
  }
  const metadata = inspectProject(projectRoot);
  if (isFailure(metadata)) {
    return metadata;
  }
  // Only declared `dev` (preferred) or `start` scripts are ever executed.
  let script = validateScriptName(metadata.scripts, "dev", EXECUTABLE_RUN_SCRIPTS);
  if (!script.ok) {
    script = validateScriptName(metadata.scripts, "start", EXECUTABLE_RUN_SCRIPTS);
  }
  if (!script.ok) {
    return {
      ok: false,
      code: "missing-run-script",
      reason: `package.json declares neither a "dev" nor a "start" script — nothing to run`,
      details: { declaredScripts: Object.keys(metadata.scripts) },
    };
  }
  const plan = await resolvePackageManagerCommand(metadata.packageManager, nodeExecutable);
  if (!plan.ok) {
    return plan;
  }

  // Port: explicit (strictPort, conflict is an error) or auto-picked free port.
  let port: number;
  let portMode: "requested" | "auto";
  if (parsed.data.port !== undefined) {
    port = parsed.data.port;
    portMode = "requested";
  } else {
    const free = await findFreePort();
    if (free === null) {
      return {
        ok: false,
        code: "port-resolution-failure",
        reason: "could not reserve a free loopback port for the dev server",
      };
    }
    port = free;
    portMode = "auto";
  }

  const runArgs: string[] = [...plan.args, "run", script.script as string];
  const spawnEnv: Record<string, string | undefined> = { ...(options.env ?? process.env) };
  if (script.script === "dev") {
    // vite semantics: explicit port + strictPort (a conflict is an error)
    runArgs.push("--", "--port", String(port), "--strictPort");
  } else if (parsed.data.port !== undefined) {
    // `start` scripts manage their own port; forward the conventional PORT hint
    spawnEnv.PORT = String(port);
  }

  const startedAtMs = Date.now();
  let child: ChildProcess;
  try {
    child = spawn(plan.command, runArgs, {
      cwd: projectRoot,
      shell: false,
      detached: true, // own process group: kill(-pid) reaps npm + sh + vite
      stdio: ["ignore", "pipe", "pipe"],
      env: spawnEnv,
    });
  } catch (error) {
    return {
      ok: false,
      code: "spawn-error",
      reason: `failed to start ${plan.name} run ${script.script}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (child.pid === undefined) {
    return { ok: false, code: "spawn-error", reason: `${plan.name} run ${script.script} produced no pid` };
  }

  const runtime: TrackedRuntime = {
    pid: child.pid,
    child,
    port,
    runtimeUrl: `http://127.0.0.1:${port}/`,
    script: script.script as string,
    projectRoot,
    packageManager: metadata.packageManager,
    startedAtMs,
    stopped: false,
    exitStatus: null,
    closed: false,
    stdout: "",
    stderr: "",
    truncated: false,
  };
  runtimes.set(runtime.pid, runtime);
  attachBoundedCollectors(runtime, options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES);
  child.once("close", (code) => {
    runtime.closed = true;
    runtime.exitStatus = code ?? null;
  });
  child.once("error", () => {
    runtime.closed = true;
  });

  const deadlineMs = options.healthDeadlineMs ?? DEFAULT_RUN_HEALTH_DEADLINE_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_RUN_POLL_INTERVAL_MS;
  const deadlineAt = Date.now() + deadlineMs;
  let lastHtml = "";
  let lastStatus = 0;

  // Headless HTTP health poll: success = HTTP 200 + a render mount in the
  // served HTML. (The full ZCode Browser verification of rendered content is
  // the TL journey's job — this plugin only proves the real server is up.)
  for (;;) {
    try {
      const response = await httpGetUrl(runtime.runtimeUrl, HEALTH_REQUEST_TIMEOUT_MS);
      lastStatus = response.status;
      if (response.status === 200) {
        lastHtml = response.body;
        const mount = detectHtmlMount(response.body);
        if (mount !== null) {
          return {
            ok: true,
            projectRoot,
            started: true,
            runtimeUrl: runtime.runtimeUrl,
            port,
            portMode,
            pid: runtime.pid,
            script: runtime.script,
            packageManager: runtime.packageManager,
            healthChecked: true,
            htmlBytes: Buffer.byteLength(response.body, "utf8"),
            htmlSha256: sha256Text(response.body),
            htmlMount: mount,
            startedAtMs,
            readyMs: Date.now() - startedAtMs,
          };
        }
      }
    } catch {
      // server not accepting connections yet — keep polling
    }

    if (runtime.closed) {
      runtimes.delete(runtime.pid);
      const output = combineRuntimeOutput(runtime);
      if (PORT_CONFLICT_PATTERN.test(output)) {
        return {
          ok: false,
          code: "port-conflict",
          reason: `dev server failed to start: port ${port} is already in use (strictPort — no silent retry)`,
          details: { pid: runtime.pid, exitStatus: runtime.exitStatus, outputTail: tail(output) },
        };
      }
      return {
        ok: false,
        code: "run-exit-early",
        reason: `dev server exited before becoming healthy (exit ${String(runtime.exitStatus)})`,
        details: { pid: runtime.pid, exitStatus: runtime.exitStatus, outputTail: tail(output) },
      };
    }

    if (Date.now() >= deadlineAt) {
      await killRuntimeTree(runtime);
      runtimes.delete(runtime.pid);
      if (lastStatus === 200) {
        return {
          ok: false,
          code: "run-unhealthy",
          reason: `dev server answered HTTP 200 but the HTML exposed no render mount (no <canvas>, no root div) within ${deadlineMs}ms`,
          details: { pid: runtime.pid, port, bodyExcerpt: tail(lastHtml, 500) },
        };
      }
      return {
        ok: false,
        code: "run-timeout",
        reason: `dev server did not become healthy on ${runtime.runtimeUrl} within ${deadlineMs}ms; the process group was killed`,
        details: { pid: runtime.pid, port, outputTail: tail(combineRuntimeOutput(runtime)) },
      };
    }
    await sleep(pollIntervalMs);
  }
}

const PORT_CONFLICT_PATTERN = /already in use|EADDRINUSE|strictport/i;

// ---------------------------------------------------------------------------
// stopRuntime (cancellation surface)
// ---------------------------------------------------------------------------

export interface StopRuntimeSuccess {
  ok: true;
  pid: number;
  stopped: true;
  port: number;
  portFreed: boolean | null;
  exitStatus: number | null;
  durationMs: number;
}

/**
 * Stop a tracked runtime: SIGTERM to the whole process group, bounded grace,
 * then SIGKILL; finally verify the port was actually freed (second-bind
 * probe). Idempotent for already-stopped runtimes.
 */
export async function stopRuntime(pid: number): Promise<StopRuntimeSuccess | StructuredFailure> {
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
    return { ok: false, code: "invalid-pid", reason: `pid must be a positive integer, got ${String(pid)}` };
  }
  const runtime = runtimes.get(pid);
  if (!runtime) {
    return {
      ok: false,
      code: "unknown-runtime",
      reason: `no tracked runtime with pid ${pid} (it may have already been stopped or never started by this process)`,
      details: { knownPids: [...runtimes.keys()] },
    };
  }

  const startedAt = Date.now();
  if (!runtime.closed) {
    await killRuntimeTree(runtime);
  }
  runtime.stopped = true;
  const portFreed = await verifyPortFree(runtime.port);
  return {
    ok: true,
    pid,
    stopped: true,
    port: runtime.port,
    portFreed,
    exitStatus: runtime.exitStatus,
    durationMs: Date.now() - startedAt,
  };
}

async function killRuntimeTree(runtime: TrackedRuntime): Promise<void> {
  const signalGroup = (signal: NodeJS.Signals) => {
    try {
      process.kill(-runtime.pid, signal);
      return true;
    } catch {
      return false;
    }
  };
  signalGroup("SIGTERM");
  try {
    runtime.child.kill("SIGTERM");
  } catch {
    // child already gone
  }
  const termDeadline = Date.now() + STOP_TERM_GRACE_MS;
  while (!runtime.closed && Date.now() < termDeadline) {
    await sleep(50);
  }
  if (!runtime.closed) {
    signalGroup("SIGKILL");
    try {
      runtime.child.kill("SIGKILL");
    } catch {
      // child already gone
    }
    const killDeadline = Date.now() + STOP_KILL_GRACE_MS;
    while (!runtime.closed && Date.now() < killDeadline) {
      await sleep(50);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveProjectRoot(
  inputPath: string,
  workspaceRoot: string,
): string | StructuredFailure {
  try {
    return resolveWorkspacePath(inputPath, workspaceRoot);
  } catch (error) {
    return {
      ok: false,
      code: "path-safety",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function isFailure<T>(value: T | StructuredFailure): value is StructuredFailure {
  return typeof value === "object" && value !== null && (value as StructuredFailure).ok === false;
}

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

function timeoutFailure(label: string, timeoutMs: number, run: NodeCommandRun): StructuredFailure {
  return {
    ok: false,
    code: "timeout",
    reason: `${label} timed out after ${timeoutMs}ms and the process group was killed`,
    details: { killed: run.killed, truncated: run.truncated, logTail: tail(combineOutput(run)) },
  };
}

function combineOutput(run: NodeCommandRun): string {
  return `${run.stdout}\n${run.stderr}`;
}

function combineRuntimeOutput(runtime: TrackedRuntime): string {
  return `${runtime.stdout}\n${runtime.stderr}`;
}

function attachBoundedCollectors(runtime: TrackedRuntime, maxBytes: number): void {
  const attach = (stream: NodeJS.ReadableStream | null, property: "stdout" | "stderr") => {
    if (!stream) return;
    let bytes = 0;
    stream.on("data", (chunk: Buffer) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      const text = buffer.toString("utf8");
      const current = runtime[property];
      if (current.length < maxBytes) {
        runtime[property] = current + text.slice(0, maxBytes - current.length);
        if (current.length + text.length > maxBytes) {
          runtime.truncated = true;
        }
      } else if (text.length > 0) {
        runtime.truncated = true;
      }
      bytes += buffer.length;
    });
  };
  attach(runtime.child.stdout, "stdout");
  attach(runtime.child.stderr, "stderr");
}

async function sha256File(file: string): Promise<string> {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function tail(text: string, limit = 2000): string {
  return text.length <= limit ? text : text.slice(text.length - limit);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpGetUrl(url: string, timeoutMs: number): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const request = httpGet(url, { timeout: timeoutMs }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      });
      response.on("end", () => {
        if (settled) return;
        settled = true;
        resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") });
      });
      response.on("error", fail);
    });
    request.on("timeout", () => {
      // Settle immediately: destroy(err) does not reliably emit 'error' on
      // every runtime (verified: Bun never fires it), so the promise would
      // hang forever against a connection that never responds.
      fail(new Error(`HTTP GET ${url} timed out after ${timeoutMs}ms`));
      request.destroy();
    });
    request.on("error", fail);
  });
}

function findFreePort(): Promise<number | null> {
  return new Promise((resolve) => {
    const server = createNetServer();
    server.once("error", () => resolve(null));
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => resolve(port));
    });
  });
}

function verifyPortFree(port: number): Promise<boolean | null> {
  return new Promise((resolve) => {
    const server = createNetServer();
    let settled = false;
    const finish = (value: boolean | null) => {
      if (settled) return;
      settled = true;
      server.close();
      resolve(value);
    };
    server.once("error", (error) => {
      const code = (error as NodeJS.ErrnoException).code;
      finish(code === "EADDRINUSE" ? false : null);
    });
    server.listen(port, "127.0.0.1", () => finish(true));
    setTimeout(() => finish(null), 2_000).unref?.();
  });
}

function isExecutableFile(candidate: string): boolean {
  try {
    const stats = statSync(candidate);
    return stats.isFile() && (stats.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

// ProjectMetadata is re-exported for callers that want the pure fs shape
export type { ProjectMetadata };
