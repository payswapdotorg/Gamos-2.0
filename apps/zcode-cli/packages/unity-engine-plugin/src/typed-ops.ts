import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/**
 * Typed Unity operations (M2.1).
 *
 * This module is deliberately free of Unity execution: it owns the frozen
 * capability input schemas, the workspace path-safety rules, the Unity version
 * grammar and gate, the fixed C# bridge plan and the shared structured-failure
 * shape. Everything here is unit-testable without a Unity install.
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
// Unity version grammar and gate
// ---------------------------------------------------------------------------

/**
 * The Unity version grammar, e.g. `2022.3.10f1` or `6000.0.23f1`:
 * `<year>.<major>.<stream><release-type-letter><sequence>`. The release-type
 * letter (a=alpha, b=beta, f=final, c=china, p=patch) is validated by the
 * grammar and preserved in `rawVersion`; the parsed tuple carries the four
 * numeric fields the version gate compares.
 */
export const UNITY_VERSION_PATTERN = /^(\d{4,})\.(\d+)\.(\d+)([abfcp])(\d+)$/;

export interface UnityVersion {
  /** 2022, 2023, 6000 (Unity 6), … */
  year: number;
  /** The second component (the LTS stream number, e.g. 3 in 2022.3). */
  major: number;
  /** The third component (the update number, e.g. 23 in 6000.0.23f1). */
  stream: number;
  /** The trailing revision number (e.g. 1 in 6000.0.23f1). */
  sequence: number;
}

/** Minimum supported Unity Editor: 2022.3 LTS. */
export const UNITY_MIN_VERSION = { year: 2022, major: 3 } as const;

/** Parse a single line against the Unity grammar (anchored, no noise). */
export function parseUnityVersionLine(line: string): { raw: string; parsed: UnityVersion } | null {
  const match = UNITY_VERSION_PATTERN.exec(line.trim());
  if (!match) {
    return null;
  }
  return {
    raw: match[0],
    parsed: {
      year: Number.parseInt(match[1] ?? "0", 10),
      major: Number.parseInt(match[2] ?? "0", 10),
      stream: Number.parseInt(match[3] ?? "0", 10),
      sequence: Number.parseInt(match[5] ?? "0", 10),
    },
  };
}

