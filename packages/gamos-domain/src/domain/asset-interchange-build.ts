/**
 * Pipeline-side export-manifest builder (`gamos/asset-interchange@1`, M3.4).
 *
 * Pure facility that turns a REAL engine export record — the additive result
 * fields of `blender/asset.export` (exact engine version, source asset sha256,
 * applied interchange settings, engine-verified dependent files) — into a
 * validated `status: "exported"` interchange manifest. The final-closure
 * handoff §7 (M3.1 pipeline, step 6) and §6 (manifest minimums) require the
 * pipeline to "generate and validate the cross-engine asset manifest"; this
 * module is the single builder — plugins stay dependency-free and never
 * duplicate the contract.
 *
 * Fail-closed rules beyond the wire contract:
 * - `source.assetSha256` is REQUIRED here (tight provenance: our producers
 *   always hash the source asset; the wire contract keeps the field optional);
 * - only the reviewed real-exporter formats are accepted (fbx/glb/gltf/obj);
 * - dependent files land in the manifest `dependencies` (all of them) and the
 *   `image/*` subset additionally in `interchange.textures`;
 * - the built manifest is validated through `parseAssetInterchangeManifest`
 *   (unsafe paths, malformed hashes and unknown fields fail closed).
 *
 * This module is pure data construction. It does not touch the filesystem:
 * the caller (pipeline/orchestration layer) supplies observed paths, hashes
 * and timestamps, and persists the serialized manifest.
 */

import {
  parseAssetInterchangeManifest,
  type AssetEngine,
  type AssetFileIntegrity,
  type AssetInterchangeManifest,
  type InterchangeSemantics,
} from "./asset-interchange.js";

/** The reviewed real-exporter interchange formats (verified against Blender 4.1.1). */
export const EXPORT_INTERCHANGE_FORMATS = ["fbx", "glb", "gltf", "obj"] as const;
export type ExportInterchangeFormat = (typeof EXPORT_INTERCHANGE_FORMATS)[number];

/** A dependent file observed by the export operation (engine-verified). */
export interface ExportDependentFile {
  readonly path: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly sha256: string;
}

/** Source provenance ingredients observed at export time. */
export interface ExportSourceRecord {
  readonly engine: AssetEngine;
  readonly engineVersion: string;
  readonly projectIdentity: string;
  readonly assetPath: string;
  readonly assetSha256: string;
  readonly operationPlanId?: string;
  readonly exporter: {
    readonly capabilityId: string;
    readonly capabilityVersion: string;
  };
}

/** The interchange semantics actually applied by the exporter (echoed, not assumed). */
export interface AppliedInterchangeRecord {
  readonly format: ExportInterchangeFormat;
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
  readonly animation?: {
    readonly skeleton: boolean;
    readonly clips: readonly string[];
  };
  readonly unsupported?: readonly string[];
}

/** The builder input: the real export record plus the artifact integrity. */
export interface ExportedManifestBuildInput {
  readonly manifestId: string;
  readonly source: ExportSourceRecord;
  readonly interchange: AppliedInterchangeRecord;
  readonly artifact: AssetFileIntegrity;
  readonly dependentFiles?: readonly ExportDependentFile[];
  readonly createdAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Builds and validates a `status: "exported"` asset interchange manifest from
 * a real engine export record. Every contract violation (unsafe paths,
 * malformed hashes, unknown fields, unsupported formats) fails closed.
 */
export function buildExportedManifest(input: unknown): AssetInterchangeManifest {
  if (!isRecord(input)) {
    throw new Error("GAMOS/ASSET-INTERCHANGE-BUILD: input — must be a non-null object");
  }
  if (!isRecord(input.source)) {
    throw new Error("GAMOS/ASSET-INTERCHANGE-BUILD: source — must be an object");
  }
  if (typeof input.source.assetSha256 !== "string" || input.source.assetSha256.length === 0) {
    throw new Error(
      "GAMOS/ASSET-INTERCHANGE-BUILD: source.assetSha256 — is REQUIRED for built manifests (tight provenance; the wire contract keeps it optional)",
    );
  }
  if (!isRecord(input.interchange)) {
    throw new Error("GAMOS/ASSET-INTERCHANGE-BUILD: interchange — must be an object");
  }
  if (
    typeof input.interchange.format !== "string" ||
    !(EXPORT_INTERCHANGE_FORMATS as readonly string[]).includes(input.interchange.format)
  ) {
    throw new Error(
      `GAMOS/ASSET-INTERCHANGE-BUILD: interchange.format — must be one of ${EXPORT_INTERCHANGE_FORMATS.join("|")} (reviewed real-exporter formats only)`,
    );
  }

  const dependentFiles = Array.isArray(input.dependentFiles)
    ? (input.dependentFiles as readonly ExportDependentFile[])
    : undefined;

  const interchange: InterchangeSemantics = {
    ...(input.interchange as unknown as AppliedInterchangeRecord),
    // image/* dependents are texture files; they additionally populate
    // interchange.textures while every dependent keeps a dependencies record.
    ...(dependentFiles !== undefined && dependentFiles.some((file) => file.mediaType.startsWith("image/"))
      ? { textures: dependentFiles.filter((file) => file.mediaType.startsWith("image/")) }
      : {}),
  };

  const manifest = {
    schema: "gamos/asset-interchange@1" as const,
    manifestId: input.manifestId,
    status: "exported" as const,
    source: input.source,
    interchange,
    artifact: input.artifact,
    ...(dependentFiles !== undefined && dependentFiles.length > 0 ? { dependencies: dependentFiles } : {}),
    createdAt: input.createdAt,
  };

  // Fail-closed validation through the contract parser.
  return parseAssetInterchangeManifest(manifest);
}
