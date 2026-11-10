import { existsSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { parseGodotExecutableVersion } from "./discovery.js";

/**
 * Typed Godot operations (M4 WP-2).
 *
 * This module is deliberately free of Godot execution: it owns the frozen
 * input schemas, the workspace path-safety rules, the fixed bridge-script
 * plan and the pure post-modification verification models. Everything here
 * is unit-testable without a Godot install.
 */

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

/**
 * Resolve an absolute input path that must additionally live inside a
 * project sub-root (the res:// confinement: scenes, scripts and import
 * targets are project files, never workspace-wide escapes).
 */
export function resolveProjectPath(inputPath: string, projectRoot: string): string {
  const resolved = resolveWorkspacePath(inputPath, projectRoot);
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
// Frozen capability input schemas
// ---------------------------------------------------------------------------

const AbsolutePath = z
  .string()
  .min(1)
  .max(4096)
  .describe("Absolute path (relative inputs fail the workspace path-safety layer with the path-safety code)");

/** Scene-relative node path grammar: identifier segments, no leading slash, no `..`, bounded depth. */
const NodePath = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*(?:\/[A-Za-z_][A-Za-z0-9_]*){0,15}$/, {
    message: "nodePath must be scene-relative identifier segments (no leading slash, no ..)",
  });

const FiniteNumber = z.number().finite();

const Vector3 = z
  .tuple([FiniteNumber, FiniteNumber, FiniteNumber])
  .describe("XYZ triple");

/** The reviewed property allowlist (mirrored in the committed scene_modify.gd bridge). */
export const PROPERTY_TYPES: Record<string, "vec3" | "bool"> = {
  position: "vec3",
  rotation: "vec3",
  scale: "vec3",
  visible: "bool",
};

const SceneProperty = z.enum(["position", "rotation", "scale", "visible"]);

const PropertyValue = z.union([Vector3, z.boolean()]);

export const ModifyOperation = z
  .object({
    nodePath: NodePath,
    property: SceneProperty,
    value: PropertyValue,
  })
  .superRefine((operation, ctx) => {
    const expected = PROPERTY_TYPES[operation.property];
    const isVec3 = Array.isArray(operation.value);
    if (expected === "vec3" && !isVec3) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: `property "${operation.property}" requires a 3-number [x, y, z] value`,
      });
    }
    if (expected === "bool" && isVec3) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: `property "${operation.property}" requires a boolean value`,
      });
    }
  });
export type ModifyOperation = z.infer<typeof ModifyOperation>;

export const SceneModifyInput = z.object({
  projectRoot: AbsolutePath.describe("Absolute path to the Godot project root (contains project.godot)."),
  scenePath: AbsolutePath.describe("Absolute path to the .tscn scene INSIDE the project root."),
  operations: z
    .array(ModifyOperation)
    .min(1)
    .max(64)
    .describe("Typed operations applied atomically in order."),
});
export type SceneModifyInput = z.infer<typeof SceneModifyInput>;

export const ProjectInspectInput = z.object({
  projectRoot: AbsolutePath,
});
export type ProjectInspectInput = z.infer<typeof ProjectInspectInput>;

export const ScriptCheckInput = z.object({
  projectRoot: AbsolutePath,
  scriptPath: AbsolutePath.describe("Absolute path to the .gd script INSIDE the project root."),
});
export type ScriptCheckInput = z.infer<typeof ScriptCheckInput>;

export const AssetImportInput = z.object({
  projectRoot: AbsolutePath,
  sourcePath: AbsolutePath.describe("Absolute path to the readable source asset INSIDE the workspace."),
  targetAssetPath: AbsolutePath.describe("Absolute import target INSIDE the project root."),
});
export type AssetImportInput = z.infer<typeof AssetImportInput>;

export const ProjectBuildInput = z.object({
  projectRoot: AbsolutePath,
  preset: z.string().min(1).max(64).describe("Allowlisted export preset name declared in export_presets.cfg."),
  outPath: AbsolutePath.describe("Absolute pre-created output directory inside the workspace."),
});
export type ProjectBuildInput = z.infer<typeof ProjectBuildInput>;

