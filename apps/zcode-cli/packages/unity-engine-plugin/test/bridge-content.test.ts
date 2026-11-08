import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { BRIDGE_FILES, UNITY_EXECUTE_METHODS, resolveBridgeRoot } from "../src/typed-ops.js";

// HONEST DISCLOSURE: these are static text-shape checks of the committed C#
// bridge sources (the reviewed templates that will be copied into a real Unity
// project and invoked via -executeMethod). They are NOT engine execution
// proof: the C# is only compiled and executed inside a real Unity Editor, which
// is verified exclusively by test/engine-real-unity.integration.test.ts behind
// its honest skipIf real-editor gate.

const root = resolveBridgeRoot();
const markerSource = readFileSync(path.join(root, "GamosMarker.cs"), "utf8");
const buildSource = readFileSync(path.join(root, "GamosBuild.cs"), "utf8");
// M3.1 target leg: the asset-import bridge is a NEW committed template — read
// it defensively so its absence fails the new assertions (RED), never the
// pre-existing review of the two landed templates.
const assetImportBridgePath = path.join(root, "GamosAssetImport.cs");
const assetImportSource = existsSync(assetImportBridgePath)
  ? readFileSync(assetImportBridgePath, "utf8")
  : "";
const bridgeSources: Record<string, string> = {
  "GamosMarker.cs": markerSource,
  "GamosBuild.cs": buildSource,
  ...(assetImportSource === "" ? {} : { "GamosAssetImport.cs": assetImportSource }),
};

