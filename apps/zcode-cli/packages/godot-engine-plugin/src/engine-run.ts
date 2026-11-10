import { spawn, type ChildProcess } from "node:child_process";
import { DEFAULT_MAX_OUTPUT_BYTES, DEFAULT_TIMEOUT_MS } from "./engine-shared.js";

/**
 * Headless process runner (M4 WP-2): every Godot invocation spawns the real
 * executable with an argument array (`shell: false`), a bounded timeout that
 * kills the whole process group (`detached: true`, `kill(-pid)`), abort-signal
 * cancellation and bounded output collection. Extracted verbatim from
 * engine.ts at the lint-forced module split (re-exported from engine.ts).
 */

export interface RunGodotOptions {
  /** Kill the process tree after this many milliseconds. */
  timeoutMs?: number;
  /** Working directory for the Godot process. */
  cwd?: string;
  /** Cap on collected stdout/stderr bytes (default 8 MiB; excess is drained). */
  maxOutputBytes?: number;
  /** AbortSignal-style handle: aborting kills the process tree. */
  signal?: AbortSignal;
  /** Environment overrides merged over `process.env` (XDG_DATA_HOME redirection in tests). */
  env?: Record<string, string | undefined>;
}

export interface GodotRun {
  exitStatus: number | null;
  signal: string | null;
  /** Child pid (own process-group leader) — enables no-orphan assertions after kills. */
  pid: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
  killed: boolean;
  aborted: boolean;
  spawnError: string | null;
}

export async function runGodotHeadless(
  executable: string,
  args: string[],
  options: RunGodotOptions = {},
): Promise<GodotRun> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  return await new Promise<GodotRun>((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(executable, args, {
        cwd: options.cwd,
        shell: false,
        detached: true, // own process group so the whole tree can be killed
        stdio: ["ignore", "pipe", "pipe"],
        env: mergedEnv(options.env),
      });
    } catch (error) {
      resolve({
        exitStatus: 127,
        signal: null,
        pid: null,
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
        pid: child.pid ?? null,
        stdout: Buffer.concat(outChunks).toString("utf8"),
        stderr: Buffer.concat(errChunks).toString("utf8"),
        truncated,
        timedOut,
        killed: timedOut || aborted || signal === "SIGKILL",
        aborted,
        spawnError,
      });
    };

    child.on("error", (error) => {
      spawnError = error instanceof Error ? error.message : String(error);
      killTree();
    });
    child.on("close", (code, signal) => finish(code, signal));
  });
}

/** Merge env overrides over process.env, dropping undefined-valued keys honestly. */
function mergedEnv(overrides?: Record<string, string | undefined>): NodeJS.ProcessEnv {
  if (!overrides) return process.env;
  const merged: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete merged[key];
    } else {
      merged[key] = value;
    }
  }
  return merged;
}
