import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, afterAll, describe, expect, test } from "vitest";
// The Blender leg of the hop drives the REAL blender-engine-plugin surface
// (the same relative-import precedent as the blender integration test's
// domain imports — test-only, no package dependency is added).
import { discoverBlender } from "../../blender-engine-plugin/src/discovery.js";
import {
  assetExport as blenderAssetExport,
  bootstrapEmptyScene,
  sceneModify as blenderSceneModify,
} from "../../blender-engine-plugin/src/engine.js";
import { discoverGodot } from "../src/discovery.js";
import { assetImport, projectBuild, projectRun, sceneModify } from "../src/engine.js";
// The hop's domain legs: the export manifest builder + the WP-3 hop builder.
import { buildExportedManifest } from "../../../../../packages/gamos-domain/src/domain/asset-interchange-build.js";
import { buildBlenderToGodotHop } from "../../../../../packages/gamos-domain/src/domain/asset-interchange-hop.js";
import {
  hashAssetInterchangeManifest,
  matchesIntegrity,
} from "../../../../../packages/gamos-domain/src/domain/asset-interchange.js";
import { ENGINE_PLUGIN_CAPABILITIES } from "../../../../../packages/gamos-domain/src/domain/engine-plugin.js";

/**
 * Real cross-engine hop gate (M4 WP-3 INTEGRATE): a REAL Blender exports an
 * asset, the REAL Godot imports it into a real project, the project is
 * modified with fresh-process read-back, headlessly built and headlessly run,
 * and the interchange manifest advances to `runtime-verified` from the REAL
 * leg records — readiness §4.1's verification column is the contract:
 * filesystem-probe import verdicts (never exit-code trust), fresh-process
 * scene read-back, artifact hashing, and the exit-0-AND-zero-crash-lines run
 * discipline.
 *
 * Both engines must be REAL (fixture executables are NOT acceptable here) —
 * a miss is an honest skip, and the skip line states the gate is NOT passing.
 */

const FIXTURE_ROOT = fileURLToPath(new URL("./fixture/project", import.meta.url));

const blenderDiscovery = discoverBlender();
const godotDiscovery = discoverGodot();
const blenderExe = blenderDiscovery.executable;
const godotExe = godotDiscovery.executable;
const realBlenderFound =
  blenderDiscovery.status === "available" && typeof blenderExe === "string" && blenderExe.length > 0;
const realGodotFound =
  godotDiscovery.status === "available" && typeof godotExe === "string" && godotExe.length > 0;
const hopAvailable = realBlenderFound && realGodotFound;

if (!hopAvailable) {
  console.log(
    `SKIP: cross-engine hop gate NOT passing (blender=${blenderDiscovery.status}${blenderDiscovery.reason ? `:${blenderDiscovery.reason}` : ""}, godot=${godotDiscovery.status}${godotDiscovery.reason ? `:${godotDiscovery.reason}` : ""})`,
  );
} else {
  console.log(`[gamos-evidence] real Blender executable: ${blenderExe}`);
  console.log(`[gamos-evidence] real Godot executable: ${godotExe}`);
}

