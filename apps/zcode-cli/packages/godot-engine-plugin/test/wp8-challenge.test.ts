import { chmod, cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { projectBuild, projectInspect, projectRun, sceneModify } from "../src/engine.js";
import { runGodotHeadless } from "../src/engine-run.js";
import { SceneInspectInput } from "../src/typed-ops.js";

/**
 * M4 WP-8 — the Godot challenge-matrix rows that had NO engine-independent
 * executed evidence (the WP-8 audit of delivery plan §7):
 *
 * - G4 (oversized input): the declared schema bounds — AbsolutePath ≤ 4096,
 *   preset ≤ 64, quitAfterFrames ≤ 100_000, nodePath ≤ 256, read-back
 *   queries ≤ 128 — each now has a REAL over-bound negative row; and the
 *   bounded-output collection (maxOutputBytes / truncated) gets a real
 *   flooding-executable row.
 * - G6 (runaway processes): an engine-independent kill-path row — a fake
 *   executable that never quits is killed with the whole process group
 *   within the bound, and the abort-signal path kills the tree the same way
 *   (the real-Godot legs stay in the integration suite where the engine is
 *   provisioned).
 * - G8 (export templates): the honest-failure branches beyond the
 *   templates-ROOT check — the version-dir mismatch (fake --version
 *   executable + a root holding only a different version), the missing
 *   linux_release template file, the unparseable version, and the
 *   preset-without-export_path refusal.
 *
 * Every row is engine-independent: it either fails closed before any spawn
 * or drives the REAL process runner with a fake executable.
 */

const FIXTURE_ROOT = fileURLToPath(new URL("./fixture/project", import.meta.url));
const FAKE_EXE = "/nonexistent/godot-binary";

let workspace = "";
let projectRoot = "";

beforeAll(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), "gamos-godot-wp8-"));
  projectRoot = path.join(workspace, "proj");
  await cp(FIXTURE_ROOT, projectRoot, { recursive: true });
});

afterAll(async () => {
  if (workspace) await rm(workspace, { recursive: true, force: true });
});

/** A fake executable that prints the given first line and exits 0. */
async function fakeVersionExe(version: string): Promise<string> {
  const exe = path.join(workspace, `fake-godot-${version.replace(/[^0-9a-z]/gi, "_")}`);
  await writeFile(exe, `#!/bin/sh\necho "${version}"\n`);
  await chmod(exe, 0o755);
  return exe;
}

