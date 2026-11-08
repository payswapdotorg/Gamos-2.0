/**
 * M3.4 — the additive, versioned cross-engine asset interchange manifest
 * (`gamos/asset-interchange@1`). Written FIRST (strict TDD RED) per the
 * final-closure handoff §6: the manifest is NOT a replacement for PlayLiquid
 * GameIR and must not become a second asset database — it captures identity
 * and provenance, file integrity (SHA-256 + dependencies), interchange
 * semantics (coordinates/axes/units/materials/color space) and target
 * verification, and rejects unknown schema versions, missing mandatory
 * metadata, corrupted hashes, absent dependencies, unsafe paths and
 * unsupported targets.
 *
 * Status model (handoff §6): exported → export-validated → import-pending →
 * imported → import-validated → built → runtime-verified; failed; cancelled.
 * A file existing on disk does not prove successful import or runtime use —
 * the status coupling rules below enforce that claim structure.
 */

import { describe, expect, it } from "vitest";
import {
  ASSET_INTERCHANGE_SCHEMA_ID,
  ASSET_STATUS_CHAIN,
  parseAssetInterchangeManifest,
  serializeAssetInterchangeManifest,
  hashAssetInterchangeManifest,
  canTransitionAssetStatus,
  isTerminalAssetStatus,
  matchesIntegrity,
} from "../src/domain/asset-interchange.js";

const sha = (c: string) => c.repeat(64);

const validExportedManifest = {
  schema: "gamos/asset-interchange@1",
  manifestId: "asset-mesh-001",
  status: "exported",
  source: {
    engine: "blender",
    engineVersion: "4.1.1",
    projectIdentity: "blender-project",
    assetPath: "blender-project/scenes/main.blend",
    assetSha256: sha("a"),
    operationPlanId: "plan-001",
    exporter: { capabilityId: "blender/asset.export", capabilityVersion: "1.0.0" },
  },
  interchange: {
    format: "fbx",
    handedness: "right",
    upAxis: "y",
    forwardAxis: "-z",
    units: "meter",
    scaleFactor: 1,
    colorSpace: "srgb",
    uvChannels: 2,
    materials: { referenced: ["Material.mesh"], embedded: true },
    textures: [
      { path: "staging/textures/mesh_base.png", mediaType: "image/png", byteLength: 1024, sha256: sha("c") },
    ],
    animation: { skeleton: false, clips: [] },
    unsupported: ["shape keys are not carried by the FBX 2020 exporter"],
  },
  artifact: {
    path: "staging/mesh.fbx",
    mediaType: "application/octet-stream",
    byteLength: 2048,
    sha256: sha("b"),
  },
  createdAt: "2026-11-08T03:00:00Z",
};

const runtimeVerifiedManifest = {
  ...validExportedManifest,
  status: "runtime-verified",
  target: {
    engine: "babylon",
    engineVersion: "8.0.0",
    projectIdentity: "babylon-project",
    importer: { capabilityId: "babylon/asset.integrate", capabilityVersion: "1.0.0", settings: "default" },
    importedPath: "babylon-project/public/mesh.glb",
    importedSha256: sha("d"),
    validation: "passed",
    buildArtifact: { path: "babylon-project/dist/index.html", mediaType: "text/html", byteLength: 4096, sha256: sha("e") },
    evidence: ["evidence/phase-m3/babylon-runtime-verification.json"],
  },
};

