import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { discoverGodot } from "../src/discovery.js";
import {
  assetImport,
  projectBuild,
  projectInspect,
  projectRun,
  runGodotHeadless,
  sceneModify,
  scriptCheck,
} from "../src/engine.js";

/**
 * Real-engine gate (M4 WP-2 INTEGRATE): these tests only mean anything
 * against an actual Godot >=4.2 install. Fixture executables are NOT
 * acceptable here — a miss is an honest skip, and the skip line states the
 * gate is NOT passing.
 *
 * Every capability goes through the committed data-only GDScript bridge:
 * discovery (real `--version`), project.godot read-back, typed scene modify
 * with FRESH-process verification, --check-only negative + positive, real
 * asset import with filesystem probe, headless export with artifact hashing,
 * headless run with crash-line discipline, and bounded-time process-group
 * kill (runaway + abort) with no-orphan assertions.
 */

const FIXTURE_ROOT = fileURLToPath(new URL("./fixture/project", import.meta.url));

const discovery = discoverGodot();
const exe = discovery.executable;
const realGodotFound = discovery.status === "available" && typeof exe === "string" && exe.length > 0;

if (!realGodotFound) {
  console.log(
    `SKIP: real Godot unavailable — integration gate NOT passing (status=${discovery.status}, reason=${discovery.reason ?? "none"})`,
  );
} else {
  console.log(`[gamos-evidence] real Godot executable: ${exe}`);
  console.log(`[gamos-evidence] raw version: ${discovery.rawVersion}`);
}

