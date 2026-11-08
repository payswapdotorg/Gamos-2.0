/**
 * Cross-engine asset interchange manifest (`gamos/asset-interchange@1`) — the
 * additive, versioned M3.4 contract (final-closure handoff §6). It captures
 * identity/provenance, file integrity (SHA-256 + dependent files), interchange
 * semantics (coordinates, axes, units, materials, color space, animation) and
 * target verification for an asset moved between engines.
 *
 * Constraints (handoff §6, binding):
 * - NOT a replacement for PlayLiquid GameIR and NOT a second asset database —
 *   it is a per-artifact interchange record;
 * - rejects unknown schema versions, missing mandatory metadata, corrupted
 *   hashes, absent dependencies, unsafe paths and unsupported target features;
 * - status model: exported → export-validated → import-pending → imported →
 *   import-validated → built → runtime-verified; failed; cancelled;
 * - a file existing on disk does not prove successful import or runtime use —
 *   later statuses demand the corresponding verification records.
 *
 * This module is pure data validation. It does not touch the filesystem:
 * runtime verification of hashes happens in the pipelines
 * (`matchesIntegrity` is the comparison helper), and staging/integration is
 * an executor responsibility.
 */

import { canonicalJson, canonicalSha256 } from "../adapters/canonical.js";
import type { EngineFamily } from "./game-concept.js";
import { canonicalizeClaimPath } from "./resource-claims.js";

export const ASSET_INTERCHANGE_SCHEMA_ID = "gamos/asset-interchange@1";

/** The forward status chain (failed/cancelled are terminal side-states). */
export const ASSET_STATUS_CHAIN = [
  "exported",
  "export-validated",
  "import-pending",
  "imported",
  "import-validated",
  "built",
  "runtime-verified",
] as const;

export type AssetInterchangeStatus =
  | (typeof ASSET_STATUS_CHAIN)[number]
  | "failed"
  | "cancelled";

/** An engine that can own project/asset state (never "core"). */
export type AssetEngine = Exclude<EngineFamily, "core">;

/** File integrity record for an artifact or a dependent file. */
export interface AssetFileIntegrity {
  readonly path: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly sha256: string;
}

/** Identity and provenance of the exported asset. */
export interface AssetSourceProvenance {
  readonly engine: AssetEngine;
  readonly engineVersion: string;
  readonly projectIdentity: string;
  readonly assetPath: string;
  readonly assetSha256?: string;
  readonly operationPlanId?: string;
  readonly exporter: {
    readonly capabilityId: string;
    readonly capabilityVersion: string;
  };
}

/** Interchange semantics recorded at export time. */
export interface InterchangeSemantics {
  readonly format: string;
  readonly handedness: "left" | "right";
  readonly upAxis: "y" | "z";
  readonly forwardAxis?: string;
  readonly units: string;
  readonly scaleFactor?: number;
  readonly appliedTransforms?: string;
  readonly colorSpace?: string;
  readonly uvChannels?: number;
  readonly materials?: {
    readonly referenced: readonly string[];
    readonly embedded: boolean;
  };
  readonly textures?: readonly AssetFileIntegrity[];
  readonly animation?: {
    readonly skeleton: boolean;
    readonly clips: readonly string[];
  };
  readonly unsupported?: readonly string[];
}

/** Target-side verification record (required from import-pending onward). */
export interface TargetVerification {
  readonly engine: AssetEngine;
  readonly engineVersion: string;
  readonly projectIdentity: string;
  readonly importer: {
    readonly capabilityId: string;
    readonly capabilityVersion: string;
    readonly settings?: string;
  };
  readonly importedPath?: string;
  readonly importedSha256?: string;
  readonly validation?: "pending" | "passed" | "failed";
  readonly buildArtifact?: AssetFileIntegrity;
  readonly evidence?: readonly string[];
}

/** The manifest itself. */
export interface AssetInterchangeManifest {
  readonly schema: "gamos/asset-interchange@1";
  readonly manifestId: string;
  readonly status: AssetInterchangeStatus;
  readonly source: AssetSourceProvenance;
  readonly interchange: InterchangeSemantics;
  readonly artifact: AssetFileIntegrity;
  readonly target?: TargetVerification;
  readonly createdAt: string;
}