/** Search multi-line output for the first line matching the grammar. */
export function parseUnityVersionOutput(output: string): { raw: string; parsed: UnityVersion } | null {
  for (const line of output.split(/\r?\n/)) {
    const parsed = parseUnityVersionLine(line);
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

/** Version gate: `>= 2022.3`. */
export function meetsMinimumUnityVersion(parsed: UnityVersion): boolean {
  if (parsed.year !== UNITY_MIN_VERSION.year) {
    return parsed.year > UNITY_MIN_VERSION.year;
  }
  return parsed.major >= UNITY_MIN_VERSION.major;
}

// ---------------------------------------------------------------------------
// Exact project/editor version contract (M2-B, final-closure directive §2)
// ---------------------------------------------------------------------------

/**
 * The Unity Editor version the committed fixture project requires (from its
 * `ProjectSettings/ProjectVersion.txt`: `m_EditorVersion: 6000.0.23f1`).
 * The tested editor version and the project version must agree EXACTLY.
 */
export const REQUIRED_UNITY_EDITOR_VERSION = "6000.0.23f1";

/** The revision hash the committed fixture pins (`m_EditorVersionWithRevision`). */
export const REQUIRED_UNITY_EDITOR_REVISION = "ab2b18a5f80dcba39fd8f5ee57b07edc7c0f600f";

/** A project's pinned editor version (parsed from ProjectVersion.txt). */
export interface UnityProjectVersionPin {
  /** e.g. `6000.0.23f1` */
  version: string;
  /** The 40-hex revision hash when `m_EditorVersionWithRevision` carries one. */
  revision: string | null;
}

export type UnityVersionContractResult =
  | { ok: true; version: string; revision: string | null }
  | {
      ok: false;
      code: "editor-version-missing" | "editor-version-incompatible" | "editor-revision-incompatible";
      reason: string;
    };

const PROJECT_VERSION_KEY = /^m_EditorVersion:\s*(\S+)\s*$/;
const PROJECT_VERSION_WITH_REVISION_KEY = /^m_EditorVersionWithRevision:\s*(\S+)(?:\s+\(([0-9a-f]{12,64})\))?\s*$/;

/**
 * Parse `ProjectSettings/ProjectVersion.txt` content into an exact pin.
 * Fails closed (null) when `m_EditorVersion` is missing or malformed, when a
 * `m_EditorVersionWithRevision` line is present but malformed (including an
 * absent or non-hex hash), or when the two lines disagree — never returns a
 * partial guess.
 */
export function parseProjectVersionFile(content: string): UnityProjectVersionPin | null {
  if (typeof content !== "string") {
    return null;
  }
  let version: string | null = null;
  let revision: string | null = null;
  let sawPrimaryVersionKey = false;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "") {
      continue;
    }
    if (/^m_EditorVersion:/.test(line)) {
      const match = PROJECT_VERSION_KEY.exec(line);
      if (match === null || !UNITY_VERSION_PATTERN.test(match[1] ?? "")) {
        return null; // present but malformed — fail closed, never a guess
      }
      const candidate = match[1] ?? "";
      if (sawPrimaryVersionKey && version !== candidate) {
        return null; // duplicate disagreeing m_EditorVersion lines
      }
      sawPrimaryVersionKey = true;
      version = candidate;
      continue;
    }
    if (/^m_EditorVersionWithRevision:/.test(line)) {
      const match = PROJECT_VERSION_WITH_REVISION_KEY.exec(line);
      if (match === null) {
        return null; // present but malformed (bad version or bad/missing hash) — fail closed
      }
      const candidateVersion = match[1] ?? "";
      const candidateRevision = match[2] ?? null;
      if (!UNITY_VERSION_PATTERN.test(candidateVersion)) {
        return null;
      }
      if (candidateRevision !== null && !/^[0-9a-f]{12,64}$/.test(candidateRevision)) {
        return null;
      }
      if (version !== null && version !== candidateVersion) {
        return null; // the two lines disagree — malformed file
      }
      if (revision !== null && revision !== candidateRevision) {
        return null; // duplicate disagreeing revision lines
      }
      version = candidateVersion;
      revision = candidateRevision;
    }
  }
  if (!sawPrimaryVersionKey || version === null) {
    return null; // the primary m_EditorVersion key is mandatory
  }
  return { version, revision };
}

/** Extract a 40-hex revision hash from editor `-version` output, when exposed. */
export function parseUnityRevisionFromVersionOutput(output: string): string | null {
  if (typeof output !== "string") {
    return null;
  }
  for (const line of output.split(/\r?\n/)) {
    const match = /\(([0-9a-f]{40})\)/.exec(line);
    if (match) {
      return match[1] ?? null;
    }
  }
  return null;
}

/**
 * The EXACT editor/project version contract (M2-B): the tested editor version
 * and the project's pinned version must agree exactly — including the
 * revision where the official installation metadata exposes it. An
 * incompatible editor is reported as incompatible, never licensed or
 * verified; an older editor is never silently accepted against a project
 * that requires a newer version, and a newer editor is not accepted either
 * (the contract is exact, not a floor).
 */
