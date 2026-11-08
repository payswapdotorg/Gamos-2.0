import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  BRIDGE_FILES,
  DEFAULT_SCENE_PATH,
  PathSafetyError,
  ProjectBuildInput,
  ProjectInspectInput,
  SceneModifyInput,
  UNITY_EXECUTE_METHODS,
  resolveBridgeRoot,
  resolveWorkspacePath,
} from "../src/typed-ops.js";

describe("unity typed operation input schemas", () => {
  test("project inspect requires a projectRoot", () => {
    expect(ProjectInspectInput.safeParse({}).success).toBe(false);
    expect(ProjectInspectInput.safeParse({ projectRoot: "" }).success).toBe(false);
    expect(ProjectInspectInput.safeParse({ projectRoot: "/ws/unity-project" }).success).toBe(true);
  });

  test("scene modify accepts the frozen operation set and rejects unknown operations", () => {
    expect(
      SceneModifyInput.safeParse({ projectRoot: "/ws/p", operation: "scene.spawn-shell" }).success,
    ).toBe(false);
    expect(SceneModifyInput.safeParse({ projectRoot: "/ws/p", operation: "scene.add-cube" }).success).toBe(
      true,
    );
    expect(
      SceneModifyInput.safeParse({
        projectRoot: "/ws/p",
        operation: "scene.set-active-build-target",
        parameters: { buildTarget: "StandaloneLinux64" },
      }).success,
    ).toBe(true);
    expect(SceneModifyInput.safeParse({ projectRoot: "/ws/p" }).success).toBe(false);
    expect(SceneModifyInput.safeParse({ operation: "scene.add-cube" }).success).toBe(false);
  });

  test("scene modify validates add-cube parameters", () => {
    expect(
      SceneModifyInput.safeParse({
        projectRoot: "/ws/p",
        operation: "scene.add-cube",
        parameters: {
          name: "GamosTestCube",
          location: [1, 2, 3],
          scale: [1.5, 1.5, 1.5],
          scenePath: "Assets/Scenes/Main.unity",
        },
      }).success,
    ).toBe(true);
    // vectors must be finite 3-number tuples
    expect(
      SceneModifyInput.safeParse({
        projectRoot: "/ws/p",
        operation: "scene.add-cube",
        parameters: { location: ["a", 2, 3] },
      }).success,
    ).toBe(false);
    expect(
      SceneModifyInput.safeParse({
        projectRoot: "/ws/p",
        operation: "scene.add-cube",
        parameters: { location: [1, 2] },
      }).success,
    ).toBe(false);
    expect(
      SceneModifyInput.safeParse({
        projectRoot: "/ws/p",
        operation: "scene.add-cube",
        parameters: { scale: [1, Number.NaN, 3] },
      }).success,
    ).toBe(false);
    expect(
      SceneModifyInput.safeParse({
        projectRoot: "/ws/p",
        operation: "scene.add-cube",
        parameters: { scale: [1, Number.POSITIVE_INFINITY, 3] },
      }).success,
    ).toBe(false);
    // scenePath must be a relative Assets/ path with no traversal
    expect(
      SceneModifyInput.safeParse({
        projectRoot: "/ws/p",
        operation: "scene.add-cube",
        parameters: { scenePath: "/etc/passwd" },
      }).success,
    ).toBe(false);
    expect(
      SceneModifyInput.safeParse({
        projectRoot: "/ws/p",
        operation: "scene.add-cube",
        parameters: { scenePath: "../outside.unity" },
      }).success,
    ).toBe(false);
    expect(
      SceneModifyInput.safeParse({
        projectRoot: "/ws/p",
        operation: "scene.add-cube",
        parameters: { scenePath: "Assets/../outside.unity" },
      }).success,
    ).toBe(false);
    // unknown parameter keys are rejected (fail closed, no silent pass-through)
    expect(
      SceneModifyInput.safeParse({
        projectRoot: "/ws/p",
        operation: "scene.add-cube",
        parameters: { spawnShell: true },
      }).success,
    ).toBe(false);
    // non-string names are rejected
    expect(
      SceneModifyInput.safeParse({
        projectRoot: "/ws/p",
        operation: "scene.add-cube",
        parameters: { name: 42 },
      }).success,
    ).toBe(false);
  });

  test("scene modify validates set-active-build-target parameters (StandaloneLinux64 only)", () => {
    expect(
      SceneModifyInput.safeParse({
        projectRoot: "/ws/p",
        operation: "scene.set-active-build-target",
        parameters: { buildTarget: "StandaloneWindows64" },
      }).success,
    ).toBe(false);
    expect(
      SceneModifyInput.safeParse({
        projectRoot: "/ws/p",
        operation: "scene.set-active-build-target",
        parameters: { buildTarget: "StandaloneLinux64", extra: "no" },
      }).success,
    ).toBe(false);
    expect(
      SceneModifyInput.safeParse({ projectRoot: "/ws/p", operation: "scene.set-active-build-target" })
        .success,
    ).toBe(true);
  });

  test("project build accepts exactly StandaloneLinux64 as the build target", () => {
    expect(
      ProjectBuildInput.safeParse({ projectRoot: "/ws/p", buildTarget: "StandaloneLinux64" }).success,
    ).toBe(true);
    expect(
      ProjectBuildInput.safeParse({ projectRoot: "/ws/p", buildTarget: "StandaloneOSX" }).success,
    ).toBe(false);
    expect(
      ProjectBuildInput.safeParse({ projectRoot: "/ws/p", buildTarget: "StandaloneWindows64" }).success,
    ).toBe(false);
    expect(ProjectBuildInput.safeParse({ projectRoot: "/ws/p" }).success).toBe(false);
  });

  test("the default scene path is the frozen Gamos scene path", () => {
    expect(DEFAULT_SCENE_PATH).toBe("Assets/Scenes/GamosScene.unity");
  });
});

