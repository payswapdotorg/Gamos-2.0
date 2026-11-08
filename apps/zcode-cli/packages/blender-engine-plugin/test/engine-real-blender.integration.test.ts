import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { discoverBlender } from "../src/discovery.js";
import {
  assetExport,
  bootstrapEmptyScene,
  runBlenderHeadless,
  sceneInspect,
  sceneModify,
  sceneRender,
} from "../src/engine.js";
import { resolveBridgeRoot } from "../src/typed-ops.js";
import {
  buildExportedManifest,
  type ExportedManifestBuildInput,
} from "../../../../../packages/gamos-domain/src/domain/asset-interchange-build.js";
import {
  hashAssetInterchangeManifest,
  matchesIntegrity,
} from "../../../../../packages/gamos-domain/src/domain/asset-interchange.js";

// Real-engine gate: these tests only mean anything against an actual Blender.
// Fixture executables are NOT acceptable here — a miss must be an honest skip.
const discovery = discoverBlender();
const exe = discovery.executable;
const realBlenderFound = discovery.status === "available" && typeof exe === "string" && exe.length > 0;

if (!realBlenderFound) {
  console.log(
    `SKIP: real Blender unavailable — integration gate NOT passing (status=${discovery.status}, reason=${discovery.reason ?? "none"})`,
  );
} else {
  console.log(`[gamos-evidence] real Blender executable: ${exe}`);
  console.log(`[gamos-evidence] raw version: ${discovery.rawVersion}`);
}