function sha256Of(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

describe.skipIf(!realGodotFound)("godot-engine plugin real-Godot integration", () => {
  let workspace = "";
  let projectRoot = "";
  let noMainSceneRoot = "";

  beforeAll(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), "gamos-godot-ws-"));
    projectRoot = path.join(workspace, "proj");
    await cp(FIXTURE_ROOT, projectRoot, { recursive: true });
    // A project variant WITHOUT a main scene — the honest run-failure probe.
    noMainSceneRoot = path.join(workspace, "no-main-scene");
    await cp(FIXTURE_ROOT, noMainSceneRoot, { recursive: true });
    const projectGodot = await readFile(path.join(noMainSceneRoot, "project.godot"), "utf8");
    await writeFile(
      path.join(noMainSceneRoot, "project.godot"),
      projectGodot.replace('run/main_scene="res://main.tscn"\n', ""),
    );
    console.log(`[gamos-evidence] fixture project staged at: ${projectRoot}`);
  }, 120_000);

  afterAll(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  test(
    "project_inspect: the engine re-parses the real project.godot (version + config read-back)",
    async () => {
      const outcome = await projectInspect(exe as string, { projectRoot }, workspace, { timeoutMs: 120_000 });
      expect(outcome.ok, outcome.ok ? undefined : JSON.stringify(outcome)).toBe(true);
      if (outcome.ok) {
        expect(outcome.godotVersion).toBe(discovery.rawVersion);
        expect(outcome.configVersion).toBe(5);
        expect(outcome.projectName).toBe("GamosProbe");
        expect(outcome.configFeatures).toContain("4.2");
        expect(outcome.hasScripts).toContain("res://scripts/good.gd");
        expect(outcome.hasScripts).toContain("res://scripts/broken.gd");
        expect(outcome.mainScene).toBe("res://main.tscn");
      }
    },
    180_000,
  );

  test(
    "scene_modify: typed ops apply, the saved scene is re-loaded in a FRESH process and verified",
    async () => {
      const scenePath = path.join(projectRoot, "scene.tscn");
      const before = sha256Of(scenePath);
      const outcome = await sceneModify(
        exe as string,
        {
          projectRoot,
          scenePath,
          operations: [
            { nodePath: "Box", property: "position", value: [5, 6, 7] },
            { nodePath: "Marker", property: "visible", value: true },
          ],
        },
        workspace,
        { timeoutMs: 240_000 },
      );
      expect(outcome.ok, outcome.ok ? undefined : JSON.stringify(outcome)).toBe(true);
      if (outcome.ok) {
        expect(outcome.applied).toHaveLength(2);
        expect(outcome.applied[0]).toMatchObject({ nodePath: "Box", property: "position", verifiedValue: [5, 6, 7] });
        expect(outcome.applied[1]).toMatchObject({ nodePath: "Marker", property: "visible", verifiedValue: true });
        expect(outcome.verification.ok).toBe(true);
        expect(outcome.verification.failures).toEqual([]);
        // The pre-mutation snapshot is staged in workspace temp and is the pre-file bytes.
        expect(existsSync(outcome.snapshotPath)).toBe(true);
        expect(sha256Of(outcome.snapshotPath)).toBe(before);
        // The scene file genuinely changed (exit code alone never proved this).
        expect(sha256Of(scenePath)).not.toBe(before);
        expect(outcome.sceneSha256).toBe(sha256Of(scenePath));
      }
    },
    300_000,
  );

  test(
    "scene_modify fails ATOMICALLY on an unknown node — the scene file is left byte-identical",
    async () => {
      const scenePath = path.join(projectRoot, "scene.tscn");
      const before = sha256Of(scenePath);
      const outcome = await sceneModify(
        exe as string,
        {
          projectRoot,
          scenePath,
          operations: [
            { nodePath: "Box", property: "position", value: [9, 9, 9] },
            { nodePath: "NoSuchNode", property: "position", value: [1, 1, 1] },
          ],
        },
        workspace,
        { timeoutMs: 240_000 },
      );
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe("godot-bridge-failed");
        expect(JSON.stringify(outcome.details)).toContain("node-not-found");
      }
      expect(sha256Of(scenePath)).toBe(before);
    },
    300_000,
  );

  test(
    "script_check: positive verdict requires a clean engine check; the broken script fails with parsed errors",
    async () => {
      const good = await scriptCheck(exe as string, { projectRoot, scriptPath: path.join(projectRoot, "scripts", "good.gd") }, workspace, { timeoutMs: 120_000 });
      expect(good.ok, JSON.stringify(good)).toBe(true);
      if (good.ok) {
        expect(good.checkOk).toBe(true);
        expect(good.parseErrors).toEqual([]);
        expect(good.engineVersion).toBe(discovery.rawVersion);
      }
      const broken = await scriptCheck(exe as string, { projectRoot, scriptPath: path.join(projectRoot, "scripts", "broken.gd") }, workspace, { timeoutMs: 120_000 });
      expect(broken.ok).toBe(true);
      if (broken.ok) {
        expect(broken.checkOk).toBe(false);
        expect(broken.parseErrors.length).toBeGreaterThanOrEqual(1);
        expect(broken.parseErrors[0]?.line).toBe(4);
        expect(broken.parseErrors[0]?.message).toContain("Expected expression");
      }
    },
    180_000,
  );

  test(
    "asset_import: a real asset imports through the engine pass with a filesystem-probe verdict",
    async () => {
      const sourcePath = path.join(workspace, "tri.obj");
      await writeFile(sourcePath, "# gamos probe obj\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n");
      const sourceSha = sha256Of(sourcePath);
      const targetAssetPath = path.join(projectRoot, "assets", "tri.obj");
      const outcome = await assetImport(exe as string, { projectRoot, sourcePath, targetAssetPath }, workspace, { timeoutMs: 300_000 });
      expect(outcome.ok, outcome.ok ? undefined : JSON.stringify(outcome)).toBe(true);
      if (outcome.ok) {
        expect(outcome.importedFiles.length).toBeGreaterThanOrEqual(1);
        for (const file of outcome.importedFiles) {
          expect(file).toContain(path.join(".godot", "imported"));
          expect(existsSync(file)).toBe(true);
        }
        expect(existsSync(outcome.importMetadataPath)).toBe(true);
        expect(path.basename(outcome.importMetadataPath)).toBe("tri.obj.import");
        expect(outcome.sourceSha256).toBe(sourceSha);
        expect(sha256Of(sourcePath)).toBe(sourceSha);
      }
    },
    360_000,
  );

  test(
    "project_build: headless export produces a hash-verified artifact with the templates version",
    async () => {
      const outDir = path.join(workspace, "builds");
      await mkdir(outDir, { recursive: true });
      const outcome = await projectBuild(exe as string, { projectRoot, preset: "LinuxX11", outPath: outDir }, workspace, { timeoutMs: 300_000 });
      expect(outcome.ok, outcome.ok ? undefined : JSON.stringify(outcome)).toBe(true);
      if (outcome.ok) {
        expect(existsSync(outcome.artifactPath)).toBe(true);
        expect(statSync(outcome.artifactPath).size).toBe(outcome.artifactBytes);
        expect(outcome.artifactBytes).toBeGreaterThan(1_000_000);
        expect(outcome.artifactBytes).toBeLessThan(512_000_000);
        expect(outcome.artifactSha256).toMatch(/^[0-9a-f]{64}$/);
        expect(sha256Of(outcome.artifactPath)).toBe(outcome.artifactSha256);
        expect(outcome.templatesVersion).toBe("4.2.2.stable");
        // The engine wrote either a separate pck or embedded it into the binary.
        expect(["separate", "embedded"]).toContain(outcome.pck.mode);
        if (outcome.pck.mode === "separate" && outcome.pck.path) {
          expect(existsSync(outcome.pck.path)).toBe(true);
        }
      }
    },
    360_000,
  );

  test(
    "project_run: the main scene runs headless with exit 0 AND zero crash lines; an explicit scene works too",
    async () => {
      const outcome = await projectRun(exe as string, { projectRoot, quitAfterFrames: 3 }, workspace, { timeoutMs: 120_000 });
      expect(outcome.ok, outcome.ok ? undefined : JSON.stringify(outcome)).toBe(true);
      if (outcome.ok) {
        expect(outcome.exitCode).toBe(0);
        expect(outcome.crashLines).toEqual([]);
      }
      const explicit = await projectRun(
        exe as string,
        { projectRoot, scene: path.join(projectRoot, "scene.tscn"), quitAfterFrames: 2 },
        workspace,
        { timeoutMs: 120_000 },
      );
      expect(explicit.ok).toBe(true);
      if (explicit.ok) {
        expect(explicit.exitCode).toBe(0);
        expect(explicit.crashLines).toEqual([]);
      }
    },
    180_000,
  );

  test(
    "project_run honest failures: a missing scene and a project without a main scene are crash-detected (exit 0 is NOT success)",
    async () => {
      const badScene = await projectRun(
        exe as string,
        { projectRoot, scene: path.join(projectRoot, "nope.tscn"), quitAfterFrames: 2 },
        workspace,
        { timeoutMs: 120_000 },
      );
      expect(badScene.ok).toBe(false);
      if (!badScene.ok) {
        expect(badScene.code).toBe("run-crash-detected");
        expect(JSON.stringify(badScene.details)).toContain("Cannot open file");
      }
      const noMain = await projectRun(exe as string, { projectRoot: noMainSceneRoot, quitAfterFrames: 2 }, workspace, { timeoutMs: 120_000 });
      expect(noMain.ok).toBe(false);
      if (!noMain.ok) {
        expect(noMain.code).toBe("run-crash-detected");
        expect(JSON.stringify(noMain.details)).toContain("Can't run project");
      }
    },
    180_000,
  );

  test(
    "runaway process: bounded time kills the whole process group and leaves NO orphan",
    async () => {
      // The fixture main scene never quits on its own — a genuine runaway.
      const run = await runGodotHeadless(exe as string, ["--headless", "--path", projectRoot], { timeoutMs: 6_000 });
      expect(run.timedOut).toBe(true);
      expect(run.killed).toBe(true);
      expect(typeof run.pid).toBe("number");
      // No-orphan assertion: both the process and its group are gone.
      await expect
        .poll(
          async () => {
            try {
              process.kill(run.pid as number, 0);
              return "alive";
            } catch {
              return "dead";
            }
          },
          { timeout: 15_000, interval: 250 },
        )
        .toBe("dead");
      expect(() => process.kill(-(run.pid as number), 0)).toThrow();
    },
    60_000,
  );

  test(
    "abort signal: cancellation kills the process tree and leaves NO orphan",
    async () => {
      const controller = new AbortController();
      const runPromise = runGodotHeadless(exe as string, ["--headless", "--path", projectRoot], { signal: controller.signal, timeoutMs: 120_000 });
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      controller.abort();
      const run = await runPromise;
      expect(run.aborted).toBe(true);
      expect(run.killed).toBe(true);
      await expect
        .poll(
          async () => {
            try {
              process.kill(run.pid as number, 0);
              return "alive";
            } catch {
              return "dead";
            }
          },
          { timeout: 15_000, interval: 250 },
        )
        .toBe("dead");
    },
    60_000,
  );
});
