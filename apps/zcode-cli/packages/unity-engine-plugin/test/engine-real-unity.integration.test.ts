import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { copyFile, cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { discoverUnityEditor } from "../src/discovery.js";
import { assetImport, classifyUnityBatchOutput, projectBuild, runUnityBatch, sceneModify } from "../src/engine.js";
import {
  checkUnityVersionContract,
  parseProjectVersionFile,
  parseUnityRevisionFromVersionOutput,
  type UnityProjectVersionPin,
} from "../src/typed-ops.js";

const FIXTURE_DIR = fileURLToPath(new URL("./fixture/unity-project", import.meta.url));

// The committed cross-engine FBX fixture (M3.1 target leg): a real Blender
// 4.1.1 FBX export of a cube named GamosTestCube with a material color,
// generated once through the blender plugin's reviewed bridge (bootstrap →
// typed sceneModify → assetExport FBX interchange {upAxis y, globalScale 1})
// and committed as the artifact — the record, never regenerated per run.
const FBX_FIXTURE_PATH = fileURLToPath(new URL("./fixture/gamos-cube.fbx", import.meta.url));
const FBX_FIXTURE_BYTES = 15228;
const FBX_FIXTURE_SHA256 = "ce346618c7df43efc2496ed4c5cd2f0f35c5e2be2f7a40ec34e8a9b51fe3d78d";

// ---------------------------------------------------------------------------
// Machine-readable suite evidence (M2-A): the integration suite ALWAYS writes
// its own machine facts to this file — editor discovery outcome, the exact
// version contract, the preflight license classification, and the verified
// mutation/build artifacts. The CI gate-status classifier consumes this file
// (plus the vitest JSON-reporter per-test results and the suite exit code) —
// a preflight console marker alone can never produce an editor-verified gate
// record. CI sets GAMOS_UNITY_SUITE_EVIDENCE; local runs default to tmp.
// ---------------------------------------------------------------------------
const EVIDENCE_PATH =
  typeof process.env.GAMOS_UNITY_SUITE_EVIDENCE === "string" && process.env.GAMOS_UNITY_SUITE_EVIDENCE !== ""
    ? process.env.GAMOS_UNITY_SUITE_EVIDENCE
    : path.join(tmpdir(), "gamos-unity-suite-evidence.json");

interface SuiteMachineEvidence {
  schema_version: 1;
  discovery: {
    status: string;
    executable: string | null;
    raw_version: string | null;
    reason?: string;
  };
  editor_revision: string | null;
  version_contract: {
    required_version: string;
    required_revision: string | null;
    matches: boolean;
    reason?: string;
  } | null;
  preflight: {
    exit_status: number | null;
    timed_out: boolean;
    license_classification: "license-required" | "editor-lock" | null;
    editor_licensed: boolean;
  } | null;
  scene_mutation: {
    verified: boolean;
    sha256_before: string;
    sha256_after: string;
  } | null;
  build_artifact: {
    verified: boolean;
    path: string;
    bytes: number;
    sha256: string;
  } | null;
  /** M3.1 target leg: the real-editor asset import (null = not run — honest). */
  asset_import: {
    verified: boolean;
    target_asset_path: string;
    guid: string;
    mesh_count: number;
    vertex_count: number;
    material_count: number;
    scene_saved: boolean;
    staged_sha256: string;
  } | null;
}

const evidence: SuiteMachineEvidence = {
  schema_version: 1,
  discovery: { status: "unavailable", executable: null, raw_version: null },
  editor_revision: null,
  version_contract: null,
  preflight: null,
  scene_mutation: null,
  build_artifact: null,
  asset_import: null,
};

function persistEvidence(): void {
  try {
    writeFileSync(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
  } catch (error) {
    console.log(`[gamos-evidence] could not write machine evidence to ${EVIDENCE_PATH}: ${String(error)}`);
  }
}

// ---------------------------------------------------------------------------
// Real-editor gate: these tests only mean anything against an actual Unity
// Editor. Fixture executables are NOT acceptable here — a miss is an honest
// skip per M2 directive §8 ("The absence of a real engine is an honest
// unavailable or blocked state. It is not a passing integration gate.").
// ---------------------------------------------------------------------------
const discovery = discoverUnityEditor();
const exe = discovery.executable;
const realEditorFound = discovery.status === "available" && typeof exe === "string" && exe.length > 0;

// The fixture project's exact version pin (ProjectSettings/ProjectVersion.txt):
// m_EditorVersion: 6000.0.23f1
// m_EditorVersionWithRevision: 6000.0.23f1 (ab2b18a5f80dcba39fd8f5ee57b07edc7c0f600f)
const fixtureProjectVersion: UnityProjectVersionPin | null = parseProjectVersionFile(
  readFileSync(path.join(FIXTURE_DIR, "ProjectSettings", "ProjectVersion.txt"), "utf8"),
);

/** Revision hash when the editor's own -version output exposes it (null otherwise). */
function probeEditorRevision(editor: string): string | null {
  try {
    const out = spawnSync(editor, ["-version"], {
      encoding: "utf8",
      timeout: 20_000,
      maxBuffer: 4 * 1024 * 1024,
      shell: false,
      windowsHide: true,
    });
    return parseUnityRevisionFromVersionOutput(`${out.stdout ?? ""}\n${out.stderr ?? ""}`);
  } catch {
    return null;
  }
}

const editorRevision = realEditorFound ? probeEditorRevision(exe as string) : null;
const versionContract =
  realEditorFound && fixtureProjectVersion !== null
    ? checkUnityVersionContract(discovery.rawVersion, editorRevision, fixtureProjectVersion)
    : null;
const versionCompatible = versionContract !== null && versionContract.ok;

evidence.discovery = {
  status: discovery.status,
  executable: discovery.executable,
  raw_version: discovery.rawVersion,
  ...(discovery.reason ? { reason: discovery.reason } : {}),
};
evidence.editor_revision = editorRevision;
evidence.version_contract =
  versionContract !== null && fixtureProjectVersion !== null
    ? {
        required_version: fixtureProjectVersion.version,
        required_revision: fixtureProjectVersion.revision,
        matches: versionContract.ok,
        ...(versionContract.ok ? {} : { reason: versionContract.reason }),
      }
    : null;
persistEvidence();

if (!realEditorFound) {
  console.log(
    "SKIP: real Unity Editor not available on this runner — M2-G1 integration gate NOT passing " +
      `(honest unavailable state per directive §8: status=${discovery.status}` +
      `${discovery.reason ? `, reason=${discovery.reason}` : ""}). ` +
      "HOW TO PROVISION: install the exact Unity Editor 6000.0.23f1 (the fixture project's pinned version, " +
      "revision ab2b18a5f80dcba39fd8f5ee57b07edc7c0f600f), activate it with YOUR OWN license credentials " +
      "(an external, user-controlled prerequisite — never fabricated; Unity Personal activation is Unity Hub " +
      "sign-in only, see docs/gamos/UNITY-M2G1-PROVISIONING.md), and set UNITY_EDITOR_PATH to the editor " +
      "executable (e.g. /opt/Unity/Hub/Editor/6000.0.23f1/Editor/Unity). The invocation layer in src/engine.ts " +
      "is fully real and will drive the licensed editor the moment one is provisioned.",
  );
} else if (fixtureProjectVersion === null) {
  console.log(
    "SKIP: the fixture project's ProjectVersion.txt did not parse into an exact version pin — " +
      "the version contract cannot be verified (fail closed; M2-G1 integration gate NOT passing). " +
      "This is a repository defect: the committed fixture must pin m_EditorVersion " +
      "(and m_EditorVersionWithRevision with its revision hash).",
  );
} else if (!versionCompatible) {
  console.log(
    `SKIP: real Unity Editor version-INCOMPATIBLE with the fixture contract — M2-G1 integration gate NOT passing. ` +
      `Discovered editor ${discovery.rawVersion ?? "(unparsed)"}${editorRevision ? ` (revision ${editorRevision})` : ""} ` +
      `does not match the project requirement ${fixtureProjectVersion.version}` +
      `${fixtureProjectVersion.revision ? ` (revision ${fixtureProjectVersion.revision})` : ""} exactly: ` +
      `${versionContract && !versionContract.ok ? versionContract.reason : "unknown"}. ` +
      "An incompatible editor is never a licensed or verified state (M2-B). " +
      "Install the exact editor version the fixture pins.",
  );
} else {
  console.log(`[gamos-evidence] real Unity Editor executable: ${exe}`);
  console.log(`[gamos-evidence] raw version: ${discovery.rawVersion}`);
  if (editorRevision !== null) {
    console.log(`[gamos-evidence] editor revision: ${editorRevision}`);
  }
  console.log(
    "[gamos-evidence] version contract: exact match with the fixture pin " +
      `(${fixtureProjectVersion.version}${fixtureProjectVersion.revision ? `, revision ${fixtureProjectVersion.revision}` : ""})`,
  );
  console.log(
    "[gamos-evidence] licensing is NOT probed by discovery; the pre-flight batch invocation below " +
      "classifies the runner's license state honestly (license-required is a valid, expected outcome).",
  );
}

function sha256Of(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function tail(text: string, limit = 2000): string {
  return text.length <= limit ? text : text.slice(text.length - limit);
}

// The real-editor integration tests run ONLY when a real editor was found AND
// its version exactly matches the fixture contract (M2-B).
describe.skipIf(!(realEditorFound && versionCompatible && fixtureProjectVersion !== null))(
  "unity-engine plugin real-Unity integration",
  () => {
    let workspace = "";
    let projectRoot = "";
    let sceneFile = "";
    let sceneShaBefore = "";
    // (a) pre-flight: the cheapest real batch invocation (no -executeMethod).
    //     license-required here means the runner's editor exists but is
    //     unlicensed — the honest negative path the tests below then PROVE.
    let editorLicensed = false;
    let preflightExit: number | null = null;

    beforeAll(async () => {
      workspace = await mkdtemp(path.join(tmpdir(), "gamos-unity-ws-"));
      projectRoot = path.join(workspace, "unity-project");
      await cp(FIXTURE_DIR, projectRoot, {
        recursive: true,
        // defensive: never copy generated state from the fixture checkout
        filter: (source) => !/(^|[\\/])(Library|Builds|Temp|Logs)([\\/]|$)/.test(source),
      });
      sceneFile = path.join(projectRoot, "Assets", "Scenes", "Main.unity");
      sceneShaBefore = sha256Of(sceneFile);

      const preflight = await runUnityBatch(exe as string, projectRoot, ["-quit"], { timeoutMs: 600_000 });
      preflightExit = preflight.exitStatus;
      const classification = classifyUnityBatchOutput(`${preflight.stdout}\n${preflight.stderr}`);
      editorLicensed = classification === null && preflight.exitStatus === 0;
      evidence.preflight = {
        exit_status: preflight.exitStatus,
        timed_out: preflight.timedOut,
        license_classification: classification,
        editor_licensed: editorLicensed,
      };
      persistEvidence();
      console.log(
        `[gamos-evidence] pre-flight batch (Unity -batchmode -nographics -projectPath <fixture> -quit -logFile -): ` +
          `exit=${String(preflight.exitStatus)} timedOut=${preflight.timedOut} ` +
          `licenseClassification=${classification ?? "none"} editorLicensed=${String(editorLicensed)}`,
      );
      console.log(`[gamos-evidence] pre-flight output tail:\n${tail(preflight.stdout || preflight.stderr)}`);
      if (classification === "editor-lock") {
        console.log(
          "[gamos-evidence] another Unity instance holds the project lock — not a license failure, " +
            "reported as the distinct editor-lock failure class",
        );
      }
    }, 600_000);

    afterAll(async () => {
      // Final evidence flush: whatever happened, the machine facts on disk
      // reflect the suite's own recorded state.
      persistEvidence();
      console.log(`[gamos-evidence] machine evidence written to ${EVIDENCE_PATH}`);
      if (workspace) {
        await rm(workspace, { recursive: true, force: true });
      }
    });

    // (b) test A: scene_modify — full modify + verification on a licensed editor,
    //     or the honest license-required negative path on an unlicensed one.
    test(
      "scene_modify add-cube: full modify + verification when licensed, honest license-required when not",
      async () => {
        const outcome = await sceneModify(
          exe as string,
          {
            projectRoot,
            operation: "scene.add-cube",
            parameters: {
              name: "GamosTestCube",
              location: [1, 2, 3],
              scale: [1.5, 1.5, 1.5],
              scenePath: "Assets/Scenes/Main.unity",
            },
          },
          workspace,
          { timeoutMs: 600_000 },
        );

        if (!editorLicensed) {
          expect(outcome.ok).toBe(false);
          if (!outcome.ok) {
            expect(outcome.code).toBe("license-required");
            expect(outcome.reason).toMatch(/external, user-controlled prerequisite/i);
            expect(outcome.reason).toMatch(/never fabricated/i);
            console.log(
              `[gamos-evidence] honest negative path PROVEN: scene_modify returns ${outcome.code} — ` +
                `${outcome.reason}`,
            );
          }
          return;
        }

        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;
        expect(outcome.exitStatus).toBe(0);
        expect(outcome.verification.sceneFileExists).toBe(true);
        expect(outcome.verification.methodReportedSuccess).toBe(true);
        expect(outcome.changedScene).not.toBeNull();
        if (outcome.changedScene) {
          expect(outcome.changedScene.sha256Before).toBe(sceneShaBefore);
          expect(outcome.changedScene.sha256After ?? "").toMatch(/^[0-9a-f]{64}$/);
          expect(outcome.changedScene.sha256After).not.toBe(sceneShaBefore);
          expect(outcome.changedScene.sha256After).toBe(sha256Of(sceneFile));
          // record the verified mutation as machine evidence (only after every
          // assertion above passed — an unverified mutation is never evidence)
          evidence.scene_mutation = {
            verified: true,
            sha256_before: outcome.changedScene.sha256Before,
            sha256_after: outcome.changedScene.sha256After,
          };
          persistEvidence();
        }
        // the scene file is real YAML text: the created cube is present on disk
        const sceneText = readFileSync(sceneFile, "utf8");
        expect(sceneText).toContain("GamosTestCube");
        // the copied reviewed bridge is part of the evidence
        expect(outcome.bridgeFiles.map((file) => file.name).sort()).toEqual(["GamosBuild.cs", "GamosMarker.cs"]);
        console.log(
          `[gamos-evidence] scene_modify: scene sha256 ${sceneShaBefore.slice(0, 12)}… → ` +
            `${outcome.changedScene?.sha256After?.slice(0, 12)}…, invocation: ${outcome.invocation.join(" ")}`,
        );
      },
      600_000,
    );

    // (c) test B: project_build — real player build when licensed, or the honest
    //     license-required negative path when not.
    test(
      "project_build: real StandaloneLinux64 player artifact when licensed, honest license-required when not",
      async () => {
        const outcome = await projectBuild(
          exe as string,
          { projectRoot, buildTarget: "StandaloneLinux64" },
          workspace,
          { timeoutMs: 600_000 },
        );

        if (!editorLicensed) {
          expect(outcome.ok).toBe(false);
          if (!outcome.ok) {
            expect(outcome.code).toBe("license-required");
            expect(outcome.reason).toMatch(/external, user-controlled prerequisite/i);
            console.log(
              `[gamos-evidence] honest negative path PROVEN: project_build returns ${outcome.code} — ${outcome.reason}`,
            );
          }
          return;
        }

        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;
        expect(outcome.exitStatus).toBe(0);
        expect(outcome.buildTarget).toBe("StandaloneLinux64");
        expect(existsSync(outcome.buildDir)).toBe(true);
        expect(outcome.artifact).not.toBeNull();
        if (outcome.artifact) {
          expect(outcome.artifact.bytes).toBeGreaterThan(0);
          expect(existsSync(outcome.artifact.path)).toBe(true);
          expect(outcome.artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
          expect(outcome.artifact.sha256).toBe(sha256Of(outcome.artifact.path));
          // record the verified build artifact as machine evidence (only after
          // every assertion above passed)
          evidence.build_artifact = {
            verified: true,
            path: outcome.artifact.path,
            bytes: outcome.artifact.bytes,
            sha256: outcome.artifact.sha256,
          };
          persistEvidence();
        }
        console.log(
          `[gamos-evidence] project_build: artifact ${outcome.artifact?.path} ` +
            `(${outcome.artifact?.bytes} bytes, sha256=${outcome.artifact?.sha256?.slice(0, 16)}…)`,
        );
      },
      600_000,
    );

    // (d) process-tree timeout kill — on its OWN project copy so a SIGKILLed
    //     Unity cannot leave a stale project lock for the tests above.
    test(
      "runUnityBatch with a tiny timeout kills the Unity process tree and reports a structured timeout",
      async () => {
        const killWorkspace = await mkdtemp(path.join(tmpdir(), "gamos-unity-kill-"));
        const killRoot = path.join(killWorkspace, "unity-project");
        try {
          await cp(FIXTURE_DIR, killRoot, { recursive: true });
          const run = await runUnityBatch(exe as string, killRoot, ["-quit"], { timeoutMs: 300 });
          expect(run.timedOut).toBe(true);
          expect(run.killed).toBe(true);
          expect(run.exitStatus === 0).toBe(false);
          expect(run.spawnError).toBeNull();

          const outcome = await sceneModify(
            exe as string,
            { projectRoot: killRoot, operation: "scene.add-cube" },
            killWorkspace,
            { timeoutMs: 300 },
          );
          expect(outcome.ok).toBe(false);
          if (!outcome.ok) {
            expect(outcome.code).toBe("timeout");
            expect(outcome.reason).toMatch(/timeout|killed|SIGTERM/i);
          }
        } finally {
          await rm(killWorkspace, { recursive: true, force: true });
        }
      },
      600_000,
    );

    // (e) test D (M3.1 target leg): asset_import — the real Blender→Unity
    //     interchange leg. The committed FBX fixture (with its authoritative
    //     integrity record) is copied into the workspace exactly like the real
    //     cross-engine flow (the Blender export lands inside the workspace),
    //     imported through the real editor's AssetDatabase and verified by the
    //     loaded-asset record. When the editor is unlicensed, the honest
    //     license-required negative path is what this test PROVES.
    test(
      "asset_import: real AssetDatabase import of the committed FBX fixture when licensed, honest license-required when not",
      async () => {
        // the committed fixture IS the record: byteLength and sha256 pinned
        expect(existsSync(FBX_FIXTURE_PATH)).toBe(true);
        expect(sha256Of(FBX_FIXTURE_PATH)).toBe(FBX_FIXTURE_SHA256);

        const artifactPath = path.join(workspace, "gamos-cube.fbx");
        await copyFile(FBX_FIXTURE_PATH, artifactPath);

        const outcome = await assetImport(
          exe as string,
          {
            projectRoot,
            artifactPath,
            targetAssetPath: "Assets/Gamos/gamos-cube.fbx",
            expectedIntegrity: { byteLength: FBX_FIXTURE_BYTES, sha256: FBX_FIXTURE_SHA256 },
            placeInScene: { scenePath: "Assets/Scenes/Main.unity" },
          },
          workspace,
          { timeoutMs: 600_000 },
        );

        if (!editorLicensed) {
          expect(outcome.ok).toBe(false);
          if (!outcome.ok) {
            expect(outcome.code).toBe("license-required");
            expect(outcome.reason).toMatch(/external, user-controlled prerequisite/i);
            expect(outcome.reason).toMatch(/never fabricated/i);
            console.log(
              `[gamos-evidence] honest negative path PROVEN: asset_import returns ${outcome.code} — ` +
                `${outcome.reason}`,
            );
          }
          return;
        }

        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;
        expect(outcome.imported).toBe(true);
        expect(outcome.exitStatus).toBe(0);
        // the engine-query verification: a staged file alone does not prove import
        expect(outcome.guid).toMatch(/^[0-9a-f]{32,64}$/);
        expect(outcome.meshCount).toBeGreaterThan(0);
        expect(outcome.vertexCount).toBeGreaterThan(0);
        expect(outcome.materialCount).toBeGreaterThanOrEqual(1);
        expect(outcome.subAssetNames.length).toBeGreaterThan(0);
        // the staged copy is byte-identical to the committed fixture
        expect(outcome.stagedBytes).toBe(FBX_FIXTURE_BYTES);
        expect(outcome.stagedSha256).toBe(FBX_FIXTURE_SHA256);
        expect(sha256Of(path.join(projectRoot, "Assets", "Gamos", "gamos-cube.fbx"))).toBe(
          FBX_FIXTURE_SHA256,
        );
        // the scene integration saved the instantiated object
        expect(outcome.sceneIntegrated).toBe(true);
        expect(outcome.scenePath).toBe("Assets/Scenes/Main.unity");
        const sceneText = readFileSync(sceneFile, "utf8");
        expect(sceneText).toContain("GamosImported");
        // the copied reviewed bridge (all three templates) is part of the evidence
        expect(outcome.bridgeFiles.map((file) => file.name).sort()).toEqual([
          "GamosAssetImport.cs",
          "GamosBuild.cs",
          "GamosMarker.cs",
        ]);
        // record the verified import as machine evidence (only after every
        // assertion above passed — an unverified import is never evidence)
        evidence.asset_import = {
          verified: true,
          target_asset_path: outcome.targetAssetPath,
          guid: outcome.guid,
          mesh_count: outcome.meshCount,
          vertex_count: outcome.vertexCount,
          material_count: outcome.materialCount,
          scene_saved: true,
          staged_sha256: outcome.stagedSha256,
        };
        persistEvidence();
        console.log(
          `[gamos-evidence] asset_import: ${outcome.targetAssetPath} guid=${outcome.guid.slice(0, 12)}… ` +
            `meshes=${outcome.meshCount} vertices=${outcome.vertexCount} materials=${outcome.materialCount} ` +
            `sceneSaved=true stagedSha256=${outcome.stagedSha256.slice(0, 16)}…`,
        );
      },
      600_000,
    );
  },
);
