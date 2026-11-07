import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  AssetExportInput,
  PathSafetyError,
  SceneInspectInput,
  SceneModifyInput,
  SceneRenderInput,
  buildBridgeScript,
  expectationsFromOperations,
  resolveBridgeRoot,
  resolveWorkspacePath,
  verifySceneReport,
} from "../src/typed-ops.js";

describe("blender typed operation input schemas", () => {
  test("scene inspect requires a blendFile", () => {
    expect(SceneInspectInput.safeParse({}).success).toBe(false);
    expect(SceneInspectInput.safeParse({ blendFile: "" }).success).toBe(false);
    expect(SceneInspectInput.safeParse({ blendFile: "/ws/scene.blend" }).success).toBe(true);
  });

  test("scene modify rejects unknown op names, non-numeric vectors, and empty operation lists", () => {
    expect(
      SceneModifyInput.safeParse({ blendFile: "/ws/s.blend", operations: [{ op: "spawn-shell" }] }).success,
    ).toBe(false);
    expect(
      SceneModifyInput.safeParse({
        blendFile: "/ws/s.blend",
        operations: [{ op: "add-primitive", primitive: "cube", location: ["a", 2, 3] }],
      }).success,
    ).toBe(false);
    expect(
      SceneModifyInput.safeParse({ blendFile: "/ws/s.blend", operations: [{ op: "add-primitive", primitive: "vtube" }] })
        .success,
    ).toBe(false);
    expect(SceneModifyInput.safeParse({ blendFile: "/ws/s.blend", operations: [] }).success).toBe(false);
    expect(SceneModifyInput.safeParse({ blendFile: "/ws/s.blend" }).success).toBe(false);
  });

  test("scene modify enforces per-op required fields", () => {
    expect(
      SceneModifyInput.safeParse({ blendFile: "/ws/s.blend", operations: [{ op: "add-primitive" }] }).success,
    ).toBe(false);
    expect(
      SceneModifyInput.safeParse({ blendFile: "/ws/s.blend", operations: [{ op: "rename", target: "A" }] }).success,
    ).toBe(false);
    expect(
      SceneModifyInput.safeParse({
        blendFile: "/ws/s.blend",
        operations: [{ op: "set-material-color", target: "A" }],
      }).success,
    ).toBe(false);
    expect(
      SceneModifyInput.safeParse({ blendFile: "/ws/s.blend", operations: [{ op: "delete", target: "A" }] }).success,
    ).toBe(true);
    expect(
      SceneModifyInput.safeParse({
        blendFile: "/ws/s.blend",
        operations: [
          {
            op: "add-primitive",
            primitive: "monkey",
            name: "Suzanne",
            location: [1, 2, 3],
            rotation: [0, 0, 0],
            scale: [2, 2, 2],
          },
          { op: "set-transform", target: "Suzanne", location: [1, 1, 1] },
          { op: "rename", target: "Suzanne", name: "Suzanne2" },
          { op: "set-material-color", target: "Suzanne2", color: [0.5, 0.5, 0.5] },
        ],
        save: true,
      }).success,
    ).toBe(true);
  });

  test("scene render and asset export schemas", () => {
    expect(SceneRenderInput.safeParse({ blendFile: "/ws/s.blend", outputPath: "/ws/out.png" }).success).toBe(true);
    expect(
      SceneRenderInput.safeParse({ blendFile: "/ws/s.blend", outputPath: "/ws/out.png", engine: "PIXAR" }).success,
    ).toBe(false);
    expect(
      SceneRenderInput.safeParse({
        blendFile: "/ws/s.blend",
        outputPath: "/ws/out.png",
        resolution: { x: 160.5, y: 120 },
      }).success,
    ).toBe(false);
    expect(
      SceneRenderInput.safeParse({
        blendFile: "/ws/s.blend",
        outputPath: "/ws/out.png",
        engine: "CYCLES",
        resolution: { x: 160, y: 120 },
      }).success,
    ).toBe(true);
    expect(
      AssetExportInput.safeParse({ blendFile: "/ws/s.blend", outputPath: "/ws/cube.obj", format: "STL" }).success,
    ).toBe(false);
    expect(
      AssetExportInput.safeParse({
        blendFile: "/ws/s.blend",
        outputPath: "/ws/cube.obj",
        format: "OBJ",
        selection: ["Cube"],
      }).success,
    ).toBe(true);
  });
});