describe("asset interchange manifest validation (gamos/asset-interchange@1, fail closed)", () => {
  it("exposes the schema identity and the canonical status chain", () => {
    expect(ASSET_INTERCHANGE_SCHEMA_ID).toBe("gamos/asset-interchange@1");
    expect(ASSET_STATUS_CHAIN).toEqual([
      "exported",
      "export-validated",
      "import-pending",
      "imported",
      "import-validated",
      "built",
      "runtime-verified",
    ]);
  });

  it("parses a valid exported manifest without a target", () => {
    const manifest = parseAssetInterchangeManifest(validExportedManifest);
    expect(manifest.status).toBe("exported");
    expect(manifest.target).toBeUndefined();
    expect(manifest.source.exporter.capabilityId).toBe("blender/asset.export");
  });

  it("parses a fully verified manifest and hashes deterministically", () => {
    const manifest = parseAssetInterchangeManifest(runtimeVerifiedManifest);
    expect(manifest.status).toBe("runtime-verified");
    expect(manifest.target?.importedPath).toBe("babylon-project/public/mesh.glb");
    const hash = hashAssetInterchangeManifest(manifest);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // Key-order independence: shuffled input hashes identically.
    const shuffled = {
      createdAt: runtimeVerifiedManifest.createdAt,
      artifact: { sha256: sha("b"), byteLength: 2048, mediaType: "application/octet-stream", path: "staging/mesh.fbx" },
      interchange: { ...runtimeVerifiedManifest.interchange },
      source: { ...runtimeVerifiedManifest.source, exporter: { ...runtimeVerifiedManifest.source.exporter } },
      status: runtimeVerifiedManifest.status,
      manifestId: runtimeVerifiedManifest.manifestId,
      schema: runtimeVerifiedManifest.schema,
      target: { ...runtimeVerifiedManifest.target, importer: { ...runtimeVerifiedManifest.target.importer } },
    };
    expect(hashAssetInterchangeManifest(parseAssetInterchangeManifest(shuffled))).toBe(hash);
    expect(serializeAssetInterchangeManifest(manifest)).toBe(
      serializeAssetInterchangeManifest(parseAssetInterchangeManifest(shuffled)),
    );
  });

  it("rejects unknown schema versions and malformed status values", () => {
    expect(() => parseAssetInterchangeManifest({ ...validExportedManifest, schema: "gamos/asset-interchange@2" })).toThrow(/schema/i);
    expect(() => parseAssetInterchangeManifest({ ...validExportedManifest, schema: "gamos/artifact@1" })).toThrow(/schema/i);
    expect(() => parseAssetInterchangeManifest({ ...validExportedManifest, status: "delivered" })).toThrow(/status/i);
    expect(() => parseAssetInterchangeManifest({ ...validExportedManifest, status: "RUNTIME-VERIFIED" })).toThrow(/status/i);
  });

  it("rejects unknown top-level and nested fields (exact field sets)", () => {
    expect(() => parseAssetInterchangeManifest({ ...validExportedManifest, extra: 1 })).toThrow(/extra|unknown/i);
    expect(() => parseAssetInterchangeManifest({ ...validExportedManifest, source: { ...validExportedManifest.source, extra: 1 } })).toThrow(/extra|unknown/i);
    expect(() => parseAssetInterchangeManifest({ ...validExportedManifest, artifact: { ...validExportedManifest.artifact, extra: 1 } })).toThrow(/extra|unknown/i);
    expect(() => parseAssetInterchangeManifest({ ...runtimeVerifiedManifest, target: { ...runtimeVerifiedManifest.target, extra: 1 } })).toThrow(/extra|unknown/i);
  });

  it("rejects invalid source provenance (engine, version, paths, hashes, exporter)", () => {
    expect(() => parseAssetInterchangeManifest({ ...validExportedManifest, source: { ...validExportedManifest.source, engine: "core" } })).toThrow(/engine/i);
    expect(() => parseAssetInterchangeManifest({ ...validExportedManifest, source: { ...validExportedManifest.source, engine: "webgl" } })).toThrow(/engine/i);
    expect(() => parseAssetInterchangeManifest({ ...validExportedManifest, source: { ...validExportedManifest.source, engineVersion: "" } })).toThrow(/engineVersion/i);
    expect(() => parseAssetInterchangeManifest({ ...validExportedManifest, source: { ...validExportedManifest.source, projectIdentity: "../other-project" } })).toThrow(/projectIdentity|path/i);
    expect(() => parseAssetInterchangeManifest({ ...validExportedManifest, source: { ...validExportedManifest.source, assetPath: "/abs/path.blend" } })).toThrow(/assetPath|path/i);
    expect(() => parseAssetInterchangeManifest({ ...validExportedManifest, source: { ...validExportedManifest.source, assetSha256: "xyz" } })).toThrow(/assetSha256|sha256/i);
    expect(() => parseAssetInterchangeManifest({ ...validExportedManifest, source: { ...validExportedManifest.source, operationPlanId: "Not A Plan" } })).toThrow(/operationPlanId/i);
    expect(() => parseAssetInterchangeManifest({ ...validExportedManifest, source: { ...validExportedManifest.source, exporter: { capabilityId: "no-slash", capabilityVersion: "1.0.0" } } })).toThrow(/capabilityId/i);
    expect(() => parseAssetInterchangeManifest({ ...validExportedManifest, source: { ...validExportedManifest.source, exporter: { capabilityId: "blender/asset.export", capabilityVersion: "1" } } })).toThrow(/capabilityVersion/i);
  });

  it("rejects invalid interchange semantics", () => {
    expect(() => parseAssetInterchangeManifest({ ...validExportedManifest, interchange: { ...validExportedManifest.interchange, format: "FBX" } })).toThrow(/format/i);
    expect(() => parseAssetInterchangeManifest({ ...validExportedManifest, interchange: { ...validExportedManifest.interchange, handedness: "middle" } })).toThrow(/handedness/i);
    expect(() => parseAssetInterchangeManifest({ ...validExportedManifest, interchange: { ...validExportedManifest.interchange, upAxis: "x" } })).toThrow(/upAxis/i);
    expect(() => parseAssetInterchangeManifest({ ...validExportedManifest, interchange: { ...validExportedManifest.interchange, units: "" } })).toThrow(/units/i);
    expect(() => parseAssetInterchangeManifest({ ...validExportedManifest, interchange: { ...validExportedManifest.interchange, scaleFactor: 0 } })).toThrow(/scaleFactor/i);
    expect(() => parseAssetInterchangeManifest({ ...validExportedManifest, interchange: { ...validExportedManifest.interchange, scaleFactor: -1 } })).toThrow(/scaleFactor/i);
    expect(() => parseAssetInterchangeManifest({ ...validExportedManifest, interchange: { ...validExportedManifest.interchange, uvChannels: -1 } })).toThrow(/uvChannels/i);
    expect(() => parseAssetInterchangeManifest({ ...validExportedManifest, interchange: { ...validExportedManifest.interchange, materials: { referenced: [""], embedded: true } } })).toThrow(/material/i);
    expect(() => parseAssetInterchangeManifest({ ...validExportedManifest, interchange: { ...validExportedManifest.interchange, textures: [{ path: "../escape.png", mediaType: "image/png", byteLength: 1, sha256: sha("c") }] } })).toThrow(/path/i);
    expect(() => parseAssetInterchangeManifest({ ...validExportedManifest, interchange: { ...validExportedManifest.interchange, textures: [{ path: "t.png", mediaType: "image/png", byteLength: 0, sha256: sha("c") }] } })).toThrow(/byteLength/i);
    expect(() => parseAssetInterchangeManifest({ ...validExportedManifest, interchange: { ...validExportedManifest.interchange, textures: [{ path: "t.png", mediaType: "image/png", byteLength: 1, sha256: "abc" }] } })).toThrow(/sha256/i);
    expect(() => parseAssetInterchangeManifest({ ...validExportedManifest, interchange: { ...validExportedManifest.interchange, unsupported: [""] } })).toThrow(/unsupported/i);
  });

  it("rejects an invalid artifact integrity record", () => {
    expect(() => parseAssetInterchangeManifest({ ...validExportedManifest, artifact: { ...validExportedManifest.artifact, path: "" } })).toThrow(/path/i);
    expect(() => parseAssetInterchangeManifest({ ...validExportedManifest, artifact: { ...validExportedManifest.artifact, mediaType: "" } })).toThrow(/mediaType/i);
    expect(() => parseAssetInterchangeManifest({ ...validExportedManifest, artifact: { ...validExportedManifest.artifact, byteLength: -5 } })).toThrow(/byteLength/i);
    expect(() => parseAssetInterchangeManifest({ ...validExportedManifest, artifact: { ...validExportedManifest.artifact, sha256: "z".repeat(64) } })).toThrow(/sha256/i);
    expect(() => parseAssetInterchangeManifest({ ...validExportedManifest, artifact: { ...validExportedManifest.artifact, path: "a\\b.fbx" } })).toThrow(/path/i);
  });

  it("rejects an invalid target verification record", () => {
    const withTarget = (target: Record<string, unknown>) =>
      parseAssetInterchangeManifest({ ...runtimeVerifiedManifest, target });
    expect(() => withTarget({ ...runtimeVerifiedManifest.target, engine: "core" })).toThrow(/engine/i);
    expect(() => withTarget({ ...runtimeVerifiedManifest.target, importer: { capabilityId: "bad", capabilityVersion: "1.0.0" } })).toThrow(/capabilityId/i);
    expect(() => withTarget({ ...runtimeVerifiedManifest.target, importer: undefined as never })).toThrow(/importer/i);
    expect(() => withTarget({ ...runtimeVerifiedManifest.target, importedSha256: "short" })).toThrow(/importedSha256|sha256/i);
    expect(() => withTarget({ ...runtimeVerifiedManifest.target, validation: "maybe" })).toThrow(/validation/i);
    expect(() => withTarget({ ...runtimeVerifiedManifest.target, evidence: ["../../etc/passwd"] })).toThrow(/evidence|path/i);
    expect(() => withTarget({ ...runtimeVerifiedManifest.target, buildArtifact: { path: "../escape.html", mediaType: "text/html", byteLength: 1, sha256: sha("e") } })).toThrow(/path/i);
  });

  it("enforces status coupling: import-pending and beyond require the target record", () => {
    expect(() => parseAssetInterchangeManifest({ ...validExportedManifest, status: "import-pending" })).toThrow(/target/i);
    expect(() => parseAssetInterchangeManifest({ ...validExportedManifest, status: "imported" })).toThrow(/target/i);
  });

  it("enforces status coupling: imported+ requires importedPath and importedSha256", () => {
    const base = { ...runtimeVerifiedManifest, status: "imported" as const };
    expect(() => parseAssetInterchangeManifest(base)).not.toThrow();
    expect(() =>
      parseAssetInterchangeManifest({ ...base, target: { ...base.target, importedPath: undefined as never } }),
    ).toThrow(/importedPath/i);
    expect(() =>
      parseAssetInterchangeManifest({ ...base, target: { ...base.target, importedSha256: undefined as never } }),
    ).toThrow(/importedSha256/i);
  });

  it("enforces status coupling: built+ requires a build artifact; runtime-verified requires passing validation and evidence", () => {
    const built = { ...runtimeVerifiedManifest, status: "built" as const };
    expect(() => parseAssetInterchangeManifest(built)).not.toThrow();
    expect(() =>
      parseAssetInterchangeManifest({ ...built, target: { ...built.target, buildArtifact: undefined as never } }),
    ).toThrow(/buildArtifact/i);
    expect(() => parseAssetInterchangeManifest({ ...built, status: "runtime-verified" })).not.toThrow();
    expect(() =>
      parseAssetInterchangeManifest({ ...runtimeVerifiedManifest, target: { ...runtimeVerifiedManifest.target, validation: "pending" } }),
    ).toThrow(/validation/i);
    expect(() =>
      parseAssetInterchangeManifest({ ...runtimeVerifiedManifest, target: { ...runtimeVerifiedManifest.target, evidence: [] } }),
    ).toThrow(/evidence/i);
  });

  it("accepts terminal statuses without extra coupling requirements", () => {
    expect(parseAssetInterchangeManifest({ ...validExportedManifest, status: "failed" }).status).toBe("failed");
    expect(parseAssetInterchangeManifest({ ...validExportedManifest, status: "cancelled" }).status).toBe("cancelled");
  });

  it("rejects a malformed manifestId, createdAt and non-object input", () => {
    expect(() => parseAssetInterchangeManifest({ ...validExportedManifest, manifestId: "Bad ID" })).toThrow(/manifestId/i);
    expect(() => parseAssetInterchangeManifest({ ...validExportedManifest, createdAt: "not-a-date" })).toThrow(/createdAt/i);
    expect(() => parseAssetInterchangeManifest(null)).toThrow(/object/i);
    expect(() => parseAssetInterchangeManifest("manifest")).toThrow(/object/i);
  });
});