describe("§7 G4 — the declared input bounds are enforced (every bound gets a real over-bound row)", () => {
  test("a project root longer than 4096 chars is invalid-input (never a path-safety or spawn path)", async () => {
    const longRoot = "/tmp/" + "a".repeat(5000);
    const outcome = await projectInspect(FAKE_EXE, { projectRoot: longRoot }, workspace);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("invalid-input");
  });

  test("an export preset name longer than 64 chars is invalid-input", async () => {
    const outcome = await projectBuild(
      FAKE_EXE,
      { projectRoot, preset: "p".repeat(65), outPath: path.join(workspace, "builds") },
      workspace,
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("invalid-input");
  });

  test("quitAfterFrames above 100_000 is invalid-input (bounded headless run)", async () => {
    const outcome = await projectRun(FAKE_EXE, { projectRoot, quitAfterFrames: 100_001 }, workspace);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("invalid-input");
  });

  test("a node path longer than 256 chars is invalid-input", async () => {
    const outcome = await sceneModify(
      FAKE_EXE,
      {
        projectRoot,
        scenePath: path.join(projectRoot, "scene.tscn"),
        operations: [{ nodePath: "n".repeat(257), property: "position", value: [1, 2, 3] }],
      },
      workspace,
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("invalid-input");
  });

  test("more than 128 read-back queries is invalid-input (the internal inspect schema bound)", () => {
    const queries = Array.from({ length: 129 }, () => ({ nodePath: "Box", property: "position" }));
    const parsed = SceneInspectInput.safeParse({
      projectRoot,
      scenePath: path.join(projectRoot, "scene.tscn"),
      queries,
    });
    expect(parsed.success).toBe(false);
  });
});

describe("§7 G4 — bounded output collection (a flooding executable, capped collection, honest truncation flag)", () => {
  test("a flooding executable is collected up to maxOutputBytes and flagged truncated", async () => {
    const exe = path.join(workspace, "flood-exe");
    await writeFile(exe, "#!/bin/sh\nyes 0123456789abcdef | head -c 65536\n");
    await chmod(exe, 0o755);
    const run = await runGodotHeadless(exe, [], { timeoutMs: 10_000, maxOutputBytes: 4096 });
    expect(run.exitStatus).toBe(0);
    expect(run.truncated).toBe(true);
    expect(Buffer.byteLength(run.stdout, "utf8")).toBeLessThanOrEqual(4096);
    expect(run.stdout.length).toBeGreaterThan(0);
  });
});

describe("§7 G6 — runaway processes: the engine-independent kill-path rows (bounded time + process-group kill)", () => {
  test("a never-quitting fake executable is killed with its whole process group within the bound", async () => {
    const exe = path.join(workspace, "runaway-exe");
    // The fake spawns a CHILD that also never quits — the process GROUP kill
    // must reap both (no orphan).
    await writeFile(exe, "#!/bin/sh\nsleep 60 &\nsleep 60\n");
    await chmod(exe, 0o755);
    const run = await runGodotHeadless(exe, [], { timeoutMs: 400 });
    expect(run.timedOut).toBe(true);
    expect(run.killed).toBe(true);
    expect(run.pid).not.toBeNull();
    // Poll until the process group is truly gone (kill(pid,0) throws ESRCH).
    let groupDead = false;
    for (let i = 0; i < 40 && !groupDead; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      try {
        process.kill(run.pid!, 0);
      } catch {
        groupDead = true;
      }
    }
    expect(groupDead).toBe(true);
    // The whole process GROUP (the sh + its sleep child) is dead.
    let orphanFound = false;
    try {
      process.kill(-run.pid!, 0);
    } catch {
      orphanFound = true;
    }
    expect(orphanFound).toBe(true);
  }, 15_000);

  test("an abort signal kills the process tree and surfaces aborted", async () => {
    const exe = path.join(workspace, "abort-exe");
    await writeFile(exe, "#!/bin/sh\nsleep 60\n");
    await chmod(exe, 0o755);
    const controller = new AbortController();
    const pending = runGodotHeadless(exe, [], { timeoutMs: 60_000, signal: controller.signal });
    setTimeout(() => controller.abort(), 150);
    const run = await pending;
    expect(run.aborted).toBe(true);
    expect(run.killed).toBe(true);
  });
});

describe("§7 G8 — export-template honesty beyond the root check (fake --version executable + real template tree)", () => {
  test("a version-dir mismatch names the EXACT expected templates directory (no silent success)", async () => {
    const exe = await fakeVersionExe("4.2.2.stable.official.15073afe3");
    const xdg = path.join(workspace, "xdg-wrongversion");
    const outDir = path.join(workspace, "builds");
    await mkdir(path.join(xdg, "godot", "export_templates", "4.2.1.stable"), { recursive: true });
    await mkdir(outDir, { recursive: true });
    const outcome = await projectBuild(
      exe,
      { projectRoot, preset: "LinuxX11", outPath: outDir },
      workspace,
      { env: { XDG_DATA_HOME: xdg, HOME: "/home/me" } },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe("godot-export-templates-missing");
      expect(outcome.message).toContain(path.join(xdg, "godot", "export_templates", "4.2.2.stable"));
    }
  });

  test("a missing linux_release template file in an otherwise correct version dir fails honestly", async () => {
    const exe = await fakeVersionExe("4.2.2.stable.official.15073afe3");
    const xdg = path.join(workspace, "xdg-emptyversiondir");
    const outDir = path.join(workspace, "builds");
    await mkdir(path.join(xdg, "godot", "export_templates", "4.2.2.stable"), { recursive: true });
    await mkdir(outDir, { recursive: true });
    const outcome = await projectBuild(
      exe,
      { projectRoot, preset: "LinuxX11", outPath: outDir },
      workspace,
      { env: { XDG_DATA_HOME: xdg, HOME: "/home/me" } },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe("godot-export-templates-missing");
      expect(outcome.message).toContain(path.join(xdg, "godot", "export_templates", "4.2.2.stable"));
    }
  });

  test("an unparseable engine version fails closed (godot-version-unparseable)", async () => {
    const exe = await fakeVersionExe("totally-not-a-version");
    const xdg = path.join(workspace, "xdg-anyversion");
    const outDir = path.join(workspace, "builds");
    await mkdir(path.join(xdg, "godot", "export_templates", "4.2.2.stable"), { recursive: true });
    await writeFile(path.join(xdg, "godot", "export_templates", "4.2.2.stable", "linux_release.x86_64"), "template");
    await mkdir(outDir, { recursive: true });
    const outcome = await projectBuild(
      exe,
      { projectRoot, preset: "LinuxX11", outPath: outDir },
      workspace,
      { env: { XDG_DATA_HOME: xdg, HOME: "/home/me" } },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("godot-version-unparseable");
  });

  test("a preset that declares no export_path is refused (the artifact filename is unknown)", async () => {
    const cfgPath = path.join(projectRoot, "export_presets.cfg");
    await writeFile(
      cfgPath,
      '[preset.0]\n\nname="LinuxX11"\nplatform="Linux"\nrunnable=true\n\n[preset.0.options]\n',
    );
    const outcome = await projectBuild(
      FAKE_EXE,
      { projectRoot, preset: "LinuxX11", outPath: path.join(workspace, "builds") },
      workspace,
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("preset-export-path-missing");
  });
});
