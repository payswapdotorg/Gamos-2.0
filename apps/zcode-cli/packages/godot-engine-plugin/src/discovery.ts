import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Godot executable discovery (M4 WP-2, mirrors the blender discipline).
 *
 * Order: `GODOT_PATH` env override → PATH lookup → common install roots
 * (including the verified `/home/z/engines` layouts from the zero-cost
 * recipe). The `userConfig.godotPath` option is resolved app-side and
 * forwarded as `GODOT_PATH`, so it needs no handling here.
 *
 * All probing uses `spawnSync(exe, ["--version"])` with argument arrays —
 * never a shell — and every accepted executable is resolved to its absolute
 * real path. Version verification uses the Godot FAMILY grammar
 * (`<major>.<minor>.<patch>.<channel>[<ordinal>][.extra]`, channels ordered
 * dev < alpha < beta < rc < stable) and the `>=4.2` minimum; an unparseable
 * version is `version-unknown` — fail closed, never available-by-guess.
 */

export const GODOT_PATH_ENV = "GODOT_PATH";
export const GODOT_MIN_VERSION = { major: 4, minor: 2, patch: 0, channel: "stable", channelOrdinal: 0 } as const;

export interface GodotVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly channel: "dev" | "alpha" | "beta" | "rc" | "stable";
  readonly channelOrdinal: number;
}

export interface GodotDiscovery {
  status: "available" | "unavailable" | "version-unknown";
  executable: string | null;
  rawVersion: string | null;
  parsed: GodotVersion | null;
  reason?: string;
}

export interface DiscoveryOptions {
  /** Environment to read (defaults to `process.env`); useful for deterministic tests. */
  env?: Record<string, string | undefined>;
  /** Common install roots to scan; defaults to the standard set. Pass [] to disable. */
  roots?: string[];
}

// The family grammar (mirrors the domain parser's GODOT_PATTERN):
// 4.2.2.stable.official.15073afe3 · 4.3.rc1.official.abc · 4.4.dev · v4.2.1.stable
// The mono marker is passive: it appears in the extra segment and does not
// affect ordering.
const GODOT_PATTERN = /^v?(\d+)\.(\d+)(?:\.(\d+))?\.(stable|rc|beta|alpha|dev)(\d+)?(?:\.(.*))?$/i;

const GODOT_CHANNEL_ORDER: Record<GodotVersion["channel"], number> = {
  dev: 0,
  alpha: 1,
  beta: 2,
  rc: 3,
  stable: 4,
};

export type GodotParseResult =
  | ({ ok: true; raw: string } & GodotVersion & { patchExplicit: boolean })
  | { ok: false; raw: string; diagnostic: string };

/** Parse a `godot --version` line with the family grammar; fail closed on any mismatch. */
export function parseGodotExecutableVersion(raw: string): GodotParseResult {
  const stripped = raw.trim().replace(/\s*\(.*\)\s*$/, "").trim();
  const m = GODOT_PATTERN.exec(stripped);
  if (!m) {
    return {
      ok: false,
      raw,
      diagnostic: "not a Godot version: expected <major>.<minor>.<patch>.<channel>[<ordinal>][.extra]",
    };
  }
  return {
    ok: true,
    raw: raw.trim(),
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: m[3] !== undefined ? Number(m[3]) : 0,
    patchExplicit: m[3] !== undefined,
    channel: (m[4] as string).toLowerCase() as GodotVersion["channel"],
    channelOrdinal: m[5] !== undefined ? Number(m[5]) : 0,
  };
}

/** Compare two family-grammar versions: semver, then channel order, then ordinal. */
export function compareGodotVersions(a: GodotVersion, b: GodotVersion): number {
  return (
    a.major - b.major ||
    a.minor - b.minor ||
    a.patch - b.patch ||
    GODOT_CHANNEL_ORDER[a.channel] - GODOT_CHANNEL_ORDER[b.channel] ||
    a.channelOrdinal - b.channelOrdinal
  );
}

/**
 * The export-templates directory version: the version string truncated at the
 * channel+ordinal boundary — Godot's own convention omits an absent/zero
 * patch segment ("4.2.2.stable", "4.3.rc1"; never "4.3.0.rc1"), and never
 * includes the build/extra suffix.
 */
export function godotTemplatesVersion(version: GodotVersion & { patchExplicit?: boolean }): string {
  const ordinal = version.channelOrdinal > 0 ? String(version.channelOrdinal) : "";
  const core =
    version.patchExplicit === false
      ? `${version.major}.${version.minor}`
      : `${version.major}.${version.minor}.${version.patch}`;
  return `${core}.${version.channel}${ordinal}`;
}

function meetsMinimum(parsed: GodotVersion): boolean {
  return compareGodotVersions(parsed, GODOT_MIN_VERSION) >= 0;
}

