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
  canTransitionAssetStatus,
  parseAssetInterchangeManifest,
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

function exactFields(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      hopFail(label, `unknown field "${key}" — exact field set is ${allowed.join(", ")}`);
    }
  }
  for (const key of allowed) {
    if (value[key] === undefined) {
      hopFail(label, `missing field "${key}" — exact field set is ${allowed.join(", ")}`);
    }
  }
}

function subRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    hopFail(label, "must be a non-null object");
  }
  return value;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    hopFail(label, "must be a non-empty string");
  }
  return value;
}

function hopCapabilityRef(value: unknown, label: string): HopCapabilityRef {
  const record = subRecord(value, label);
  exactFields(record, ["capabilityId", "capabilityVersion"], label);
  return {
    capabilityId: nonEmptyString(record.capabilityId, `${label}.capabilityId`),
    capabilityVersion: nonEmptyString(record.capabilityVersion, `${label}.capabilityVersion`),
  };
}

/**
 * Builds and validates the full Blender→Godot hop: advances a real
 * `exported` manifest through every forward status to `runtime-verified`,
 * re-validating each stage through the contract parser and asserting each
 * transition is legal. Every contract violation fails closed.
 */
export function buildBlenderToGodotHop(input: unknown): BlenderToGodotHop {
  const record = subRecord(input, "input");
  exactFields(record, ["manifest", "target", "importer", "import", "build", "run"], "input");

  // ---- the source manifest: parses, is exactly `exported`, is the reviewed
  // hop source, and carries no target records (the export side owns none).
  const manifest = parseAssetInterchangeManifest(record.manifest);
  if (manifest.status !== "exported") {
    hopFail(
      "manifest.status",
      `the hop starts from exactly status "exported" (got "${manifest.status}") — no mid-chain starts, no skipped steps`,
    );
  }
  if (manifest.source.engine !== HOP_SOURCE_ENGINE) {
    hopFail(
      "manifest.source.engine",
      `THE reviewed hop source is "${HOP_SOURCE_ENGINE}" (got "${manifest.source.engine}") — no silent engine substitution`,
    );
  }
  if (manifest.target !== undefined) {
    hopFail("manifest.target", "the hop starts from a target-free exported manifest (the export side owns no target records)");
  }

  // ---- the reviewed participants (exact capability ids, fail-closed else).
  const target = subRecord(record.target, "target");
  exactFields(target, ["engineVersion", "projectIdentity"], "target");
  const targetEngineVersion = nonEmptyString(target.engineVersion, "target.engineVersion");
  const targetProjectIdentity = nonEmptyString(target.projectIdentity, "target.projectIdentity");

  const importer = hopCapabilityRef(record.importer, "importer");
  if (importer.capabilityId !== HOP_IMPORTER_CAPABILITY_ID) {
    hopFail(
      "importer.capabilityId",
      `must be exactly "${HOP_IMPORTER_CAPABILITY_ID}" (the reviewed importer; got "${importer.capabilityId}")`,
    );
  }
  const build = subRecord(record.build, "build");
  exactFields(build, ["buildArtifact", "builder"], "build");
  const builder = hopCapabilityRef(build.builder, "build.builder");
  if (builder.capabilityId !== HOP_BUILDER_CAPABILITY_ID) {
    hopFail(
      "build.builder.capabilityId",
      `must be exactly "${HOP_BUILDER_CAPABILITY_ID}" (the reviewed builder; got "${builder.capabilityId}")`,
    );
  }
  const run = subRecord(record.run, "run");
  exactFields(run, ["runner", "exitCode", "crashLines"], "run");
  const runner = hopCapabilityRef(run.runner, "run.runner");
  if (runner.capabilityId !== HOP_RUNNER_CAPABILITY_ID) {
    hopFail(
      "run.runner.capabilityId",
      `must be exactly "${HOP_RUNNER_CAPABILITY_ID}" (the reviewed runner; got "${runner.capabilityId}")`,
    );
  }

  // ---- the import record: the cross-engine integrity link + the reviewed
  // importer's byte-copy discipline (both MUST equal the manifest artifact sha).
  const importRecord = subRecord(record.import, "import");
  exactFields(importRecord, ["ingestedSourceSha256", "importedPath", "importedSha256", "evidence"], "import");
  const ingestedSourceSha256 = nonEmptyString(importRecord.ingestedSourceSha256, "import.ingestedSourceSha256");
  if (ingestedSourceSha256 !== manifest.artifact.sha256) {
    hopFail(
      "import.ingestedSourceSha256",
      `breaks the cross-engine integrity link: the manifest artifact is ${manifest.artifact.sha256} but the import consumed ${ingestedSourceSha256} — a different file than the manifest describes`,
    );
  }
  const importedSha256 = nonEmptyString(importRecord.importedSha256, "import.importedSha256");
  if (importedSha256 !== manifest.artifact.sha256) {
    hopFail(
      "import.importedSha256",
      `breaks the reviewed importer's byte-copy discipline: the staged copy is ${importedSha256} but the manifest artifact is ${manifest.artifact.sha256} — a non-copy import path is not the reviewed importer`,
    );
  }
  const importedPath = nonEmptyString(importRecord.importedPath, "import.importedPath");
  if (!Array.isArray(importRecord.evidence)) {
    hopFail("import.evidence", "must be an array of canonical workspace-relative evidence paths");
  }

  // ---- the run verdict: exit 0 AND zero crash lines (the project.run
  // verification column — exit 0 alone never proves success, crash lines
  // alone fail it).
  if (run.exitCode !== 0) {
    hopFail("run.exitCode", `must be 0 (got ${String(run.exitCode)}) — a non-zero headless run is a failed hop leg`);
  }
  if (run.crashLines !== 0) {
    hopFail(
      "run.crashLines",
      `must be 0 (got ${String(run.crashLines)}) — crash lines fail the run verdict even with exit 0`,
    );
  }

  // ---- the stage walk: exactly one legal forward step at a time, every
  // stage re-validated through the contract parser (unsafe paths, malformed
  // hashes and status-coupling violations fail closed at the step that hits
  // them — validation steps cannot be bypassed).
  const stages: AssetInterchangeManifest[] = [];
  const advance = (status: AssetInterchangeManifest["status"], targetPatch: Record<string, unknown>): void => {
    const previous = stages.length === 0 ? manifest : stages[stages.length - 1]!;
    const next = {
      ...previous,
      status,
      ...(previous.target === undefined && Object.keys(targetPatch).length === 0
        ? {}
        : {
            target: {
              ...(previous.target as Record<string, unknown> | undefined),
              ...targetPatch,
            },
          }),
    };
    if (!canTransitionAssetStatus(previous.status, status)) {
      hopFail("transition", `"${previous.status}" → "${status}" is not exactly one legal forward step`);
    }
    const validated = parseAssetInterchangeManifest(JSON.parse(JSON.stringify(next)));
    stages.push(validated);
  };

  advance("export-validated", {});
  advance("import-pending", {
    engine: HOP_TARGET_ENGINE,
    engineVersion: targetEngineVersion,
    projectIdentity: targetProjectIdentity,
    importer,
  });
  advance("imported", { importedPath, importedSha256 });
  advance("import-validated", { evidence: importRecord.evidence });
  advance("built", { buildArtifact: build.buildArtifact });
  advance("runtime-verified", { validation: "passed" });

  const final = stages[stages.length - 1]!;
  if (final.status !== "runtime-verified") {
    hopFail("final", `the stage walk must end at "runtime-verified" (got "${final.status}")`);
  }
  return { stages, final };
}
