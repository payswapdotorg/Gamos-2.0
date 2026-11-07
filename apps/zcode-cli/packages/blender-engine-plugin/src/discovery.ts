import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Blender executable discovery.
 *
 * Order: `BLENDER_PATH` env override → PATH lookup → common install roots.
 * The `userConfig.blenderPath` option is resolved app-side and forwarded as
 * `BLENDER_PATH`, so it needs no handling here.
 *
 * All probing uses `spawnSync(exe, ["--version"])` with argument arrays — never
 * a shell — and every accepted executable is resolved to its absolute real path.
 */

export const BLENDER_PATH_ENV = "BLENDER_PATH";
export const BLENDER_MIN_VERSION = { major: 4, minor: 1, patch: 0 } as const;

export interface BlenderVersion {
  major: number;
  minor: number;
  patch: number;
}

export interface BlenderDiscovery {
  status: "available" | "unavailable" | "version-unknown";
  executable: string | null;
  rawVersion: string | null;
  parsed: BlenderVersion | null;
  reason?: string;
}

export interface DiscoveryOptions {
  /** Environment to read (defaults to `process.env`); useful for deterministic tests. */
  env?: Record<string, string | undefined>;
  /** Common install roots to scan; defaults to the standard set. Pass [] to disable. */
  roots?: string[];
}

const VERSION_PATTERN = /Blender\s+(\d+)\.(\d+)\.(\d+)/;

export function discoverBlender(options: DiscoveryOptions = {}): BlenderDiscovery {
  const env = options.env ?? process.env;
  const roots = options.roots ?? defaultCommonRoots();

  const envPath = typeof env[BLENDER_PATH_ENV] === "string" ? env[BLENDER_PATH_ENV]!.trim() : "";
  if (envPath !== "") {
    // An explicit override is authoritative: report its outcome, never fall
    // through to a different executable the user did not ask for.
    return probeBlender(path.resolve(envPath));
  }

  const pathCandidates = lookupOnPath("blender", env.PATH);
  const rootCandidates = roots.filter((candidate) => isExecutableFile(candidate));
  let lastFailure: BlenderDiscovery | null = null;
  for (const candidate of dedupe([...pathCandidates, ...rootCandidates])) {
    const probed = probeBlender(candidate);
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
    reason: "no Blender executable found (searched PATH and common install roots)",
  };
}

function probeBlender(candidate: string): BlenderDiscovery {
  if (!existsSync(candidate)) {
    return unavailable(`Blender executable not found: ${candidate}`);
  }
  let stats;
  try {
    stats = statSync(candidate);
  } catch (error) {
    return unavailable(`cannot stat Blender candidate ${candidate}: ${errorMessage(error)}`);
  }
  if (stats.isDirectory()) {
    return unavailable(`Blender candidate is a directory: ${candidate}`);
  }
  if (!stats.isFile()) {
    return unavailable(`Blender candidate is not a regular file: ${candidate}`);
  }
  if ((stats.mode & 0o111) === 0) {
    return unavailable(`Blender candidate is not executable: ${candidate}`);
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
      reason: `could not parse Blender version from ${real} --version output`,
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
      reason: `Blender ${rawVersion} at ${real} is below the minimum supported version ${BLENDER_MIN_VERSION.major}.${BLENDER_MIN_VERSION.minor}`,
    };
  }
  return { status: "available", executable: real, rawVersion, parsed };
}

function meetsMinimumVersion(parsed: BlenderVersion): boolean {
  if (parsed.major !== BLENDER_MIN_VERSION.major) {
    return parsed.major > BLENDER_MIN_VERSION.major;
  }
  return parsed.minor >= BLENDER_MIN_VERSION.minor;
}

function unavailable(reason: string): BlenderDiscovery {
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

/** Expand `<parent>/<dirPattern>/<binary>` globs, preferring newer-looking directories. */
function globRoot(parentDir: string, dirPattern: string, binary: string): string[] {
  if (!existsSync(parentDir)) {
    return [];
  }
  const pattern = new RegExp(`^${escapeRegExp(dirPattern).replace(/\\\*/g, ".*")}$`);
  let entries: string[];
  try {
    entries = readdirSync(parentDir);
  } catch {
    return [];
  }
  return entries
    .filter((entry) => pattern.test(entry))
    .sort((left, right) => right.localeCompare(left))
    .map((entry) => path.join(parentDir, entry, binary))
    .filter((candidate) => isExecutableFile(candidate));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Standard install roots, frozen order; glob roots prefer newest first. */
export function defaultCommonRoots(): string[] {
  const home = os.homedir();
  return [
    "/usr/bin/blender",
    "/usr/local/bin/blender",
    ...globRoot("/opt", "blender*", "blender"),
    ...globRoot(home, "blender*", "blender"),
    ...globRoot("/home/z/engines", "blender-*-linux-x64", "blender"),
  ];
}
