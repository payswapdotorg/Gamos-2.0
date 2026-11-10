/**
 * M4 WP-3 — the target-side Blender→Godot hop builder
 * (`gamos/asset-interchange@1`). Written FIRST (strict TDD RED). The builder
 * advances a REAL `exported` manifest (from `asset-interchange-build.ts`) to
 * `runtime-verified` through every forward status, using only real
 * engine-side records. Delivery plan §3 order 3: readiness §4.1's
 * verification column is the contract.
 *
 * Fail-closed requirements pinned here:
 * - the hop starts from a manifest that parses AND is exactly
 *   `status: "exported"` with `source.engine: "blender"` (THE reviewed hop;
 *   no silent engine substitution, no mid-chain starts);
 * - the importer/builder/runner capability ids are exactly the reviewed
 *   `godot/asset.import` / `godot/project.build` / `godot/project.run`;
 * - `ingestedSourceSha256` and `importedSha256` MUST equal the manifest
 *   artifact sha — the cross-engine integrity link + the reviewed importer's
 *   byte-copy discipline;
 * - the run verdict is exit 0 AND zero crash lines (both directions fail);
 * - every stage re-parses and every transition is exactly one legal forward
 *   step; the final manifest is `runtime-verified` with `validation:
 *   "passed"` and non-empty engine-read-back evidence.
 */

import { describe, expect, it } from "vitest";
import {
  buildBlenderToGodotHop,
  HOP_BUILDER_CAPABILITY_ID,
  HOP_IMPORTER_CAPABILITY_ID,
  HOP_RUNNER_CAPABILITY_ID,
  type BlenderToGodotHopInput,
} from "../src/domain/asset-interchange-hop.js";
import { buildExportedManifest } from "../src/domain/asset-interchange-build.js";
import {
  canTransitionAssetStatus,
  hashAssetInterchangeManifest,
  parseAssetInterchangeManifest,
} from "../src/domain/asset-interchange.js";

const sha = (c: string) => c.repeat(64);

const exportedManifest = () =>
  buildExportedManifest({
    manifestId: "asset-hop-cube",
    source: {
      engine: "blender",
      engineVersion: "4.1.1",
      projectIdentity: "blender-hop",
      assetPath: "blender-hop/scene.blend",
      assetSha256: sha("a"),
      exporter: { capabilityId: "blender/asset.export", capabilityVersion: "1.0.0" },
    },
    interchange: {
      format: "glb",
      handedness: "right",
      upAxis: "y",
      forwardAxis: "-z",
      units: "meter",
      appliedTransforms: "blender z-up to y-up axis conversion",
      materials: { referenced: ["Material"], embedded: true },
    },
    artifact: {
      path: "staging/hop-cube.glb",
      mediaType: "model/gltf-binary",
      byteLength: 2048,
      sha256: sha("b"),
    },
    createdAt: "2026-11-10T05:00:00Z",
  });

const validHopInput = (): BlenderToGodotHopInput => ({
  manifest: exportedManifest(),
  target: { engineVersion: "4.2.2.stable.official.15073afe3", projectIdentity: "proj" },
  importer: { capabilityId: HOP_IMPORTER_CAPABILITY_ID, capabilityVersion: "1.0.0" },
  import: {
    ingestedSourceSha256: sha("b"),
    importedPath: "proj/assets/hop-cube.glb",
    importedSha256: sha("b"),
    // Durable evidence paths only: the .import metadata + the staged asset.
    // Godot's .godot/imported cache dir is NOT manifest-canonicalizable
    // (dotfile segments fail the shared claim-path grammar) — the probe
    // verdict over those artifacts stays the capability's own verification.
    evidence: ["proj/assets/hop-cube.glb.import", "proj/assets/hop-cube.glb"],
  },
  build: {
    buildArtifact: {
      path: "builds/hop-cube.x86_64",
      mediaType: "application/octet-stream",
      byteLength: 30_000_000,
      sha256: sha("c"),
    },
    builder: { capabilityId: HOP_BUILDER_CAPABILITY_ID, capabilityVersion: "1.0.0" },
  },
  run: { runner: { capabilityId: HOP_RUNNER_CAPABILITY_ID, capabilityVersion: "1.0.0" }, exitCode: 0, crashLines: 0 },
});

