/**
 * M3.4 — the pipeline-side export-manifest builder (`gamos/asset-interchange@1`).
 * Written FIRST (strict TDD RED). The builder is the pure facility that turns a
 * real engine export record (the additive blender/asset.export result fields)
 * into a validated `status: "exported"` interchange manifest — handoff §6/§7:
 * the pipeline must "generate and validate the cross-engine asset manifest"
 * from the applied export settings, source provenance and dependent files.
 *
 * Fail-closed requirements pinned here:
 * - the source asset sha256 is REQUIRED (tight provenance — our producers
 *   always compute it; the wire contract keeps it optional);
 * - only the reviewed real exporter formats are accepted (fbx/glb/gltf/obj);
 * - dependent files land in the manifest `dependencies` (all of them) and the
 *   image/* subset additionally in `interchange.textures`;
 * - the built manifest is validated through parseAssetInterchangeManifest —
 *   unsafe paths, malformed hashes and unknown fields fail closed;
 * - serialization is canonical and key-order independent.
 */

import { describe, expect, it } from "vitest";
import {
  buildExportedManifest,
  type ExportedManifestBuildInput,
} from "../src/domain/asset-interchange-build.js";
import {
  parseAssetInterchangeManifest,
  serializeAssetInterchangeManifest,
  hashAssetInterchangeManifest,
  matchesIntegrity,
} from "../src/domain/asset-interchange.js";

const sha = (c: string) => c.repeat(64);

const validBuildInput: ExportedManifestBuildInput = {
  manifestId: "asset-mesh-002",
  source: {
    engine: "blender",
    engineVersion: "4.1.1",
    projectIdentity: "blender-project",
    assetPath: "blender-project/scenes/main.blend",
    assetSha256: sha("a"),
    operationPlanId: "plan-002",
    exporter: { capabilityId: "blender/asset.export", capabilityVersion: "1.0.0" },
  },
  interchange: {
    format: "fbx",
    handedness: "right",
    upAxis: "y",
    forwardAxis: "-z",
    units: "meter",
    scaleFactor: 2,
    appliedTransforms: "blender z-up to y-up axis conversion; global scale 2.0 applied",
    materials: { referenced: ["Material"], embedded: true },
  },
  artifact: {
    path: "staging/mesh.fbx",
    mediaType: "application/octet-stream",
    byteLength: 2048,
    sha256: sha("b"),
  },
  dependentFiles: [
    { path: "staging/mesh.mtl", mediaType: "text/plain", byteLength: 512, sha256: sha("f") },
    { path: "staging/textures/base.png", mediaType: "image/png", byteLength: 768, sha256: sha("7") },
  ],
  createdAt: "2026-11-08T05:00:00Z",
};

describe("exported-manifest builder (pipeline-side M3.4 facility, fail closed)", () => {
  it("builds a valid `exported` manifest that round-trips through the contract parser", () => {
    const manifest = buildExportedManifest(validBuildInput);
    expect(manifest.status).toBe("exported");
    expect(manifest.schema).toBe("gamos/asset-interchange@1");
    expect(manifest.manifestId).toBe("asset-mesh-002");
    const reparsed = parseAssetInterchangeManifest(JSON.parse(JSON.stringify(manifest)));
    expect(reparsed.source.engineVersion).toBe("4.1.1");
    expect(reparsed.interchange.format).toBe("fbx");
    expect(reparsed.interchange.scaleFactor).toBe(2);
    expect(reparsed.artifact.path).toBe("staging/mesh.fbx");
  });

  it("places every dependent file in dependencies and the image/* subset in interchange.textures", () => {
    const manifest = buildExportedManifest(validBuildInput);
    expect(manifest.dependencies?.map((d) => d.path)).toEqual(["staging/mesh.mtl", "staging/textures/base.png"]);
    expect(manifest.interchange.textures?.map((t) => t.path)).toEqual(["staging/textures/base.png"]);
    const noDeps = buildExportedManifest({ ...validBuildInput, dependentFiles: undefined });
    expect(noDeps.dependencies).toBeUndefined();
    expect(noDeps.interchange.textures).toBeUndefined();
  });

  it("requires the source asset sha256 (tight provenance — the wire contract keeps it optional)", () => {
    const { assetSha256: _omit, ...withoutSha } = validBuildInput.source;
    expect(() =>
      buildExportedManifest({ ...validBuildInput, source: withoutSha }),
    ).toThrow(/assetSha256/i);
  });

  it("rejects formats outside the reviewed real-exporter set", () => {
    expect(() =>
      buildExportedManifest({
        ...validBuildInput,
        interchange: { ...validBuildInput.interchange, format: "3ds" as never },
      }),
    ).toThrow(/format/i);
  });

  it("fails closed on unsafe dependent paths, malformed hashes and bad manifest ids (contract-enforced)", () => {
    expect(() =>
      buildExportedManifest({
        ...validBuildInput,
        dependentFiles: [{ path: "../escape.mtl", mediaType: "text/plain", byteLength: 1, sha256: sha("f") }],
      }),
    ).toThrow(/path/i);
    expect(() =>
      buildExportedManifest({
        ...validBuildInput,
        artifact: { ...validBuildInput.artifact, sha256: "zz" },
      }),
    ).toThrow(/sha256/i);
    expect(() => buildExportedManifest({ ...validBuildInput, manifestId: "Bad ID" })).toThrow(/manifestId/i);
  });

  it("serializes canonically with a stable, key-order-independent hash", () => {
    const manifest = buildExportedManifest(validBuildInput);
    const hash = hashAssetInterchangeManifest(manifest);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const reordered = buildExportedManifest({
      ...validBuildInput,
      source: { ...validBuildInput.source, exporter: { ...validBuildInput.source.exporter } },
      interchange: { ...validBuildInput.interchange, materials: { ...validBuildInput.interchange.materials } },
    });
    expect(hashAssetInterchangeManifest(reordered)).toBe(hash);
    expect(serializeAssetInterchangeManifest(reordered)).toBe(serializeAssetInterchangeManifest(manifest));
  });

  it("keeps the artifact record directly comparable through matchesIntegrity", () => {
    const manifest = buildExportedManifest(validBuildInput);
    expect(matchesIntegrity(manifest.artifact, { byteLength: 2048, sha256: sha("b") })).toBe(true);
    expect(matchesIntegrity(manifest.artifact, { byteLength: 2048, sha256: sha("a") })).toBe(false);
  });
});