function sha256Of(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

describe.skipIf(!realBlenderFound)("blender-engine plugin real-Blender integration", () => {
  let workspace = "";
  let blendFile = "";

  beforeAll(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), "gamos-blender-ws-"));
    blendFile = path.join(workspace, "scene.blend");
    const boot = await bootstrapEmptyScene(exe as string, blendFile, { timeoutMs: 180_000 });
    if (!boot.ok) {
      throw new Error(`bootstrap failed: ${JSON.stringify(boot)}`);
    }
    console.log(
      `[gamos-evidence] bootstrap empty scene: ${blendFile} (${boot.bytes} bytes, sha256=${boot.sha256})`,
    );
  }, 240_000);

  afterAll(async () => {
    if (workspace) {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test(
    "scene_inspect reports one empty scene from the bootstrapped blend",
    async () => {
      const outcome = await sceneInspect(exe as string, { blendFile }, workspace, { timeoutMs: 180_000 });
      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.blenderVersion).toContain("4.1");
        expect(outcome.scenes).toHaveLength(1);
        expect(outcome.scenes[0]?.objects ?? []).toHaveLength(0);
        console.log(
          `[gamos-evidence] inspect: blender=${outcome.blenderVersion} scenes=[${outcome.scenes
            .map((scene) => scene.name)
            .join(", ")}]`,
        );
      }
    },
    240_000,
  );

  test(
    "scene_modify applies typed ops, saves atomically, and verifies object state by re-inspection",
    async () => {
      const outcome = await sceneModify(
        exe as string,
        {
          blendFile,
          operations: [
            {
              op: "add-primitive",
              primitive: "cube",
              name: "GamosTestCube",
              location: [1, 2, 3],
              scale: [1.5, 1.5, 1.5],
            },
            { op: "set-material-color", target: "GamosTestCube", color: [0.1, 0.2, 0.3] },
          ],
          save: true,
        },
        workspace,
        { timeoutMs: 180_000 },
      );
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.saved).toBe(true);
      expect(outcome.applied).toHaveLength(2);
      expect(outcome.sha256 ?? "").toMatch(/^[0-9a-f]{64}$/);
      expect(outcome.verification.ok).toBe(true);

      // independent engine-query verification (the contract's verification method)
      const inspect = await sceneInspect(exe as string, { blendFile }, workspace, { timeoutMs: 180_000 });
      expect(inspect.ok).toBe(true);
      if (inspect.ok) {
        const cube = inspect.scenes[0]?.objects.find((object) => object.name === "GamosTestCube");
        expect(cube).toBeDefined();
        expect(cube?.location?.[0]).toBeCloseTo(1, 6);
        expect(cube?.location?.[1]).toBeCloseTo(2, 6);
        expect(cube?.location?.[2]).toBeCloseTo(3, 6);
        expect(cube?.scale?.[0]).toBeCloseTo(1.5, 6);
        expect(cube?.scale?.[1]).toBeCloseTo(1.5, 6);
        expect(cube?.scale?.[2]).toBeCloseTo(1.5, 6);
        expect(cube?.materialColor?.[2]).toBeCloseTo(0.3, 5);
      }
      console.log(`[gamos-evidence] modify: saved blend sha256=${outcome.sha256}`);
      expect(outcome.sha256).toBe(sha256Of(blendFile));
    },
    240_000,
  );

  test(
    "scene_render produces a non-empty CYCLES PNG artifact at the requested resolution",
    async () => {
      const outputPath = path.join(workspace, "render.png");
      const outcome = await sceneRender(
        exe as string,
        { blendFile, outputPath, engine: "CYCLES", resolution: { x: 160, y: 120 } },
        workspace,
        { timeoutMs: 240_000 },
      );
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.bytes).toBeGreaterThan(0);
      expect(outcome.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(outcome.engine).toBe("CYCLES");

      const png = await readFile(outputPath);
      expect(png.length).toBeGreaterThan(0);
      expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(png.readUInt32BE(16)).toBe(160);
      expect(png.readUInt32BE(20)).toBe(120);
      expect(outcome.sha256).toBe(sha256Of(outputPath));
      console.log(
        `[gamos-evidence] render artifact ${outputPath}: ${png.length} bytes, sha256=${outcome.sha256}`,
      );
    },
    300_000,
  );

  test(
    "asset_export writes a non-empty OBJ artifact for the named selection",
    async () => {
      const outputPath = path.join(workspace, "GamosTestCube.obj");
      const outcome = await assetExport(
        exe as string,
        { blendFile, outputPath, format: "OBJ", selection: ["GamosTestCube"] },
        workspace,
        { timeoutMs: 180_000 },
      );
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.bytes).toBeGreaterThan(0);
      expect(outcome.sha256).toMatch(/^[0-9a-f]{64}$/);
      const artifact = await readFile(outputPath, "utf8");
      expect(artifact).toContain("GamosTestCube");
      console.log(`[gamos-evidence] OBJ export ${outputPath}: sha256=${outcome.sha256}`);
    },
    240_000,
  );

  test(
    "asset_export also covers GLTF (GLB) and FBX formats",
    async () => {
      for (const [format, fileName] of [
        ["GLTF", "GamosTestCube.glb"],
        ["FBX", "GamosTestCube.fbx"],
      ] as const) {
        const outputPath = path.join(workspace, fileName);
        const outcome = await assetExport(
          exe as string,
          { blendFile, outputPath, format, selection: ["GamosTestCube"] },
          workspace,
          { timeoutMs: 180_000 },
        );
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) continue;
        expect(outcome.bytes).toBeGreaterThan(0);
        expect(outcome.sha256).toMatch(/^[0-9a-f]{64}$/);
        console.log(`[gamos-evidence] ${format} export ${outputPath}: sha256=${outcome.sha256}`);
      }
    },
    240_000,
  );

  test(
    "asset_export with declared interchange settings emits the manifest ingredients and a validated cross-engine manifest (FBX)",
    async () => {
      const outputPath = path.join(workspace, "staging", "gamos-cube.fbx");
      const outcome = await assetExport(
        exe as string,
        {
          blendFile,
          outputPath,
          format: "FBX",
          selection: ["GamosTestCube"],
          interchange: { upAxis: "y", globalScale: 2 },
        },
        workspace,
        { timeoutMs: 180_000 },
      );
      if (!outcome.ok) {
        console.log(`[gamos-evidence] FBX manifest-ingredient export FAILED: ${JSON.stringify(outcome)}`);
      }
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;

      // Manifest ingredients (handoff §6 identity/provenance + applied semantics).
      expect(outcome.blenderVersion).toContain("4.1");
      expect(outcome.sourceSha256).toBe(sha256Of(blendFile));
      expect(outcome.unitScale).toBe(1);
      expect(outcome.appliedInterchange.format).toBe("fbx");
      expect(outcome.appliedInterchange.handedness).toBe("right");
      expect(outcome.appliedInterchange.upAxis).toBe("y");
      expect(outcome.appliedInterchange.forwardAxis).toBe("-z");
      expect(outcome.appliedInterchange.units).toBe("meter");
      expect(outcome.appliedInterchange.scaleFactor).toBe(2);
      expect(outcome.appliedInterchange.appliedTransforms).toContain("y-up");
      expect(outcome.appliedInterchange.materials?.embedded).toBe(true);
      expect(Array.isArray(outcome.appliedInterchange.materials?.referenced)).toBe(true);

      // The pipeline-side domain builder produces a validated manifest from the REAL record.
      const rel = (absolute: string) => path.relative(workspace, absolute).split(path.sep).join("/");
      const buildInput: ExportedManifestBuildInput = {
        manifestId: "asset-gamos-cube-fbx",
        source: {
          engine: "blender",
          engineVersion: outcome.blenderVersion,
          projectIdentity: "blender-ws",
          assetPath: rel(blendFile),
          assetSha256: outcome.sourceSha256,
          exporter: { capabilityId: "blender/asset.export", capabilityVersion: "1.0.0" },
        },
        interchange: outcome.appliedInterchange,
        artifact: {
          path: rel(outputPath),
          mediaType: "application/octet-stream",
          byteLength: outcome.bytes,
          sha256: outcome.sha256,
        },
        dependentFiles: outcome.dependentFiles?.map((file) => ({
          path: rel(file.path),
          mediaType: file.mediaType,
          byteLength: file.byteLength,
          sha256: file.sha256,
        })),
        createdAt: new Date().toISOString(),
      };
      const manifest = buildExportedManifest(buildInput);
      expect(manifest.status).toBe("exported");
      expect(manifest.source.engineVersion).toBe(outcome.blenderVersion);
      // Independent verification: the manifest artifact record matches the real file.
      expect(matchesIntegrity(manifest.artifact, { byteLength: outcome.bytes, sha256: sha256Of(outputPath) })).toBe(
        true,
      );
      const manifestHash = hashAssetInterchangeManifest(manifest);
      expect(manifestHash).toMatch(/^[0-9a-f]{64}$/);
      console.log(
        `[gamos-evidence] FBX manifest-ingredient export: blender=${outcome.blenderVersion} sourceSha256=${outcome.sourceSha256} artifact=${rel(outputPath)} sha256=${outcome.sha256} manifestHash=${manifestHash}`,
      );
    },
    240_000,
  );

  test(
    "asset_export OBJ reports the .mtl sidecar as an engine-verified dependent file",
    async () => {
      const outputPath = path.join(workspace, "staging", "gamos-cube.obj");
      const outcome = await assetExport(
        exe as string,
        {
          blendFile,
          outputPath,
          format: "OBJ",
          selection: ["GamosTestCube"],
          interchange: { upAxis: "y" },
        },
        workspace,
        { timeoutMs: 180_000 },
      );
      if (!outcome.ok) {
        console.log(`[gamos-evidence] OBJ dependent-sidecar export FAILED: ${JSON.stringify(outcome)}`);
      }
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.appliedInterchange.format).toBe("obj");
      expect(outcome.appliedInterchange.materials?.embedded).toBe(false);
      const mtl = outcome.dependentFiles?.find((file) => file.path.endsWith(".mtl"));
      expect(mtl).toBeDefined();
      if (mtl) {
        expect(mtl.mediaType).toBe("text/plain");
        expect(mtl.byteLength).toBeGreaterThan(0);
        expect(mtl.sha256).toBe(sha256Of(mtl.path));
      }
      console.log(
        `[gamos-evidence] OBJ dependent sidecar: ${mtl?.path} bytes=${mtl?.byteLength} sha256=${mtl?.sha256}`,
      );
    },
    240_000,
  );

  test(
    "asset_export GLB embeds materials (no dependent files) and records export_yup semantics",
    async () => {
      const outputPath = path.join(workspace, "staging", "gamos-cube.glb");
      const outcome = await assetExport(
        exe as string,
        {
          blendFile,
          outputPath,
          format: "GLTF",
          selection: ["GamosTestCube"],
          interchange: { upAxis: "y" },
        },
        workspace,
        { timeoutMs: 180_000 },
      );
      if (!outcome.ok) {
        console.log(`[gamos-evidence] GLB embedded-materials export FAILED: ${JSON.stringify(outcome)}`);
      }
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.appliedInterchange.format).toBe("glb");
      expect(outcome.appliedInterchange.upAxis).toBe("y");
      expect(outcome.appliedInterchange.materials?.embedded).toBe(true);
      expect(outcome.dependentFiles ?? []).toHaveLength(0);
      const glb = await readFile(outputPath);
      expect(glb.length).toBeGreaterThan(0);
      expect(glb.subarray(0, 4).toString("hex")).toBe("676c5446"); // 'glTF' magic (0x67 0x6c 0x54 0x46)
      console.log(`[gamos-evidence] GLB embedded-materials export: sha256=${outcome.sha256}`);
    },
    240_000,
  );

  test(
    "runBlenderHeadless with a tiny timeout kills the process tree and reports a structured timeout",
    async () => {
      const neverPng = path.join(workspace, "never.png");
      const configPath = path.join(workspace, "timeout-config.json");
      const reportPath = path.join(workspace, "timeout-report.json");
      await writeFile(configPath, JSON.stringify({ outputPath: neverPng, engine: "CYCLES" }));
      const run = await runBlenderHeadless(
        exe as string,
        ["-b", blendFile, "--python", path.join(resolveBridgeRoot(), "set_render.py"), "--", configPath, reportPath],
        { timeoutMs: 300 },
      );
      expect(run.timedOut).toBe(true);
      expect(run.killed).toBe(true);
      expect(run.exitStatus === 0).toBe(false);

      const outcome = await sceneRender(
        exe as string,
        { blendFile, outputPath: path.join(workspace, "never2.png"), engine: "CYCLES" },
        workspace,
        { timeoutMs: 250 },
      );
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe("timeout");
      }
      expect(existsSync(neverPng)).toBe(false);
    },
    240_000,
  );
});
