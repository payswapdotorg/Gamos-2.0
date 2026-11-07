import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { StructuredFailure } from "./typed-ops.js";

/**
 * Babylon project metadata (M2.3).
 *
 * Pure filesystem inspection of a project root: package.json parsing (fail
 * closed on malformed metadata), Babylon dependency detection, declared
 * scripts, engines, vite config presence, lockfile-based package-manager
 * detection, and the executable-script allowlist. Nothing here spawns a
 * process — the execution layer lives in `engine.ts`.
 */

export type PackageManagerName = "npm" | "pnpm" | "yarn";

export interface BabylonDependency {
  name: string;
  version: string;
}

export interface ProjectMetadata {
  ok: true;
  projectRoot: string;
  packageName: string | null;
  packageVersion: string | null;
  packageType: string | null;
  babylon: { dependencies: BabylonDependency[] };
  scripts: Record<string, string>;
  engines: { node: string | null };
  viteConfig: boolean;
  nodeModulesPresent: boolean;
  packageManager: PackageManagerName;
  lockfile: string | null;
}

export type ProjectInspection = ProjectMetadata | StructuredFailure;

const LOCKFILE_BY_MANAGER: Record<PackageManagerName, string> = {
  npm: "package-lock.json",
  pnpm: "pnpm-lock.yaml",
  yarn: "yarn.lock",
};

const VITE_CONFIG_FILES = ["vite.config.js", "vite.config.ts", "vite.config.mjs", "vite.config.cjs"] as const;

// ---------------------------------------------------------------------------
// Script execution allowlist
// ---------------------------------------------------------------------------

/**
 * The only script names the engine will ever execute. Scripts are taken from
 * package.json declarations only — never inferred from model text, and never
 * extended by tool input.
 */
export const EXECUTABLE_BUILD_SCRIPTS = ["build"] as const;
export const EXECUTABLE_RUN_SCRIPTS = ["dev", "start"] as const;

export interface ScriptValidation {
  ok: boolean;
  script: string | null;
  command: string | null;
  code?: string;
  reason?: string;
}

/**
 * Validate a script name against an allowlist AND the project's declared
 * scripts. Both must hold: an allowlisted name that is not declared in
 * package.json is a structured failure (fail closed), and a declared script
 * outside the allowlist is rejected even if it exists.
 */
export function validateScriptName(
  scripts: Record<string, string>,
  scriptName: string,
  allowlist: readonly string[],
): ScriptValidation {
  if (typeof scriptName !== "string" || scriptName.length === 0) {
    return { ok: false, script: null, command: null, code: "script-invalid", reason: "script name must be a non-empty string" };
  }
  if (!allowlist.includes(scriptName)) {
    return {
      ok: false,
      script: scriptName,
      command: null,
      code: "script-not-allowed",
      reason: `script "${scriptName}" is not in the executable allowlist [${allowlist.join(", ")}]`,
    };
  }
  const command = Object.prototype.hasOwnProperty.call(scripts, scriptName) ? scripts[scriptName] : undefined;
  if (typeof command !== "string" || command.length === 0) {
    return {
      ok: false,
      script: scriptName,
      command: null,
      code: "script-missing",
      reason: `package.json does not declare a "${scriptName}" script`,
    };
  }
  return { ok: true, script: scriptName, command };
}

// ---------------------------------------------------------------------------
// Package manager detection
// ---------------------------------------------------------------------------

/** Detect the package manager from the committed lockfile; default npm. */
export function detectPackageManager(projectRoot: string): PackageManagerName {
  if (isFile(path.join(projectRoot, LOCKFILE_BY_MANAGER.pnpm))) {
    return "pnpm";
  }
  if (isFile(path.join(projectRoot, LOCKFILE_BY_MANAGER.yarn))) {
    return "yarn";
  }
  return "npm";
}

/** Lockfile filename for a package manager (null for "no lockfile detected"). */
export function lockfileName(projectRoot: string): string | null {
  const manager = detectPackageManager(projectRoot);
  return isFile(path.join(projectRoot, LOCKFILE_BY_MANAGER[manager])) ? LOCKFILE_BY_MANAGER[manager] : null;
}

// ---------------------------------------------------------------------------
// Project inspection
// ---------------------------------------------------------------------------

/**
 * Inspect a project root's package.json-derived metadata. Fails closed:
 * missing/malformed package.json and projects without `@babylonjs/*`
 * dependencies are structured failures, never guesses.
 */