function sha256Of(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function capabilityVersion(id: string): string {
  const record = ENGINE_PLUGIN_CAPABILITIES.find((entry) => entry.id === id);
  if (record === undefined) {
    throw new Error(`capability not registered: ${id}`);
  }
  return record.version;
}

describe.skipIf(!hopAvailable)("Blender→Godot real cross-engine hop (M4 WP-3)", () => {
  let workspace = "";
  let projectRoot = "";
  let blendFile = "";

  beforeAll(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), "gamos-hop-ws-"));
    projectRoot = path.join(workspace, "proj");
    await cp(FIXTURE_ROOT, projectRoot, { recursive: true });
    blendFile = path.join(workspace, "scene.blend");
    const boot = await bootstrapEmptyScene(blenderExe as string, blendFile, { timeoutMs: 180_000 });
    if (!boot.ok) {
      throw new Error(`blender bootstrap failed: ${JSON.stringify(boot)}`);
    }
    console.log(`[gamos-evidence] hop workspace: ${workspace}`);
  }, 240_000);

  afterAll(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  test(
    "the full hop: real Blender export → real Godot import → scene read-back → headless build → headless run → runtime-verified manifest",
    async () => {
      const rel = (absolute: string) => path.relative(workspace, absolute).split(path.sep).join("/");

      // ---- Blender leg: a real mesh in a real .blend, exported GLB with the
      // y-up interchange the Godot side expects (readiness §4.1).
      const modify = await blenderSceneModify(
        blenderExe as string,
        {
          blendFile,
          operations: [
            {
              op: "add-primitive",
              primitive: "cube",
              name: "GamosHopCube",
              location: [1, 2, 3],
              scale: [1, 1, 1],
            },
            { op: "set-material-color", target: "GamosHopCube", color: [0.2, 0.4, 0.6] },
          ],
          save: true,
        },
        workspace,
        { timeoutMs: 180_000 },
      );
      expect(modify.ok, modify.ok ? undefined : JSON.stringify(modify)).toBe(true);

      const glbPath = path.join(workspace, "staging", "hop-cube.glb");
      const exportOutcome = await blenderAssetExport(
        blenderExe as string,
        {
          blendFile,
          outputPath: glbPath,
          format: "GLTF",
          selection: ["GamosHopCube"],
          interchange: { upAxis: "y" },
        },
        workspace,
        { timeoutMs: 180_000 },
      );
      expect(exportOutcome.ok, exportOutcome.ok ? undefined : JSON.stringify(exportOutcome)).toBe(true);
      if (!exportOutcome.ok) return;
      expect(existsSync(glbPath)).toBe(true);
      expect(exportOutcome.bytes).toBeGreaterThan(0);
      console.log(
        `[gamos-evidence] blender leg: ${exportOutcome.blenderVersion} exported ${rel(glbPath)} (${exportOutcome.bytes} B, sha256=${exportOutcome.sha256})`,
      );

      // ---- Domain export manifest from the REAL export record.
      const exportedManifest = buildExportedManifest({
        manifestId: "asset-hop-cube",
        source: {
          engine: "blender",
          engineVersion: exportOutcome.blenderVersion,
          projectIdentity: rel(blendFile),
          assetPath: rel(blendFile),
          assetSha256: exportOutcome.sourceSha256,
          exporter: { capabilityId: "blender/asset.export", capabilityVersion: capabilityVersion("blender/asset.export") },
        },
        interchange: exportOutcome.appliedInterchange,
        artifact: {
          path: rel(glbPath),
          mediaType: "model/gltf-binary",
          byteLength: exportOutcome.bytes,
          sha256: exportOutcome.sha256,
        },
        dependentFiles: exportOutcome.dependentFiles?.map((file) => ({
          path: rel(file.path),
          mediaType: file.mediaType,
          byteLength: file.byteLength,
          sha256: file.sha256,
        })),
        createdAt: new Date().toISOString(),
      });
      expect(exportedManifest.status).toBe("exported");

      // ---- Godot import leg: the REAL engine pass with the filesystem-probe
      // verdict; the ingested source sha IS the manifest artifact sha (the
      // cross-engine integrity link, verified against the real bytes).
      const targetAssetPath = path.join(projectRoot, "assets", "hop-cube.glb");
      const importOutcome = await assetImport(
        godotExe as string,
        { projectRoot, sourcePath: glbPath, targetAssetPath },
        workspace,
        { timeoutMs: 300_000 },
      );
      expect(importOutcome.ok, importOutcome.ok ? undefined : JSON.stringify(importOutcome)).toBe(true);
      if (!importOutcome.ok) return;
      expect(importOutcome.importedFiles.length).toBeGreaterThanOrEqual(1);
      expect(existsSync(importOutcome.importMetadataPath)).toBe(true);
      expect(importOutcome.sourceSha256).toBe(exportOutcome.sha256);
      expect(sha256Of(targetAssetPath)).toBe(exportOutcome.sha256);
      expect(sha256Of(glbPath)).toBe(exportOutcome.sha256);
      console.log(
        `[gamos-evidence] godot import leg: ${importOutcome.importedFiles.length} imported artifacts, metadata ${rel(importOutcome.importMetadataPath)}, source sha unchanged`,
      );

      // ---- Scene modification leg in the hop project: typed ops with the
      // FRESH-process engine read-back (the §4.1 scene.modify column).
      const scenePath = path.join(projectRoot, "scene.tscn");
      const sceneBefore = sha256Of(scenePath);
      const sceneOutcome = await sceneModify(
        godotExe as string,
        {
          projectRoot,
          scenePath,
          operations: [{ nodePath: "Box", property: "position", value: [4, 5, 6] }],
        },
        workspace,
        { timeoutMs: 240_000 },
      );
      expect(sceneOutcome.ok, sceneOutcome.ok ? undefined : JSON.stringify(sceneOutcome)).toBe(true);
      if (sceneOutcome.ok) {
        expect(sceneOutcome.verification.ok).toBe(true);
        expect(sha256Of(scenePath)).not.toBe(sceneBefore);
      }

      // ---- Headless build leg: the exported binary carries the imported
      // Blender asset inside the project (artifact hashing per the column).
      const outDir = path.join(workspace, "builds");
      await mkdir(outDir, { recursive: true });
      const buildOutcome = await projectBuild(
        godotExe as string,
        { projectRoot, preset: "LinuxX11", outPath: outDir },
        workspace,
        { timeoutMs: 300_000 },
      );
      expect(buildOutcome.ok, buildOutcome.ok ? undefined : JSON.stringify(buildOutcome)).toBe(true);
      if (!buildOutcome.ok) return;
      expect(existsSync(buildOutcome.artifactPath)).toBe(true);
      expect(sha256Of(buildOutcome.artifactPath)).toBe(buildOutcome.artifactSha256);
      console.log(
        `[gamos-evidence] godot build leg: ${rel(buildOutcome.artifactPath)} (${buildOutcome.artifactBytes} B, sha256=${buildOutcome.artifactSha256})`,
      );

      // ---- Headless run leg: exit 0 AND zero crash lines (both, per the column).
      const runOutcome = await projectRun(
        godotExe as string,
        { projectRoot, quitAfterFrames: 3 },
        workspace,
        { timeoutMs: 120_000 },
      );
      expect(runOutcome.ok, runOutcome.ok ? undefined : JSON.stringify(runOutcome)).toBe(true);
      if (!runOutcome.ok) return;
      expect(runOutcome.exitCode).toBe(0);
      expect(runOutcome.crashLines).toEqual([]);
      console.log(`[gamos-evidence] godot run leg: exit 0, zero crash lines`);

      // ---- Domain hop: the manifest advances to runtime-verified from the
      // REAL leg records (the WP-3 builder under test).
      const hop = buildBlenderToGodotHop({
        manifest: exportedManifest,
        target: { engineVersion: godotDiscovery.rawVersion as string, projectIdentity: "proj" },
        importer: {
          capabilityId: "godot/asset.import",
          capabilityVersion: capabilityVersion("godot/asset.import"),
        },
        import: {
          ingestedSourceSha256: importOutcome.sourceSha256,
          importedPath: rel(targetAssetPath),
          importedSha256: sha256Of(targetAssetPath),
          // Durable evidence only: the .import metadata + the staged asset.
          // Godot's .godot/imported cache dir is not manifest-canonicalizable
          // (dotfile segments fail the shared claim-path grammar); the probe
          // verdict over those artifacts stays the capability's verification
          // (importedFiles asserted above).
          evidence: [rel(importOutcome.importMetadataPath), rel(targetAssetPath)],
        },
        build: {
          buildArtifact: {
            path: rel(buildOutcome.artifactPath),
            mediaType: "application/octet-stream",
            byteLength: buildOutcome.artifactBytes,
            sha256: buildOutcome.artifactSha256,
          },
          builder: { capabilityId: "godot/project.build", capabilityVersion: capabilityVersion("godot/project.build") },
        },
        run: {
          runner: { capabilityId: "godot/project.run", capabilityVersion: capabilityVersion("godot/project.run") },
          exitCode: runOutcome.exitCode,
          crashLines: runOutcome.crashLines.length,
        },
      });
      expect(hop.final.status).toBe("runtime-verified");
      expect(hop.stages.map((stage) => stage.status)).toEqual([
        "export-validated",
        "import-pending",
        "imported",
        "import-validated",
        "built",
        "runtime-verified",
      ]);
      expect(hop.final.target?.engine).toBe("godot");
      expect(hop.final.target?.validation).toBe("passed");
      expect(hop.final.target?.importedPath).toBe("proj/assets/hop-cube.glb");

      // ---- Independent integrity re-verification against the REAL files on
      // disk (the manifest never drifted from the bytes).
      expect(
        matchesIntegrity(hop.final.artifact, {
          byteLength: statSync(glbPath).size,
          sha256: sha256Of(glbPath),
        }),
      ).toBe(true);
      expect(
        matchesIntegrity(hop.final.target?.buildArtifact as { path: string; byteLength: number; sha256: string }, {
          byteLength: statSync(buildOutcome.artifactPath).size,
          sha256: sha256Of(buildOutcome.artifactPath),
        }),
      ).toBe(true);
      const manifestHash = hashAssetInterchangeManifest(hop.final);
      expect(manifestHash).toMatch(/^[0-9a-f]{64}$/);
      console.log(`[gamos-evidence] hop manifest runtime-verified: hash=${manifestHash}`);
      console.log(
        `[gamos-evidence] hop chain: blender ${exportOutcome.blenderVersion} → glb ${exportOutcome.sha256.slice(0, 12)}… → godot ${godotDiscovery.rawVersion} → build ${buildOutcome.artifactSha256.slice(0, 12)}…`,
      );
    },
    420_000,
  );

  test(
    "the hop fails closed when the integrity link is broken (a tampered ingest hash is refused)",
    async () => {
      // A REAL negative with REAL records: the same journey shape, but the
      // ingested sha claims a different file than the manifest describes.
      const glbSha = sha256Of(path.join(workspace, "staging", "hop-cube.glb"));
      const exportedManifest = buildExportedManifest({
        manifestId: "asset-hop-tamper",
        source: {
          engine: "blender",
          engineVersion: blenderDiscovery.rawVersion as string,
          projectIdentity: "scene.blend",
          assetPath: "scene.blend",
          assetSha256: sha256Of(path.join(workspace, "scene.blend")),
          exporter: { capabilityId: "blender/asset.export", capabilityVersion: capabilityVersion("blender/asset.export") },
        },
        interchange: {
          format: "glb",
          handedness: "right",
          upAxis: "y",
          units: "meter",
          materials: { referenced: ["Material"], embedded: true },
        },
        artifact: {
          path: "staging/hop-cube.glb",
          mediaType: "model/gltf-binary",
          byteLength: statSync(path.join(workspace, "staging", "hop-cube.glb")).size,
          sha256: glbSha,
        },
        createdAt: new Date().toISOString(),
      });
      expect(() =>
        buildBlenderToGodotHop({
          manifest: exportedManifest,
          target: { engineVersion: godotDiscovery.rawVersion as string, projectIdentity: "proj" },
          importer: {
            capabilityId: "godot/asset.import",
            capabilityVersion: capabilityVersion("godot/asset.import"),
          },
          import: {
            ingestedSourceSha256: "f".repeat(64), // NOT the manifest artifact sha
            importedPath: "proj/assets/hop-cube.glb",
            importedSha256: glbSha,
            evidence: ["proj/assets/hop-cube.glb.import"],
          },
          build: {
            buildArtifact: {
              path: "builds/hop.x86_64",
              mediaType: "application/octet-stream",
              byteLength: 1024,
              sha256: "e".repeat(64),
            },
            builder: {
              capabilityId: "godot/project.build",
              capabilityVersion: capabilityVersion("godot/project.build"),
            },
          },
          run: {
            runner: { capabilityId: "godot/project.run", capabilityVersion: capabilityVersion("godot/project.run") },
            exitCode: 0,
            crashLines: 0,
          },
        }),
      ).toThrow(/GAMOS\/ASSET-INTERCHANGE-HOP: import\.ingestedSourceSha256/);
    },
    60_000,
  );
});
