import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  PathSafetyError,
  ProjectBuildInput,
  ProjectInspectInput,
  ProjectRunInput,
  ProjectStopInput,
  resolveWorkspacePath,
} from "../src/typed-ops.js";

describe("babylon typed operation input schemas", () => {
  test("project inspect requires a non-empty projectRoot", () => {
    expect(ProjectInspectInput.safeParse({}).success).toBe(false);
    expect(ProjectInspectInput.safeParse({ projectRoot: "" }).success).toBe(false);
    expect(ProjectInspectInput.safeParse({ projectRoot: "/ws/babylon-app" }).success).toBe(true);
    expect(ProjectInspectInput.safeParse({ projectRoot: "/ws/app", extra: 1 }).success).toBe(true);
  });

  test("project build requires a non-empty projectRoot and strips smuggled script overrides", () => {
    expect(ProjectBuildInput.safeParse({}).success).toBe(false);
    expect(ProjectBuildInput.safeParse({ projectRoot: "" }).success).toBe(false);
    expect(ProjectBuildInput.safeParse({ projectRoot: "/ws/babylon-app" }).success).toBe(true);
    // a caller cannot smuggle a script name into the input: unknown keys are
    // stripped and only the package.json-declared `build` script is ever run
    const smuggled = ProjectBuildInput.safeParse({ projectRoot: "/ws/app", script: "arbitrary-script" });
    expect(smuggled.success).toBe(true);
    if (smuggled.success) {
      expect((smuggled.data as Record<string, unknown>).script).toBeUndefined();
    }
  });

  test("project run accepts an optional bounded integer port and rejects junk ports", () => {
    expect(ProjectRunInput.safeParse({ projectRoot: "/ws/app" }).success).toBe(true);
    expect(ProjectRunInput.safeParse({ projectRoot: "/ws/app", port: 3000 }).success).toBe(true);
    expect(ProjectRunInput.safeParse({ projectRoot: "/ws/app", port: 5173 }).success).toBe(true);
    expect(ProjectRunInput.safeParse({ projectRoot: "/ws/app", port: 65535 }).success).toBe(true);
    expect(ProjectRunInput.safeParse({ projectRoot: "/ws/app", port: 0 }).success).toBe(false);
    expect(ProjectRunInput.safeParse({ projectRoot: "/ws/app", port: -1 }).success).toBe(false);
    expect(ProjectRunInput.safeParse({ projectRoot: "/ws/app", port: 65536 }).success).toBe(false);
    expect(ProjectRunInput.safeParse({ projectRoot: "/ws/app", port: 8080.5 }).success).toBe(false);
    expect(ProjectRunInput.safeParse({ projectRoot: "/ws/app", port: "8080" }).success).toBe(false);
    expect(ProjectRunInput.safeParse({ projectRoot: "/ws/app", port: null }).success).toBe(false);
    expect(ProjectRunInput.safeParse({ port: 3000 }).success).toBe(false);
  });

  test("project stop requires a positive integer pid", () => {
    expect(ProjectStopInput.safeParse({}).success).toBe(false);
    expect(ProjectStopInput.safeParse({ pid: 0 }).success).toBe(false);
    expect(ProjectStopInput.safeParse({ pid: -123 }).success).toBe(false);
    expect(ProjectStopInput.safeParse({ pid: 123.5 }).success).toBe(false);
    expect(ProjectStopInput.safeParse({ pid: "123" }).success).toBe(false);
    expect(ProjectStopInput.safeParse({ pid: 12345 }).success).toBe(true);
  });
});

describe("workspace path safety", () => {
  test("rejects relative paths and requires an absolute workspace root", async () => {
    const ws = await mkdtemp(path.join(tmpdir(), "gamos-babylon-path-ws-"));
    try {
      expect(() => resolveWorkspacePath("package.json", ws)).toThrow(PathSafetyError);
      expect(() => resolveWorkspacePath("relative/app", ws)).toThrow(/absolute/i);
      expect(() => resolveWorkspacePath("/tmp/app", "relative-root")).toThrow(/absolute/i);
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  test("rejects traversal outside the workspace root but allows traversal inside it", async () => {
    const ws = await mkdtemp(path.join(tmpdir(), "gamos-babylon-path-ws-"));
    try {
      expect(() => resolveWorkspacePath("../../etc/passwd", ws)).toThrow(PathSafetyError);
      expect(() => resolveWorkspacePath(path.join(ws, "..", "..", "etc", "passwd"), ws)).toThrow(/outside/i);
      expect(() => resolveWorkspacePath(path.join(ws, "a", "..", "..", "etc", "passwd"), ws)).toThrow(/outside/i);
      const inside = resolveWorkspacePath(path.join(ws, "a", "..", "app", "package.json"), ws);
      expect(inside).toBe(path.join(ws, "app", "package.json"));
      expect(resolveWorkspacePath(ws, ws)).toBe(ws);
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  test("rejects symlink escapes out of the workspace root and allows symlinks inside it", async () => {
    const ws = await mkdtemp(path.join(tmpdir(), "gamos-babylon-path-ws-"));
    const outside = await mkdtemp(path.join(tmpdir(), "gamos-babylon-path-out-"));
    try {
      await mkdir(path.join(ws, "safe"));
      await symlink(outside, path.join(ws, "escape"));
      expect(() => resolveWorkspacePath(path.join(ws, "escape", "secret.txt"), ws)).toThrow(
        /symlink|escapes|outside/i,
      );

      await symlink(path.join(ws, "safe"), path.join(ws, "alias"));
      const aliased = resolveWorkspacePath(path.join(ws, "alias", "package.json"), ws);
      expect(aliased).toBe(path.join(ws, "alias", "package.json"));
    } finally {
      await rm(ws, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
