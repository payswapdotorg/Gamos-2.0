import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  UNITY_MIN_VERSION,
  meetsMinimumUnityVersion,
  parseUnityVersionOutput,
  type UnityVersion,
} from "./typed-ops.js";

/**
 * Unity Editor executable discovery.
 *
 * Order: `UNITY_EDITOR_PATH` env override → PATH lookup (`unity-editor`,
 * `unity`) → common install roots (including `UNITY_HOME`-derived paths).
 * The `userConfig.unityEditorPath` option is resolved app-side and forwarded
 * as `UNITY_EDITOR_PATH`, so it needs no handling here.
 *
 * All probing uses `spawnSync(exe, ["-version"])` with argument arrays —
 * never a shell — and every accepted executable is resolved to its absolute
 * real path. The `-version` flag is batch-safe and exits fast (works on
 * Unity 2019+; prints e.g. `6000.0.23f1`).
 *
 * LICENSING IS NOT PROBED HERE (spawning the editor for a license check is
 * slow): the `license-required` status in the `UnityDiscovery` union is
 * produced by the ENGINE layer when a real batch invocation fails with
 * Unity's license error output. Discovery itself never returns it.
 *
 * A Unity project marker (ProjectSettings/ProjectVersion.txt) is NEVER
 * evidence of editor availability.
 */

export const UNITY_EDITOR_PATH_ENV = "UNITY_EDITOR_PATH";
export const UNITY_HOME_ENV = "UNITY_HOME";

export interface UnityDiscovery {
  status: "available" | "unavailable" | "version-unknown" | "license-required";
  executable: string | null;
  rawVersion: string | null;
  parsed: UnityVersion | null;
  reason?: string;
}

export interface DiscoveryOptions {
  /** Environment to read (defaults to `process.env`); useful for deterministic tests. */
  env?: Record<string, string | undefined>;
  /** Common install roots to scan; defaults to the standard set. Pass [] to disable. */
  roots?: string[];
}

export function discoverUnityEditor(options: DiscoveryOptions = {}): UnityDiscovery {
  const env = options.env ?? process.env;
  const roots = options.roots ?? defaultCommonRoots(env);

  const envPath = typeof env[UNITY_EDITOR_PATH_ENV] === "string" ? env[UNITY_EDITOR_PATH_ENV]!.trim() : "";
  if (envPath !== "") {
    // An explicit override is authoritative: report its outcome, never fall
    // through to a different executable the user did not ask for.
    return probeUnityEditor(path.resolve(envPath));
  }

  const pathCandidates = [
    ...lookupOnPath("unity-editor", env.PATH),
    ...lookupOnPath("unity", env.PATH),
  ];
  const rootCandidates = roots.filter((candidate) => isExecutableFile(candidate));
  let lastFailure: UnityDiscovery | null = null;
  for (const candidate of dedupe([...pathCandidates, ...rootCandidates])) {
    const probed = probeUnityEditor(candidate);
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
    reason: "no Unity Editor executable found (searched PATH for unity-editor/unity and common install roots)",
  };
}

function probeUnityEditor(candidate: string): UnityDiscovery {
  if (!existsSync(candidate)) {
    return unavailable(`Unity Editor executable not found: ${candidate}`);
  }
  let stats;
  try {
    stats = statSync(candidate);
  } catch (error) {
    return unavailable(`cannot stat Unity Editor candidate ${candidate}: ${errorMessage(error)}`);
  }
  if (stats.isDirectory()) {
    return unavailable(`Unity Editor candidate is a directory: ${candidate}`);
  }
  if (!stats.isFile()) {
    return unavailable(`Unity Editor candidate is not a regular file: ${candidate}`);
  }
  if ((stats.mode & 0o111) === 0) {
    return unavailable(`Unity Editor candidate is not executable: ${candidate}`);
  }

  let real: string;
  try {
    real = realpathSync(candidate);
  } catch (error) {
    return unavailable(`cannot resolve real path of ${candidate}: ${errorMessage(error)}`);
  }

  const version = spawnSync(real, ["-version"], {
    encoding: "utf8",
    timeout: 20_000,
    maxBuffer: 4 * 1024 * 1024,
    shell: false,
    windowsHide: true,
  });
  if (version.error) {
    return unavailable(`failed to run ${real} -version: ${errorMessage(version.error)}`);
  }
  if (version.status !== 0) {
    return unavailable(
      `${real} -version exited with code ${String(version.status)}: ${excerpt(version.stderr ?? "")}`,
    );
  }

  const parsedVersion = parseUnityVersionOutput(version.stdout ?? "") ?? parseUnityVersionOutput(version.stderr ?? "");
  if (!parsedVersion) {
    return {
      status: "version-unknown",
      executable: real,
      rawVersion: null,
      parsed: null,
      reason: `could not parse Unity version from ${real} -version output (expected e.g. 6000.0.23f1)`,
    };
  }

  const { raw, parsed } = parsedVersion;
  if (!meetsMinimumUnityVersion(parsed)) {
    return {
      status: "unavailable",
      executable: real,
      rawVersion: raw,
      parsed,
      reason: `Unity ${raw} at ${real} is below the minimum supported version ${UNITY_MIN_VERSION.year}.${UNITY_MIN_VERSION.major}`,
    };
  }
  return { status: "available", executable: real, rawVersion: raw, parsed };
}

function unavailable(reason: string): UnityDiscovery {
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

/**
 * Expand `<parent>/<dirPattern>/<suffix>` globs, preferring newer-looking
 * directories. Works for POSIX-style roots and (on Windows hosts) the
 * `C:\Program Files\…` root via win32 path operations; on other platforms the
 * Windows parent simply does not exist and yields no candidates.
 */
function globRoot(parentDir: string, dirPattern: string, suffix: string, pathOps: typeof path = path): string[] {
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
    .map((entry) => pathOps.join(parentDir, entry, suffix))
    .filter((candidate) => isExecutableFile(candidate));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Standard install roots, frozen order; glob roots prefer newest first. */
export function defaultCommonRoots(env: Record<string, string | undefined> = process.env): string[] {
  const home = os.homedir();
  const roots: string[] = [
    "/usr/local/bin/unity-editor",
    ...globRoot("/opt/Unity", "*", path.join("Editor", "Unity")),
    ...globRoot(path.join(home, "Unity"), "*", path.join("Editor", "Unity")),
  ];

  const unityHome = typeof env[UNITY_HOME_ENV] === "string" ? env[UNITY_HOME_ENV]!.trim() : "";
  if (unityHome !== "") {
    const base = path.resolve(unityHome);
    roots.push(
      path.join(base, "Editor", "Unity"),
      path.join(base, "Unity"),
      ...globRoot(base, "*", path.join("Editor", "Unity")),
    );
  }

  if (process.platform === "darwin") {
    roots.push(
      ...globRoot(
        path.join(home, "Applications", "Unity", "Hub", "Editor"),
        "*",
        path.join("Unity.app", "Contents", "MacOS", "Unity"),
      ),
    );
  }

  if (process.platform === "win32") {
    roots.push(
      ...globRoot(
        "C:\\Program Files\\Unity\\Hub\\Editor",
        "*",
        path.win32.join("Editor", "Unity.exe"),
        path.win32,
      ),
    );
  }

  return roots;
}
