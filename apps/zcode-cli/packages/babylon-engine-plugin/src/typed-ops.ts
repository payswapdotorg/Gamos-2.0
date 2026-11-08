import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * Typed Babylon project operations (M2.3).
 *
 * This module is deliberately free of Node/package-manager execution: it owns
 * the frozen capability input schemas, the workspace path-safety rules and the
 * shared structured-failure shape. Everything here is unit-testable without a
 * Node install or a Babylon project.
 */

// ---------------------------------------------------------------------------
// Shared structured failure shape
// ---------------------------------------------------------------------------

/** Every engine-layer operation fails closed through this shape. */
export interface StructuredFailure {
  ok: false;
  code: string;
  reason: string;
  details?: unknown;
}

// ---------------------------------------------------------------------------
// Workspace path safety
// ---------------------------------------------------------------------------

export class PathSafetyError extends Error {
  readonly code = "PATH_SAFETY";

  constructor(message: string) {
    super(message);
    this.name = "PathSafetyError";
  }
}

/**
 * Resolve an absolute input path against the workspace root.
 *
 * - requires absolute inputs (and an absolute workspace root)
 * - rejects `..` traversal that lands outside the workspace root
 *   (traversal that stays inside is fine)
 * - rejects symlink escapes: the deepest existing ancestor of the path must
 *   realpath inside the (realpath'd) workspace root
 *
 * Returns the lexically resolved absolute path (it is inside the root by
 * construction at call time).
 */
export function resolveWorkspacePath(inputPath: string, workspaceRoot: string): string {
  if (typeof inputPath !== "string" || inputPath.length === 0) {
    throw new PathSafetyError("Path must be a non-empty string");
  }
  if (typeof workspaceRoot !== "string" || workspaceRoot.length === 0) {
    throw new PathSafetyError("Workspace root must be a non-empty string");
  }
  if (!path.isAbsolute(inputPath)) {
    throw new PathSafetyError(`Path must be absolute, got relative path: ${inputPath}`);
  }
  if (!path.isAbsolute(workspaceRoot)) {
    throw new PathSafetyError(`Workspace root must be absolute, got: ${workspaceRoot}`);
  }
  const lexicalRoot = path.resolve(workspaceRoot);
  const resolved = path.resolve(inputPath);
  assertInsideRoot(resolved, lexicalRoot, `path escapes workspace root`);

  const realRoot = realPathOfExisting(workspaceRoot);
  const realAncestor = realPathOfExisting(resolved);
  assertInsideRoot(realAncestor, realRoot, "symlink escape out of workspace root");
  return resolved;
}

function assertInsideRoot(candidate: string, root: string, reason: string): void {
  const relative = path.relative(root, candidate);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return;
  }
  throw new PathSafetyError(`${reason}: ${candidate} is outside ${root}`);
}

function realPathOfExisting(candidate: string): string {
  if (existsSync(candidate)) {
    return realpathSync(candidate);
  }
  const parent = path.dirname(candidate);
  if (parent === candidate) {
    return candidate;
  }
  return path.join(realPathOfExisting(parent), path.basename(candidate));
}

// ---------------------------------------------------------------------------
// Asset registry model constants (M3.2 target leg)
// ---------------------------------------------------------------------------

/** Schema id of the committed Babylon asset registry. */
export const ASSET_REGISTRY_SCHEMA_ID = "gamos/babylon-assets@1" as const;

/** Registry asset names are lowercase alphanumeric plus dashes, max 64 chars. */
export const ASSET_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

// ---------------------------------------------------------------------------
// Frozen capability input schemas
// ---------------------------------------------------------------------------

export const ProjectInspectInput = z.object({
  projectRoot: z.string().min(1).describe("Absolute path to the Babylon project root inside the workspace."),
});
export type ProjectInspectInput = z.infer<typeof ProjectInspectInput>;

export const ProjectBuildInput = z.object({
  projectRoot: z.string().min(1).describe("Absolute path to the Babylon project root inside the workspace."),
});
export type ProjectBuildInput = z.infer<typeof ProjectBuildInput>;

