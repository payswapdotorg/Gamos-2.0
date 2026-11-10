import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  BRIDGE_MARKER,
  BRIDGE_SCRIPTS,
  PathSafetyError,
  PROPERTY_TYPES,
  resolveBridgeRoot,
  resolveTemplatesDir,
  resolveWorkspacePath,
  buildBridgeScript,
  scanCrashLines,
  verifySceneReadback,
  SceneModifyInput,
} from "../src/typed-ops.js";

/**
 * Pure typed-op contract (no engine needed):
 *
 * - workspace path safety mirrors the blender discipline: absolute-only,
 *   `..`-escape rejection, symlink-escape rejection (G-T2);
 * - frozen schemas reject traversal-shaped node paths, non-allowlisted
 *   properties (the classic GDScript-injection surface), wrong value types
 *   and oversized inputs;
 * - the bridge plan references ONLY the committed fixed templates — the
 *   complete set is enumerated, and every bridge is data-only (JSON in,
 *   marker + JSON report out; no eval-equivalents).
 */

let workspace = "";
let outside = "";

beforeAll(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), "gamos-godot-typedops-"));
  outside = await mkdtemp(path.join(tmpdir(), "gamos-godot-outside-"));
});

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe("workspace path safety (G-T2 mirror of the blender discipline)", () => {
  test("absolute paths inside the root resolve", () => {
    const resolved = resolveWorkspacePath(path.join(workspace, "proj", "scene.tscn"), workspace);
    expect(resolved).toBe(path.join(workspace, "proj", "scene.tscn"));
  });

  test("relative paths are rejected", () => {
    expect(() => resolveWorkspacePath("scene.tscn", workspace)).toThrow(PathSafetyError);
    expect(() => resolveWorkspacePath("../scene.tscn", workspace)).toThrow(PathSafetyError);
  });

  test("traversal that escapes the root is rejected; traversal that stays inside is fine", () => {
    expect(() => resolveWorkspacePath(path.join(workspace, "..", "escape.tscn"), workspace)).toThrow(PathSafetyError);
    const inside = resolveWorkspacePath(path.join(workspace, "a", "..", "b.tscn"), workspace);
    expect(inside).toBe(path.join(workspace, "b.tscn"));
  });

  test("symlink escapes are rejected", async () => {
    const target = path.join(outside, "secret.tscn");
    await writeFile(target, "data");
    const link = path.join(workspace, "link.tscn");
    await symlink(target, link);
    expect(() => resolveWorkspacePath(link, workspace)).toThrow(PathSafetyError);
  });
});