describe("dependent files (handoff §6 file integrity: dependent texture/material files with hashes)", () => {
  it("accepts an optional top-level dependencies array of integrity records", () => {
    const manifest = parseAssetInterchangeManifest({
      ...validExportedManifest,
      dependencies: [
        { path: "staging/mesh.mtl", mediaType: "text/plain", byteLength: 512, sha256: sha("f") },
        { path: "staging/textures/base.png", mediaType: "image/png", byteLength: 768, sha256: sha("7") },
      ],
    });
    expect(manifest.dependencies).toHaveLength(2);
    expect(manifest.dependencies?.[0].path).toBe("staging/mesh.mtl");
    expect(manifest.dependencies?.[1].mediaType).toBe("image/png");
  });

  it("keeps dependencies optional — a manifest without them still parses (additive field)", () => {
    const manifest = parseAssetInterchangeManifest(validExportedManifest);
    expect(manifest.dependencies).toBeUndefined();
  });

  it("validates every dependent file exactly like the artifact (hash format, path safety, byteLength)", () => {
    expect(() =>
      parseAssetInterchangeManifest({
        ...validExportedManifest,
        dependencies: [{ path: "staging/mesh.mtl", mediaType: "text/plain", byteLength: 512, sha256: "nothex" }],
      }),
    ).toThrow(/sha256/i);
    expect(() =>
      parseAssetInterchangeManifest({
        ...validExportedManifest,
        dependencies: [{ path: "../escape.mtl", mediaType: "text/plain", byteLength: 512, sha256: sha("f") }],
      }),
    ).toThrow(/path/i);
    expect(() =>
      parseAssetInterchangeManifest({
        ...validExportedManifest,
        dependencies: [{ path: "staging/mesh.mtl", mediaType: "text/plain", byteLength: 0, sha256: sha("f") }],
      }),
    ).toThrow(/byteLength/i);
    expect(() => parseAssetInterchangeManifest({ ...validExportedManifest, dependencies: "mesh.mtl" })).toThrow(
      /dependencies/i,
    );
  });
});

