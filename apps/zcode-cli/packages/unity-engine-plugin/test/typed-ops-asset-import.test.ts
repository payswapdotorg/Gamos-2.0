/**
 * M3.1 target leg — the typed surface of `unity/asset.import` (typed-ops).
 * Written FIRST (strict TDD RED): the input schema, the additively-grown
 * bridge plan and the execute-method mapping do not exist yet.
 *
 * Pins the reviewed asset-import convention:
 * - the input is {projectRoot, artifactPath, targetAssetPath?,
 *   expectedIntegrity?, placeInScene?}: artifactPath must point at a .fbx or
 *   .glb interchange artifact (the export legs' output); targetAssetPath is a
 *   relative "Assets/…" path without ".." whose extension MATCHES the
 *   artifact's (default "Assets/Gamos/gamos-asset<ext>" is derived at the
 *   engine layer);
 * - expectedIntegrity {byteLength positive int, sha256 64 lowercase hex} is
 *   the AUTHORITATIVE cross-engine manifest record — malformed records are
 *   rejected at the typed boundary, never silently ignored;
 * - placeInScene.scenePath is a relative "Assets/…" scene path without ".."
 *   (default: the frozen DEFAULT_SCENE_PATH);
 * - BRIDGE_FILES grows ADDITIVELY to the three reviewed templates and
 *   UNITY_EXECUTE_METHODS maps asset.import → Gamos.AssetImport.ImportAsset
 *   (the pre-existing mappings untouched).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  AssetImportInput,
  BRIDGE_FILES,
  DEFAULT_SCENE_PATH,
  UNITY_EXECUTE_METHODS,
  resolveBridgeRoot,
} from "../src/typed-ops.js";

/** The committed cross-engine fixture: a real Blender 4.1.1 FBX export. */
const FBX_FIXTURE_SHA256 = "ce346618c7df43efc2496ed4c5cd2f0f35c5e2be2f7a40ec34e8a9b51fe3d78d";

