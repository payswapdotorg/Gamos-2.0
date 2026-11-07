import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { inspectUnityProject } from "../src/project.js";

const FIXTURE_ROOT = fileURLToPath(new URL("./fixture/unity-project", import.meta.url));

async function tempProject(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "gamos-unity-proj-"));
  for (const [relativePath, contents] of Object.entries(files)) {
    const target = path.join(dir, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents);
  }
  return dir;
}

const validProjectVersion = [
  "m_EditorVersion: 6000.0.23f1",
  "m_EditorVersionWithRevision: 6000.0.23f1 (ab2b18a5f80dcba39fd8f5ee57b07edc7c0f600f)",
  "",
].join("\n");

describe("unity project marker inspection (real fixture)", () => {
  test("inspectUnityProject parses the committed real Unity project fixture", () => {
    const outcome = inspectUnityProject(FIXTURE_ROOT);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.projectVersion.raw).toBe("6000.0.23f1");
    expect(outcome.projectVersion.parsed).toEqual({ year: 6000, major: 0, stream: 23, sequence: 1 });
    expect(outcome.projectVersion.revision).toBe("ab2b18a5f80dcba39fd8f5ee57b07edc7c0f600f");
    expect(outcome.hasAssets).toBe(true);
    expect(outcome.sceneFiles).toEqual(["Assets/Scenes/Main.unity"]);
    expect(outcome.sceneCount).toBe(1);
    expect(outcome.sceneSearchTruncated).toBe(false);
    // machine-neutral evidence: marker paths relative to the project root
    expect(outcome.evidencePaths).toContain("ProjectSettings/ProjectVersion.txt");
    expect(outcome.evidencePaths).toContain("Assets/Scenes/Main.unity");
    expect(outcome.evidencePaths.every((entry) => !path.isAbsolute(entry))).toBe(true);
  });

  test("the fixture scene is real Unity scene YAML, not an empty marker", async () => {
    const scene = await import("node:fs").then((fs) =>
      fs.readFileSync(path.join(FIXTURE_ROOT, "Assets", "Scenes", "Main.unity"), "utf8"),
    );
    expect(scene).toContain("%YAML 1.1");
    expect(scene).toContain("%TAG !u! tag:unity3d.com,2011:");
    expect(scene).toContain("GameObject:");
    expect(scene).toContain("Transform:");
    expect(scene).toContain("m_LocalPosition:");
  });
});

describe("unity project fail-closed marker gating", () => {
  test("an empty directory is not a Unity project", async () => {
    const dir = await tempProject({ "README.md": "not a unity project" });
    try {
      const outcome = inspectUnityProject(dir);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe("not-a-unity-project");
        expect(outcome.reason).toMatch(/ProjectVersion|Assets|unity/i);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("ProjectVersion.txt without an Assets/ directory is not a Unity project", async () => {
    const dir = await tempProject({ "ProjectSettings/ProjectVersion.txt": validProjectVersion });
    try {
      const outcome = inspectUnityProject(dir);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe("not-a-unity-project");
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("an Assets/ directory without ProjectVersion.txt is not a Unity project", async () => {
    const dir = await tempProject({ "Assets/keep.txt": "assets without identity" });
    try {
      const outcome = inspectUnityProject(dir);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe("not-a-unity-project");
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a malformed ProjectVersion.txt is a structured failure, never a guess", async () => {
    const dir = await tempProject({
      "ProjectSettings/ProjectVersion.txt": "m_EditorVersion: garbage-not-a-version\n",
    });
    await mkdir(path.join(dir, "Assets"), { recursive: true });
    try {
      const outcome = inspectUnityProject(dir);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe("project-version-unparseable");
        expect(outcome.reason).toBeTruthy();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a ProjectVersion.txt missing the m_EditorVersion line fails closed", async () => {
    const dir = await tempProject({
      "ProjectSettings/ProjectVersion.txt":
        "m_EditorVersionWithRevision: 6000.0.23f1 (ab2b18a5f80dcba39fd8f5ee57b07edc7c0f600f)\n",
    });
    await mkdir(path.join(dir, "Assets"), { recursive: true });
    try {
      const outcome = inspectUnityProject(dir);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe("project-version-unparseable");
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("relative and missing project roots are structured failures", () => {
    const relative = inspectUnityProject("relative/project");
    expect(relative.ok).toBe(false);
    if (!relative.ok) {
      expect(relative.code).toBe("project-root-invalid");
    }
    const missing = inspectUnityProject("/nonexistent/gamos/unity-project");
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.code).toBe("project-root-missing");
    }
  });
});

describe("unity scene listing", () => {
  test("nested .unity files are found, sorted, and bounded at 50", async () => {
    const files: Record<string, string> = {
      "ProjectSettings/ProjectVersion.txt": validProjectVersion,
    };
    for (let index = 0; index < 60; index += 1) {
      const folder = index % 2 === 0 ? "Assets/Scenes" : "Assets/Nested/Deep/Scenes";
      files[`${folder}/Scene${String(index).padStart(2, "0")}.unity`] = "%YAML 1.1\n";
    }
    const dir = await tempProject(files);
    try {
      const outcome = inspectUnityProject(dir);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.sceneCount).toBe(50);
      expect(outcome.sceneFiles).toHaveLength(50);
      expect(outcome.sceneSearchTruncated).toBe(true);
      expect(outcome.sceneFiles.every((entry) => entry.startsWith("Assets/") && entry.endsWith(".unity"))).toBe(
        true,
      );
      expect([...outcome.sceneFiles].sort()).toEqual(outcome.sceneFiles);
      // non-scene files are never listed
      expect(outcome.sceneFiles.some((entry) => entry.includes("keep.txt"))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a project without scenes reports an empty list honestly", async () => {
    const dir = await tempProject({
      "ProjectSettings/ProjectVersion.txt": validProjectVersion,
      "Assets/Scripts/Player.cs": "public class Player {}\n",
    });
    try {
      const outcome = inspectUnityProject(dir);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.sceneFiles).toEqual([]);
      expect(outcome.sceneCount).toBe(0);
      expect(outcome.sceneSearchTruncated).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