describe("frozen scene-modify schema (typed allowlist, no free-form surface)", () => {
  const base = {
    projectRoot: "/tmp/ws/proj",
    scenePath: "/tmp/ws/proj/scene.tscn",
  };

  test("accepts the typed allowlisted shape", () => {
    const parsed = SceneModifyInput.safeParse({
      ...base,
      operations: [
        { nodePath: "Box", property: "position", value: [1, 2, 3] },
        { nodePath: "Marker", property: "visible", value: true },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  test("rejects non-allowlisted properties — the GDScript-injection surface", () => {
    for (const property of ["script", "metadata", "__dict__", "owner", "filename"]) {
      const parsed = SceneModifyInput.safeParse({
        ...base,
        operations: [{ nodePath: "Box", property, value: [1, 2, 3] }],
      });
      expect(parsed.success, `property "${property}" must be rejected`).toBe(false);
    }
  });

  test("rejects traversal-shaped and malformed node paths", () => {
    for (const nodePath of ["../Root", "/root/Box", "a//b", "Box/../Marker", "a b", "", ".", "A/" + "B/".repeat(20)]) {
      const parsed = SceneModifyInput.safeParse({
        ...base,
        operations: [{ nodePath, property: "position", value: [1, 2, 3] }],
      });
      expect(parsed.success, `nodePath "${nodePath}" must be rejected`).toBe(false);
    }
  });

  test("rejects wrong value shapes and non-finite numbers", () => {
    for (const value of ["1,2,3", [1, 2], [1, 2, "x"], [1, 2, 3, 4], 5, null]) {
      const parsed = SceneModifyInput.safeParse({
        ...base,
        operations: [{ nodePath: "Box", property: "position", value }],
      });
      expect(parsed.success, `value ${JSON.stringify(value)} must be rejected for vec3`).toBe(false);
    }
    const nonBool = SceneModifyInput.safeParse({
      ...base,
      operations: [{ nodePath: "Box", property: "visible", value: "true" }],
    });
    expect(nonBool.success).toBe(false);
  });

  test("rejects empty and oversized operation batches (bounded input)", () => {
    expect(SceneModifyInput.safeParse({ ...base, operations: [] }).success).toBe(false);
    const oversized = Array.from({ length: 65 }, () => ({ nodePath: "Box", property: "position", value: [1, 2, 3] }));
    expect(SceneModifyInput.safeParse({ ...base, operations: oversized }).success).toBe(false);
  });

  test("the property allowlist is exactly the reviewed set with typed values", () => {
    expect(PROPERTY_TYPES).toEqual({
      position: "vec3",
      rotation: "vec3",
      scale: "vec3",
      visible: "bool",
    });
  });
});

describe("fixed bridge plan — the committed data-only GDScript set", () => {
  test("BRIDGE_SCRIPTS is the complete committed set (nothing else is executed)", () => {
    expect([...BRIDGE_SCRIPTS].sort()).toEqual(["project_inspect.gd", "scene_inspect.gd", "scene_modify.gd"]);
  });

  test("resolveBridgeRoot finds the committed templates from the package sources", () => {
    const root = resolveBridgeRoot();
    expect(root).toContain(path.join("godot-engine-plugin", "src", "bridge"));
  });

  test("buildBridgeScript returns the FIXED committed template path and the data-only args", () => {
    const plan = buildBridgeScript("scene_modify.gd", ["/tmp/ops.json"]);
    expect(plan.scriptPath.endsWith("scene_modify.gd")).toBe(true);
    expect(plan.scriptPath.startsWith(resolveBridgeRoot())).toBe(true);
    expect(plan.args).toEqual(["/tmp/ops.json"]);
  });

  test("every committed bridge is data-only: JSON in, marker+report out, no eval-equivalents", () => {
    const root = resolveBridgeRoot();
    for (const script of BRIDGE_SCRIPTS) {
      const source = readFileSync(path.join(root, script), "utf8");
      expect(source, `${script} must read its payload as data (JSON.parse_string)`).toContain("JSON.parse_string");
      expect(source, `${script} must write the stdout report marker`).toContain(BRIDGE_MARKER);
      expect(source, `${script} must not contain eval-equivalents`).not.toMatch(/\beval\s*\(/i);
      expect(source, `${script} must not build code from payload strings`).not.toContain("GDScript.new");
    }
    const modify = readFileSync(path.join(root, "scene_modify.gd"), "utf8");
    expect(modify).toContain("ALLOWED_PROPERTIES");
    expect(modify).toContain("operations");
  });
});

describe("read-back verification model (engine-query, tolerance class 1e-5)", () => {
  test("matching applied/readback passes with float tolerance", () => {
    const outcome = verifySceneReadback(
      [{ nodePath: "Box", property: "position", value: [5, 6, 7] }],
      [{ nodePath: "Box", property: "position", value: [5 + 1e-6, 6, 7 - 1e-7] }],
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.failures).toEqual([]);
  });

  test("a difference beyond the tolerance fails closed", () => {
    const outcome = verifySceneReadback(
      [{ nodePath: "Box", property: "position", value: [5, 6, 7] }],
      [{ nodePath: "Box", property: "position", value: [5, 6, 7 + 1e-4] }],
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.failures.length).toBe(1);
  });

  test("booleans must match exactly", () => {
    const outcome = verifySceneReadback(
      [{ nodePath: "Marker", property: "visible", value: true }],
      [{ nodePath: "Marker", property: "visible", value: false }],
    );
    expect(outcome.ok).toBe(false);
  });

  test("a missing or erroring read-back entry fails closed", () => {
    expect(verifySceneReadback([{ nodePath: "Box", property: "position", value: [1, 2, 3] }], []).ok).toBe(false);
    expect(
      verifySceneReadback(
        [{ nodePath: "Box", property: "position", value: [1, 2, 3] }],
        [{ nodePath: "Box", error: "node-not-found" }],
      ).ok,
    ).toBe(false);
  });
});

describe("crash-line scan (exit-0-is-not-proof discipline; verified engine output shapes)", () => {
  test("the verified engine failure lines are crash lines", () => {
    const samples = [
      "SCRIPT ERROR: Parse Error: Expected expression for variable initial value after \"=\".",
      "ERROR: Failed to load script \"res://broken.gd\" with error \"Parse error\".",
      "Error: Can't run project: no main scene defined in the project.",
      "ERROR: Cannot open file 'res://nope.tscn'.",
      "ERROR: Project export for preset \"LinuxX11\" failed.",
      "Segmentation fault (core dumped)",
    ];
    for (const sample of samples) {
      expect(scanCrashLines(sample), `line must be a crash line: ${sample}`).toEqual([sample]);
    }
  });

  test("the benign banner and SceneTree teardown warning are NOT crash lines", () => {
    const benign = [
      "Godot Engine v4.2.2.stable.official.15073afe3 - https://godotengine.org",
      "WARNING: ObjectDB instances leaked at exit (run with --verbose for details).",
      "\t at: cleanup (core/object/object.cpp:2209)",
      "GAMOS_GODOT_REPORT:/tmp/report.json",
      "",
    ];
    expect(scanCrashLines(benign.join("\n"))).toEqual([]);
  });
});

describe("export-templates directory resolution (honest prerequisite probe)", () => {
  test("honors XDG_DATA_HOME when set", () => {
    expect(resolveTemplatesDir({ XDG_DATA_HOME: "/xdg-data", HOME: "/home/me" })).toBe(
      path.join("/xdg-data", "godot", "export_templates"),
    );
  });

  test("falls back to HOME/.local/share", () => {
    expect(resolveTemplatesDir({ HOME: "/home/me" })).toBe(
      path.join("/home/me", ".local", "share", "godot", "export_templates"),
    );
  });
});