describe("asset import input schema (M3.1 target leg)", () => {
  test("accepts the minimal input, an explicit targetAssetPath, expectedIntegrity and placeInScene", () => {
    expect(
      AssetImportInput.safeParse({ projectRoot: "/ws/unity-project", artifactPath: "/ws/out/gamos-cube.fbx" })
        .success,
    ).toBe(true);
    expect(
      AssetImportInput.safeParse({
        projectRoot: "/ws/unity-project",
        artifactPath: "/ws/out/gamos-cube.fbx",
        targetAssetPath: "Assets/Gamos/gamos-cube.fbx",
      }).success,
    ).toBe(true);
    expect(
      AssetImportInput.safeParse({
        projectRoot: "/ws/unity-project",
        artifactPath: "/ws/out/gamos-cube.glb",
        targetAssetPath: "Assets/Gamos/nested/dir/gamos-cube.glb",
        expectedIntegrity: { byteLength: 15228, sha256: FBX_FIXTURE_SHA256 },
        placeInScene: { scenePath: "Assets/Scenes/Main.unity" },
      }).success,
    ).toBe(true);
    expect(
      AssetImportInput.safeParse({
        projectRoot: "/ws/unity-project",
        artifactPath: "/ws/out/gamos-cube.fbx",
        placeInScene: {},
      }).success,
    ).toBe(true);
    // unknown keys are stripped (a caller cannot smuggle extra surface in)
    const smuggled = AssetImportInput.safeParse({
      projectRoot: "/ws/unity-project",
      artifactPath: "/ws/out/gamos-cube.fbx",
      script: "arbitrary-csharp",
    });
    expect(smuggled.success).toBe(true);
    if (smuggled.success) {
      expect((smuggled.data as Record<string, unknown>).script).toBeUndefined();
    }
  });

  test("requires projectRoot and artifactPath", () => {
    expect(AssetImportInput.safeParse({}).success).toBe(false);
    expect(AssetImportInput.safeParse({ projectRoot: "/ws/unity-project" }).success).toBe(false);
    expect(AssetImportInput.safeParse({ artifactPath: "/ws/out/gamos-cube.fbx" }).success).toBe(false);
    expect(
      AssetImportInput.safeParse({ projectRoot: "", artifactPath: "/ws/out/gamos-cube.fbx" }).success,
    ).toBe(false);
    expect(AssetImportInput.safeParse({ projectRoot: "/ws/unity-project", artifactPath: "" }).success).toBe(false);
  });

  test("rejects artifacts outside the FBX/GLB interchange contract", () => {
    for (const badArtifact of [
      "/ws/out/gamos-cube.obj",
      "/ws/out/gamos-cube.FBX", // case-sensitive: uppercase extensions are not the contract
      "/ws/out/gamos-cube.GLB",
      "/ws/out/gamos-cube",
      "/ws/out/gamos-cube.fbx.bak",
    ]) {
      expect(
        AssetImportInput.safeParse({ projectRoot: "/ws/unity-project", artifactPath: badArtifact }).success,
        `artifactPath ${badArtifact} must be rejected`,
      ).toBe(false);
    }
  });

  test("rejects unsafe targetAssetPath values (absolute, traversal, non-Assets prefix)", () => {
    for (const badTarget of [
      "/etc/passwd",
      "../outside.fbx",
      "Assets/../outside.fbx",
      "Public/Gamos/gamos-cube.fbx",
      "Assets\\..\\evil.fbx",
      "Assets",
      "",
    ]) {
      expect(
        AssetImportInput.safeParse({
          projectRoot: "/ws/unity-project",
          artifactPath: "/ws/out/gamos-cube.fbx",
          targetAssetPath: badTarget,
        }).success,
        `targetAssetPath "${badTarget}" must be rejected`,
      ).toBe(false);
    }
    // a bare "Assets" directory name is not an asset path, but a real one is fine
    expect(
      AssetImportInput.safeParse({
        projectRoot: "/ws/unity-project",
        artifactPath: "/ws/out/gamos-cube.fbx",
        targetAssetPath: "Assets/gamos-cube.fbx",
      }).success,
    ).toBe(true);
  });

  test("rejects a targetAssetPath whose extension does not match the artifact's", () => {
    expect(
      AssetImportInput.safeParse({
        projectRoot: "/ws/unity-project",
        artifactPath: "/ws/out/gamos-cube.fbx",
        targetAssetPath: "Assets/Gamos/gamos-cube.glb",
      }).success,
    ).toBe(false);
    expect(
      AssetImportInput.safeParse({
        projectRoot: "/ws/unity-project",
        artifactPath: "/ws/out/gamos-cube.glb",
        targetAssetPath: "Assets/Gamos/gamos-cube.fbx",
      }).success,
    ).toBe(false);
    expect(
      AssetImportInput.safeParse({
        projectRoot: "/ws/unity-project",
        artifactPath: "/ws/out/gamos-cube.fbx",
        targetAssetPath: "Assets/Gamos/gamos-cube",
      }).success,
    ).toBe(false);
    expect(
      AssetImportInput.safeParse({
        projectRoot: "/ws/unity-project",
        artifactPath: "/ws/out/gamos-cube.fbx",
        targetAssetPath: "Assets/Gamos/gamos-cube.fbx",
      }).success,
    ).toBe(true);
  });

  test("rejects malformed expectedIntegrity records at the typed boundary", () => {
    const base = { projectRoot: "/ws/unity-project", artifactPath: "/ws/out/gamos-cube.fbx" };
    for (const badIntegrity of [
      { byteLength: 0, sha256: FBX_FIXTURE_SHA256 },
      { byteLength: -15228, sha256: FBX_FIXTURE_SHA256 },
      { byteLength: 15228.5, sha256: FBX_FIXTURE_SHA256 },
      { byteLength: "15228", sha256: FBX_FIXTURE_SHA256 },
      { byteLength: 15228, sha256: FBX_FIXTURE_SHA256.toUpperCase() },
      { byteLength: 15228, sha256: FBX_FIXTURE_SHA256.slice(0, 63) },
      { byteLength: 15228 },
      { sha256: FBX_FIXTURE_SHA256 },
      "not-an-object",
      ["array"],
    ]) {
      expect(
        AssetImportInput.safeParse({ ...base, expectedIntegrity: badIntegrity }).success,
        `expectedIntegrity ${JSON.stringify(badIntegrity)} must be rejected`,
      ).toBe(false);
    }
    expect(AssetImportInput.safeParse({ ...base, expectedIntegrity: { byteLength: 15228, sha256: FBX_FIXTURE_SHA256 } }).success).toBe(true);
  });

  test("rejects an unsafe placeInScene.scenePath and a non-object placeInScene", () => {
    for (const badScene of ["/etc/passwd", "../evil.unity", "Assets/../outside.unity", "Scenes/Main.unity", ""]) {
      expect(
        AssetImportInput.safeParse({
          projectRoot: "/ws/unity-project",
          artifactPath: "/ws/out/gamos-cube.fbx",
          placeInScene: { scenePath: badScene },
        }).success,
        `placeInScene.scenePath "${badScene}" must be rejected`,
      ).toBe(false);
    }
    expect(
      AssetImportInput.safeParse({
        projectRoot: "/ws/unity-project",
        artifactPath: "/ws/out/gamos-cube.fbx",
        placeInScene: true,
      }).success,
    ).toBe(false);
    expect(
      AssetImportInput.safeParse({
        projectRoot: "/ws/unity-project",
        artifactPath: "/ws/out/gamos-cube.fbx",
        placeInScene: { scenePath: "Assets/Scenes/Main.unity" },
      }).success,
    ).toBe(true);
    // the documented default remains the frozen Gamos scene path
    expect(DEFAULT_SCENE_PATH).toBe("Assets/Scenes/GamosScene.unity");
  });
});

describe("asset import bridge plan (additive growth of the frozen plan)", () => {
  test("BRIDGE_FILES grew additively: the three reviewed templates", () => {
    expect([...BRIDGE_FILES].sort()).toEqual(["GamosAssetImport.cs", "GamosBuild.cs", "GamosMarker.cs"]);
  });

  test("UNITY_EXECUTE_METHODS maps asset.import to the reviewed entry point, pre-existing mappings untouched", () => {
    expect(UNITY_EXECUTE_METHODS["asset.import"]).toBe("Gamos.AssetImport.ImportAsset");
    expect(UNITY_EXECUTE_METHODS["scene.add-cube"]).toBe("Gamos.Marker.AddCube");
    expect(UNITY_EXECUTE_METHODS["scene.set-active-build-target"]).toBe("Gamos.Build.SetActiveBuildTarget");
    expect(UNITY_EXECUTE_METHODS["project.build"]).toBe("Gamos.Build.BuildStandalone");
  });

  test("the committed bridge directory contains the GamosAssetImport.cs template", () => {
    const root = resolveBridgeRoot();
    const source = readFileSync(path.join(root, "GamosAssetImport.cs"), "utf8");
    // fixed committed template: substantial, reviewed source — never generated
    expect(source.length).toBeGreaterThan(500);
    expect(source).toContain("namespace Gamos");
  });
});
