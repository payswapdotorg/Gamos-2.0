/**
 * M3.1 target leg HARDEN — adversarial failure paths of `assetImport`
 * (engine layer, no editor, temp dirs). The pre-editor stages (parse →
 * integrity → project inspection → version contract → staging → bridge/params
 * preparation) all run BEFORE the honest editor gate, so every failure path
 * and every staging assertion is directly testable without a Unity install —
 * the batch invocation itself returns the honest `unity-editor-unavailable`
 * failure, never a fabricated import result.
 *
 * Pins the fail-closed contract:
 * - the artifact must exist as a non-empty regular file INSIDE the workspace
 *   (artifact-missing / artifact-invalid / artifact-empty / path-safety);
 * - a declared expectedIntegrity record is AUTHORITATIVE
 *   (asset-integrity-mismatch) and no project mutation happens on failure;
 * - only a real Unity project is ever touched (not-a-unity-project) and the
 *   project's pinned editor version must match the exact contract
 *   (asset-import-project-version-mismatch, fail before mutate);
 * - a different file already staged at the target fails closed
 *   (asset-name-collision) and never clobbers the occupant or the source;
 * - staging is byte-identical and re-hashed: the committed cross-engine FBX
 *   fixture stages with its pinned sha256 intact, the derived default target
 *   is Assets/Gamos/gamos-asset<ext>, and re-staging is idempotent;
 * - the three reviewed bridge templates and the exact params JSON the C#
 *   deserializes are on disk before the (honestly unavailable) batch;
 * - symlinked Assets/… directories cannot redirect the engine's writes
 *   outside the project (path-safety — the same escape the workspace guard
 *   rejects for inputs, applied to the engine's own outputs);
 * - the invalid-input schema boundary holds.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { assetImport } from "../src/engine.js";
import { DEFAULT_SCENE_PATH } from "../src/typed-ops.js";

const FIXTURE_PROJECT_DIR = fileURLToPath(new URL("./fixture/unity-project", import.meta.url));
const FBX_FIXTURE_PATH = fileURLToPath(new URL("./fixture/gamos-cube.fbx", import.meta.url));
const FBX_FIXTURE_BYTES = 15228;
const FBX_FIXTURE_SHA256 = "ce346618c7df43efc2496ed4c5cd2f0f35c5e2be2f7a40ec34e8a9b51fe3d78d";

/** No editor on this runner: a path that provably does not exist. */
const NO_EDITOR = "/nonexistent/gamos-unity-editor";

const ARTIFACT_BYTES = Buffer.from("gamos-fake-fbx-artifact-payload-0123456789abcdef", "utf8");
const OTHER_ARTIFACT_BYTES = Buffer.from("gamos-fake-fbx-DIFFERENT-payload-fedcba9876543210", "utf8");
const ARTIFACT_SHA256 = createHash("sha256").update(ARTIFACT_BYTES).digest("hex");

function sha256Of(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

async function makeWorkspace(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "gamos-ai-unity-harden-"));
}

/** A Unity-shaped temp project copied from the committed fixture. */
async function makeUnityProject(workspace: string, name = "unity-project"): Promise<string> {
  const projectRoot = path.join(workspace, name);
  await cp(FIXTURE_PROJECT_DIR, projectRoot, {
    recursive: true,
    filter: (source) => !/(^|[\\/])(Library|Builds|Temp|Logs)([\\/]|$)/.test(source),
  });
  return projectRoot;
}

async function makeArtifact(workspace: string, name = "gamos-cube.fbx", content = ARTIFACT_BYTES): Promise<string> {
  const artifactPath = path.join(workspace, name);
  await writeFile(artifactPath, content);
  return artifactPath;
}

