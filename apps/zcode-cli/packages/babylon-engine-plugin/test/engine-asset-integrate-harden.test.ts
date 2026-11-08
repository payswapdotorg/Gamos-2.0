/**
 * M3.2 target leg HARDEN — adversarial failure paths of `assetIntegrate`
 * (engine layer, no engines, temp dirs). The operation is executableless, so
 * every failure path is directly testable without Node/npm/Blender.
 *
 * Pins the fail-closed contract:
 * - the artifact must exist as a non-empty regular file INSIDE the workspace
 *   (artifact-missing / artifact-invalid / artifact-empty / path-safety);
 * - a declared expectedIntegrity record is AUTHORITATIVE
 *   (asset-integrity-mismatch) and no project mutation happens on failure;
 * - only a real Babylon project is ever touched (not-a-babylon-project);
 * - name collisions fail closed on BOTH surfaces (staged file / registry
 *   entry) and never clobber the source artifact;
 * - the registry is derived state: missing/corrupt registries restart from
 *   the fresh schema shape, valid entries are preserved append-only;
 * - symlinked staging/registry directories cannot redirect writes outside
 *   their sanctioned roots (path-safety — the same escape the workspace
 *   guard rejects for inputs, applied to the engine's own outputs);
 * - re-integrating the already-staged artifact is an idempotent no-op.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { assetIntegrate } from "../src/engine.js";

const ARTIFACT_BYTES = Buffer.from("gamos-fake-glb-artifact-payload-0123456789abcdef", "utf8");
const OTHER_ARTIFACT_BYTES = Buffer.from("gamos-fake-glb-DIFFERENT-payload-fedcba9876543210", "utf8");
const ARTIFACT_SHA256 = createHash("sha256").update(ARTIFACT_BYTES).digest("hex");
const OTHER_SHA256 = createHash("sha256").update(OTHER_ARTIFACT_BYTES).digest("hex");

function sha256Buffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function sha256Of(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

async function makeWorkspace(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "gamos-ai-harden-"));
}

async function makeFakeBabylonProject(workspace: string, name = "app"): Promise<string> {
  const projectRoot = path.join(workspace, name);
  await mkdir(projectRoot, { recursive: true });
  await writeFile(
    path.join(projectRoot, "package.json"),
    JSON.stringify(
      {
        name: "fake-babylon-app",
        private: true,
        type: "module",
        dependencies: { "@babylonjs/core": "^8.0.0" },
      },
      null,
      2,
    ),
  );
  return projectRoot;
}

async function makeArtifact(workspace: string, name = "artifact.glb", content = ARTIFACT_BYTES): Promise<string> {
  const artifactPath = path.join(workspace, name);
  await writeFile(artifactPath, content);
  return artifactPath;
}

describe("assetIntegrate adversarial failure paths (no engines)", () => {
  test("missing artifact fails closed with artifact-missing before any project mutation", async () => {
    const workspace = await makeWorkspace();
    try {
      const projectRoot = await makeFakeBabylonProject(workspace);
      const outcome = await assetIntegrate(
        { projectRoot, artifactPath: path.join(workspace, "no-such-artifact.glb") },
        workspace,
      );
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe("artifact-missing");
        expect(outcome.reason).toMatch(/no-such-artifact\.glb/);
      }
      // fail before mutate: neither the staging dir nor the registry appeared
      expect(existsSync(path.join(projectRoot, "public"))).toBe(false);
      expect(existsSync(path.join(projectRoot, "src"))).toBe(false);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("empty artifact fails closed with artifact-empty", async () => {
    const workspace = await makeWorkspace();
    try {
      const projectRoot = await makeFakeBabylonProject(workspace);
      const artifactPath = path.join(workspace, "empty.glb");
      await writeFile(artifactPath, Buffer.alloc(0));
      const outcome = await assetIntegrate({ projectRoot, artifactPath }, workspace);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe("artifact-empty");
      }
      expect(existsSync(path.join(projectRoot, "public"))).toBe(false);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("a directory posing as the artifact fails closed with artifact-invalid", async () => {
    const workspace = await makeWorkspace();
    try {
      const projectRoot = await makeFakeBabylonProject(workspace);
      const directoryArtifact = path.join(workspace, "fake-glb-dir.glb");
      await mkdir(directoryArtifact);
      const outcome = await assetIntegrate({ projectRoot, artifactPath: directoryArtifact }, workspace);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe("artifact-invalid");
      }
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("an artifact outside the workspace root fails closed with path-safety", async () => {
    const workspace = await makeWorkspace();
    const outside = await mkdtemp(path.join(tmpdir(), "gamos-ai-harden-out-"));
    try {
      const projectRoot = await makeFakeBabylonProject(workspace);
      const artifactPath = await makeArtifact(outside, "outside.glb");
      const outcome = await assetIntegrate({ projectRoot, artifactPath }, workspace);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe("path-safety");
        expect(outcome.reason).toMatch(/outside|escapes/i);
      }
      expect(existsSync(path.join(projectRoot, "public"))).toBe(false);
    } finally {
      await rm(workspace, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  test("a wrong declared sha256 fails closed with asset-integrity-mismatch (the manifest record is authoritative)", async () => {
    const workspace = await makeWorkspace();
    try {
      const projectRoot = await makeFakeBabylonProject(workspace);
      const artifactPath = await makeArtifact(workspace);
      const outcome = await assetIntegrate(
        {
          projectRoot,
          artifactPath,
          expectedIntegrity: { byteLength: ARTIFACT_BYTES.length, sha256: OTHER_SHA256 },
        },
        workspace,
      );
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe("asset-integrity-mismatch");
        expect(outcome.reason).toMatch(/authoritative integrity record/);
        expect(outcome.details).toMatchObject({
          expected: { byteLength: ARTIFACT_BYTES.length, sha256: OTHER_SHA256 },
          observed: { byteLength: ARTIFACT_BYTES.length, sha256: ARTIFACT_SHA256 },
        });
      }
      // fail before mutate: the mismatch must not stage anything
      expect(existsSync(path.join(projectRoot, "public"))).toBe(false);
      expect(existsSync(path.join(projectRoot, "src"))).toBe(false);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("a wrong declared byteLength fails closed with asset-integrity-mismatch", async () => {
    const workspace = await makeWorkspace();
    try {
      const projectRoot = await makeFakeBabylonProject(workspace);
      const artifactPath = await makeArtifact(workspace);
      const outcome = await assetIntegrate(
        {
          projectRoot,
          artifactPath,
          expectedIntegrity: { byteLength: ARTIFACT_BYTES.length + 1, sha256: ARTIFACT_SHA256 },
        },
        workspace,
      );
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe("asset-integrity-mismatch");
      }
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("an empty directory as projectRoot fails closed with not-a-babylon-project", async () => {
    const workspace = await makeWorkspace();
    try {
      const emptyRoot = path.join(workspace, "empty-project");
      await mkdir(emptyRoot);
      const artifactPath = await makeArtifact(workspace);
      const outcome = await assetIntegrate({ projectRoot: emptyRoot, artifactPath }, workspace);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe("not-a-babylon-project");
        // the underlying inspection failure is preserved honestly
        expect(outcome.details).toMatchObject({ underlyingCode: "package-json-missing" });
      }
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("a non-Babylon package.json fails closed with not-a-babylon-project", async () => {
    const workspace = await makeWorkspace();
    try {
      const plainRoot = path.join(workspace, "plain-app");
      await mkdir(plainRoot);
      await writeFile(
        path.join(plainRoot, "package.json"),
        JSON.stringify({ name: "plain-app", private: true, scripts: { dev: "vite" } }),
      );
      const artifactPath = await makeArtifact(workspace);
      const outcome = await assetIntegrate({ projectRoot: plainRoot, artifactPath }, workspace);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe("not-a-babylon-project");
        expect(outcome.details).toMatchObject({ underlyingCode: "not-a-babylon-project" });
      }
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("successful staging creates the registry, verifies the staged hash, and leaves no tmp files", async () => {
    const workspace = await makeWorkspace();
    try {
      const projectRoot = await makeFakeBabylonProject(workspace);
      const artifactPath = await makeArtifact(workspace, "gamos-cube.glb");
      const outcome = await assetIntegrate(
        {
          projectRoot,
          artifactPath,
          expectedIntegrity: { byteLength: ARTIFACT_BYTES.length, sha256: ARTIFACT_SHA256 },
        },
        workspace,
      );
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.integrated).toBe(true);
      expect(outcome.assetName).toBe("gamos-cube");
      expect(outcome.stagedPath).toBe(path.join(projectRoot, "public", "assets", "gamos-cube.glb"));
      expect(outcome.bytes).toBe(ARTIFACT_BYTES.length);
      expect(outcome.sha256).toBe(ARTIFACT_SHA256);
      expect(outcome.registryEntry).toEqual({ assetName: "gamos-cube", file: "gamos-cube.glb", sha256: ARTIFACT_SHA256 });
      expect(outcome.registryPath).toBe(path.join(projectRoot, "src", "gamos-assets.json"));

      // the staged copy hashes identical to the source (verified, not assumed)
      expect(sha256Of(outcome.stagedPath)).toBe(ARTIFACT_SHA256);
      // the registry was created with exactly the appended entry
      expect(JSON.parse(readFileSync(outcome.registryPath, "utf8"))).toEqual({
        schema: "gamos/babylon-assets@1",
        assets: [{ assetName: "gamos-cube", file: "gamos-cube.glb", sha256: ARTIFACT_SHA256 }],
      });
      // atomic write: no tmp leftovers next to the registry
      const srcEntries = await readdir(path.join(projectRoot, "src"));
      expect(srcEntries).toEqual(["gamos-assets.json"]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("a second identical integrate is idempotent: one registry entry, same staged hash", async () => {
    const workspace = await makeWorkspace();
    try {
      const projectRoot = await makeFakeBabylonProject(workspace);
      const artifactPath = await makeArtifact(workspace, "gamos-cube.glb");
      const first = await assetIntegrate({ projectRoot, artifactPath }, workspace);
      expect(first.ok).toBe(true);
      const second = await assetIntegrate({ projectRoot, artifactPath }, workspace);
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.integrated).toBe(true);
      expect(second.sha256).toBe(ARTIFACT_SHA256);
      // replace, not append: exactly one entry for the asset
      const registry = JSON.parse(readFileSync(second.registryPath, "utf8"));
      expect(registry.assets).toHaveLength(1);
      expect(registry.assets[0]).toEqual({ assetName: "gamos-cube", file: "gamos-cube.glb", sha256: ARTIFACT_SHA256 });
      expect(sha256Of(second.stagedPath)).toBe(ARTIFACT_SHA256);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("a second integrate with a different sha256 fails closed with asset-name-collision (registry surface)", async () => {
    const workspace = await makeWorkspace();
    try {
      const projectRoot = await makeFakeBabylonProject(workspace);
      const artifactPath = await makeArtifact(workspace, "gamos-cube.glb");
      const first = await assetIntegrate({ projectRoot, artifactPath }, workspace);
      expect(first.ok).toBe(true);

      // the staged file is gone (fresh copy of the project), but the registry
      // still carries the name with a different sha256
      await rm(path.join(projectRoot, "public"), { recursive: true, force: true });
      const otherArtifactPath = await makeArtifact(workspace, "other-name.glb", OTHER_ARTIFACT_BYTES);
      const outcome = await assetIntegrate(
        { projectRoot, artifactPath: otherArtifactPath, assetName: "gamos-cube" },
        workspace,
      );
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe("asset-name-collision");
        expect(outcome.details).toMatchObject({ surface: "registry", registeredSha256: ARTIFACT_SHA256 });
      }
      // the registry row is untouched by the failed integrate
      const registry = JSON.parse(readFileSync(path.join(projectRoot, "src", "gamos-assets.json"), "utf8"));
      expect(registry.assets).toHaveLength(1);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("a pre-existing different staged file fails closed with asset-name-collision and the source artifact is untouched", async () => {
    const workspace = await makeWorkspace();
    try {
      const projectRoot = await makeFakeBabylonProject(workspace);
      const artifactPath = await makeArtifact(workspace, "gamos-cube.glb");
      // a different file already occupies the staged name (no registry entry)
      await mkdir(path.join(projectRoot, "public", "assets"), { recursive: true });
      const stagedPath = path.join(projectRoot, "public", "assets", "gamos-cube.glb");
      await writeFile(stagedPath, OTHER_ARTIFACT_BYTES);
      const outcome = await assetIntegrate({ projectRoot, artifactPath }, workspace);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe("asset-name-collision");
        expect(outcome.details).toMatchObject({ surface: "staged-file", stagedSha256: OTHER_SHA256 });
      }
      // neither the staged occupant nor the source artifact was clobbered
      expect(sha256Of(stagedPath)).toBe(OTHER_SHA256);
      expect(sha256Of(artifactPath)).toBe(ARTIFACT_SHA256);
      // and no registry was created by the failed integrate
      expect(existsSync(path.join(projectRoot, "src"))).toBe(false);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("existing registry entries are preserved when a new asset is appended", async () => {
    const workspace = await makeWorkspace();
    try {
      const projectRoot = await makeFakeBabylonProject(workspace);
      const first = await assetIntegrate(
        { projectRoot, artifactPath: await makeArtifact(workspace, "alpha-cube.glb") },
        workspace,
      );
      expect(first.ok).toBe(true);
      const second = await assetIntegrate(
        { projectRoot, artifactPath: await makeArtifact(workspace, "beta-cube.glb", OTHER_ARTIFACT_BYTES) },
        workspace,
      );
      expect(second.ok).toBe(true);
      const registry = JSON.parse(
        readFileSync(path.join(projectRoot, "src", "gamos-assets.json"), "utf8"),
      ) as { assets: Array<{ assetName: string; file: string; sha256: string }> };
      expect(registry.assets).toHaveLength(2);
      expect(registry.assets.map((entry) => entry.assetName).sort()).toEqual(["alpha-cube", "beta-cube"]);
      expect(registry.assets.find((entry) => entry.assetName === "alpha-cube")?.sha256).toBe(ARTIFACT_SHA256);
      expect(registry.assets.find((entry) => entry.assetName === "beta-cube")?.sha256).toBe(OTHER_SHA256);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("an unparseable registry is replaced with the fresh schema shape (derived state)", async () => {
    const workspace = await makeWorkspace();
    try {
      const projectRoot = await makeFakeBabylonProject(workspace);
      await mkdir(path.join(projectRoot, "src"), { recursive: true });
      await writeFile(
        path.join(projectRoot, "src", "gamos-assets.json"),
        '{"schema":"gamos/babylon-assets@9","assets":[{"assetName":"garbage"',
      );
      const artifactPath = await makeArtifact(workspace, "gamos-cube.glb");
      const outcome = await assetIntegrate({ projectRoot, artifactPath }, workspace);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      const registry = JSON.parse(readFileSync(outcome.registryPath, "utf8"));
      expect(registry).toEqual({
        schema: "gamos/babylon-assets@1",
        assets: [{ assetName: "gamos-cube", file: "gamos-cube.glb", sha256: ARTIFACT_SHA256 }],
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("an artifact whose filename stem cannot be an asset name fails closed with asset-name-invalid", async () => {
    const workspace = await makeWorkspace();
    try {
      const projectRoot = await makeFakeBabylonProject(workspace);
      const artifactPath = await makeArtifact(workspace, "Gamos Cube 1.glb");
      const outcome = await assetIntegrate({ projectRoot, artifactPath }, workspace);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe("asset-name-invalid");
        expect(outcome.reason).toMatch(/explicit assetName/);
      }
      expect(existsSync(path.join(projectRoot, "public"))).toBe(false);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("an explicit assetName overrides a non-conforming artifact filename", async () => {
    const workspace = await makeWorkspace();
    try {
      const projectRoot = await makeFakeBabylonProject(workspace);
      const artifactPath = await makeArtifact(workspace, "Blender Export 2026.glb");
      const outcome = await assetIntegrate({ projectRoot, artifactPath, assetName: "gamos-cube" }, workspace);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.assetName).toBe("gamos-cube");
      expect(outcome.stagedPath).toBe(path.join(projectRoot, "public", "assets", "gamos-cube.glb"));
      expect(outcome.registryEntry.file).toBe("gamos-cube.glb");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("a symlinked staging directory inside the workspace fails closed with path-safety and writes nothing through the symlink", async () => {
    const workspace = await makeWorkspace();
    try {
      const projectRoot = await makeFakeBabylonProject(workspace);
      // public/assets -> a directory INSIDE the workspace (outside the project):
      // the workspace-level guard alone would tolerate this — the project-level
      // containment of the staging root must reject it.
      const evilDir = path.join(workspace, "evil-staging");
      await mkdir(evilDir);
      await mkdir(path.join(projectRoot, "public"), { recursive: true });
      await symlink(evilDir, path.join(projectRoot, "public", "assets"));
      const artifactPath = await makeArtifact(workspace, "gamos-cube.glb");
      const outcome = await assetIntegrate({ projectRoot, artifactPath }, workspace);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe("path-safety");
        expect(outcome.reason).toMatch(/escapes|outside/i);
      }
      // nothing was written through the symlink
      expect(await readdir(evilDir)).toEqual([]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("a symlinked staging directory outside the workspace fails closed with path-safety", async () => {
    const workspace = await makeWorkspace();
    const outside = await mkdtemp(path.join(tmpdir(), "gamos-ai-harden-evil-"));
    try {
      const projectRoot = await makeFakeBabylonProject(workspace);
      await mkdir(path.join(projectRoot, "public"), { recursive: true });
      await symlink(outside, path.join(projectRoot, "public", "assets"));
      const artifactPath = await makeArtifact(workspace, "gamos-cube.glb");
      const outcome = await assetIntegrate({ projectRoot, artifactPath }, workspace);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe("path-safety");
      }
      expect(await readdir(outside)).toEqual([]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  test("a symlinked registry directory fails closed with path-safety and writes nothing through the symlink", async () => {
    const workspace = await makeWorkspace();
    try {
      const projectRoot = await makeFakeBabylonProject(workspace);
      // src -> a directory inside the workspace but outside the project: the
      // registry write must never be redirected there.
      const victimDir = path.join(workspace, "victim-registry");
      await mkdir(victimDir);
      await symlink(victimDir, path.join(projectRoot, "src"));
      const artifactPath = await makeArtifact(workspace, "gamos-cube.glb");
      const outcome = await assetIntegrate({ projectRoot, artifactPath }, workspace);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe("path-safety");
      }
      expect(await readdir(victimDir)).toEqual([]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("invalid input fails closed with invalid-input (schema boundary)", async () => {
    const workspace = await makeWorkspace();
    try {
      const outcome = await assetIntegrate({ projectRoot: "/ws/app" }, workspace);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe("invalid-input");
        expect(outcome.reason).toMatch(/artifactPath/);
      }
      const badName = await assetIntegrate(
        { projectRoot: path.join(workspace, "app"), artifactPath: path.join(workspace, "a.glb"), assetName: "../evil" },
        workspace,
      );
      expect(badName.ok).toBe(false);
      if (!badName.ok) {
        expect(badName.code).toBe("invalid-input");
      }
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("re-integrating the already-staged artifact is an idempotent no-op (same source and staged path)", async () => {
    const workspace = await makeWorkspace();
    try {
      const projectRoot = await makeFakeBabylonProject(workspace);
      const artifactPath = await makeArtifact(workspace, "gamos-cube.glb");
      const first = await assetIntegrate({ projectRoot, artifactPath }, workspace);
      expect(first.ok).toBe(true);
      // the export leg's artifact IS the staged file: the copy must be a
      // no-op and the hash verification must still hold
      const stagedPath = first.ok ? first.stagedPath : "";
      const restaged = await assetIntegrate({ projectRoot, artifactPath: stagedPath }, workspace);
      expect(restaged.ok).toBe(true);
      if (!restaged.ok) return;
      expect(restaged.sha256).toBe(ARTIFACT_SHA256);
      expect(sha256Of(stagedPath)).toBe(ARTIFACT_SHA256);
      const registry = JSON.parse(readFileSync(restaged.registryPath, "utf8"));
      expect(registry.assets).toHaveLength(1);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
