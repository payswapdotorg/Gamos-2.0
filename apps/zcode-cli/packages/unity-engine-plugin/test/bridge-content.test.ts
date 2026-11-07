import { readFileSync } from "node:fs";
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
const bridgeSources: Record<string, string> = {
  "GamosMarker.cs": markerSource,
  "GamosBuild.cs": buildSource,
};

describe("committed C# bridge content review (text-shape checks, not engine execution)", () => {
  test("the bridge set is exactly the two reviewed templates", () => {
    expect([...BRIDGE_FILES].sort()).toEqual(["GamosBuild.cs", "GamosMarker.cs"]);
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
});