describe("committed C# bridge content review (text-shape checks, not engine execution)", () => {
  test("the bridge set is exactly the three reviewed templates", () => {
    expect([...BRIDGE_FILES].sort()).toEqual(["GamosAssetImport.cs", "GamosBuild.cs", "GamosMarker.cs"]);
    for (const name of BRIDGE_FILES) {
      expect(bridgeSources[name]?.length ?? 0).toBeGreaterThan(500);
    }
  });

  test("GamosMarker.cs exposes the reviewed scene.add-cube executeMethod entry point", () => {
    expect(markerSource).toContain("namespace Gamos");
    expect(markerSource).toContain("static class Marker");
    expect(markerSource).toContain("public static void AddCube()");
    // the entry point exits batch mode with an explicit status after writing its report
    expect(markerSource).toContain("EditorApplication.Exit");
  });

  test("GamosBuild.cs exposes the reviewed build and set-active-build-target entry points", () => {
    expect(buildSource).toContain("namespace Gamos");
    expect(buildSource).toContain("static class Build");
    expect(buildSource).toContain("public static void BuildStandalone()");
    expect(buildSource).toContain("public static void SetActiveBuildTarget()");
    expect(buildSource).toContain("EditorApplication.Exit");
    expect(buildSource).toContain("BuildPipeline.BuildPlayer");
  });

  test("the entry-point method names match the engine's executeMethod map exactly", () => {
    // "Gamos.Marker.AddCube" => namespace Gamos, class Marker, method AddCube
    const addCube = UNITY_EXECUTE_METHODS["scene.add-cube"]?.split(".") ?? [];
    expect(addCube).toHaveLength(3);
    expect(markerSource).toContain(`public static void ${addCube[2]}()`);
    const setTarget = UNITY_EXECUTE_METHODS["scene.set-active-build-target"]?.split(".") ?? [];
    expect(setTarget).toHaveLength(3);
    expect(buildSource).toContain(`public static void ${setTarget[2]}()`);
    const build = UNITY_EXECUTE_METHODS["project.build"]?.split(".") ?? [];
    expect(build).toHaveLength(3);
    expect(buildSource).toContain(`public static void ${build[2]}()`);
    const assetImport = UNITY_EXECUTE_METHODS["asset.import"]?.split(".") ?? [];
    expect(assetImport).toHaveLength(3);
    expect(assetImport[0]).toBe("Gamos");
    expect(assetImportSource).toContain(`public static void ${assetImport[2]}()`);
  });

  test("both bridges parse command-line args safely via System.Environment.GetCommandLineArgs", () => {
    for (const name of BRIDGE_FILES) {
      const source = bridgeSources[name] ?? "";
      expect(source).toContain("System.Environment.GetCommandLineArgs()");
      expect(source).toContain("-gamosParams");
      expect(source).toContain("-gamosResult");
      // argument lookup is index-based pair matching, never a shell
      expect(source).not.toMatch(/Process\.Start/);
    }
  });

  test("both bridges write JSON result files via File.WriteAllText", () => {
    for (const name of BRIDGE_FILES) {
      const source = bridgeSources[name] ?? "";
      expect(source).toContain("File.WriteAllText");
      expect(source).toContain("JsonUtility.ToJson");
    }
  });

  test("scene paths are guarded against traversal and absolute paths inside the bridge too", () => {
    expect(markerSource).toContain("IsSafeRelativeAssetPath");
    // the guard rejects absolute paths and ".." components
    expect(markerSource).toMatch(/Path\.IsPathRooted/);
    expect(markerSource).toMatch(/Contains\("\.\."\)|IndexOf\("\.\."\)/);
  });

  test("the bridges stay inside their narrow API surface (no escape hatches)", () => {
    const forbidden = [
      "Process.Start",
      "System.Net",
      "WebClient",
      "HttpClient",
      "File.Delete",
      "Directory.Delete",
      "System.Reflection",
      "Assembly.Load",
      "DllImport",
      "Convert.FromBase64String",
      "Convert.ChangeType",
      "Type.GetType",
      "Activator.CreateInstance",
    ];
    for (const name of BRIDGE_FILES) {
      const source = bridgeSources[name] ?? "";
      for (const api of forbidden) {
        expect(source.includes(api), `${name} must not contain ${api}`).toBe(false);
      }
    }
  });

  test("add-cube is built from GameObject.CreatePrimitive and saved via EditorSceneManager", () => {
    expect(markerSource).toContain("GameObject.CreatePrimitive");
    expect(markerSource).toContain("PrimitiveType.Cube");
    expect(markerSource).toContain("EditorSceneManager.SaveScene");
    expect(markerSource).toContain("EditorSceneManager.OpenScene");
    expect(markerSource).toContain("EditorSceneManager.NewScene");
  });

  test("the build target inside the bridge is allowlisted to StandaloneLinux64", () => {
    expect(buildSource).toContain("StandaloneLinux64");
    expect(buildSource).toMatch(/BuildTarget\.StandaloneLinux64/);
    // the bridge validates the incoming buildTarget string against its allowlist
    expect(buildSource).toMatch(/allowlist|AllowedBuildTargets|allowed/i);
  });

  // -------------------------------------------------------------------------
  // M3.1 target leg: the GamosAssetImport.cs template (asset.import)
  // -------------------------------------------------------------------------

  test("GamosAssetImport.cs is committed in the bridge directory and exposes the reviewed entry point", () => {
    // the template must actually be committed (defensive read failed → "")
    expect(assetImportSource.length).toBeGreaterThan(500);
    expect(assetImportSource).toContain("namespace Gamos");
    expect(assetImportSource).toContain("static class AssetImport");
    expect(assetImportSource).toContain("public static void ImportAsset()");
    // the entry point exits batch mode with an explicit status after writing its report
    expect(assetImportSource).toContain("EditorApplication.Exit");
  });

  test("GamosAssetImport.cs imports through AssetDatabase and verifies the LOADED asset (a file alone proves nothing)", () => {
    expect(assetImportSource).toContain("AssetDatabase.ImportAsset");
    expect(assetImportSource).toContain("ImportAssetOptions.ForceUpdate");
    expect(assetImportSource).toContain("AssetDatabase.LoadAssetAtPath");
    expect(assetImportSource).toContain("AssetDatabase.LoadAllAssetsAtPath");
    expect(assetImportSource).toContain("AssetDatabase.AssetPathToGUID");
    // the loaded-asset counts are the engine-query verification
    expect(assetImportSource).toMatch(/meshCount/);
    expect(assetImportSource).toMatch(/vertexCount/);
    expect(assetImportSource).toMatch(/materialCount/);
  });

  test("GamosAssetImport.cs copies nothing itself — it operates only on the engine-staged file", () => {
    // no File.Copy / FileStream writes: staging is the TypeScript engine's job
    expect(assetImportSource).not.toContain("File.Copy");
    expect(assetImportSource).not.toContain("File.ReadAllBytes");
    expect(assetImportSource).not.toContain("FileStream");
    // the bridge refuses to run when the staged artifact is not on disk
    expect(assetImportSource).toMatch(/staged/i);
  });

  test("GamosAssetImport.cs places the imported asset into the scene through EditorSceneManager", () => {
    expect(assetImportSource).toContain("UnityEngine.Object.Instantiate");
    expect(assetImportSource).toContain("GamosImported");
    expect(assetImportSource).toContain("EditorSceneManager.SaveScene");
    expect(assetImportSource).toMatch(/EditorSceneManager\.OpenScene|EditorSceneManager\.NewScene/);
  });

  test("GamosAssetImport.cs mirrors the path-safety guard for targetAssetPath and scenePath", () => {
    expect(assetImportSource).toContain("IsSafeRelativeAssetPath");
    expect(assetImportSource).toMatch(/Path\.IsPathRooted/);
    expect(assetImportSource).toMatch(/Contains\("\.\."\)|IndexOf\("\.\."\)/);
    expect(assetImportSource).toContain("Assets/");
  });

  test("GamosAssetImport.cs keeps the JsonUtility DTO protocol and safe argv pair-matching", () => {
    expect(assetImportSource).toContain("System.Environment.GetCommandLineArgs()");
    expect(assetImportSource).toContain("-gamosParams");
    expect(assetImportSource).toContain("-gamosResult");
    expect(assetImportSource).toContain("JsonUtility.FromJson");
    expect(assetImportSource).toContain("JsonUtility.ToJson");
    expect(assetImportSource).toContain("File.WriteAllText");
    expect(assetImportSource).toMatch(/artifactStagedPath/);
    expect(assetImportSource).toMatch(/targetAssetPath/);
    expect(assetImportSource).toMatch(/placeInScene/);
    expect(assetImportSource).toMatch(/scenePath/);
  });
});
