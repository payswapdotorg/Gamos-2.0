import { describe, expect, it } from "vitest";
import {
  discoverUnityProject,
  discoverBlenderProject,
  discoverGodotProject,
  discoverUnrealProject,
  discoverBabylonProject,
  detectProjectEngines,
} from "../src/adapters/discovery/project-probes.js";

/**
 * Real project discovery from actual files/metadata (contract 04 §1 — M1.3 TDD RED).
 * Fixtures create REAL directories with REAL files on disk; discovery is read-only.
 * Non-project directories must NOT produce fake project records.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function tempRoot() {
  return mkdtempSync(join(tmpdir(), "gamos-m13-"));
}

describe("Project discovery (real files — M1.3)", () => {
  let root: string;
  it("discovers a Unity project from ProjectSettings/ProjectVersion.txt", () => {
    root = tempRoot();
    mkdirSync(join(root, "Assets"), { recursive: true });
    mkdirSync(join(root, "ProjectSettings"), { recursive: true });
    writeFileSync(join(root, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersionWithRevision: 2022.3.10f1 (abcdef123456)\n");
    const r = discoverUnityProject(root);
    expect(r.isProject).toBe(true);
    expect(r.engineFamily).toBe("unity");
    expect(r.evidence).toContain("ProjectSettings/ProjectVersion.txt");
    expect(r.rawVersion).toBe("2022.3.10f1");
    expect(r.projectName).toBeTruthy();
  });
  it("discovers a Blender project from .blend files", () => {
    root = tempRoot();
    writeFileSync(join(root, "scene.blend"), "BLENDER-v293 BLENDER");
    const r = discoverBlenderProject(root);
    expect(r.isProject).toBe(true);
    expect(r.engineFamily).toBe("blender");
    expect(r.evidence[0]).toContain(".blend");
  });
  it("discovers a Godot project from project.godot", () => {
    root = tempRoot();
    writeFileSync(join(root, "project.godot"), "config_version=5\n[application]\nconfig/name=\"MyGame\"\n");
    const r = discoverGodotProject(root);
    expect(r.isProject).toBe(true);
    expect(r.engineFamily).toBe("godot");
    expect(r.evidence).toContain("project.godot");
  });
  it("discovers an Unreal project from a .uproject descriptor", () => {
    root = tempRoot();
    writeFileSync(join(root, "MyGame.uproject"), '{ "FileVersion": 3, "EngineAssociation": "5.3" }');
    const r = discoverUnrealProject(root);
    expect(r.isProject).toBe(true);
    expect(r.engineFamily).toBe("unreal");
    expect(r.evidence[0]).toContain(".uproject");
  });
  it("discovers a Babylon project from package.json with babylonjs dependencies", () => {
    root = tempRoot();
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "my-babylon-game", dependencies: { "@babylonjs/core": "^7.0.0" } }),
    );
    const r = discoverBabylonProject(root);
    expect(r.isProject).toBe(true);
    expect(r.engineFamily).toBe("babylon");
  });
  it("a NON-project directory produces no fake project record", () => {
    root = tempRoot();
    writeFileSync(join(root, "readme.md"), "just docs");
    const r = detectProjectEngines(root);
    expect(r.isProject).toBe(false);
    expect(r.detected).toHaveLength(0);
  });
  it("detectProjectEngines aggregates all families with evidence-backed identities", () => {
    root = tempRoot();
    mkdirSync(join(root, "ProjectSettings"), { recursive: true });
    writeFileSync(join(root, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersionWithRevision: 6000.0.23f1\n");
    writeFileSync(join(root, "scene.blend"), "BLENDER");
    const r = detectProjectEngines(root);
    expect(r.isProject).toBe(true);
    const families = r.detected.map((d) => d.engineFamily);
    expect(families).toContain("unity");
    expect(families).toContain("blender");
    // Machine-local metadata separation: shared metadata fields only
    for (const d of r.detected) {
      expect(d.evidence.length).toBeGreaterThan(0);
      expect(d.projectName).toBeTruthy();
    }
  });
  it("missing root directory is handled explicitly (not an internal error)", () => {
    const r = detectProjectEngines(join(tmpdir(), "gamos-nonexistent-xyz"));
    expect(r.isProject).toBe(false);
  });
  it("cleanup", () => {
    rmSync(root, { recursive: true, force: true });
    expect(true).toBe(true);
  });
});