export function discoverGodot(options: DiscoveryOptions = {}): GodotDiscovery {
  const env = options.env ?? process.env;
  const roots = options.roots ?? defaultCommonRoots();

  const envPath = typeof env[GODOT_PATH_ENV] === "string" ? env[GODOT_PATH_ENV]!.trim() : "";
  if (envPath !== "") {
    // An explicit override is authoritative: report its outcome, never fall
    // through to a different executable the user did not ask for.
    return probeGodot(path.resolve(envPath));
  }

  const pathCandidates = lookupOnPath("godot", env.PATH);
  const rootCandidates = roots.filter((candidate) => isExecutableFile(candidate));
  let lastFailure: GodotDiscovery | null = null;
  for (const candidate of dedupe([...pathCandidates, ...rootCandidates])) {
    const probed = probeGodot(candidate);
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
    reason: "no Godot executable found (searched PATH and common install roots)",
  };
}

function probeGodot(candidate: string): GodotDiscovery {
  if (!existsSync(candidate)) {
    return unavailable(`Godot executable not found: ${candidate}`);
  }
  let stats;
  try {
    stats = statSync(candidate);
  } catch (error) {
    return unavailable(`cannot stat Godot candidate ${candidate}: ${errorMessage(error)}`);
  }
  if (stats.isDirectory()) {
    return unavailable(`Godot candidate is a directory: ${candidate}`);
  }
  if (!stats.isFile()) {
    return unavailable(`Godot candidate is not a regular file: ${candidate}`);
  }
  if ((stats.mode & 0o111) === 0) {
    return unavailable(`Godot candidate is not executable: ${candidate}`);
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

  const output = (version.stdout ?? "").trim() || (version.stderr ?? "").trim();
  const parsed = parseGodotExecutableVersion(output);
  if (!parsed.ok) {
    return {
      status: "version-unknown",
      executable: real,
      rawVersion: output.length > 0 ? output : null,
      parsed: null,
      reason: `could not parse Godot version from ${real} --version output`,
    };
  }

  const structured: GodotVersion = {
    major: parsed.major,
    minor: parsed.minor,
    patch: parsed.patch,
    channel: parsed.channel,
    channelOrdinal: parsed.channelOrdinal,
  };
  if (!meetsMinimum(structured)) {
    return {
      status: "unavailable",
      executable: real,
      rawVersion: parsed.raw,
      parsed: structured,
      reason: `Godot ${parsed.raw} at ${real} is below the minimum supported version >=4.2 (family grammar)`,
    };
  }
  return { status: "available", executable: real, rawVersion: parsed.raw, parsed: structured };
}

function unavailable(reason: string): GodotDiscovery {
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Expand `<parent>/<dirPattern>` directory globs and list the Godot binaries inside each. */
function globDirBinaries(parentDir: string, dirPattern: string, binaryPattern: RegExp): string[] {
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
  const candidates: string[] = [];
  for (const entry of entries.filter((e) => pattern.test(e)).sort((a, b) => b.localeCompare(a))) {
    const dirPath = path.join(parentDir, entry);
    try {
      for (const file of readdirSync(dirPath)) {
        if (binaryPattern.test(file)) {
          const candidate = path.join(dirPath, file);
          if (isExecutableFile(candidate)) {
            candidates.push(candidate);
          }
        }
      }
    } catch {
      // unreadable directory — skip it honestly
    }
  }
  return candidates;
}

/** Expand flat `<parent>/<binary>` globs (the zip's top-level binary layout). */
function globFlatBinaries(parentDir: string, binaryPattern: RegExp): string[] {
  if (!existsSync(parentDir)) {
    return [];
  }
  let entries: string[];
  try {
    entries = readdirSync(parentDir);
  } catch {
    return [];
  }
  return entries
    .filter((entry) => binaryPattern.test(entry))
    .sort((a, b) => b.localeCompare(a))
    .map((entry) => path.join(parentDir, entry))
    .filter((candidate) => isExecutableFile(candidate));
}

const GODOT_BINARY_PATTERN = /^Godot_v\d[\w.\-]*_linux\.x86_64$/;

/** Standard install roots, frozen order; globs prefer newer-looking candidates first. */
export function defaultCommonRoots(): string[] {
  const home = os.homedir();
  return [
    "/usr/bin/godot",
    "/usr/local/bin/godot",
    // The verified zero-cost recipe layouts under /home/z/engines:
    // directory form (godot-4.2.2-stable-linux-x64/Godot_v4.2.2-stable_linux.x86_64)…
    ...globDirBinaries("/home/z/engines", "godot-*-linux-x64", GODOT_BINARY_PATTERN),
    // …and the zip's flat top-level binary form (Godot_v4.2.2-stable_linux.x86_64).
    ...globFlatBinaries("/home/z/engines", GODOT_BINARY_PATTERN),
    ...globDirBinaries("/opt", "godot*", GODOT_BINARY_PATTERN),
    ...globDirBinaries(home, "godot*", GODOT_BINARY_PATTERN),
    ...globDirBinaries(path.join(home, ".local", "bin"), "godot*", GODOT_BINARY_PATTERN),
  ];
}
