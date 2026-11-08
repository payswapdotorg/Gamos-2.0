import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/**
 * Typed Blender operations (M2.2).
 *
 * This module is deliberately free of Blender execution: it owns the frozen
 * input schemas, the workspace path-safety rules, the fixed bridge-script plan
 * and the pure post-modification verification model. Everything here is
 * unit-testable without a Blender install.
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

const Vector3 = z
  .tuple([z.number().finite(), z.number().finite(), z.number().finite()])
  .describe("XYZ triple");

export const SceneInspectInput = z.object({
  blendFile: z.string().min(1).describe("Absolute path to the .blend file inside the workspace."),
});
export type SceneInspectInput = z.infer<typeof SceneInspectInput>;

export const ModifyOperation = z
  .object({
    op: z.enum(["add-primitive", "set-transform", "rename", "delete", "set-material-color"]),
    target: z.string().min(1).optional().describe("Object name the operation applies to."),
    primitive: z.enum(["cube", "sphere", "cylinder", "plane", "monkey"]).optional(),
    location: Vector3.optional(),
    rotation: Vector3.optional().describe("Euler XYZ rotation in radians."),
    scale: Vector3.optional(),
    name: z.string().min(1).optional().describe("New object name (add-primitive / rename)."),
    color: Vector3.optional().describe("Linear base color, 0..1 per channel."),
  })
  .superRefine((operation, ctx) => {
    const requireField = (field: string, present: boolean) => {
      if (!present) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: `operation "${operation.op}" requires "${field}"`,
        });
      }
    };
    if (operation.op === "add-primitive") {
      requireField("primitive", operation.primitive !== undefined);
    } else if (operation.op === "set-transform") {
      requireField("target", operation.target !== undefined);
    } else if (operation.op === "rename") {
      requireField("target", operation.target !== undefined);
      requireField("name", operation.name !== undefined);
    } else if (operation.op === "delete") {
      requireField("target", operation.target !== undefined);
    } else if (operation.op === "set-material-color") {
      requireField("target", operation.target !== undefined);
      requireField("color", operation.color !== undefined);
    }
  });
export type ModifyOperation = z.infer<typeof ModifyOperation>;

export const SceneModifyInput = z.object({
  blendFile: z.string().min(1).describe("Absolute path to the .blend file inside the workspace."),
  operations: z.array(ModifyOperation).min(1).describe("Typed operations applied in order."),
  save: z
    .boolean()
    .optional()
    .describe("Persist the modified scene atomically and verify it by re-opening the file."),
});
export type SceneModifyInput = z.infer<typeof SceneModifyInput>;

export const SceneRenderInput = z.object({
  blendFile: z.string().min(1).describe("Absolute path to the .blend file inside the workspace."),
  outputPath: z.string().min(1).describe("Absolute PNG output path inside the workspace."),
  engine: z
    .enum(["CYCLES", "BLENDER_EEVEE"])
    .optional()
    .describe("Render engine. Defaults to CYCLES on CPU (EEVEE needs a GL context)."),
  resolution: z
    .object({
      x: z.number().int().positive(),
      y: z.number().int().positive(),
    })
    .optional()
    .describe("Output resolution in pixels; keeps the scene default when unset."),
});
export type SceneRenderInput = z.infer<typeof SceneRenderInput>;

export const AssetExportInterchange = z
  .object({
    upAxis: z.enum(["y", "z"]).describe("Target up axis applied by the exporter (Blender-native is z-up)."),
    globalScale: z
      .number()
      .finite()
      .positive()
      .optional()
      .describe("Uniform scale multiplier applied at export (FBX/OBJ only; the glTF exporter has no global scale setting)."),
  })
  .describe("Declared coordinate/scale settings applied by the exporter and recorded in the cross-engine manifest.");
export type AssetExportInterchange = z.infer<typeof AssetExportInterchange>;

export const AssetExportInput = z
  .object({
    blendFile: z.string().min(1).describe("Absolute path to the .blend file inside the workspace."),
    outputPath: z.string().min(1).describe("Absolute artifact path inside the workspace."),
    format: z.enum(["OBJ", "GLTF", "FBX"]).describe("Export format (GLTF writes a binary .glb)."),
    selection: z
      .array(z.string().min(1))
      .optional()
      .describe("Object names to export; the whole scene when unset."),
    interchange: AssetExportInterchange.optional(),
  })
  .superRefine((input, ctx) => {
    if (input.format === "GLTF" && input.interchange?.globalScale !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["interchange", "globalScale"],
        message: "the glTF exporter has no global scale setting — declare globalScale only for FBX/OBJ exports",
      });
    }
  });
export type AssetExportInput = z.infer<typeof AssetExportInput>;

/** The bridge config for the export template (data-only JSON; the bridge maps abstract settings to per-exporter kwargs). */
export interface ExportBridgeConfig {
  readonly outputPath: string;
  readonly format: "OBJ" | "GLTF" | "FBX";
  readonly selection: readonly string[] | null;
  readonly interchange: { readonly upAxis: "y" | "z"; readonly globalScale?: number } | null;
}