describe("workspace path safety", () => {
  test("rejects relative paths and requires an absolute workspace root", async () => {
    const ws = await mkdtemp(path.join(tmpdir(), "gamos-unity-path-ws-"));
    try {
      expect(() => resolveWorkspacePath("unity-project", ws)).toThrow(PathSafetyError);
      expect(() => resolveWorkspacePath("relative/project", ws)).toThrow(/absolute/i);
      expect(() => resolveWorkspacePath("/tmp/unity-project", "relative-root")).toThrow(/absolute/i);
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  test("rejects traversal outside the workspace root but allows traversal inside it", async () => {
    const ws = await mkdtemp(path.join(tmpdir(), "gamos-unity-path-ws-"));
    try {
      expect(() => resolveWorkspacePath("../../etc/passwd", ws)).toThrow(PathSafetyError);
      expect(() => resolveWorkspacePath(path.join(ws, "..", "..", "etc", "passwd"), ws)).toThrow(/outside/i);
      expect(() => resolveWorkspacePath(path.join(ws, "a", "..", "..", "etc", "passwd"), ws)).toThrow(
        /outside/i,
      );
      const inside = resolveWorkspacePath(path.join(ws, "a", "..", "b", "project"), ws);
      expect(inside).toBe(path.join(ws, "b", "project"));
      expect(resolveWorkspacePath(ws, ws)).toBe(ws);
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  test("rejects symlink escapes out of the workspace root and allows symlinks inside it", async () => {
    const ws = await mkdtemp(path.join(tmpdir(), "gamos-unity-path-ws-"));
    const outside = await mkdtemp(path.join(tmpdir(), "gamos-unity-path-out-"));
    try {
      await mkdir(path.join(ws, "safe"));
      await symlink(outside, path.join(ws, "escape"));
      expect(() => resolveWorkspacePath(path.join(ws, "escape", "Assets"), ws)).toThrow(
        /symlink|escapes|outside/i,
      );

      await symlink(path.join(ws, "safe"), path.join(ws, "alias"));
      const aliased = resolveWorkspacePath(path.join(ws, "alias", "Assets"), ws);
      expect(aliased).toBe(path.join(ws, "alias", "Assets"));
    } finally {
      await rm(ws, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe("bridge file plan (fixed committed templates)", () => {
  test("BRIDGE_FILES is the complete, committed C# bridge set", () => {
    expect([...BRIDGE_FILES].sort()).toEqual(["GamosAssetImport.cs", "GamosBuild.cs", "GamosMarker.cs"]);
  });

  test("UNITY_EXECUTE_METHODS maps every frozen operation to its reviewed entry point", () => {
    expect(UNITY_EXECUTE_METHODS["scene.add-cube"]).toBe("Gamos.Marker.AddCube");
    expect(UNITY_EXECUTE_METHODS["scene.set-active-build-target"]).toBe("Gamos.Build.SetActiveBuildTarget");
    expect(UNITY_EXECUTE_METHODS["project.build"]).toBe("Gamos.Build.BuildStandalone");
    expect(UNITY_EXECUTE_METHODS["asset.import"]).toBe("Gamos.AssetImport.ImportAsset");
  });

  test("resolveBridgeRoot points at the committed bridge directory containing the templates", () => {
    const root = resolveBridgeRoot();
    for (const name of BRIDGE_FILES) {
      const source = readFileSync(path.join(root, name), "utf8");
      // fixed committed template: substantial, reviewed source — never generated
      expect(source.length).toBeGreaterThan(500);
      expect(source).toContain("namespace Gamos");
    }
  });
});
