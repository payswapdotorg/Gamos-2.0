import { cp, mkdir, rm, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { loadBridgeReport, projectBuild, projectInspect, scriptCheck, sceneModify } from "../src/engine.js";
import { engineVersionInfoMatches } from "../src/typed-ops.js";
import { fileURLToPath } from "node:url";

/**
 * HARDEN — the structured-failure taxonomy, proven WITHOUT a real engine
 * (every path here fails closed before or independently of any spawn; a
 * fake executable path is deliberately used where no spawn can occur):
 *
 * - bridge protocol: missing report, unparseable report, lying report;
 * - input validation and path safety through the op wrappers;
 * - honest prerequisites: project.godot missing, script missing,
 *   pre-created export directory missing, unknown export preset,
 *   missing export templates (the honest `godot-export-templates-missing`
 *   reason with the expected directory named).
 */

const FIXTURE_ROOT = fileURLToPath(new URL("./fixture/project", import.meta.url));
const FAKE_EXE = "/nonexistent/godot-binary";

let workspace = "";
let projectRoot = "";

beforeAll(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), "gamos-godot-harden-"));
  projectRoot = path.join(workspace, "proj");
  await cp(FIXTURE_ROOT, projectRoot, { recursive: true });
});

afterAll(async () => {
  if (workspace) await rm(workspace, { recursive: true, force: true });
});

describe("bridge report protocol fails closed", () => {
  test("a missing report file is a structured bridge failure", async () => {
    const outcome = await loadBridgeReport(path.join(workspace, "never-written.json"));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.failure.code).toBe("godot-bridge-report-missing");
    }
  });

  test("an unparseable report is a structured bridge failure", async () => {
    const bad = path.join(workspace, "bad.json");
    await writeFile(bad, "{not json");
    const outcome = await loadBridgeReport(bad);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.failure.code).toBe("godot-bridge-report-invalid");
    }
  });

  test("a non-object report is a structured bridge failure", async () => {
    const bad = path.join(workspace, "array.json");
    await writeFile(bad, "[1,2,3]");
    const outcome = await loadBridgeReport(bad);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.failure.code).toBe("godot-bridge-report-invalid");
  });

  test("a lying report (ok:false) surfaces the bridge's own error", async () => {
    const lying = path.join(workspace, "lying.json");
    await writeFile(lying, JSON.stringify({ ok: false, error: "bridge-scene-load-failed", scenePath: "res://nope.tscn" }));
    const outcome = await loadBridgeReport(lying);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.failure.code).toBe("godot-bridge-failed");
      expect(JSON.stringify(outcome.failure.details)).toContain("bridge-scene-load-failed");
    }
  });
});

describe("engine version consistency (bridge report vs --version; fail closed)", () => {
  test("a matching bridge versionInfo agrees with the --version string", () => {
    expect(
      engineVersionInfoMatches("4.2.2.stable.official.15073afe3", { major: 4, minor: 2, patch: 2, status: "stable" }),
    ).toBe(true);
  });

  test("a mismatching bridge versionInfo fails closed", () => {
    expect(
      engineVersionInfoMatches("4.2.2.stable.official.15073afe3", { major: 4, minor: 3, patch: 0, status: "stable" }),
    ).toBe(false);
    expect(
      engineVersionInfoMatches("4.2.2.stable.official.15073afe3", { major: 4, minor: 2, patch: 2, status: "beta" }),
    ).toBe(false);
    expect(engineVersionInfoMatches("garbage", { major: 4, minor: 2, patch: 2, status: "stable" })).toBe(false);
  });
});

describe("input validation and path safety through the op wrappers", () => {
  test("malformed input is invalid-input with the zod issues", async () => {
    const outcome = await projectInspect(FAKE_EXE, { projectRoot: 42 }, workspace);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("invalid-input");
  });

  test("a relative project root is a path-safety failure (never a spawn)", async () => {
    const outcome = await projectInspect(FAKE_EXE, { projectRoot: "proj" }, workspace);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("path-safety");
  });

  test("a project root without project.godot fails honestly", async () => {
    const outcome = await projectInspect(FAKE_EXE, { projectRoot: workspace }, workspace);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("project-godot-missing");
  });

  test("a scene path outside the project root is a path-safety failure (res:// confinement)", async () => {
    const outsideScene = path.join(workspace, "outside.tscn");
    await writeFile(outsideScene, "[gd_scene format=3]\n");
    const outcome = await sceneModify(
      FAKE_EXE,
      {
        projectRoot,
        scenePath: outsideScene,
        operations: [{ nodePath: "Box", property: "position", value: [1, 2, 3] }],
      },
      workspace,
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("path-safety");
  });

  test("a missing script file fails honestly before any spawn", async () => {
    const outcome = await scriptCheck(FAKE_EXE, { projectRoot, scriptPath: path.join(projectRoot, "scripts", "nope.gd") }, workspace);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("script-file-missing");
  });
});

describe("export prerequisites fail closed and honestly (no silent success)", () => {
  test("a missing pre-created output directory is an honest error", async () => {
    const outcome = await projectBuild(
      FAKE_EXE,
      { projectRoot, preset: "LinuxX11", outPath: path.join(workspace, "no-such-dir") },
      workspace,
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("export-out-dir-missing");
  });

  test("an unknown export preset is rejected with the available presets listed", async () => {
    const outDir = path.join(workspace, "builds");
    await mkdir(outDir, { recursive: true });
    const outcome = await projectBuild(FAKE_EXE, { projectRoot, preset: "WindowsDesktop", outPath: outDir }, workspace);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe("unknown-export-preset");
      expect(JSON.stringify(outcome.details)).toContain("LinuxX11");
    }
  });

  test("missing export templates fail closed with the expected directory named", async () => {
    const outDir = path.join(workspace, "builds");
    const emptyXdg = path.join(workspace, "empty-xdg");
    await mkdir(emptyXdg, { recursive: true });
    const outcome = await projectBuild(
      FAKE_EXE,
      { projectRoot, preset: "LinuxX11", outPath: outDir },
      workspace,
      { env: { XDG_DATA_HOME: emptyXdg, HOME: "/home/me" } },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe("godot-export-templates-missing");
      expect(outcome.message).toContain(path.join(emptyXdg, "godot", "export_templates"));
    }
  });
});
