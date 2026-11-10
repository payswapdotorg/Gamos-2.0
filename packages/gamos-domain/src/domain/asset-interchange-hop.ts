/**
 * Target-side hop builder (`gamos/asset-interchange@1`, M4 WP-3) — the
 * Blender→Godot cross-engine hop.
 *
 * Pure facility that advances a REAL `status: "exported"` interchange
 * manifest (built by `asset-interchange-build.ts` from a real
 * `blender/asset.export` record) through the full forward status chain to
 * `runtime-verified`, using ONLY real engine-side records: the Godot version
 * that performed the import, the engine-verified staged-asset hash, the
 * filesystem-probe evidence paths, the headless build artifact and the
 * headless-run verdict. Delivery plan §3 order 3 (readiness §4.1's
 * verification column is the contract) — a file existing on disk proves
 * nothing; every status step demands its verification records.
 *
 * Fail-closed rules beyond the wire contract (tight, mirroring the export
 * builder's provenance tightness):
 * - the hop starts from a manifest that parses AND is exactly
 *   `status: "exported"` with `source.engine: "blender"` — this is THE
 *   reviewed Blender→Godot hop; any other source or a mid-chain start fails
 *   closed (no silent engine substitution, no skipped steps);
 * - the importer is exactly `godot/asset.import`, the builder exactly
 *   `godot/project.build`, the runner exactly `godot/project.run` (the
 *   reviewed capability ids for this hop; unreviewed ids fail closed);
 * - `import.ingestedSourceSha256` MUST equal `manifest.artifact.sha256` —
 *   THE cross-engine integrity link: the file Godot ingested is byte-identical
 *   to the file Blender produced per the manifest;
 * - `import.importedSha256` MUST equal `manifest.artifact.sha256` too — the
 *   reviewed importer stages a byte copy (the op's own source-mutated guard);
 *   a differing hash is not the reviewed import path;
 * - the run verdict must be exit code 0 AND zero crash lines (the
 *   project.run verification column: exit 0 alone never proves success, and
 *   crash lines alone fail it);
 * - every intermediate stage is re-validated through
 *   `parseAssetInterchangeManifest` and every transition must be legal per
 *   `canTransitionAssetStatus` (exactly one forward step at a time —
 *   validation steps cannot be bypassed);
 * - the returned `final` manifest is `runtime-verified` with
 *   `target.validation: "passed"` and the engine-read-back evidence paths.
 *
 * This module is pure data construction. It does not touch the filesystem:
 * the caller (integration/pipeline layer) supplies observed paths, hashes
 * and verdicts, and persists the serialized manifests.
 */

import {
  type AssetFileIntegrity,
  type AssetInterchangeManifest,
} from "./asset-interchange.js";

/** The reviewed hop participants (fail-closed on anything else). */
export const HOP_SOURCE_ENGINE = "blender" as const;
export const HOP_TARGET_ENGINE = "godot" as const;
export const HOP_IMPORTER_CAPABILITY_ID = "godot/asset.import" as const;
export const HOP_BUILDER_CAPABILITY_ID = "godot/project.build" as const;
export const HOP_RUNNER_CAPABILITY_ID = "godot/project.run" as const;

/** A reviewed hop capability reference (capability id is exact-checked). */
export interface HopCapabilityRef {
  readonly capabilityId: string;
  readonly capabilityVersion: string;
}

/** Target-side base record: the real Godot that performed the hop legs. */
export interface HopTargetRecord {
  readonly engineVersion: string;
  readonly projectIdentity: string;
}

/** The real `godot/asset.import` outcome record (filesystem-probe verified). */
export interface HopImportRecord {
  /** The sha256 of the source the import consumed — MUST equal the manifest artifact sha (the integrity link). */
  readonly ingestedSourceSha256: string;
  /** Canonical workspace-relative path of the staged asset inside the project. */
  readonly importedPath: string;
  /** Engine-verified hash of the staged copy (byte-copy discipline of the reviewed importer). */
  readonly importedSha256: string;
  /** Filesystem-probe evidence paths (the .import metadata + .godot/imported artifacts). */
  readonly evidence: readonly string[];
}

/** The real `godot/project.build` outcome record (headless export). */
export interface HopBuildRecord {
  readonly buildArtifact: AssetFileIntegrity;
  readonly builder: HopCapabilityRef;
}

/** The real `godot/project.run` verdict (exit 0 AND zero crash lines). */
export interface HopRunRecord {
  readonly runner: HopCapabilityRef;
  readonly exitCode: number;
  readonly crashLines: number;
}

/** The hop builder input: the exported manifest plus every real leg record. */
export interface BlenderToGodotHopInput {
  readonly manifest: unknown;
  readonly target: HopTargetRecord;
  readonly importer: HopCapabilityRef;
  readonly import: HopImportRecord;
  readonly build: HopBuildRecord;
  readonly run: HopRunRecord;
}

/** The hop result: every forward stage, validated, plus the final manifest. */
export interface BlenderToGodotHop {
  /** The six forward stages after `exported`: export-validated → import-pending → imported → import-validated → built → runtime-verified. */
  readonly stages: readonly AssetInterchangeManifest[];
  /** The `runtime-verified` manifest (identical to the last stage). */
  readonly final: AssetInterchangeManifest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hopFail(field: string, reason: string): never {
  throw new Error(`GAMOS/ASSET-INTERCHANGE-HOP: ${field} — ${reason}`);
}

/**
 * Builds and validates the full Blender→Godot hop: advances a real
 * `exported` manifest through every forward status to `runtime-verified`,
 * re-validating each stage through the contract parser and asserting each
 * transition is legal. Every contract violation fails closed.
 */
export function buildBlenderToGodotHop(input: unknown): BlenderToGodotHop {
  if (!isRecord(input)) {
    hopFail("input", "must be a non-null object");
  }
  // WP-3 RED stub: the binding tests land first; this marker is the honest
  // missing-behavior signal the GREEN commit replaces (delivery plan §4).
  hopFail(
    "not-implemented",
    "the Blender→Godot hop builder lands with the M4 WP-3 GREEN commit — the RED tests bind the contract first",
  );
}