describe("Blender→Godot hop builder (target-side M4 WP-3 facility, fail closed)", () => {
  it("advances the real exported manifest through every forward stage to runtime-verified", () => {
    const hop = buildBlenderToGodotHop(validHopInput());
    expect(hop.stages.map((stage) => stage.status)).toEqual([
      "export-validated",
      "import-pending",
      "imported",
      "import-validated",
      "built",
      "runtime-verified",
    ]);
    expect(hop.final.status).toBe("runtime-verified");
    expect(hop.final).toBe(hop.stages[hop.stages.length - 1]);
  });

  it("the final target record carries every real leg record and validation passed", () => {
    const hop = buildBlenderToGodotHop(validHopInput());
    const target = hop.final.target;
    expect(target).toBeDefined();
    if (target === undefined) return;
    expect(target.engine).toBe("godot");
    expect(target.engineVersion).toBe("4.2.2.stable.official.15073afe3");
    expect(target.projectIdentity).toBe("proj");
    expect(target.importer).toEqual({ capabilityId: "godot/asset.import", capabilityVersion: "1.0.0" });
    expect(target.importedPath).toBe("proj/assets/hop-cube.glb");
    expect(target.importedSha256).toBe(sha("b"));
    expect(target.validation).toBe("passed");
    expect(target.buildArtifact).toMatchObject({ path: "builds/hop-cube.x86_64", sha256: sha("c") });
    expect(target.evidence).toContain("proj/assets/hop-cube.glb.import");
  });

  it("every stage re-parses through the contract parser and each transition is one legal forward step", () => {
    const hop = buildBlenderToGodotHop(validHopInput());
    const chain = [exportedManifest(), ...hop.stages];
    for (const stage of chain) {
      expect(() => parseAssetInterchangeManifest(JSON.parse(JSON.stringify(stage)))).not.toThrow();
    }
    for (let i = 0; i + 1 < chain.length; i += 1) {
      expect(canTransitionAssetStatus(chain[i]!.status, chain[i + 1]!.status)).toBe(true);
    }
  });

  it("the source, interchange and artifact legs stay unchanged across the hop; the hash is deterministic", () => {
    const source = exportedManifest();
    const hop = buildBlenderToGodotHop(validHopInput());
    for (const stage of hop.stages) {
      expect(stage.source).toEqual(source.source);
      expect(stage.interchange).toEqual(source.interchange);
      expect(stage.artifact).toEqual(source.artifact);
      expect(stage.manifestId).toBe(source.manifestId);
      expect(stage.createdAt).toBe(source.createdAt);
    }
    const again = buildBlenderToGodotHop(validHopInput());
    expect(hashAssetInterchangeManifest(again.final)).toBe(hashAssetInterchangeManifest(hop.final));
    expect(hashAssetInterchangeManifest(hop.final)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("fails closed on a non-object input", () => {
    expect(() => buildBlenderToGodotHop(null)).toThrow(/GAMOS\/ASSET-INTERCHANGE-HOP: input/);
    expect(() => buildBlenderToGodotHop("hop")).toThrow(/GAMOS\/ASSET-INTERCHANGE-HOP: input/);
  });

  it("fails closed when the manifest does not parse (the contract parser's error surfaces)", () => {
    const input = validHopInput();
    expect(() => buildBlenderToGodotHop({ ...input, manifest: { nonsense: true } })).toThrow(
      /GAMOS\/ASSET-INTERCHANGE: /,
    );
  });

  it("fails closed when the manifest is not exactly status exported (no mid-chain starts)", () => {
    const input = validHopInput();
    // A VALIDLY-parsing mid-chain manifest (status imported with its target
    // record) — the failure must come from the hop's own start rule, not the
    // parser's status coupling.
    const midChain = exportedManifest();
    (midChain as { status: string }).status = "imported";
    (midChain as { target?: unknown }).target = {
      engine: "godot",
      engineVersion: "4.2.2.stable.official.15073afe3",
      projectIdentity: "proj",
      importer: { capabilityId: "godot/asset.import", capabilityVersion: "1.0.0" },
      importedPath: "proj/assets/hop-cube.glb",
      importedSha256: sha("b"),
    };
    expect(() => parseAssetInterchangeManifest(JSON.parse(JSON.stringify(midChain)))).not.toThrow();
    expect(() => buildBlenderToGodotHop({ ...input, manifest: midChain })).toThrow(
      /GAMOS\/ASSET-INTERCHANGE-HOP: manifest\.status/,
    );
  });

  it("fails closed when the source engine is not blender (no silent engine substitution)", () => {
    const input = validHopInput();
    const babylon = buildExportedManifest({
      manifestId: "asset-hop-cube",
      source: {
        engine: "babylon",
        engineVersion: "8.0.0",
        projectIdentity: "blender-hop",
        assetPath: "blender-hop/scene.glb",
        assetSha256: sha("a"),
        exporter: { capabilityId: "babylon/asset.export", capabilityVersion: "1.0.0" },
      },
      interchange: {
        format: "glb",
        handedness: "right",
        upAxis: "y",
        units: "meter",
        materials: { referenced: [], embedded: true },
      },
      artifact: { path: "staging/hop-cube.glb", mediaType: "model/gltf-binary", byteLength: 2048, sha256: sha("b") },
      createdAt: "2026-11-10T05:00:00Z",
    });
    expect(() => buildBlenderToGodotHop({ ...input, manifest: babylon })).toThrow(
      /GAMOS\/ASSET-INTERCHANGE-HOP: manifest\.source\.engine/,
    );
  });

  it("fails closed when the ingested source sha breaks the cross-engine integrity link", () => {
    const input = validHopInput();
    expect(() =>
      buildBlenderToGodotHop({ ...input, import: { ...input.import, ingestedSourceSha256: sha("x") } }),
    ).toThrow(/GAMOS\/ASSET-INTERCHANGE-HOP: import\.ingestedSourceSha256/);
  });

  it("fails closed when the imported sha breaks the reviewed importer's byte-copy discipline", () => {
    const input = validHopInput();
    expect(() =>
      buildBlenderToGodotHop({ ...input, import: { ...input.import, importedSha256: sha("y") } }),
    ).toThrow(/GAMOS\/ASSET-INTERCHANGE-HOP: import\.importedSha256/);
  });

  it("fails closed on unreviewed importer / builder / runner capability ids", () => {
    const input = validHopInput();
    expect(() =>
      buildBlenderToGodotHop({ ...input, importer: { capabilityId: "godot/scene.modify", capabilityVersion: "1.0.0" } }),
    ).toThrow(/GAMOS\/ASSET-INTERCHANGE-HOP: importer\.capabilityId/);
    expect(() =>
      buildBlenderToGodotHop({
        ...input,
        build: { ...input.build, builder: { capabilityId: "godot/asset.import", capabilityVersion: "1.0.0" } },
      }),
    ).toThrow(/GAMOS\/ASSET-INTERCHANGE-HOP: build\.builder\.capabilityId/);
    expect(() =>
      buildBlenderToGodotHop({
        ...input,
        run: { ...input.run, runner: { capabilityId: "godot/project.build", capabilityVersion: "1.0.0" } },
      }),
    ).toThrow(/GAMOS\/ASSET-INTERCHANGE-HOP: run\.runner\.capabilityId/);
  });

  it("fails closed when the run verdict is not exit-0-AND-zero-crash-lines (both directions)", () => {
    const input = validHopInput();
    expect(() => buildBlenderToGodotHop({ ...input, run: { ...input.run, exitCode: 1 } })).toThrow(
      /GAMOS\/ASSET-INTERCHANGE-HOP: run\.exitCode/,
    );
    expect(() => buildBlenderToGodotHop({ ...input, run: { ...input.run, crashLines: 2 } })).toThrow(
      /GAMOS\/ASSET-INTERCHANGE-HOP: run\.crashLines/,
    );
  });

  it("fails closed when the engine-read-back evidence is empty (runtime-verified demands it)", () => {
    const input = validHopInput();
    expect(() => buildBlenderToGodotHop({ ...input, import: { ...input.import, evidence: [] } })).toThrow(/evidence/);
  });

  it("fails closed on unsafe imported paths (the contract parser's path safety)", () => {
    const input = validHopInput();
    expect(() =>
      buildBlenderToGodotHop({ ...input, import: { ...input.import, importedPath: "/abs/escape.glb" } }),
    ).toThrow(/importedPath/);
    expect(() =>
      buildBlenderToGodotHop({ ...input, import: { ...input.import, importedPath: "../escape.glb" } }),
    ).toThrow(/importedPath/);
  });

  it("fails closed when the exported manifest already carries a target record (the export side owns none)", () => {
    const input = validHopInput();
    const tainted = exportedManifest();
    (tainted as { target?: unknown }).target = {
      engine: "godot",
      engineVersion: "4.2.2.stable.official.15073afe3",
      projectIdentity: "proj",
      importer: { capabilityId: "godot/asset.import", capabilityVersion: "1.0.0" },
    };
    expect(() => buildBlenderToGodotHop({ ...input, manifest: tainted })).toThrow(
      /GAMOS\/ASSET-INTERCHANGE-HOP: manifest\.target/,
    );
  });

  it("fails closed on unknown or missing input fields (exact field set)", () => {
    const input = validHopInput();
    expect(() => buildBlenderToGodotHop({ ...input, extra: true })).toThrow(
      /GAMOS\/ASSET-INTERCHANGE-HOP: input.*unknown field "extra"/,
    );
    const { run: _run, ...missingRun } = input as unknown as Record<string, unknown>;
    expect(() => buildBlenderToGodotHop(missingRun)).toThrow(/GAMOS\/ASSET-INTERCHANGE-HOP: input.*missing field "run"/);
  });

  it("fails closed on a non-canonical target project identity (the import-pending stage's parser rule)", () => {
    const input = validHopInput();
    expect(() =>
      buildBlenderToGodotHop({ ...input, target: { ...input.target, projectIdentity: "/abs/proj" } }),
    ).toThrow(/manifest\.target\.projectIdentity/);
  });

  it("fails closed on a malformed importer capability version (the parser's semver rule)", () => {
    const input = validHopInput();
    expect(() =>
      buildBlenderToGodotHop({
        ...input,
        importer: { capabilityId: "godot/asset.import", capabilityVersion: "not-semver" },
      }),
    ).toThrow(/manifest\.target\.importer/);
  });

  it("fails closed on an unsafe build-artifact path (the built stage's parser rule)", () => {
    const input = validHopInput();
    expect(() =>
      buildBlenderToGodotHop({
        ...input,
        build: {
          ...input.build,
          buildArtifact: { ...input.build.buildArtifact, path: "../escape.x86_64" },
        },
      }),
    ).toThrow(/manifest\.target\.buildArtifact/);
  });

  it("fails closed on an unsafe evidence path (the import-validated stage's parser rule)", () => {
    const input = validHopInput();
    expect(() =>
      buildBlenderToGodotHop({ ...input, import: { ...input.import, evidence: ["../escape.import"] } }),
    ).toThrow(/manifest\.target\.evidence/);
  });
});