describe("asset status transitions (single-step forward; failed/cancelled terminal)", () => {
  it("allows exactly one forward step along the chain", () => {
    expect(canTransitionAssetStatus("exported", "export-validated")).toBe(true);
    expect(canTransitionAssetStatus("export-validated", "import-pending")).toBe(true);
    expect(canTransitionAssetStatus("import-pending", "imported")).toBe(true);
    expect(canTransitionAssetStatus("imported", "import-validated")).toBe(true);
    expect(canTransitionAssetStatus("import-validated", "built")).toBe(true);
    expect(canTransitionAssetStatus("built", "runtime-verified")).toBe(true);
  });

  it("rejects skips, backwards moves and self-transitions (validation steps cannot be bypassed)", () => {
    expect(canTransitionAssetStatus("exported", "import-pending")).toBe(false);
    expect(canTransitionAssetStatus("exported", "imported")).toBe(false);
    expect(canTransitionAssetStatus("imported", "built")).toBe(false);
    expect(canTransitionAssetStatus("built", "import-validated")).toBe(false);
    expect(canTransitionAssetStatus("exported", "exported")).toBe(false);
    expect(canTransitionAssetStatus("runtime-verified", "runtime-verified")).toBe(false);
  });

  it("allows any non-terminal status to fail or cancel, and nothing to leave a terminal status", () => {
    for (const status of ASSET_STATUS_CHAIN) {
      expect(canTransitionAssetStatus(status, "failed")).toBe(true);
      expect(canTransitionAssetStatus(status, "cancelled")).toBe(true);
    }
    expect(isTerminalAssetStatus("failed")).toBe(true);
    expect(isTerminalAssetStatus("cancelled")).toBe(true);
    expect(isTerminalAssetStatus("exported")).toBe(false);
    expect(canTransitionAssetStatus("failed", "exported")).toBe(false);
    expect(canTransitionAssetStatus("cancelled", "exported")).toBe(false);
    expect(canTransitionAssetStatus("failed", "runtime-verified")).toBe(false);
  });
});

describe("artifact integrity comparison (pipeline-side verification helper)", () => {
  it("matches only when byteLength and sha256 both agree", () => {
    const declared = { path: "staging/mesh.fbx", mediaType: "application/octet-stream", byteLength: 2048, sha256: sha("b") };
    expect(matchesIntegrity(declared, { byteLength: 2048, sha256: sha("b") })).toBe(true);
    expect(matchesIntegrity(declared, { byteLength: 2047, sha256: sha("b") })).toBe(false);
    expect(matchesIntegrity(declared, { byteLength: 2048, sha256: sha("a") })).toBe(false);
  });
});
