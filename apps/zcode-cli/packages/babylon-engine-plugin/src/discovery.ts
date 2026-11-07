import { spawnSync } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Node.js executable discovery.
 *
 * Order: `BABYLON_NODE_PATH` env override → PATH lookup (`node`) → common
 * install roots (`/usr/bin/node`, `/usr/local/bin/node`). The env variable is
 * deliberately named `BABYLON_NODE_PATH` (NOT `NODE_PATH`) so it can never
 * collide with Node's own module-resolution semantics. The
 * `userConfig.nodePath` plugin option is resolved app-side and forwarded as
 * `BABYLON_NODE_PATH`, so it needs no handling here.
 *
 * All probing uses `spawnSync(exe, ["--version"])` with argument arrays —
 * never a shell — and every accepted executable is resolved to its absolute
 * real path. Node below 18.0.0 is rejected by an explicit version gate
 * (Babylon.js 8 and Vite 6 both require modern Node).
 */

export const BABYLON_NODE_PATH_ENV = "BABYLON_NODE_PATH";
export const BABYLON_NODE_MIN_VERSION = { major: 18, minor: 0, patch: 0 } as const;

export interface NodeVersion {
  major: number;
  minor: number;
  patch: number;
}

export interface NodeDiscovery {
  status: "available" | "unavailable" | "version-unknown";
  executable: string | null;
  rawVersion: string | null;
  parsed: NodeVersion | null;
  reason?: string;
}

export interface DiscoveryOptions {
  /** Environment to read (defaults to `process.env`); useful for deterministic tests. */
  env?: Record<string, string | undefined>;
  /** Common install roots to scan; defaults to the standard set. Pass [] to disable. */
  roots?: string[];
}

const VERSION_PATTERN = /v(\d+)\.(\d+)\.(\d+)/;

export function discoverNode(options: DiscoveryOptions = {}): NodeDiscovery {
  const env = options.env ?? process.env;
  const roots = options.roots ?? defaultCommonRoots();

  const envPath = typeof env[BABYLON_NODE_PATH_ENV] === "string" ? env[BABYLON_NODE_PATH_ENV]!.trim() : "";
  if (envPath !== "") {
    // An explicit override is authoritative: report its outcome, never fall
    // through to a different executable the user did not ask for.
    return probeNode(path.resolve(envPath));
  }

  const pathCandidates = lookupOnPath("node", env.PATH);
  const rootCandidates = roots.filter((candidate) => isExecutableFile(candidate));
  let lastFailure: NodeDiscovery | null = null;
  for (const candidate of dedupe([...pathCandidates, ...rootCandidates])) {
    const probed = probeNode(candidate);
    if (probed.status === "available" || probed.status === "version-unknown") {
      return probed;
    }
    lastFailure = probed;
  }

  if (lastFailure) {
    return lastFailure;
  }
  return {
    status: "unavailable",
    executable: null,
    rawVersion: null,
    parsed: null,
    reason: "no Node.js executable found (searched PATH and common install roots)",
  };
}

function probeNode(candidate: string): NodeDiscovery {
  if (!existsSync(candidate)) {
    return unavailable(`Node.js executable not found: ${candidate}`);
  }
  let stats;
  try {
    stats = statSync(candidate);
  } catch (error) {
    return unavailable(`cannot stat Node.js candidate ${candidate}: ${errorMessage(error)}`);
  }
  if (stats.isDirectory()) {
    return unavailable(`Node.js candidate is a directory: ${candidate}`);
  }
  if (!stats.isFile()) {
    return unavailable(`Node.js candidate is not a regular file: ${candidate}`);
  }
  if ((stats.mode & 0o111) === 0) {
    return unavailable(`Node.js candidate is not executable: ${candidate}`);
  }

  let real: string;
  try {
    real = realpathSync(candidate);
  } catch (error) {
    return unavailable(`cannot resolve real path of ${candidate}: ${errorMessage(error)}`);
  }

  const version = spawnSync(real, ["--version"], {
    encoding: "utf8",
    timeout: 20_000,
    maxBuffer: 4 * 1024 * 1024,
    shell: false,
    windowsHide: true,
  });
  if (version.error) {
    return unavailable(`failed to run ${real} --version: ${errorMessage(version.error)}`);
  }
  if (version.status !== 0) {
    return unavailable(
      `${real} --version exited with code ${String(version.status)}: ${excerpt(version.stderr ?? "")}`,
    );
  }

  const match = VERSION_PATTERN.exec(version.stdout ?? "") ?? VERSION_PATTERN.exec(version.stderr ?? "");
  if (!match) {
    return {
      status: "version-unknown",
      executable: real,
      rawVersion: null,
      parsed: null,
      reason: `could not parse Node.js version from ${real} --version output`,
    };
  }

  const parsed = {
    major: Number.parseInt(match[1] ?? "0", 10),
    minor: Number.parseInt(match[2] ?? "0", 10),
    patch: Number.parseInt(match[3] ?? "0", 10),
  };
  const rawVersion = `${match[1]}.${match[2]}.${match[3]}`;
  if (!meetsMinimumVersion(parsed)) {
    return {
      status: "unavailable",
      executable: real,
      rawVersion,
      parsed,
      reason: `Node.js ${rawVersion} at ${real} is below the minimum supported version ${BABYLON_NODE_MIN_VERSION.major}.${BABYLON_NODE_MIN_VERSION.minor}`,
    };
  }
  return { status: "available", executable: real, rawVersion, parsed };
}

function meetsMinimumVersion(parsed: NodeVersion): boolean {
  if (parsed.major !== BABYLON_NODE_MIN_VERSION.major) {
    return parsed.major > BABYLON_NODE_MIN_VERSION.major;
  }
  return parsed.minor >= BABYLON_NODE_MIN_VERSION.minor;
}

function unavailable(reason: string): NodeDiscovery {
  return { status: "unavailable", executable: null, rawVersion: null, parsed: null, reason };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function excerpt(text: string, limit = 200): string {
  const trimmed = text.trim();
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit)}…`;
}

function lookupOnPath(binary: string, searchPath: string | undefined): string[] {
  if (!searchPath || searchPath.trim() === "") {
    return [];
  }
  const candidates: string[] = [];
  for (const dir of searchPath.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, binary);
    if (isExecutableFile(candidate)) {
      candidates.push(candidate);
    }
  }
  return candidates;
}

function isExecutableFile(candidate: string): boolean {
  try {
    const stats = statSync(candidate);
    return stats.isFile() && (stats.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function dedupe(candidates: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const candidate of candidates) {
    if (!seen.has(candidate)) {
      seen.add(candidate);
      unique.push(candidate);
    }
  }
  return unique;
}

/** Standard install roots, frozen order. */
export function defaultCommonRoots(): string[] {
  return ["/usr/bin/node", "/usr/local/bin/node"];
}