describe("assetImport adversarial failure paths (no editor)", () => {
  test("missing artifact fails closed with artifact-missing before any project mutation", async () => {
    const workspace = await makeWorkspace();
    try {
      const projectRoot = await makeUnityProject(workspace);
      const outcome = await assetImport(
        NO_EDITOR,
        { projectRoot, artifactPath: path.join(workspace, "no-such-artifact.fbx") },
        workspace,
      );
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe("artifact-missing");
        expect(outcome.reason).toMatch(/no-such-artifact\.fbx/);
      }
      // fail before mutate: no Gamos asset, no bridge dir, no params
      expect(existsSync(path.join(projectRoot, "Assets", "Gamos"))).toBe(false);
      expect(existsSync(path.join(projectRoot, "Assets", "Editor"))).toBe(false);
      expect(existsSync(path.join(projectRoot, "Gamos"))).toBe(false);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("empty artifact fails closed with artifact-empty", async () => {
    const workspace = await makeWorkspace();
    try {
      const projectRoot = await makeUnityProject(workspace);
      const artifactPath = path.join(workspace, "empty.fbx");
      await writeFile(artifactPath, Buffer.alloc(0));
      const outcome = await assetImport(NO_EDITOR, { projectRoot, artifactPath }, workspace);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe("artifact-empty");
      }
      expect(existsSync(path.join(projectRoot, "Assets", "Gamos"))).toBe(false);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("a directory posing as the artifact fails closed with artifact-invalid", async () => {
    const workspace = await makeWorkspace();
    try {
      const projectRoot = await makeUnityProject(workspace);
      const directoryArtifact = path.join(workspace, "fake-fbx-dir.fbx");
      await mkdir(directoryArtifact);
      const outcome = await assetImport(NO_EDITOR, { projectRoot, artifactPath: directoryArtifact }, workspace);
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
    const outside = await mkdtemp(path.join(tmpdir(), "gamos-ai-unity-out-"));
    try {
      const projectRoot = await makeUnityProject(workspace);
      const artifactPath = await makeArtifact(outside, "outside.fbx");
      const outcome = await assetImport(NO_EDITOR, { projectRoot, artifactPath }, workspace);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe("path-safety");
        expect(outcome.reason).toMatch(/outside|escapes/i);
      }
      expect(existsSync(path.join(projectRoot, "Assets", "Gamos"))).toBe(false);
    } finally {
      await rm(workspace, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  test("a wrong declared sha256 fails closed with asset-integrity-mismatch (the manifest record is authoritative)", async () => {
    const workspace = await makeWorkspace();
    try {
      const projectRoot = await makeUnityProject(workspace);
      const artifactPath = await makeArtifact(workspace);
      const outcome = await assetImport(
        NO_EDITOR,
        {
          projectRoot,
          artifactPath,
          expectedIntegrity: { byteLength: ARTIFACT_BYTES.length, sha256: FBX_FIXTURE_SHA256 },
        },
        workspace,
      );
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe("asset-integrity-mismatch");
        expect(outcome.reason).toMatch(/authoritative integrity record/);
        expect(outcome.details).toMatchObject({
          expected: { byteLength: ARTIFACT_BYTES.length, sha256: FBX_FIXTURE_SHA256 },
          observed: { byteLength: ARTIFACT_BYTES.length, sha256: ARTIFACT_SHA256 },
        });
      }
      // fail before mutate: the mismatch must not stage anything
      expect(existsSync(path.join(projectRoot, "Assets", "Gamos"))).toBe(false);
      expect(existsSync(path.join(projectRoot, "Gamos"))).toBe(false);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("a wrong declared byteLength fails closed with asset-integrity-mismatch", async () => {
    const workspace = await makeWorkspace();
    try {
      const projectRoot = await makeUnityProject(workspace);
      const artifactPath = await makeArtifact(workspace);
      const outcome = await assetImport(
        NO_EDITOR,
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

  test("an empty directory as projectRoot fails closed with not-a-unity-project", async () => {
    const workspace = await makeWorkspace();
    try {
      const emptyRoot = path.join(workspace, "empty-project");
      await mkdir(emptyRoot);
      const artifactPath = await makeArtifact(workspace);
      const outcome = await assetImport(NO_EDITOR, { projectRoot: emptyRoot, artifactPath }, workspace);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe("not-a-unity-project");
      }
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("a project with a mismatched pinned editor version fails closed with asset-import-project-version-mismatch (fail before mutate)", async () => {
    const workspace = await makeWorkspace();
    try {
      const projectRoot = await makeUnityProject(workspace, "old-project");
      await writeFile(
        path.join(projectRoot, "ProjectSettings", "ProjectVersion.txt"),
        "m_EditorVersion: 2022.3.10f1\nm_EditorVersionWithRevision: 2022.3.10f1 (b3c3008e81046da5dcf5064da00a679b6b3ca0e1)\n",
        "utf8",
      );
      const artifactPath = await makeArtifact(workspace);
      const outcome = await assetImport(NO_EDITOR, { projectRoot, artifactPath }, workspace);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe("asset-import-project-version-mismatch");
        expect(outcome.reason).toMatch(/2022\.3\.10f1/);
        expect(outcome.reason).toMatch(/6000\.0\.23f1/);
        // the structured failure lists BOTH versions
        expect(outcome.details).toMatchObject({
          projectVersion: "2022.3.10f1",
          requiredVersion: "6000.0.23f1",
        });
      }
      // fail before mutate: nothing was staged, no bridge, no params
      expect(existsSync(path.join(projectRoot, "Assets", "Gamos"))).toBe(false);
      expect(existsSync(path.join(projectRoot, "Assets", "Editor"))).toBe(false);
      expect(existsSync(path.join(projectRoot, "Gamos"))).toBe(false);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("a pre-existing different staged file fails closed with asset-name-collision and nothing is clobbered", async () => {
    const workspace = await makeWorkspace();
    try {
      const projectRoot = await makeUnityProject(workspace);
      const artifactPath = await makeArtifact(workspace, "gamos-cube.fbx");
      // a different file already occupies the target (no bridge, no params yet)
      await mkdir(path.join(projectRoot, "Assets", "Gamos"), { recursive: true });
      const stagedPath = path.join(projectRoot, "Assets", "Gamos", "gamos-cube.fbx");
      await writeFile(stagedPath, OTHER_ARTIFACT_BYTES);
      const outcome = await assetImport(
        NO_EDITOR,
        { projectRoot, artifactPath, targetAssetPath: "Assets/Gamos/gamos-cube.fbx" },
        workspace,
      );
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe("asset-name-collision");
        expect(outcome.details).toMatchObject({ surface: "staged-asset", targetAssetPath: "Assets/Gamos/gamos-cube.fbx" });
      }
      // neither the staged occupant nor the source artifact was clobbered
      expect(sha256Of(stagedPath)).toBe(createHash("sha256").update(OTHER_ARTIFACT_BYTES).digest("hex"));
      expect(sha256Of(artifactPath)).toBe(ARTIFACT_SHA256);
      // and no bridge/params were written by the failed import
      expect(existsSync(path.join(projectRoot, "Assets", "Editor"))).toBe(false);
      expect(existsSync(path.join(projectRoot, "Gamos"))).toBe(false);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("staging lands byte-identical at the target, copies the three bridge templates and writes the exact params JSON — then the honest unavailable failure", async () => {
    const workspace = await makeWorkspace();
    try {
      const projectRoot = await makeUnityProject(workspace);
      const artifactPath = await makeArtifact(workspace, "gamos-cube.fbx");
      const outcome = await assetImport(
        NO_EDITOR,
        {
          projectRoot,
          artifactPath,
          targetAssetPath: "Assets/Gamos/gamos-cube.fbx",
          expectedIntegrity: { byteLength: ARTIFACT_BYTES.length, sha256: ARTIFACT_SHA256 },
        },
        workspace,
      );
      // no editor on this runner: the honest unavailable failure, never a
      // fabricated import result
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe("unity-editor-unavailable");
        expect(outcome.reason).toMatch(/honest unavailable state, never a fabricated import result/);
        expect(outcome.details).toMatchObject({
          executable: NO_EDITOR,
          targetAssetPath: "Assets/Gamos/gamos-cube.fbx",
          stagedSha256: ARTIFACT_SHA256,
          stagedBytes: ARTIFACT_BYTES.length,
        });
      }
      // the staged copy is byte-identical (verified, not assumed)
      const stagedPath = path.join(projectRoot, "Assets", "Gamos", "gamos-cube.fbx");
      expect(existsSync(stagedPath)).toBe(true);
      expect(sha256Of(stagedPath)).toBe(ARTIFACT_SHA256);
      // all three reviewed bridge templates were copied (BRIDGE_FILES drives it)
      const bridgeDir = path.join(projectRoot, "Assets", "Editor", "Gamos");
      expect((await readdir(bridgeDir)).sort()).toEqual(["GamosAssetImport.cs", "GamosBuild.cs", "GamosMarker.cs"]);
      // the params JSON is exactly what the C# JsonUtility DTOs deserialize
      const params = JSON.parse(readFileSync(path.join(projectRoot, "Gamos", "params.json"), "utf8"));
      expect(params).toEqual({
        artifactStagedPath: stagedPath,
        targetAssetPath: "Assets/Gamos/gamos-cube.fbx",
        placeInScene: false,
        scenePath: DEFAULT_SCENE_PATH,
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("placeInScene is carried into the params JSON with its scene path", async () => {
    const workspace = await makeWorkspace();
    try {
      const projectRoot = await makeUnityProject(workspace);
      const artifactPath = await makeArtifact(workspace, "gamos-cube.fbx");
      const outcome = await assetImport(
        NO_EDITOR,
        { projectRoot, artifactPath, placeInScene: { scenePath: "Assets/Scenes/Main.unity" } },
        workspace,
      );
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe("unity-editor-unavailable");
      }
      const params = JSON.parse(readFileSync(path.join(projectRoot, "Gamos", "params.json"), "utf8"));
      expect(params.placeInScene).toBe(true);
      expect(params.scenePath).toBe("Assets/Scenes/Main.unity");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("the derived default target is Assets/Gamos/gamos-asset<ext> when no targetAssetPath is given", async () => {
    const workspace = await makeWorkspace();
    try {
      const projectRoot = await makeUnityProject(workspace);
      const artifactPath = await makeArtifact(workspace, "exported-model.fbx");
      const outcome = await assetImport(NO_EDITOR, { projectRoot, artifactPath }, workspace);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe("unity-editor-unavailable");
        expect(outcome.details).toMatchObject({ targetAssetPath: "Assets/Gamos/gamos-asset.fbx" });
      }
      expect(sha256Of(path.join(projectRoot, "Assets", "Gamos", "gamos-asset.fbx"))).toBe(ARTIFACT_SHA256);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("re-staging the already-staged artifact is idempotent (same failure, same hash, one file)", async () => {
    const workspace = await makeWorkspace();
    try {
      const projectRoot = await makeUnityProject(workspace);
      const artifactPath = await makeArtifact(workspace, "gamos-cube.fbx");
      const input = {
        projectRoot,
        artifactPath,
        targetAssetPath: "Assets/Gamos/gamos-cube.fbx",
      };
      const first = await assetImport(NO_EDITOR, input, workspace);
      expect(first.ok).toBe(false);
      const stagedPath = path.join(projectRoot, "Assets", "Gamos", "gamos-cube.fbx");
      const stagedShaBefore = sha256Of(stagedPath);
      // the source artifact IS the staged file: the copy is a no-op and the
      // hash verification must still hold
      const restaged = await assetImport(
        NO_EDITOR,
        { projectRoot, artifactPath: stagedPath, targetAssetPath: "Assets/Gamos/gamos-cube.fbx" },
        workspace,
      );
      expect(restaged.ok).toBe(false);
      if (!restaged.ok) {
        expect(restaged.code).toBe("unity-editor-unavailable");
        expect(restaged.details).toMatchObject({ stagedSha256: ARTIFACT_SHA256 });
      }
      expect(sha256Of(stagedPath)).toBe(stagedShaBefore);
      expect(sha256Of(stagedPath)).toBe(ARTIFACT_SHA256);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("the committed cross-engine FBX fixture stages byte-identical with its pinned integrity record", async () => {
    const workspace = await makeWorkspace();
    try {
      const projectRoot = await makeUnityProject(workspace);
      // the real cross-engine flow: the Blender export lands inside the workspace
      const artifactPath = path.join(workspace, "gamos-cube.fbx");
      await cp(FBX_FIXTURE_PATH, artifactPath);
      const outcome = await assetImport(
        NO_EDITOR,
        {
          projectRoot,
          artifactPath,
          targetAssetPath: "Assets/Gamos/gamos-cube.fbx",
          expectedIntegrity: { byteLength: FBX_FIXTURE_BYTES, sha256: FBX_FIXTURE_SHA256 },
          placeInScene: { scenePath: "Assets/Scenes/Main.unity" },
        },
        workspace,
      );
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe("unity-editor-unavailable");
        expect(outcome.details).toMatchObject({
          stagedSha256: FBX_FIXTURE_SHA256,
          stagedBytes: FBX_FIXTURE_BYTES,
        });
      }
      expect(sha256Of(path.join(projectRoot, "Assets", "Gamos", "gamos-cube.fbx"))).toBe(FBX_FIXTURE_SHA256);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("invalid input fails closed with invalid-input (schema boundary)", async () => {
    const workspace = await makeWorkspace();
    try {
      const missingArtifact = await assetImport(NO_EDITOR, { projectRoot: "/ws/unity-project" }, workspace);
      expect(missingArtifact.ok).toBe(false);
      if (!missingArtifact.ok) {
        expect(missingArtifact.code).toBe("invalid-input");
        expect(missingArtifact.reason).toMatch(/artifactPath/);
      }
      const badTarget = await assetImport(
        NO_EDITOR,
        {
          projectRoot: path.join(workspace, "unity-project"),
          artifactPath: path.join(workspace, "a.fbx"),
          targetAssetPath: "../evil.fbx",
        },
        workspace,
      );
      expect(badTarget.ok).toBe(false);
      if (!badTarget.ok) {
        expect(badTarget.code).toBe("invalid-input");
        expect(badTarget.reason).toMatch(/targetAssetPath/);
      }
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("a symlinked Assets/Gamos staging directory inside the workspace fails closed with path-safety and writes nothing through the symlink", async () => {
    const workspace = await makeWorkspace();
    try {
      const projectRoot = await makeUnityProject(workspace);
      // Assets/Gamos -> a directory INSIDE the workspace (outside the project):
      // the workspace-level guard alone would tolerate this — the project-level
      // containment of the staging path must reject it.
      const evilDir = path.join(workspace, "evil-staging");
      await mkdir(evilDir);
      await symlink(evilDir, path.join(projectRoot, "Assets", "Gamos"));
      const artifactPath = await makeArtifact(workspace, "gamos-cube.fbx");
      const outcome = await assetImport(NO_EDITOR, { projectRoot, artifactPath }, workspace);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe("path-safety");
        expect(outcome.reason).toMatch(/escapes|outside/i);
      }
      // nothing was written through the symlink
      expect(await readdir(evilDir)).toEqual([]);
      // and no bridge/params were prepared for the redirected write
      expect(existsSync(path.join(projectRoot, "Assets", "Editor"))).toBe(false);
      expect(existsSync(path.join(projectRoot, "Gamos"))).toBe(false);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("a symlinked Assets directory outside the workspace fails closed with path-safety", async () => {
    const workspace = await makeWorkspace();
    const outside = await mkdtemp(path.join(tmpdir(), "gamos-ai-unity-evil-"));
    try {
      const projectRoot = await makeUnityProject(workspace);
      // replace the project's real Assets with a symlink out of the workspace
      // (the redirect target exists, so the project markers still inspect)
      const redirectDir = path.join(outside, "assets-redirect");
      await mkdir(redirectDir);
      await rm(path.join(projectRoot, "Assets"), { recursive: true, force: true });
      await symlink(redirectDir, path.join(projectRoot, "Assets"));
      const artifactPath = await makeArtifact(workspace, "gamos-cube.fbx");
      const outcome = await assetImport(NO_EDITOR, { projectRoot, artifactPath }, workspace);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe("path-safety");
        expect(outcome.reason).toMatch(/outside|escapes/i);
      }
      // nothing was written through the symlink
      expect(await readdir(redirectDir)).toEqual([]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