describe("workspace path safety", () => {
  test("rejects relative paths and requires an absolute workspace root", async () => {
    const ws = await mkdtemp(path.join(tmpdir(), "gamos-path-ws-"));
    try {
      expect(() => resolveWorkspacePath("scene.blend", ws)).toThrow(PathSafetyError);
      expect(() => resolveWorkspacePath("relative/scene.blend", ws)).toThrow(/absolute/i);
      expect(() => resolveWorkspacePath("/tmp/scene.blend", "relative-root")).toThrow(/absolute/i);
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  test("rejects traversal outside the workspace root but allows traversal inside it", async () => {
    const ws = await mkdtemp(path.join(tmpdir(), "gamos-path-ws-"));
    try {
      expect(() => resolveWorkspacePath("../../etc/passwd", ws)).toThrow(PathSafetyError);
      expect(() => resolveWorkspacePath(path.join(ws, "..", "..", "etc", "passwd"), ws)).toThrow(/outside/i);
      expect(() => resolveWorkspacePath(path.join(ws, "a", "..", "..", "etc", "passwd"), ws)).toThrow(/outside/i);
      const inside = resolveWorkspacePath(path.join(ws, "a", "..", "b", "scene.blend"), ws);
      expect(inside).toBe(path.join(ws, "b", "scene.blend"));
      expect(resolveWorkspacePath(ws, ws)).toBe(ws);
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  test("rejects symlink escapes out of the workspace root and allows symlinks inside it", async () => {
    const ws = await mkdtemp(path.join(tmpdir(), "gamos-path-ws-"));
    const outside = await mkdtemp(path.join(tmpdir(), "gamos-path-out-"));
    try {
      await mkdir(path.join(ws, "safe"));
      await symlink(outside, path.join(ws, "escape"));
      expect(() => resolveWorkspacePath(path.join(ws, "escape", "secret.txt"), ws)).toThrow(/symlink|escapes|outside/i);

      await symlink(path.join(ws, "safe"), path.join(ws, "alias"));
      const aliased = resolveWorkspacePath(path.join(ws, "alias", "file.txt"), ws);
      expect(aliased).toBe(path.join(ws, "alias", "file.txt"));
    } finally {
      await rm(ws, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe("bridge script plan", () => {
  test("buildBridgeScript is deterministic and never embeds generated code", () => {
    const root = resolveBridgeRoot();
    const first = buildBridgeScript("/tmp/gamos-ops-a.json", root);
    const second = buildBridgeScript("/tmp/gamos-ops-a.json", root);
    expect(first).toEqual(second);

    const other = buildBridgeScript("/tmp/gamos-ops-b.json", root);
    expect(other.scriptPath).toBe(first.scriptPath);
    expect(first.args).toEqual(["/tmp/gamos-ops-a.json"]);
    expect(other.args).toEqual(["/tmp/gamos-ops-b.json"]);
    expect(first.scriptPath).toBe(path.join(root, "apply_ops.py"));

    // default resolution points at the committed template next to the sources
    expect(buildBridgeScript("/tmp/gamos-ops.json").scriptPath).toBe(
      path.join(resolveBridgeRoot(), "apply_ops.py"),
    );

    // the bridge is a FIXED committed template: no dynamic code execution and
    // no trace of the ops payload inside the script itself
    const template = readFileSync(first.scriptPath, "utf8");
    expect(template.length).toBeGreaterThan(200);
    expect(template).not.toMatch(/\beval\s*\(/);
    expect(template).not.toMatch(/\bexec\s*\(/);
    expect(template).not.toContain("__import__");
    expect(template).not.toContain("/tmp/gamos-ops-a.json");
  });
});

describe("post-modification verification model", () => {
  test("expectation simulation tracks renames, transforms, and deletes", () => {
    const expected = expectationsFromOperations([
      { op: "add-primitive", primitive: "cube", name: "A", location: [0, 0, 0], scale: [1, 1, 1] },
      { op: "rename", target: "A", name: "B" },
      { op: "set-transform", target: "B", location: [1, 2, 3], scale: [1.5, 1.5, 1.5] },
      { op: "set-material-color", target: "B", color: [0.1, 0.2, 0.3] },
    ]);
    expect(expected.objects.map((entry) => entry.objectName)).toEqual(["B"]);
    expect(expected.absentNames).toContain("A");
    const tracked = expected.objects[0];
    expect(tracked?.location).toEqual([1, 2, 3]);
    expect(tracked?.scale).toEqual([1.5, 1.5, 1.5]);
    expect(tracked?.materialColor).toEqual([0.1, 0.2, 0.3]);

    const deleted = expectationsFromOperations([
      { op: "add-primitive", primitive: "cube", name: "C" },
      { op: "delete", target: "C" },
    ]);
    expect(deleted.objects).toHaveLength(0);
    expect(deleted.absentNames).toContain("C");
  });

  test("verifySceneReport accepts matching state and rejects drift", () => {
    const expected = expectationsFromOperations([
      { op: "add-primitive", primitive: "cube", name: "GamosTestCube", location: [1, 2, 3], scale: [1.5, 1.5, 1.5] },
      { op: "set-material-color", target: "GamosTestCube", color: [0.1, 0.2, 0.3] },
    ]);
    const good = verifySceneReport(
      {
        blenderVersion: "4.1.1",
        scenes: [
          {
            name: "Scene",
            objects: [
              {
                name: "GamosTestCube",
                type: "MESH",
                location: [1, 2, 3],
                rotation: [0, 0, 0],
                scale: [1.5, 1.5, 1.5],
                materialColor: [0.10000000149011612, 0.20000000298023224, 0.30000001192092896],
              },
            ],
          },
        ],
      },
      expected,
    );
    expect(good.ok).toBe(true);
    expect(good.failures).toEqual([]);

    const wrongLocation = verifySceneReport(
      { scenes: [{ objects: [{ name: "GamosTestCube", location: [9, 9, 9], scale: [1.5, 1.5, 1.5] }] }] },
      expected,
    );
    expect(wrongLocation.ok).toBe(false);
    expect(wrongLocation.failures.some((failure) => failure.includes("location"))).toBe(true);

    const missingObject = verifySceneReport({ scenes: [{ objects: [] }] }, expected);
    expect(missingObject.ok).toBe(false);
    expect(missingObject.failures.some((failure) => failure.includes("missing"))).toBe(true);

    const deleted = expectationsFromOperations([
      { op: "add-primitive", primitive: "cube", name: "C" },
      { op: "delete", target: "C" },
    ]);
    expect(verifySceneReport({ scenes: [{ objects: [{ name: "C" }] }] }, deleted).ok).toBe(false);
    expect(verifySceneReport({ scenes: [{ objects: [] }] }, deleted).ok).toBe(true);
  });
});