export function checkUnityVersionContract(
  editorRawVersion: string | null,
  editorRevision: string | null,
  project: UnityProjectVersionPin,
): UnityVersionContractResult {
  if (editorRawVersion === null || editorRawVersion === "" || !UNITY_VERSION_PATTERN.test(editorRawVersion)) {
    return {
      ok: false,
      code: editorRawVersion === null || editorRawVersion === "" ? "editor-version-missing" : "editor-version-incompatible",
      reason:
        editorRawVersion === null || editorRawVersion === ""
          ? "the editor's version metadata is missing — the version contract cannot be verified (fail closed)"
          : `the editor version "${editorRawVersion}" does not satisfy the Unity version grammar`,
    };
  }
  if (editorRawVersion !== project.version) {
    return {
      ok: false,
      code: "editor-version-incompatible",
      reason: `editor ${editorRawVersion} does not match the project requirement ${project.version} exactly (the version contract is exact, not a floor)`,
    };
  }
  if (editorRevision !== null && project.revision !== null && editorRevision !== project.revision) {
    return {
      ok: false,
      code: "editor-revision-incompatible",
      reason: `editor revision ${editorRevision} does not match the project requirement ${project.revision}`,
    };
  }
  return { ok: true, version: editorRawVersion, revision: editorRevision };
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
// Frozen capability input schemas
// ---------------------------------------------------------------------------

export const ProjectInspectInput = z.object({
  projectRoot: z.string().min(1).describe("Absolute path to the Unity project root inside the workspace."),
});
export type ProjectInspectInput = z.infer<typeof ProjectInspectInput>;

/** The only build target this plugin will ever build. */
export const SUPPORTED_BUILD_TARGETS = ["StandaloneLinux64"] as const;
export type SupportedBuildTarget = (typeof SUPPORTED_BUILD_TARGETS)[number];

const Vector3 = z
  .tuple([z.number().finite(), z.number().finite(), z.number().finite()])
  .describe("XYZ triple");

/** Frozen operation names for `scene_modify`. */
export const SCENE_OPERATIONS = ["scene.add-cube", "scene.set-active-build-target"] as const;
export type SceneOperation = (typeof SCENE_OPERATIONS)[number];

/** Default scene written/created by `scene.add-cube` when no scenePath is given. */
export const DEFAULT_SCENE_PATH = "Assets/Scenes/GamosScene.unity";

const ADD_CUBE_PARAMETER_KEYS = ["name", "location", "scale", "scenePath"] as const;
const SET_BUILD_TARGET_PARAMETER_KEYS = ["buildTarget"] as const;

export const SceneModifyInput = z
  .object({
    projectRoot: z.string().min(1).describe("Absolute path to the Unity project root inside the workspace."),
    operation: z
      .enum(SCENE_OPERATIONS)
      .describe("The typed scene operation to execute inside the real Unity Editor (batch mode)."),
    parameters: z.record(z.string(), z.unknown()).optional().describe("Typed parameters for the operation."),
  })
  .superRefine((input, ctx) => {
    if (input.operation === "scene.add-cube") {
      validateAddCubeParameters(input.parameters, ctx);
    } else if (input.operation === "scene.set-active-build-target") {
      validateBuildTargetParameters(input.parameters, ctx);
    }
  });
export type SceneModifyInput = z.infer<typeof SceneModifyInput>;

function validateAddCubeParameters(
  parameters: Record<string, unknown> | undefined,
  ctx: z.RefinementCtx,
): void {
  if (parameters === undefined) {
    return; // every add-cube parameter is optional
  }
  for (const key of Object.keys(parameters)) {
    if (!(ADD_CUBE_PARAMETER_KEYS as readonly string[]).includes(key)) {
      ctx.addIssue({
        code: "custom",
        path: ["parameters", key],
        message: `unknown add-cube parameter "${key}" (allowed: ${ADD_CUBE_PARAMETER_KEYS.join(", ")})`,
      });
    }
  }
  if ("name" in parameters) {
    const name = parameters.name;
    if (typeof name !== "string" || name.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["parameters", "name"],
        message: "name must be a non-empty string",
      });
    }
  }
  for (const field of ["location", "scale"] as const) {
    if (field in parameters) {
      const check = Vector3.safeParse(parameters[field]);
      if (!check.success) {
        ctx.addIssue({
          code: "custom",
          path: ["parameters", field],
          message: `${field} must be a finite 3-number [x, y, z] tuple`,
        });
      }
    }
  }
  if ("scenePath" in parameters) {
    const scenePath = parameters.scenePath;
    if (typeof scenePath !== "string" || !isSafeRelativeAssetPath(scenePath)) {
      ctx.addIssue({
        code: "custom",
        path: ["parameters", "scenePath"],
        message: `scenePath must be a relative "Assets/…" scene path without ".." (default: ${DEFAULT_SCENE_PATH})`,
      });
    }
  }
}