export const ProjectRunInput = z
  .object({
    projectRoot: z.string().min(1).describe("Absolute path to the Babylon project root inside the workspace."),
    port: z
      .number()
      .int()
      .min(1)
      .max(65535)
      .optional()
      .describe(
        "Explicit loopback port for the dev server (strictPort: a conflict is an error, never a silent retry). A free port is auto-picked when unset.",
      ),
  })
  .describe("Start the project's declared dev/start script and health-check its runtime URL.");
export type ProjectRunInput = z.infer<typeof ProjectRunInput>;

/** Cancellation surface for `project_run` runtimes (not a standalone capability). */
export const ProjectStopInput = z.object({
  pid: z.number().int().positive().describe("Runtime pid returned by project_run."),
});
export type ProjectStopInput = z.infer<typeof ProjectStopInput>;

export const AssetIntegrateInput = z
  .object({
    projectRoot: z.string().min(1).describe("Absolute path to the Babylon project root inside the workspace."),
    artifactPath: z
      .string()
      .min(1)
      .describe("Absolute path to the GLB artifact inside the workspace (the Blender export leg's output)."),
    assetName: z
      .string()
      .regex(ASSET_NAME_PATTERN)
      .optional()
      .describe(
        "Registry asset name (lowercase alphanumeric plus dashes, max 64 chars). Defaults to the artifact filename stem.",
      ),
    expectedIntegrity: z
      .object({
        byteLength: z
          .number()
          .int()
          .positive()
          .describe("Expected artifact size in bytes (the cross-engine manifest record is authoritative)."),
        sha256: z
          .string()
          .regex(/^[0-9a-f]{64}$/)
          .describe("Expected artifact sha256 (64 lowercase hex chars; a mismatch fails closed)."),
      })
      .optional()
      .describe(
        "Authoritative integrity record carried from the cross-engine asset-interchange manifest; when present, the artifact must match byteLength and sha256 exactly.",
      ),
  })
  .describe(
    "Integrate a verified GLB artifact into a Babylon project: stage it under public/assets and append the committed asset registry entry.",
  );
export type AssetIntegrateInput = z.infer<typeof AssetIntegrateInput>;

// ---------------------------------------------------------------------------
// Runtime HTML verification model (pure)
// ---------------------------------------------------------------------------

export type HtmlMount = "canvas" | "div" | null;

/**
 * Check whether served dev-server HTML exposes a render mount: a `<canvas`
 * element or a root `<div id="...">`. This is the headless HTTP-level check;
 * the full ZCode Browser verification (real rendered content, behavior
 * assertions such as `window.__GAMOS_BABYLON_READY__`) is owned by the
 * TL journey, not this plugin.
 */
