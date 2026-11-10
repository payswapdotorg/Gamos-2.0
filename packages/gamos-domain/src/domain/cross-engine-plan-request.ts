/**
 * Cross-engine pipeline request validation (M4 WP-7 extraction from
 * `cross-engine-plan.ts`) - the fail-closed request layer of
 * `gamos/cross-engine-plan@1`.
 *
 * Extracted verbatim from cross-engine-plan.ts when the M4 WP-7 godot/unreal
 * target legs would otherwise have pushed that file past the repository
 * max-lines architecture bound (the sanctioned engine-plugin-shared.ts
 * precedent from M4 WP-1): this module owns the request TYPES, the exact
 * field-set validation discipline, the per-engine format rules and the unreal
 * object-path / property-name planning floor. cross-engine-plan.ts re-exports
 * the public surface and keeps the builder + the shipped records; the
 * architecture direction stays one-way (this module imports no engine-plugin
 * module, exactly as the builder does not).
 *
 * Fail-closed rules (unchanged from the M3.3 layer they were extracted from):
 * - the request is validated with an EXACT field set (unknown/missing fields
 *   fail closed) and every relative path must be a canonical workspace-relative
 *   POSIX path (canonicalizeClaimPath is reused as the authority);
 * - babylon consumes GLB only; the verified Blender-to-Godot interchange is GLB
 *   (the WP-3 runtime-verified hop recipe); unity accepts fbx|glb; the unreal
 *   legs verify the target editor and no unreal record constrains the format;
 * - the unreal-only target fields (objectPath + propertyNames) are REQUIRED
 *   for the unreal leg and REJECTED on every other engine (never silently
 *   ignored), validated through the domain planning floor that mirrors the
 *   WP-5 connector grammars fail-closed.
 */

import { canonicalizeClaimPath } from "./resource-claims.js";
import { isAbsoluteHostPath, resolveHostPath } from "../adapters/workspace-paths.js";

/** The request contract shipped by this module (final-closure handoff §7). */
export const CROSS_ENGINE_PLAN_SCHEMA_ID = "gamos/cross-engine-plan@1";

/** The supported target engines for the cross-engine asset pipeline (M4 WP-7: godot + unreal joined the union). */
export type CrossEngineTarget = "unity" | "babylon" | "godot" | "unreal";

/** The interchange artifact formats the pipeline moves between engines. */
export type CrossEngineInterchangeFormat = "fbx" | "glb";

/** The fail-closed-validated request for `buildCrossEngineAssetPlan`. */
export interface CrossEnginePlanRequest {
  /** ^[a-z0-9][a-z0-9-]{0,63}$ — the plan identity. */
  readonly planId: string;
  readonly conceptRef: { readonly conceptId: string; readonly conceptSha256: string };
  readonly acceptanceRecord: { readonly recordId: string; readonly recordSha256: string };
  /** Absolute POSIX workspace root — op inputs are derived as workspaceRoot-joined absolutes. */
  readonly workspaceRoot: string;
  readonly source: {
    /** Canonical workspace-relative dir of the Blender project. */
    readonly projectIdentity: string;
    /** Canonical workspace-relative path of the source .blend file. */
    readonly blendFile: string;
  };
  readonly target: {
    readonly engine: CrossEngineTarget;
    /** Canonical workspace-relative dir of the target project. */
    readonly projectIdentity: string;
    /** Canonical workspace-relative path of the target project root. */
    readonly projectRoot: string;
    /**
     * Unreal-only (M4 WP-7): the exact validated object path the RC
     * verification chain describes and reads back. REQUIRED for the unreal
     * target leg; rejected on every other engine (never silently ignored).
     */
    readonly objectPath?: string;
    /**
     * Unreal-only (M4 WP-7): the allowlisted-grammar property names the
     * verify-target leg reads from the live editor. REQUIRED for the unreal
     * target leg; rejected on every other engine.
     */
    readonly propertyNames?: readonly string[];
  };
  /** babylon requires glb; unity accepts fbx|glb. */
  readonly format: CrossEngineInterchangeFormat;
  /** ^[a-z0-9][a-z0-9-]{0,63}$; defaults to "gamos-asset". */
  readonly assetName?: string;
  readonly interchange?: { readonly upAxis: "y" | "z"; readonly globalScale?: number };
  /** Positive integer; defaults to 2. */
  readonly maxConcurrency?: number;
  /** ISO-8601 UTC — the caller supplies it so the plan hash is deterministic. */
  readonly now: string;
}