export const ProjectRunInput = z
  .object({
    projectRoot: AbsolutePath,
    scene: AbsolutePath.optional().describe("Optional absolute scene INSIDE the project root (default: the main scene)."),
    quitAfterFrames: z
      .number()
      .int()
      .positive()
      .max(100_000)
      .describe("Run this many frames headlessly, then quit."),
  })
  .superRefine((input, ctx) => {
    if (input.scene !== undefined && !input.scene.endsWith(".tscn")) {
      ctx.addIssue({ code: "custom", path: ["scene"], message: "scene must be a .tscn inside the project root" });
    }
  });
export type ProjectRunInput = z.infer<typeof ProjectRunInput>;

/** Internal read-back query input (the scene_modify verification step). */
export const SceneInspectInput = z.object({
  projectRoot: AbsolutePath,
  scenePath: AbsolutePath,
  queries: z
    .array(
      z.object({
        nodePath: NodePath,
        property: SceneProperty,
      }),
    )
    .min(1)
    .max(128),
});
export type SceneInspectInput = z.infer<typeof SceneInspectInput>;

// ---------------------------------------------------------------------------
// Fixed bridge-script plan (NO dynamic code generation)
// ---------------------------------------------------------------------------

/** Marker the bridge scripts print to stdout to point at their JSON report. */
export const BRIDGE_MARKER = "GAMOS_GODOT_REPORT:";

/** The complete, committed set of bridge templates. Nothing else is executed. */
export const BRIDGE_SCRIPTS = ["project_inspect.gd", "scene_modify.gd", "scene_inspect.gd"] as const;
export type BridgeScript = (typeof BRIDGE_SCRIPTS)[number];

export interface BridgePlan {
  /** Absolute path of the fixed, committed bridge template (never generated). */
  scriptPath: string;
  /** Arguments handed to the bridge after `--` (the input JSON path, then the report path). */
  args: string[];
}

/**
 * Resolve the directory holding the committed bridge templates. Works from the
 * TypeScript sources (src/bridge), the tsc-compiled output (dist/bridge) and
 * the esbuild bundle (dist/mcp/bridge) — the same three-location contract as
 * the blender plugin.
 */
export function resolveBridgeRoot(bridgeRoot?: string): string {
  if (bridgeRoot) {
    return path.resolve(bridgeRoot);
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.join(here, "bridge"), path.join(here, "mcp", "bridge")];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "scene_modify.gd"))) {
      return candidate;
    }
  }
  return candidates[0];
}

/**
 * Plan the `--script` invocation for a bridge: the FIXED committed template
 * path plus the data-only argument list. The bridge is read as-is at
 * runtime, never contains the payload, and maps each typed field to
 * explicit Godot API calls (no eval / exec / dynamic code).
 */
export function buildBridgeScript(script: BridgeScript, args: string[], bridgeRoot?: string): BridgePlan {
  for (const arg of args) {
    if (!path.isAbsolute(arg)) {
      throw new Error(`bridge data argument must be absolute: ${arg}`);
    }
  }
  return {
    scriptPath: path.join(resolveBridgeRoot(bridgeRoot), script),
    args: args.map((arg) => path.resolve(arg)),
  };
}

/** Convert an absolute path inside the project root to its res:// form (fail-closed on escape). */
export function toResPath(absolutePath: string, projectRoot: string): string {
  const resolved = path.resolve(absolutePath);
  const root = path.resolve(projectRoot);
  const relative = path.relative(root, resolved);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new PathSafetyError(`path is not inside the project root: ${resolved} (root ${root})`);
  }
  return `res://${relative.split(path.sep).join("/")}`;
}

// ---------------------------------------------------------------------------
// Verification models (pure)
// ---------------------------------------------------------------------------

export interface ReadbackQuery {
  readonly nodePath: string;
  readonly property: string;
}

export interface ReadbackResult {
  readonly nodePath?: string;
  readonly property?: string;
  readonly value?: unknown;
  readonly error?: string;
}

export interface AppliedOperation {
  readonly nodePath: string;
  readonly property: string;
  readonly value: unknown;
}

const TOLERANCE = 1e-5;

/**
 * Verify a fresh-process scene read-back against the applied operations:
 * every applied {nodePath, property} must appear in the read-back with a
 * value equal within the 1e-5 class tolerance (numbers) or exactly (bools).
 * A missing or erroring read-back entry fails closed.
 */