export function detectHtmlMount(html: string): HtmlMount {
  if (/<canvas[\s>]/i.test(html)) {
    return "canvas";
  }
  if (/<div[^>]*\bid\s*=\s*["'][^"']+["']/i.test(html)) {
    return "div";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Asset integration registry model (M3.2 target leg, pure)
// ---------------------------------------------------------------------------

/** Registry files are plain .glb filenames — the only URLs the fixture loader will ever fetch. */
const ASSET_FILE_PATTERN = /^[a-z0-9][a-z0-9-]*\.glb$/;

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/** One committed registry entry: the frozen {assetName, file, sha256} triple. */
export interface AssetRegistryEntry {
  readonly assetName: string;
  readonly file: string;
  readonly sha256: string;
}

/** The committed registry shape (`src/gamos-assets.json`). */
export interface AssetRegistry {
  readonly schema: typeof ASSET_REGISTRY_SCHEMA_ID;
  readonly assets: readonly AssetRegistryEntry[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse a committed asset registry, fail-closed: a wrong schema id, malformed
 * JSON, a non-registry shape or ANY malformed entry yields `null` — never a
 * partial guess. The caller decides how to treat `null` (missing file and
 * unreadable/malformed registries both surface explicitly).
 */
export function parseAssetRegistry(json: string): AssetRegistry | null {
  if (typeof json !== "string" || json.length === 0) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) {
    return null;
  }
  if (parsed.schema !== ASSET_REGISTRY_SCHEMA_ID) {
    return null;
  }
  if (!Array.isArray(parsed.assets)) {
    return null;
  }
  const assets: AssetRegistryEntry[] = [];
  for (const entry of parsed.assets) {
    if (!isPlainObject(entry)) {
      return null;
    }
    if (typeof entry.assetName !== "string" || !ASSET_NAME_PATTERN.test(entry.assetName)) {
      return null;
    }
    if (typeof entry.file !== "string" || !ASSET_FILE_PATTERN.test(entry.file)) {
      return null;
    }
    if (typeof entry.sha256 !== "string" || !SHA256_HEX_PATTERN.test(entry.sha256)) {
      return null;
    }
    assets.push({ assetName: entry.assetName, file: entry.file, sha256: entry.sha256 });
  }
  return { schema: ASSET_REGISTRY_SCHEMA_ID, assets };
}

/**
 * Construct a registry entry, refusing invalid constituents: entries enter
 * the committed registry only through this frozen triple.
 */
export function buildAssetRegistryEntry(input: {
  readonly assetName: string;
  readonly file: string;
  readonly sha256: string;
}): AssetRegistryEntry {
  if (typeof input.assetName !== "string" || !ASSET_NAME_PATTERN.test(input.assetName)) {
    throw new Error(`assetName must match ${ASSET_NAME_PATTERN.source}: ${String(input.assetName)}`);
  }
  if (typeof input.file !== "string" || !ASSET_FILE_PATTERN.test(input.file)) {
    throw new Error(`file must match ${ASSET_FILE_PATTERN.source}: ${String(input.file)}`);
  }
  if (typeof input.sha256 !== "string" || !SHA256_HEX_PATTERN.test(input.sha256)) {
    throw new Error(`sha256 must be 64 lowercase hex chars: ${String(input.sha256)}`);
  }
  return { assetName: input.assetName, file: input.file, sha256: input.sha256 };
}

/** The committed registry file of a project root: `<projectRoot>/src/gamos-assets.json`. */
export function registryFileOf(projectRoot: string): string {
  return path.join(projectRoot, "src", "gamos-assets.json");
}

/**
 * Resolve where a registry file is staged: `<projectRoot>/public/assets/<file>`.
 * The same path-safety semantics as `resolveWorkspacePath`, applied to the
 * staging root: no traversal, no separators, no absolute file names — a
 * registry file is always a plain `.glb` filename. Symlinked staging
 * directories that redirect the path out of the project are rejected.
 */
export function resolveStagedAssetPath(projectRoot: string, file: string): string {
  if (typeof projectRoot !== "string" || projectRoot.length === 0 || !path.isAbsolute(projectRoot)) {
    throw new PathSafetyError(`project root must be an absolute path: ${String(projectRoot)}`);
  }
  if (typeof file !== "string" || file.length === 0) {
    throw new PathSafetyError("asset file must be a non-empty string");
  }
  if (path.isAbsolute(file)) {
    throw new PathSafetyError(`asset file must be a plain filename under public/assets, got absolute path: ${file}`);
  }
  if (file.includes("/") || file.includes("\\")) {
    throw new PathSafetyError(`asset file must be a plain filename under public/assets (no path separators): ${file}`);
  }
  if (file === "." || file === "..") {
    throw new PathSafetyError(`asset file must be a plain filename: ${file}`);
  }
  const stagingRoot = path.resolve(projectRoot, "public", "assets");
  const staged = path.join(stagingRoot, file);
  const relative = path.relative(stagingRoot, staged);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new PathSafetyError(`staged asset path escapes the public/assets staging root: ${staged}`);
  }
  assertPathWithinProject(staged, projectRoot);
  return staged;
}

/**
 * Assert that a project-relative target path cannot have been redirected by a
 * symlink: the deepest existing ancestor of `candidate` must realpath inside
 * (or equal) the realpath of `projectRoot`. This is the project-scoped
 * counterpart of `resolveWorkspacePath`'s symlink guard — it rejects e.g. a
 * `public/assets` or `src` directory swapped for a symlink out of the project,
 * even when the redirect target still lies inside the workspace.
 */
export function assertPathWithinProject(candidate: string, projectRoot: string): void {
  const realRoot = realPathOfExisting(projectRoot);
  const realAncestor = realPathOfExisting(candidate);
  assertInsideRoot(realAncestor, realRoot, "symlink escape out of the project root");
}