// ---------------------------------------------------------------------------
// Request validation (fail closed)
// ---------------------------------------------------------------------------

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;

const DEFAULT_ASSET_NAME = "gamos-asset";
const DEFAULT_MAX_CONCURRENCY = 2;

const REQUEST_FIELDS = ["planId", "conceptRef", "acceptanceRecord", "workspaceRoot", "source", "target", "format", "assetName", "interchange", "maxConcurrency", "now"] as const;
const CONCEPT_REF_FIELDS = ["conceptId", "conceptSha256"] as const;
const ACCEPTANCE_REF_FIELDS = ["recordId", "recordSha256"] as const;
const SOURCE_FIELDS = ["projectIdentity", "blendFile"] as const;
const TARGET_FIELDS = ["engine", "projectIdentity", "projectRoot", "objectPath", "propertyNames"] as const;
const INTERCHANGE_FIELDS = ["upAxis", "globalScale"] as const;

/** The shared fail-closed error constructor (the builder reuses it for derivation-bug guards). */
export function fail(field: string, reason: string): never {
  throw new Error(`GAMOS/CROSS-ENGINE-PLAN: ${field} — ${reason}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Exact-field-set enforcement: unknown keys fail closed (the request contract is exact). */
function exactKeys(value: Record<string, unknown>, field: string, allowed: readonly string[]): void {
  for (const key of Object.keys(value)) {
    if (!(allowed as readonly string[]).includes(key)) {
      fail(field, `unknown field "${key}" — the exact field set is ${allowed.join(", ")}`);
    }
  }
}

function requireString(value: unknown, field: string, reason: string): string {
  if (typeof value !== "string" || value.length === 0) fail(field, reason);
  return value;
}

function validateIdPattern(value: unknown, field: string): string {
  requireString(value, field, `must match ${ID_PATTERN}`);
  if (!ID_PATTERN.test(value as string)) fail(field, `"${value as string}" must match ${ID_PATTERN}`);
  return value as string;
}

function validateSha256(value: unknown, field: string): string {
  requireString(value, field, "must be a 64-hex sha256 string");
  if (!SHA256_PATTERN.test(value as string)) fail(field, `"${value as string}" must be a 64-hex sha256`);
  return value as string;
}

/** Absolute POSIX workspace root, canonical (no traversal, dot segments or trailing slash). */
function validateWorkspaceRoot(value: unknown): string {
  requireString(value, "workspaceRoot", "must be a non-empty absolute POSIX path string");
  const root = value as string;
  if (root.includes("\\")) {
    fail("workspaceRoot", "must be a POSIX absolute path (backslashes fail closed — resource claim paths are canonical workspace-relative POSIX)");
  }
  if (!isAbsoluteHostPath(root)) {
    fail("workspaceRoot", `"${root}" must be an absolute path (the op inputs are derived as workspaceRoot-joined absolutes)`);
  }
  const resolved = resolveHostPath(root);
  if (resolved !== root) {
    fail("workspaceRoot", `"${root}" must be canonical (no traversal, dot segments or trailing slash — it resolves to "${resolved}")`);
  }
  return root;
}

/** Canonical workspace-relative POSIX path, validated through the claim-path authority. */
function validateRelativePath(value: unknown, field: string, options?: { readonly blendFile?: boolean }): string {
  requireString(value, field, "must be a non-empty canonical workspace-relative POSIX path string");
  const canonical = canonicalizeClaimPath(value as string);
  if (canonical === null) {
    fail(
      field,
      `"${value as string}" is not a canonical workspace-relative POSIX path (traversal, absolute, backslash, control, Windows-unsafe, non-ASCII, space, leading dot/hyphen, trailing dot, reserved device and oversize inputs all fail closed)`,
    );
  }
  if (options?.blendFile === true && !(value as string).endsWith(".blend")) {
    fail(field, `"${value as string}" must be the source .blend file (a .blend suffix is required)`);
  }
  return canonical;
}

// ---------------------------------------------------------------------------
// M4 WP-7: the unreal object-path / property-name planning floor
// ---------------------------------------------------------------------------

/**
 * The domain-level fail-closed floor for the unreal target's objectPath — a
 * faithful mirror of the WP-5 connector's `parseUnrealObjectPath` grammar
 * (apps/zcode-cli/packages/unreal-engine-plugin/src/object-paths.ts). The
 * plugin gate stays the EXECUTION authority (it re-validates client-side
 * BEFORE any request is built, zero network round-trips); this planning floor
 * keeps malformed paths out of plans at the earliest domain boundary. Drift
 * between the two grammars can only ever fail MORE closed here (the safe
 * direction): a plan-time rejection never opens an execution-time hole.
 */
const UNREAL_OBJECT_PATH_MAX_LENGTH = 512;
const UNREAL_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;
const UNREAL_SUBOBJECT_PATTERN = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;

function validateUnrealObjectPath(value: unknown): string {
  requireString(value, "target.objectPath", "must be a non-empty Unreal object path string (/Game/… package-path grammar)");
  const objectPath = value as string;
  if (objectPath.length > UNREAL_OBJECT_PATH_MAX_LENGTH) {
    fail("target.objectPath", `exceeds the ${UNREAL_OBJECT_PATH_MAX_LENGTH}-character bound (bounded input, no runaway parses)`);
  }
  if (!/^[\x20-\x7E]*$/.test(objectPath)) {
    fail("target.objectPath", "contains non-printable-ASCII characters");
  }
  if (/\s/.test(objectPath)) {
    fail("target.objectPath", "contains whitespace");
  }
  if (!objectPath.startsWith("/")) {
    fail("target.objectPath", `"${objectPath}" must be absolute (start with "/" — the Unreal package-path grammar)`);
  }
  if (objectPath.startsWith("//")) {
    fail("target.objectPath", "contains an empty segment ('//')");
  }
  if (objectPath.includes("?") || objectPath.includes("&") || objectPath.includes("=") || objectPath.includes("%")) {
    fail("target.objectPath", "contains query-string/URL-encoding characters (credential smuggling refused)");
  }
  if (objectPath.includes("@") || objectPath.includes("://")) {
    fail("target.objectPath", "contains URI/credential syntax (refused)");
  }
  if (objectPath.includes("\\")) {
    fail("target.objectPath", "contains a backslash separator (refused)");
  }

  const colonIndex = objectPath.indexOf(":");
  const pathPart = colonIndex === -1 ? objectPath : objectPath.slice(0, colonIndex);
  const subobjectPart = colonIndex === -1 ? "" : objectPath.slice(colonIndex + 1);
  if (pathPart.endsWith("/") || pathPart === "/") {
    fail("target.objectPath", "must not end or consist of a bare separator");
  }

  const segments = pathPart.slice(1).split("/");
  for (const segment of segments) {
    if (segment.length === 0) {
      fail("target.objectPath", "contains an empty segment");
    }
    if (segment === "." || segment === "..") {
      fail("target.objectPath", "contains a traversal segment (refused)");
    }
    if (segment.includes(".") && segment !== segments[segments.length - 1]) {
      fail("target.objectPath", "contains a dotted non-final segment (grammar violation)");
    }
    if (!UNREAL_SEGMENT_PATTERN.test(segment.replace(/\./g, ""))) {
      fail("target.objectPath", "segment contains characters outside the identifier grammar");
    }
  }

  const lastSegment = segments[segments.length - 1] ?? "";
  const nameComponents = lastSegment.split(".");
  if (nameComponents.length > 2) {
    fail("target.objectPath", "final segment carries more than one dotted object-name component");
  }
  for (const component of nameComponents) {
    if (component.length === 0 || !UNREAL_SEGMENT_PATTERN.test(component)) {
      fail("target.objectPath", "object-name component violates the identifier grammar");
    }
  }

  if (colonIndex !== -1) {
    const subobjects = subobjectPart.split(":");
    if (subobjects.length < 1 || subobjects.length > 3) {
      fail("target.objectPath", "sub-object component count outside 1..3 (the deepest documented shape)");
    }
    for (const sub of subobjects) {
      if (sub.length === 0 || !UNREAL_SUBOBJECT_PATTERN.test(sub)) {
        fail("target.objectPath", "sub-object component violates the identifier grammar");
      }
    }
  }

  return objectPath;
}

/**
 * The domain-level fail-closed floor for the unreal target's propertyNames —
 * the identifier grammar mirrored from the WP-5 connector's
 * `isValidPropertyName` (object-paths.ts), with the exact-set discipline on
 * top: duplicates fail closed (the read set is exact, never a stutter).
 */
const UNREAL_PROPERTY_NAME_MAX_LENGTH = 128;
const UNREAL_PROPERTY_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function validateUnrealPropertyNames(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    fail("target.propertyNames", "must be a non-empty array of property names (the verify-target step reads at least one typed property)");
  }
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") {
      fail("target.propertyNames", "each property name must be a string (the identifier grammar)");
    }
    if (entry.length === 0 || entry.length > UNREAL_PROPERTY_NAME_MAX_LENGTH || !UNREAL_PROPERTY_NAME_PATTERN.test(entry)) {
      fail("target.propertyNames", `"${entry}" violates the identifier grammar (^[A-Za-z_][A-Za-z0-9_]*$, bounded 128 — the WP-5 plugin grammar mirrored fail-closed)`);
    }
    if (seen.has(entry)) {
      fail("target.propertyNames", `"${entry}" is duplicated — the read set is exact (never a stutter)`);
    }
    seen.add(entry);
  }
  return value as readonly string[];
}

export interface ValidatedRequest {
  readonly planId: string;
  readonly conceptId: string;
  readonly conceptSha256: string;
  readonly recordId: string;
  readonly recordSha256: string;
  readonly workspaceRoot: string;
  readonly sourceProjectIdentity: string;
  readonly blendFile: string;
  readonly targetEngine: CrossEngineTarget;
  readonly targetProjectIdentity: string;
  readonly targetProjectRoot: string;
  readonly targetObjectPath?: string;
  readonly targetPropertyNames?: readonly string[];
  readonly format: CrossEngineInterchangeFormat;
  readonly assetName: string;
  readonly upAxis?: "y" | "z";
  readonly globalScale?: number;
  readonly maxConcurrency: number;
  readonly now: string;
}

/** Fail-closed validation of the raw request (exact field set, patterns, cross-field rules) - the exported entrypoint. */
export function validateCrossEnginePlanRequest(input: unknown): ValidatedRequest {
  if (!isRecord(input)) fail("request", `must be a non-null object following ${CROSS_ENGINE_PLAN_SCHEMA_ID}`);
  exactKeys(input, "request", REQUEST_FIELDS);

  const planId = validateIdPattern(input.planId, "planId");

  if (!isRecord(input.conceptRef)) fail("conceptRef", "must be an object");
  exactKeys(input.conceptRef, "conceptRef", CONCEPT_REF_FIELDS);
  const conceptId = validateIdPattern(input.conceptRef.conceptId, "conceptRef.conceptId");
  const conceptSha256 = validateSha256(input.conceptRef.conceptSha256, "conceptRef.conceptSha256");

  if (!isRecord(input.acceptanceRecord)) fail("acceptanceRecord", "must be an object");
  exactKeys(input.acceptanceRecord, "acceptanceRecord", ACCEPTANCE_REF_FIELDS);
  const recordId = validateIdPattern(input.acceptanceRecord.recordId, "acceptanceRecord.recordId");
  const recordSha256 = validateSha256(input.acceptanceRecord.recordSha256, "acceptanceRecord.recordSha256");

  const workspaceRoot = validateWorkspaceRoot(input.workspaceRoot);

  if (!isRecord(input.source)) fail("source", "must be an object");
  exactKeys(input.source, "source", SOURCE_FIELDS);
  const sourceProjectIdentity = validateRelativePath(input.source.projectIdentity, "source.projectIdentity");
  const blendFile = validateRelativePath(input.source.blendFile, "source.blendFile", { blendFile: true });

  if (!isRecord(input.target)) fail("target", "must be an object");
  exactKeys(input.target, "target", TARGET_FIELDS);
  const targetEngineRaw = input.target.engine;
  if (targetEngineRaw !== "unity" && targetEngineRaw !== "babylon" && targetEngineRaw !== "godot" && targetEngineRaw !== "unreal") {
    fail("target.engine", `"${String(targetEngineRaw)}" must be one of unity|babylon|godot|unreal (the cross-engine asset pipeline ships exactly these four target legs)`);
  }
  const targetEngine: CrossEngineTarget = targetEngineRaw;
  const targetProjectIdentity = validateRelativePath(input.target.projectIdentity, "target.projectIdentity");
  const targetProjectRoot = validateRelativePath(input.target.projectRoot, "target.projectRoot");

  // M4 WP-7: the unreal-only target fields (objectPath + propertyNames) —
  // REQUIRED for the unreal leg, REJECTED on every other engine (an
  // unreal-specific field on another engine is a request-authoring error,
  // never a silently-ignored extra).
  let targetObjectPath: string | undefined;
  let targetPropertyNames: readonly string[] | undefined;
  const hasObjectPath = input.target.objectPath !== undefined;
  const hasPropertyNames = input.target.propertyNames !== undefined;
  if (targetEngine === "unreal") {
    if (!hasObjectPath) {
      fail("target.objectPath", "is required for the unreal target leg (the RC verification chain describes and reads back this exact object path)");
    }
    if (!hasPropertyNames) {
      fail("target.propertyNames", "is required for the unreal target leg (the verify-target step reads these typed property names from the live editor)");
    }
    targetObjectPath = validateUnrealObjectPath(input.target.objectPath);
    targetPropertyNames = validateUnrealPropertyNames(input.target.propertyNames);
  } else {
    if (hasObjectPath) {
      fail("target.objectPath", `is only accepted for the unreal target leg (engine "${targetEngine}" carries no RC object-path semantics — remove the field)`);
    }
    if (hasPropertyNames) {
      fail("target.propertyNames", `is only accepted for the unreal target leg (engine "${targetEngine}" carries no RC property-read semantics — remove the field)`);
    }
  }

  const formatRaw = input.format;
  if (formatRaw !== "fbx" && formatRaw !== "glb") {
    fail("format", `"${String(formatRaw)}" must be one of fbx|glb (the interchange formats the pipeline moves between engines)`);
  }
  const format: CrossEngineInterchangeFormat = formatRaw;
  if (targetEngine === "babylon" && format === "fbx") {
    fail(
      "format",
      'target engine "babylon" cannot consume "fbx": the Babylon asset integration consumes GLB only (babylon/asset.integrate stages a hash-verified GLB artifact into public/assets; request format "glb")',
    );
  }
  if (targetEngine === "godot" && format === "fbx") {
    fail(
      "format",
      'target engine "godot" cannot consume "fbx": the verified Blender→Godot interchange is GLB — the WP-3 runtime-verified hop recipe (godot/asset.import stages the manifest-described GLB and the engine read-back proves the ingestion); request format "glb"',
    );
  }

  let assetName = DEFAULT_ASSET_NAME;
  if (input.assetName !== undefined) {
    assetName = validateIdPattern(input.assetName, "assetName");
  }

  let upAxis: "y" | "z" | undefined;
  let globalScale: number | undefined;
  if (input.interchange !== undefined) {
    if (!isRecord(input.interchange)) fail("interchange", "must be an object");
    exactKeys(input.interchange, "interchange", INTERCHANGE_FIELDS);
    if (input.interchange.upAxis === undefined) fail("interchange.upAxis", "is required when interchange is declared");
    if (input.interchange.upAxis !== "y" && input.interchange.upAxis !== "z") {
      fail("interchange.upAxis", `"${String(input.interchange.upAxis)}" must be one of y|z`);
    }
    upAxis = input.interchange.upAxis;
    if (input.interchange.globalScale !== undefined) {
      const scale = input.interchange.globalScale;
      if (typeof scale !== "number" || !Number.isFinite(scale) || scale <= 0) {
        fail("interchange.globalScale", "must be a positive finite number when present");
      }
      globalScale = scale;
    }
  }

  let maxConcurrency = DEFAULT_MAX_CONCURRENCY;
  if (input.maxConcurrency !== undefined) {
    const value = input.maxConcurrency;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
      fail("maxConcurrency", "must be a positive integer");
    }
    maxConcurrency = value;
  }

  const now = input.now;
  if (typeof now !== "string" || !ISO_UTC_PATTERN.test(now) || !Number.isFinite(Date.parse(now))) {
    fail(
      "now",
      `"${String(now)}" is not an ISO-8601 UTC timestamp (YYYY-MM-DDTHH:MM:SS[.sss]Z — the caller supplies it so the plan hash is deterministic)`,
    );
  }

  return {
    planId,
    conceptId,
    conceptSha256,
    recordId,
    recordSha256,
    workspaceRoot,
    sourceProjectIdentity,
    blendFile,
    targetEngine,
    targetProjectIdentity,
    targetProjectRoot,
    ...(targetObjectPath !== undefined ? { targetObjectPath } : {}),
    ...(targetPropertyNames !== undefined ? { targetPropertyNames } : {}),
    format,
    assetName,
    ...(upAxis !== undefined ? { upAxis } : {}),
    ...(globalScale !== undefined ? { globalScale } : {}),
    maxConcurrency,
    now,
  };
}