const ASSET_ENGINES = ["unity", "blender", "babylon", "godot", "unreal"] as const;
const MANIFEST_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const CAPABILITY_ID_PATTERN = /^[a-z0-9-]+\/[a-z0-9.-]+$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9a-zA-Z.-]+)?$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const FORMAT_PATTERN = /^[a-z0-9][a-z0-9.+-]*$/;

function fail(field: string, reason: string): never {
  throw new Error(`GAMOS/ASSET-INTERCHANGE: ${field} — ${reason}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactFields(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      fail(label, `unknown field "${key}" — exact field set is ${allowed.join(", ")}`);
    }
  }
}

function parseEngine(value: unknown, label: string): AssetEngine {
  if (typeof value !== "string" || !(ASSET_ENGINES as readonly string[]).includes(value)) {
    fail(label, `must be one of ${ASSET_ENGINES.join("|")} ("core" is not an asset engine)`);
  }
  return value as AssetEngine;
}

function parseCanonicalPath(value: unknown, label: string): string {
  if (typeof value !== "string" || canonicalizeClaimPath(value) === null) {
    fail(label, "must be a canonical workspace-relative POSIX path (traversal, absolute and unsafe paths fail closed)");
  }
  return value;
}

function parseSha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail(label, "must be a lowercase 64-hex sha256");
  }
  return value;
}

function parseCapabilityRef(
  value: unknown,
  label: string,
): { readonly capabilityId: string; readonly capabilityVersion: string } {
  if (!isRecord(value)) fail(label, "must be an object");
  exactFields(value, ["capabilityId", "capabilityVersion", ...(label.includes("importer") ? ["settings"] : [])], label);
  if (typeof value.capabilityId !== "string" || !CAPABILITY_ID_PATTERN.test(value.capabilityId)) {
    fail(`${label}.capabilityId`, `must match ${CAPABILITY_ID_PATTERN}`);
  }
  if (typeof value.capabilityVersion !== "string" || !SEMVER_PATTERN.test(value.capabilityVersion)) {
    fail(`${label}.capabilityVersion`, "must be a semver string");
  }
  return {
    capabilityId: value.capabilityId,
    capabilityVersion: value.capabilityVersion,
    ...(value.settings !== undefined ? { settings: value.settings as string } : {}),
  } as { readonly capabilityId: string; readonly capabilityVersion: string };
}

function parseFileIntegrity(value: unknown, label: string): AssetFileIntegrity {
  if (!isRecord(value)) fail(label, "must be an object");
  exactFields(value, ["path", "mediaType", "byteLength", "sha256"], label);
  const path = parseCanonicalPath(value.path, `${label}.path`);
  if (typeof value.mediaType !== "string" || value.mediaType.length === 0) {
    fail(`${label}.mediaType`, "must be a non-empty string");
  }
  if (!Number.isInteger(value.byteLength) || (value.byteLength as number) <= 0) {
    fail(`${label}.byteLength`, "must be a positive integer");
  }
  const sha256 = parseSha256(value.sha256, `${label}.sha256`);
  return { path, mediaType: value.mediaType, byteLength: value.byteLength as number, sha256 };
}

function parseStringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) fail(label, "must be an array");
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0) {
      fail(`${label}[]`, "each entry must be a non-empty string");
    }
  }
  return value as readonly string[];
}

function statusRequiresTarget(status: AssetInterchangeStatus): boolean {
  return status === "import-pending" || status === "imported" || status === "import-validated" ||
    status === "built" || status === "runtime-verified";
}

/**
 * Validates + constructs an asset interchange manifest. Fail-closed on unknown
 * schema versions, malformed fields, unknown fields (exact field sets),
 * corrupted hashes, unsafe paths, and status-coupling violations (later
 * statuses demand the corresponding target/import/build/runtime-verification
 * records).
 */
export function parseAssetInterchangeManifest(input: unknown): AssetInterchangeManifest {
  if (!isRecord(input)) fail("manifest", "must be a non-null object");
  exactFields(input, ["schema", "manifestId", "status", "source", "interchange", "artifact", "target", "createdAt"], "manifest");

  if (input.schema !== ASSET_INTERCHANGE_SCHEMA_ID) {
    fail("manifest.schema", `must be exactly "${ASSET_INTERCHANGE_SCHEMA_ID}" — unknown schema versions fail closed`);
  }
  if (typeof input.manifestId !== "string" || !MANIFEST_ID_PATTERN.test(input.manifestId)) {
    fail("manifest.manifestId", `must match ${MANIFEST_ID_PATTERN}`);
  }
  const status = input.status;
  if (typeof status !== "string" || !( [...ASSET_STATUS_CHAIN, "failed", "cancelled"] as readonly string[]).includes(status)) {
    fail("manifest.status", `must be one of ${[...ASSET_STATUS_CHAIN, "failed", "cancelled"].join("|")}`);
  }

  // Source provenance.
  if (!isRecord(input.source)) fail("manifest.source", "must be an object");
  exactFields(
    input.source,
    ["engine", "engineVersion", "projectIdentity", "assetPath", "assetSha256", "operationPlanId", "exporter"],
    "manifest.source",
  );
  const sourceEngine = parseEngine(input.source.engine, "manifest.source.engine");
  if (typeof input.source.engineVersion !== "string" || input.source.engineVersion.length === 0) {
    fail("manifest.source.engineVersion", "must be a non-empty exact version string");
  }
  const projectIdentity = parseCanonicalPath(input.source.projectIdentity, "manifest.source.projectIdentity");
  const assetPath = parseCanonicalPath(input.source.assetPath, "manifest.source.assetPath");
  if (input.source.assetSha256 !== undefined && (typeof input.source.assetSha256 !== "string" || !SHA256_PATTERN.test(input.source.assetSha256))) {
    fail("manifest.source.assetSha256", "must be a 64-hex sha256 when present");
  }
  if (input.source.operationPlanId !== undefined && (typeof input.source.operationPlanId !== "string" || !MANIFEST_ID_PATTERN.test(input.source.operationPlanId))) {
    fail("manifest.source.operationPlanId", `must match ${MANIFEST_ID_PATTERN} when present`);
  }
  const exporter = parseCapabilityRef(input.source.exporter, "manifest.source.exporter");

  // Interchange semantics.
  if (!isRecord(input.interchange)) fail("manifest.interchange", "must be an object");
  exactFields(
    input.interchange,
    ["format", "handedness", "upAxis", "forwardAxis", "units", "scaleFactor", "appliedTransforms", "colorSpace", "uvChannels", "materials", "textures", "animation", "unsupported"],
    "manifest.interchange",
  );
  if (typeof input.interchange.format !== "string" || !FORMAT_PATTERN.test(input.interchange.format)) {
    fail("manifest.interchange.format", "must be a lowercase format identifier (e.g. fbx, glb, gltf, obj)");
  }
  for (const key of ["forwardAxis", "appliedTransforms", "colorSpace"] as const) {
    const value = input.interchange[key];
    if (value !== undefined && (typeof value !== "string" || value.length === 0)) {
      fail(`manifest.interchange.${key}`, "must be a non-empty string when present");
    }
  }
  if (input.interchange.handedness !== "left" && input.interchange.handedness !== "right") {
    fail("manifest.interchange.handedness", 'must be "left" | "right"');
  }
  if (input.interchange.upAxis !== "y" && input.interchange.upAxis !== "z") {
    fail("manifest.interchange.upAxis", 'must be "y" | "z"');
  }
  if (typeof input.interchange.units !== "string" || input.interchange.units.length === 0) {
    fail("manifest.interchange.units", "must be a non-empty string (e.g. meter, centimeter)");
  }
  if (input.interchange.scaleFactor !== undefined && (typeof input.interchange.scaleFactor !== "number" || !Number.isFinite(input.interchange.scaleFactor) || (input.interchange.scaleFactor as number) <= 0)) {
    fail("manifest.interchange.scaleFactor", "must be a positive finite number when present");
  }
  if (input.interchange.uvChannels !== undefined && (!Number.isInteger(input.interchange.uvChannels) || (input.interchange.uvChannels as number) < 0)) {
    fail("manifest.interchange.uvChannels", "must be a non-negative integer when present");
  }
  if (input.interchange.materials !== undefined) {
    if (!isRecord(input.interchange.materials)) fail("manifest.interchange.materials", "must be an object");
    exactFields(input.interchange.materials, ["referenced", "embedded"], "manifest.interchange.materials");
    parseStringArray(input.interchange.materials.referenced, "manifest.interchange.materials.referenced");
    if (typeof input.interchange.materials.embedded !== "boolean") {
      fail("manifest.interchange.materials.embedded", "must be boolean");
    }
  }
  if (input.interchange.textures !== undefined) {
    if (!Array.isArray(input.interchange.textures)) fail("manifest.interchange.textures", "must be an array");
    (input.interchange.textures as unknown[]).forEach((texture, index) => {
      parseFileIntegrity(texture, `manifest.interchange.textures[${index}]`);
    });
  }
  if (input.interchange.animation !== undefined) {
    if (!isRecord(input.interchange.animation)) fail("manifest.interchange.animation", "must be an object");
    exactFields(input.interchange.animation, ["skeleton", "clips"], "manifest.interchange.animation");
    if (typeof input.interchange.animation.skeleton !== "boolean") {
      fail("manifest.interchange.animation.skeleton", "must be boolean");
    }
    parseStringArray(input.interchange.animation.clips, "manifest.interchange.animation.clips");
  }
  if (input.interchange.unsupported !== undefined) {
    parseStringArray(input.interchange.unsupported, "manifest.interchange.unsupported");
  }

  // Artifact integrity.
  const artifact = parseFileIntegrity(input.artifact, "manifest.artifact");

  // Target verification.
  let target: TargetVerification | undefined;
  if (input.target !== undefined) {
    if (!isRecord(input.target)) fail("manifest.target", "must be an object");
    exactFields(
      input.target,
      ["engine", "engineVersion", "projectIdentity", "importer", "importedPath", "importedSha256", "validation", "buildArtifact", "evidence"],
      "manifest.target",
    );
    const targetEngine = parseEngine(input.target.engine, "manifest.target.engine");
    if (typeof input.target.engineVersion !== "string" || input.target.engineVersion.length === 0) {
      fail("manifest.target.engineVersion", "must be a non-empty exact version string");
    }
    const targetProject = parseCanonicalPath(input.target.projectIdentity, "manifest.target.projectIdentity");
    const importer = parseCapabilityRef(input.target.importer, "manifest.target.importer");
    if (input.target.importedPath !== undefined) {
      parseCanonicalPath(input.target.importedPath, "manifest.target.importedPath");
    }
    if (input.target.importedSha256 !== undefined && !SHA256_PATTERN.test(String(input.target.importedSha256))) {
      fail("manifest.target.importedSha256", "must be a 64-hex sha256 when present");
    }
    if (
      input.target.validation !== undefined &&
      !["pending", "passed", "failed"].includes(String(input.target.validation))
    ) {
      fail("manifest.target.validation", 'must be "pending" | "passed" | "failed" when present');
    }
    let buildArtifact: AssetFileIntegrity | undefined;
    if (input.target.buildArtifact !== undefined) {
      buildArtifact = parseFileIntegrity(input.target.buildArtifact, "manifest.target.buildArtifact");
    }
    let evidence: readonly string[] | undefined;
    if (input.target.evidence !== undefined) {
      if (!Array.isArray(input.target.evidence)) fail("manifest.target.evidence", "must be an array");
      (input.target.evidence as unknown[]).forEach((entry, index) => {
        parseCanonicalPath(entry, `manifest.target.evidence[${index}]`);
      });
      evidence = input.target.evidence as readonly string[];
    }
    target = {
      engine: targetEngine,
      engineVersion: input.target.engineVersion as string,
      projectIdentity: targetProject,
      importer,
      ...(input.target.importedPath !== undefined ? { importedPath: input.target.importedPath as string } : {}),
      ...(input.target.importedSha256 !== undefined ? { importedSha256: input.target.importedSha256 as string } : {}),
      ...(input.target.validation !== undefined ? { validation: input.target.validation as TargetVerification["validation"] } : {}),
      ...(buildArtifact !== undefined ? { buildArtifact } : {}),
      ...(evidence !== undefined ? { evidence } : {}),
    };
  }

  // Status coupling: a file existing on disk does not prove import or runtime use.
  if (statusRequiresTarget(status as AssetInterchangeStatus) && target === undefined) {
    fail("manifest.target", `status "${status}" requires the target verification record (a file on disk does not prove import)`);
  }
  if ((status === "imported" || status === "import-validated" || status === "built" || status === "runtime-verified")) {
    if (target?.importedPath === undefined) fail("manifest.target.importedPath", `status "${status}" requires the imported asset path`);
    if (target?.importedSha256 === undefined) fail("manifest.target.importedSha256", `status "${status}" requires the engine-verified imported asset hash`);
  }
  if (status === "built" || status === "runtime-verified") {
    if (target?.buildArtifact === undefined) fail("manifest.target.buildArtifact", `status "${status}" requires the build artifact record`);
  }
  if (status === "runtime-verified") {
    if (target?.validation !== "passed") {
      fail("manifest.target.validation", 'status "runtime-verified" requires validation "passed"');
    }
    if (target?.evidence === undefined || target.evidence.length === 0) {
      fail("manifest.target.evidence", 'status "runtime-verified" requires at least one evidence path');
    }
  }

  if (typeof input.createdAt !== "string" || !Number.isFinite(Date.parse(input.createdAt))) {
    fail("manifest.createdAt", "must be an ISO-8601 timestamp");
  }

  return {
    schema: ASSET_INTERCHANGE_SCHEMA_ID,
    manifestId: input.manifestId as string,
    status: status as AssetInterchangeStatus,
    source: {
      engine: sourceEngine,
      engineVersion: input.source.engineVersion as string,
      projectIdentity,
      assetPath,
      ...(input.source.assetSha256 !== undefined ? { assetSha256: input.source.assetSha256 as string } : {}),
      ...(input.source.operationPlanId !== undefined ? { operationPlanId: input.source.operationPlanId as string } : {}),
      exporter: { capabilityId: exporter.capabilityId, capabilityVersion: exporter.capabilityVersion },
    },
    interchange: input.interchange as unknown as InterchangeSemantics,
    artifact,
    ...(target !== undefined ? { target } : {}),
    createdAt: input.createdAt as string,
  };
}

/** Deterministic canonical serialization. */
export function serializeAssetInterchangeManifest(manifest: AssetInterchangeManifest): string {
  return canonicalJson(manifest);
}

/** Stable SHA-256 digest of the canonical serialization. */
export function hashAssetInterchangeManifest(manifest: AssetInterchangeManifest): string {
  return canonicalSha256(manifest);
}

/** Terminal statuses cannot transition anywhere (a retry is a new manifest). */
export function isTerminalAssetStatus(status: AssetInterchangeStatus): boolean {
  return status === "failed" || status === "cancelled";
}

/**
 * Legal status moves: exactly one forward step along ASSET_STATUS_CHAIN
 * (validation steps cannot be bypassed, nothing moves backwards or stays), or
 * a move from any non-terminal status to failed/cancelled.
 */
export function canTransitionAssetStatus(from: AssetInterchangeStatus, to: AssetInterchangeStatus): boolean {
  if (from === to) return false;
  if (isTerminalAssetStatus(from)) return false;
  if (to === "failed" || to === "cancelled") return true;
  const fromIndex = (ASSET_STATUS_CHAIN as readonly string[]).indexOf(from);
  const toIndex = (ASSET_STATUS_CHAIN as readonly string[]).indexOf(to);
  if (fromIndex === -1 || toIndex === -1) return false;
  return toIndex === fromIndex + 1;
}

/** Compares a declared integrity record against an observed file. */
export function matchesIntegrity(
  declared: AssetFileIntegrity,
  actual: { readonly byteLength: number; readonly sha256: string },
): boolean {
  return declared.byteLength === actual.byteLength && declared.sha256 === actual.sha256.toLowerCase();
}