function validateBuildTargetParameters(
  parameters: Record<string, unknown> | undefined,
  ctx: z.RefinementCtx,
): void {
  if (parameters === undefined) {
    return;
  }
  for (const key of Object.keys(parameters)) {
    if (!(SET_BUILD_TARGET_PARAMETER_KEYS as readonly string[]).includes(key)) {
      ctx.addIssue({
        code: "custom",
        path: ["parameters", key],
        message: `unknown set-active-build-target parameter "${key}" (allowed: ${SET_BUILD_TARGET_PARAMETER_KEYS.join(", ")})`,
      });
    }
  }
  if ("buildTarget" in parameters) {
    const buildTarget = parameters.buildTarget;
    if (typeof buildTarget !== "string" || !(SUPPORTED_BUILD_TARGETS as readonly string[]).includes(buildTarget)) {
      ctx.addIssue({
        code: "custom",
        path: ["parameters", "buildTarget"],
        message: `buildTarget must be one of [${SUPPORTED_BUILD_TARGETS.join(", ")}]`,
      });
    }
  }
}

export const ProjectBuildInput = z.object({
  projectRoot: z.string().min(1).describe("Absolute path to the Unity project root inside the workspace."),
  buildTarget: z
    .enum(SUPPORTED_BUILD_TARGETS)
    .describe("The player build target. Only StandaloneLinux64 is supported in M2.1."),
});
export type ProjectBuildInput = z.infer<typeof ProjectBuildInput>;

// ---------------------------------------------------------------------------
// Relative asset path safety (pure)
// ---------------------------------------------------------------------------

/**
 * A scene path must be relative, inside `Assets/`, and free of `..` components
 * and absolute roots. Used by the TypeScript validation AND mirrored by the
 * `IsSafeRelativeAssetPath` guard inside the C# bridge (defense in depth).
 */
export function isSafeRelativeAssetPath(candidate: string): boolean {
  if (typeof candidate !== "string" || candidate.length === 0) {
    return false;
  }
  if (path.isAbsolute(candidate)) {
    return false;
  }
  const normalized = path.posix.normalize(candidate.replace(/\\/g, "/"));
  if (normalized === "" || normalized === "." || normalized === "..") {
    return false;
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "..")) {
    return false;
  }
  return normalized === "Assets" || normalized.startsWith("Assets/");
}

// ---------------------------------------------------------------------------
// Fixed C# bridge plan (NO dynamic code generation)
// ---------------------------------------------------------------------------

/** The complete, committed set of C# Editor bridge templates. Nothing else is executed. */
export const BRIDGE_FILES = ["GamosMarker.cs", "GamosBuild.cs"] as const;
export type BridgeFile = (typeof BRIDGE_FILES)[number];

/** The `-executeMethod` entry points inside the committed bridges (frozen map). */
export const UNITY_EXECUTE_METHODS = {
  "scene.add-cube": "Gamos.Marker.AddCube",
  "scene.set-active-build-target": "Gamos.Build.SetActiveBuildTarget",
  "project.build": "Gamos.Build.BuildStandalone",
} as const;

/**
 * Resolve the directory holding the committed C# bridge templates. Works from
 * the TypeScript sources (dev/test), the tsc-compiled output (dist/bridge)
 * and the esbuild bundle (dist/mcp/bridge).
 */
export function resolveBridgeRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.join(here, "bridge"), path.join(here, "mcp", "bridge")];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "GamosMarker.cs"))) {
      return candidate;
    }
  }
  return candidates[0];
}