/** Build the data-only bridge config for the committed export_asset.py template. */
export function buildExportBridgeConfig(input: {
  readonly outputPath: string;
  readonly format: "OBJ" | "GLTF" | "FBX";
  readonly selection?: readonly string[];
  readonly interchange?: AssetExportInterchange;
}): ExportBridgeConfig {
  return {
    outputPath: input.outputPath,
    format: input.format,
    selection: input.selection ?? null,
    interchange: input.interchange ? { upAxis: input.interchange.upAxis, ...(input.interchange.globalScale !== undefined ? { globalScale: input.interchange.globalScale } : {}) } : null,
  };
}

/** Media type of the primary export artifact per reviewed format. */
export function exportArtifactMediaType(format: "OBJ" | "GLTF" | "FBX"): string {
  switch (format) {
    case "FBX":
      return "application/octet-stream";
    case "GLTF":
      return "model/gltf-binary";
    case "OBJ":
      return "text/plain";
  }
}

/** Media type of a dependent/sidecar file by extension (manifest integrity records). */
export function dependentFileMediaType(fileName: string): string {
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  switch (extension) {
    case "mtl":
      return "text/plain";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "tga":
      return "image/x-tga";
    case "bmp":
      return "image/bmp";
    case "exr":
      return "image/x-exr";
    case "hdr":
      return "image/vnd.radiance";
    default:
      return "application/octet-stream";
  }
}

// ---------------------------------------------------------------------------
// Fixed bridge-script plan (NO dynamic code generation)
// ---------------------------------------------------------------------------

/** Marker the bridge scripts print to stdout to point at their JSON report. */
export const BRIDGE_MARKER = "GAMOS_BRIDGE_REPORT:";

/** The complete, committed set of bridge templates. Nothing else is executed. */
export const BRIDGE_SCRIPTS = [
  "apply_ops.py",
  "export_asset.py",
  "inspect.py",
  "save_empty.py",
  "set_render.py",
] as const;
export type BridgeScript = (typeof BRIDGE_SCRIPTS)[number];

export interface BridgePlan {
  /** Absolute path of the fixed, committed bridge template (never generated). */
  scriptPath: string;
  /** Arguments handed to the bridge after `--` (the ops JSON path). */
  args: string[];
}

/**
 * Plan the `--python` invocation for the apply-ops bridge.
 *
 * The bridge itself is the committed `src/bridge/apply_ops.py` template: it is
 * read as-is at runtime, never contains the ops payload, and maps each typed
 * operation to explicit bpy calls (no eval / exec / dynamic imports).
 */
export function buildBridgeScript(opsJsonPath: string, bridgeRoot?: string): BridgePlan {
  if (!path.isAbsolute(opsJsonPath)) {
    throw new Error(`ops JSON path must be absolute: ${opsJsonPath}`);
  }
  const root = bridgeRoot ?? resolveBridgeRoot();
  return {
    scriptPath: path.join(root, "apply_ops.py"),
    args: [path.resolve(opsJsonPath)],
  };
}

/**
 * Resolve the directory holding the committed bridge templates. Works from the
 * TypeScript sources (dev/test), the tsc-compiled output (dist/bridge) and the
 * esbuild bundle (dist/mcp/bridge).
 */
export function resolveBridgeRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.join(here, "bridge"), path.join(here, "mcp", "bridge")];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "apply_ops.py"))) {
      return candidate;
    }
  }
  return candidates[0];
}

// ---------------------------------------------------------------------------
// Post-modification verification model (pure)
// ---------------------------------------------------------------------------

export type Vec3 = readonly [number, number, number];

export interface ObjectExpectation {
  objectName: string;
  location?: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
  materialColor?: Vec3;
}

export interface SceneExpectations {
  /** Objects that must exist with the given state after the operations. */
  objects: ObjectExpectation[];
  /** Names that must NOT exist after the operations (deleted/renamed away). */
  absentNames: string[];
}

/**
 * Simulate the typed operations to derive the expected final object state.
 * The simulation mirrors the bridge semantics; the engine asserts the real
 * scene against it after re-opening the saved blend (engine-query verification).
 */