export function inspectProject(projectRoot: string): ProjectInspection {
  if (typeof projectRoot !== "string" || projectRoot.length === 0 || !path.isAbsolute(projectRoot)) {
    return failure("project-root-invalid", `project root must be an absolute path: ${String(projectRoot)}`);
  }
  if (!existsSync(projectRoot)) {
    return failure("project-root-missing", `project root does not exist: ${projectRoot}`);
  }
  try {
    if (!statSync(projectRoot).isDirectory()) {
      return failure("project-root-invalid", `project root is not a directory: ${projectRoot}`);
    }
  } catch (error) {
    return failure("project-root-invalid", `cannot stat project root ${projectRoot}: ${messageOf(error)}`);
  }

  const packageJsonPath = path.join(projectRoot, "package.json");
  if (!isFile(packageJsonPath)) {
    return failure("package-json-missing", `no package.json in ${projectRoot} — not a Node project`);
  }
  let raw: string;
  try {
    raw = readFileSync(packageJsonPath, "utf8");
  } catch (error) {
    return failure("package-json-read", `cannot read ${packageJsonPath}: ${messageOf(error)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return failure("package-json-parse", `malformed package.json at ${packageJsonPath}: ${messageOf(error)}`);
  }
  if (!isRecord(parsed)) {
    return failure("package-json-parse", `package.json at ${packageJsonPath} is not a JSON object`);
  }

  const babylonDependencies = collectBabylonDependencies(parsed);
  if (babylonDependencies.length === 0) {
    return failure(
      "not-a-babylon-project",
      `no @babylonjs/* dependency found in ${packageJsonPath} (checked dependencies and devDependencies) — refusing to operate on a non-Babylon project`,
    );
  }

  return {
    ok: true,
    projectRoot,
    packageName: typeof parsed.name === "string" ? parsed.name : null,
    packageVersion: typeof parsed.version === "string" ? parsed.version : null,
    packageType: typeof parsed.type === "string" ? parsed.type : null,
    babylon: { dependencies: babylonDependencies },
    scripts: collectScripts(parsed),
    engines: {
      node: isRecord(parsed.engines) && typeof parsed.engines.node === "string" ? parsed.engines.node : null,
    },
    viteConfig: VITE_CONFIG_FILES.some((candidate) => isFile(path.join(projectRoot, candidate))),
    nodeModulesPresent: existsSync(path.join(projectRoot, "node_modules")),
    packageManager: detectPackageManager(projectRoot),
    lockfile: lockfileName(projectRoot),
  };
}

function collectBabylonDependencies(packageJson: Record<string, unknown>): BabylonDependency[] {
  const collected = new Map<string, BabylonDependency>();
  // dependencies win over devDependencies when both declare the same package
  for (const section of ["devDependencies", "dependencies"] as const) {
    const deps = packageJson[section];
    if (!isRecord(deps)) continue;
    for (const [name, version] of Object.entries(deps)) {
      if (!name.startsWith("@babylonjs/")) continue;
      if (typeof version !== "string") continue;
      collected.set(name, { name, version });
    }
  }
  return [...collected.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function collectScripts(packageJson: Record<string, unknown>): Record<string, string> {
  const scripts: Record<string, string> = {};
  const declared = packageJson.scripts;
  if (isRecord(declared)) {
    for (const [name, command] of Object.entries(declared)) {
      if (typeof command === "string") {
        scripts[name] = command;
      }
    }
  }
  return scripts;
}

// ---------------------------------------------------------------------------
// Vite outDir resolution
// ---------------------------------------------------------------------------

export interface ViteOutDir {
  outDir: string;
  fromConfig: boolean;
}

const OUT_DIR_PATTERN = /outDir\s*:\s*["'`]([^"'`]+)["'`]/;

/**
 * Resolve the vite build output directory for artifact verification. Reads the
 * committed vite config and extracts a simple string `outDir` value; anything
 * unparseable, dynamic, or escaping the project root falls back to vite's
 * default `dist` (fail-closed toward the conventional location, never toward
 * a path outside the project).
 */
export function resolveViteOutDir(projectRoot: string): ViteOutDir {
  const defaultOut = { outDir: path.join(projectRoot, "dist"), fromConfig: false };
  for (const candidate of VITE_CONFIG_FILES) {
    const configPath = path.join(projectRoot, candidate);
    if (!isFile(configPath)) continue;
    let text: string;
    try {
      text = readFileSync(configPath, "utf8");
    } catch {
      return defaultOut;
    }
    const match = OUT_DIR_PATTERN.exec(text);
    if (!match || !match[1]) {
      return defaultOut;
    }
    const rawOutDir = match[1];
    if (path.isAbsolute(rawOutDir)) {
      return defaultOut; // absolute outDirs are rejected (workspace containment)
    }
    const resolved = path.resolve(projectRoot, rawOutDir);
    const relative = path.relative(projectRoot, resolved);
    if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
      return defaultOut; // outDir escaping the project root is rejected
    }
    return { outDir: resolved, fromConfig: true };
  }
  return defaultOut;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function failure(code: string, reason: string): StructuredFailure {
  return { ok: false, code, reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