export function verifySceneReadback(
  applied: readonly AppliedOperation[],
  readback: readonly ReadbackResult[],
): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const index = new Map<string, ReadbackResult>();
  for (const entry of readback) {
    if (entry.nodePath !== undefined && entry.property !== undefined) {
      index.set(`${entry.nodePath}\u0000${entry.property}`, entry);
    }
  }
  for (const operation of applied) {
    const key = `${operation.nodePath}\u0000${operation.property}`;
    const entry = index.get(key);
    if (entry === undefined) {
      failures.push(`read-back missing ${operation.nodePath}.${operation.property}`);
      continue;
    }
    if (entry.error !== undefined) {
      failures.push(`read-back error for ${operation.nodePath}.${operation.property}: ${entry.error}`);
      continue;
    }
    const expected = operation.value;
    const actual = entry.value;
    if (Array.isArray(expected) && Array.isArray(actual)) {
      if (actual.length !== 3) {
        failures.push(`read-back for ${operation.nodePath}.${operation.property} is not a 3-vector: ${JSON.stringify(actual)}`);
        continue;
      }
      for (let i = 0; i < 3; i++) {
        const e = Number(expected[i]);
        const a = Number(actual[i]);
        if (!Number.isFinite(a) || Math.abs(a - e) > TOLERANCE) {
          failures.push(
            `read-back for ${operation.nodePath}.${operation.property}[${i}] = ${actual[i]} differs from expected ${expected[i]} beyond tolerance ${TOLERANCE}`,
          );
        }
      }
    } else if (typeof expected === "boolean" || typeof actual === "boolean") {
      if (expected !== actual) {
        failures.push(`read-back for ${operation.nodePath}.${operation.property} = ${JSON.stringify(actual)} differs from expected ${JSON.stringify(expected)}`);
      }
    } else {
      failures.push(`read-back for ${operation.nodePath}.${operation.property} has unexpected value shape: ${JSON.stringify(actual)}`);
    }
  }
  return { ok: failures.length === 0, failures };
}

/**
 * The verified engine failure lines (from this session's real Godot 4.2.2
 * probes): the engine exits 0 while reporting these — so they are the crash
 * signal, never the exit code. The benign banner and the SceneTree-script
 * teardown warning ("ObjectDB instances leaked at exit") are NOT crashes.
 */
export const CRASH_LINE_PATTERNS: readonly RegExp[] = [
  /^SCRIPT ERROR:/,
  /Parse Error:/,
  /ERROR: Failed to /,
  /^Error: Can't run project/m,
  /ERROR: Cannot open file 'res:\/\//,
  /ERROR: Project export for preset/,
  /Segmentation fault/,
  /crash handler/i,
];

export function scanCrashLines(output: string): string[] {
  const lines: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (CRASH_LINE_PATTERNS.some((pattern) => pattern.test(line))) {
      lines.push(line);
    }
  }
  return lines;
}

/** Resolve the export-templates directory exactly as Godot does (XDG_DATA_HOME first). */
export function resolveTemplatesDir(env: Record<string, string | undefined> = process.env): string {
  const xdg = typeof env.XDG_DATA_HOME === "string" && env.XDG_DATA_HOME.trim() !== "" ? env.XDG_DATA_HOME.trim() : "";
  if (xdg !== "") {
    return path.join(xdg, "godot", "export_templates");
  }
  const home = typeof env.HOME === "string" && env.HOME.trim() !== "" ? env.HOME.trim() : os.homedir();
  return path.join(home, ".local", "share", "godot", "export_templates");
}

export interface BridgeEngineVersionInfo {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly status: string;
}

/**
 * The bridge's Engine.get_version_info() must agree structurally with the
 * `--version` string the caller verified — a mismatching report fails
 * closed (the engine that wrote the report is not the engine we probed).
 */
export function engineVersionInfoMatches(rawVersion: string, info: BridgeEngineVersionInfo): boolean {
  const parsed = parseGodotExecutableVersion(rawVersion);
  if (!parsed.ok) {
    return false;
  }
  return (
    parsed.major === info.major &&
    parsed.minor === info.minor &&
    parsed.patch === info.patch &&
    parsed.channel === info.status.toLowerCase()
  );
}