export function expectationsFromOperations(
  operations: readonly ModifyOperation[],
): SceneExpectations {
  interface Entry {
    location?: Vec3;
    rotation?: Vec3;
    scale?: Vec3;
    materialColor?: Vec3;
  }
  const tracked = new Map<string, Entry>();
  const absent = new Set<string>();

  const entry = (name: string): Entry => {
    const existing = tracked.get(name);
    if (existing) {
      return existing;
    }
    const created: Entry = {};
    tracked.set(name, created);
    return created;
  };

  for (const operation of operations) {
    switch (operation.op) {
      case "add-primitive": {
        if (!operation.name) break; // bridge-assigned name; verified via applied report
        absent.delete(operation.name);
        const created = entry(operation.name);
        created.location = operation.location;
        created.rotation = operation.rotation;
        created.scale = operation.scale;
        break;
      }
      case "set-transform": {
        if (!operation.target) break;
        const target = entry(operation.target);
        absent.delete(operation.target);
        if (operation.location) target.location = operation.location;
        if (operation.rotation) target.rotation = operation.rotation;
        if (operation.scale) target.scale = operation.scale;
        break;
      }
      case "rename": {
        if (!operation.target || !operation.name) break;
        const previous = tracked.get(operation.target);
        tracked.delete(operation.target);
        absent.add(operation.target);
        absent.delete(operation.name);
        tracked.set(operation.name, previous ?? {});
        break;
      }
      case "delete": {
        if (!operation.target) break;
        tracked.delete(operation.target);
        absent.add(operation.target);
        break;
      }
      case "set-material-color": {
        if (!operation.target || !operation.color) break;
        const target = entry(operation.target);
        absent.delete(operation.target);
        target.materialColor = operation.color;
        break;
      }
    }
  }

  const objects: ObjectExpectation[] = [];
  tracked.forEach((value, objectName) => {
    objects.push({ objectName, ...value });
  });
  const absentNames: string[] = [];
  absent.forEach((name) => {
    if (!tracked.has(name)) {
      absentNames.push(name);
    }
  });
  return { objects, absentNames };
}

export interface ReportObject {
  name?: string;
  type?: string;
  location?: number[];
  rotation?: number[];
  scale?: number[];
  materialColor?: number[] | null;
}

export interface SceneReport {
  blenderVersion?: string;
  scenes?: Array<{ name?: string; objects?: ReportObject[] }>;
}

export interface VerificationResult {
  ok: boolean;
  failures: string[];
}

const TRANSFORM_TOLERANCE = 1e-5;
const COLOR_TOLERANCE = 1e-3;

function closeEnough(expected: number, actual: number, tolerance: number): boolean {
  return Math.abs(expected - actual) <= tolerance;
}

function checkTriple(
  objectName: string,
  field: string,
  expected: Vec3 | undefined,
  actual: number[] | null | undefined,
  tolerance: number,
  failures: string[],
): void {
  if (!expected) return;
  if (!actual || actual.length < 3) {
    failures.push(`object "${objectName}" is missing ${field}`);
    return;
  }
  for (let axis = 0; axis < 3; axis += 1) {
    const want = expected[axis];
    const got = actual[axis];
    if (typeof got !== "number" || !closeEnough(want, got, tolerance)) {
      failures.push(
        `object "${objectName}" ${field}[${axis}] expected ${want}, got ${String(got)}`,
      );
    }
  }
}

/**
 * Verify an inspect-bridge report against the expected post-modification state.
 * Missing objects, drifted transforms, and stale (renamed/deleted) names are
 * failures — the engine turns those into structured failures.
 */
export function verifySceneReport(report: SceneReport, expected: SceneExpectations): VerificationResult {
  const failures: string[] = [];
  const objects = new Map<string, ReportObject>();
  for (const scene of report.scenes ?? []) {
    for (const object of scene.objects ?? []) {
      if (object && typeof object.name === "string") {
        objects.set(object.name, object);
      }
    }
  }
  for (const expectation of expected.objects) {
    const object = objects.get(expectation.objectName);
    if (!object) {
      failures.push(`expected object "${expectation.objectName}" is missing`);
      continue;
    }
    checkTriple(expectation.objectName, "location", expectation.location, object.location, TRANSFORM_TOLERANCE, failures);
    checkTriple(expectation.objectName, "rotation", expectation.rotation, object.rotation, TRANSFORM_TOLERANCE, failures);
    checkTriple(expectation.objectName, "scale", expectation.scale, object.scale, TRANSFORM_TOLERANCE, failures);
    checkTriple(
      expectation.objectName,
      "materialColor",
      expectation.materialColor,
      object.materialColor ?? undefined,
      COLOR_TOLERANCE,
      failures,
    );
  }
  for (const name of expected.absentNames) {
    if (objects.has(name)) {
      failures.push(`object "${name}" should not exist after the applied operations`);
    }
  }
  return { ok: failures.length === 0, failures };
}

// ---------------------------------------------------------------------------
// Inspect report shapes shared with the engine layer
// ---------------------------------------------------------------------------

export interface ObjectSummary {
  name: string;
  type: string;
  location?: number[];
  rotation?: number[];
  scale?: number[];
  materialColor?: number[] | null;
}

export interface SceneSummary {
  name: string;
  objectCount: number;
  objects: ObjectSummary[];
}
