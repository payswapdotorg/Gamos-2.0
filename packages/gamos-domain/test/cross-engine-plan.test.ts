import { describe, expect, it } from "vitest";
import { join } from "node:path";

import {
  CROSS_ENGINE_PLAN_SCHEMA_ID,
  CROSS_ENGINE_CORE_CAPABILITIES,
  M3_CROSS_ENGINE_SOURCE_COMMIT,
  buildCrossEngineAssetPlan,
} from "../src/domain/cross-engine-plan.js";
import type { CrossEnginePlanRequest } from "../src/domain/cross-engine-plan.js";
import { parseGamePlan, hashGamePlan } from "../src/domain/game-plan.js";
import type { GamePlan, GamePlanStep } from "../src/domain/game-plan.js";
import { findClaimConflicts } from "../src/domain/resource-claims.js";
import type { ResourceClaim, StepResourceClaims } from "../src/domain/resource-claims.js";
import { registerCapability, resolveCapability } from "../src/domain/capability-registry.js";
import type { CapabilityRecord } from "../src/domain/capability-registry.js";
import { registerEnginePluginCapabilities, ENGINE_PLUGIN_CAPABILITIES } from "../src/domain/engine-plugin.js";
import { buildMachineDiscoveryRecord, joinEngineState } from "../src/domain/discovery/discovery-record.js";
import type { DiscoveredEngine } from "../src/domain/discovery/discovery-record.js";
import { classifyIntent, buildGamingModelContext } from "../src/domain/intent.js";
import type { GamingModelContext } from "../src/domain/intent.js";
import { buildGamePlanWorkflowScript } from "../src/domain/plan-workflow.js";
import type { EngineFamily } from "../src/engine-family.js";

/**
 * Cross-engine asset plan builder (M3.3 — `gamos/cross-engine-plan@1`).
 *
 * buildCrossEngineAssetPlan turns a fail-closed-validated request into an
 * engine-aware GamePlan: the Blender export leg → staging manifest validation →
 * target-engine integration (babylon integrate / unity import) → project build
 * → (babylon only) runtime verification. The builder is PURE: op inputs are
 * derived as workspaceRoot-joined absolutes, every declared resource claim is a
 * canonical workspace-relative POSIX path, and the emitted plan MUST itself
 * pass parseGamePlan (including the unordered resource-claim conflict gate) —
 * the invariant that keeps the generator honest.
 */

const NOW = "2026-11-12T10:00:00Z";
const WORKSPACE_ROOT = "/workspace/gamos-pipeline";

const BABYLON_STEPS = ["export-asset", "validate-export", "integrate-asset", "build-project", "verify-runtime"] as const;
const UNITY_STEPS = ["export-asset", "validate-export", "import-asset", "build-project"] as const;

function babylonRequest(overrides: Record<string, unknown> = {}): CrossEnginePlanRequest {
  return {
    planId: "cross-engine-babylon-001",
    conceptRef: { conceptId: "concept-001", conceptSha256: "a".repeat(64) },
    acceptanceRecord: { recordId: "acc-001", recordSha256: "b".repeat(64) },
    workspaceRoot: WORKSPACE_ROOT,
    source: { projectIdentity: "source-blender", blendFile: "source-blender/hero.blend" },
    target: { engine: "babylon", projectIdentity: "target-babylon", projectRoot: "target-babylon" },
    format: "glb",
    interchange: { upAxis: "y" },
    maxConcurrency: 2,
    now: NOW,
    ...overrides,
  } as CrossEnginePlanRequest;
}

function unityRequest(format: "fbx" | "glb" = "fbx", overrides: Record<string, unknown> = {}): CrossEnginePlanRequest {
  return babylonRequest({
    planId: "cross-engine-unity-001",
    target: { engine: "unity", projectIdentity: "target-unity", projectRoot: "target-unity" },
    format,
    ...overrides,
  });
}

/** The verified Blender→Godot interchange is GLB (the WP-3 runtime-verified hop recipe). */
function godotRequest(overrides: Record<string, unknown> = {}): CrossEnginePlanRequest {
  return babylonRequest({
    planId: "cross-engine-godot-001",
    target: { engine: "godot", projectIdentity: "target-godot", projectRoot: "target-godot" },
    format: "glb",
    ...overrides,
  });
}

/**
 * The Blender→Unreal plan: the interchange artifact is exported and
 * manifest-validated, then the Unreal-side legs are the Remote Control typed
 * verification chain on the exact target object (attach → describe →
 * property-read). The unreal target fields are REQUIRED for the unreal leg
 * and rejected for every other engine (never silently ignored).
 */
function unrealRequest(overrides: Record<string, unknown> = {}): CrossEnginePlanRequest {
  return babylonRequest({
    planId: "cross-engine-unreal-001",
    target: {
      engine: "unreal",
      projectIdentity: "target-unreal",
      projectRoot: "target-unreal",
      objectPath: "/Game/Gamos/GamosAsset.GamosAsset",
      propertyNames: ["StaticMesh", "Name"],
    },
    format: "fbx",
    ...overrides,
  });
}

/** Deep key-order shuffle: every nested object's keys are reversed. */
function shuffledKeyOrder<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => shuffledKeyOrder(entry)) as unknown as T;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).reverse();
    const out: Record<string, unknown> = {};
    for (const [key, val] of entries) out[key] = shuffledKeyOrder(val);
    return out as unknown as T;
  }
  return value;
}

function claimsOf(step: GamePlanStep): readonly ResourceClaim[] {
  const claims: StepResourceClaims | undefined = step.resourceClaims;
  return claims?.claims ?? [];
}

function claimTuples(step: GamePlanStep): string[] {
  return claimsOf(step).map((c) => `${c.access} ${c.scope} ${c.path}`);
}

describe("buildCrossEngineAssetPlan — the Blender→Babylon pipeline (M3.3)", () => {
  it("emits the five pipeline steps with the exact capability ids + versions and the exact dependency chain", () => {
    const plan = buildCrossEngineAssetPlan(babylonRequest());
    expect(plan.steps.map((s) => s.stepId)).toEqual([...BABYLON_STEPS]);
    expect(plan.steps.map((s) => `${s.capability.capabilityId}@${s.capability.capabilityVersion}`)).toEqual([
      "blender/asset.export@1.0.0",
      "core/asset.manifest-validate@1.0.0",
      "babylon/asset.integrate@1.0.0",
      "babylon/project.build@1.0.0",
      "babylon/project.run@1.0.0",
    ]);
    expect(plan.steps.map((s) => s.dependsOn)).toEqual([
      [],
      ["export-asset"],
      ["validate-export"],
      ["integrate-asset"],
      ["build-project"],
    ]);
  });

  it("derives the op inputs as workspaceRoot-joined absolutes with the real op schemas (GLTF for glb, manifest convention staging/<name>.<ext>.manifest.json)", () => {
    const plan = buildCrossEngineAssetPlan(babylonRequest());
    const [exportStep, validateStep, integrateStep, buildStep, runStep] = plan.steps;

    expect(exportStep?.capability.input).toEqual({
      blendFile: join(WORKSPACE_ROOT, "source-blender/hero.blend"),
      outputPath: join(WORKSPACE_ROOT, "staging", "gamos-asset.glb"),
      format: "GLTF",
      interchange: { upAxis: "y" },
    });
    expect(validateStep?.capability.input).toEqual({
      manifestPath: join(WORKSPACE_ROOT, "staging", "gamos-asset.glb.manifest.json"),
      artifactPath: join(WORKSPACE_ROOT, "staging", "gamos-asset.glb"),
    });
    // expectedIntegrity is INTENTIONALLY absent from the plan input: it comes
    // from the manifest at runtime (the generated script instruction tells the
    // actor to read the manifest and pass its artifact record).
    expect(integrateStep?.capability.input).toEqual({
      projectRoot: join(WORKSPACE_ROOT, "target-babylon"),
      artifactPath: join(WORKSPACE_ROOT, "staging", "gamos-asset.glb"),
      assetName: "gamos-asset",
    });
    expect(integrateStep?.capability.input).not.toHaveProperty("expectedIntegrity");
    expect(buildStep?.capability.input).toEqual({ projectRoot: join(WORKSPACE_ROOT, "target-babylon") });
    expect(runStep?.capability.input).toEqual({ projectRoot: join(WORKSPACE_ROOT, "target-babylon") });
  });

  it("declares the ordered resource claims exactly (read source blend, write staging output, read staging manifest+artifact, write public/assets, read project, write dist, read project)", () => {
    const plan = buildCrossEngineAssetPlan(babylonRequest());
    const [exportStep, validateStep, integrateStep, buildStep, runStep] = plan.steps;

    expect(claimTuples(exportStep!)).toEqual([
      "read asset-path source-blender/hero.blend",
      "write generated-output staging/gamos-asset.glb",
    ]);
    expect(claimTuples(validateStep!)).toEqual([
      "read staging staging/gamos-asset.glb.manifest.json",
      "read staging staging/gamos-asset.glb",
    ]);
    expect(claimTuples(integrateStep!)).toEqual([
      "read staging staging/gamos-asset.glb",
      "write generated-output target-babylon/public/assets/gamos-asset.glb",
    ]);
    expect(claimTuples(buildStep!)).toEqual([
      "read project target-babylon",
      "write generated-output target-babylon/dist",
    ]);
    expect(claimTuples(runStep!)).toEqual(["read project target-babylon"]);

    // every step carries the versioned claim contract
    for (const step of plan.steps) {
      expect(step.resourceClaims?.schemaVersion).toBe(1);
      expect(claimsOf(step).length).toBeGreaterThan(0);
    }
  });

  it("the built plan passes parseGamePlan including the resource-claim conflict gate — the overlapping staging/project claims are ORDERED by explicit dependsOn edges", () => {
    const plan = buildCrossEngineAssetPlan(babylonRequest());
    expect(() => parseGamePlan(JSON.parse(JSON.stringify(plan)))).not.toThrow();
    const reparsed = parseGamePlan(JSON.parse(JSON.stringify(plan)));
    expect(hashGamePlan(reparsed)).toBe(hashGamePlan(plan));

    // Adversarial proof that the ordering is load-bearing: strip every
    // dependency edge and the SAME claim set fails closed at parse time.
    const unordered = plan.steps.map((step) => ({ ...step, dependsOn: [] as string[] }));
    expect(findClaimConflicts(unordered).length).toBeGreaterThan(0);
    expect(() => parseGamePlan({ ...JSON.parse(JSON.stringify(plan)), steps: unordered })).toThrow(/conflicting unordered claims/);
  });

  it("hashes deterministically — the same request and a shuffled-key-order request produce the identical plan hash", () => {
    const a = buildCrossEngineAssetPlan(babylonRequest());
    const b = buildCrossEngineAssetPlan(babylonRequest());
    expect(hashGamePlan(a)).toBe(hashGamePlan(b));

    const shuffled = buildCrossEngineAssetPlan(shuffledKeyOrder(babylonRequest()));
    expect(hashGamePlan(shuffled)).toBe(hashGamePlan(a));
  });

  it("carries the engine binding, the real capability permission union, the artifact expectations and the execution constraints", () => {
    const plan = buildCrossEngineAssetPlan(babylonRequest());

    expect(plan.engineBinding?.engineFamily).toBe("babylon");
    expect(typeof plan.engineBinding?.bindingReason).toBe("string");
    expect(plan.engineBinding?.bindingReason?.length).toBeGreaterThan(0);

    // the union the referenced capabilities declare (mirrored from the REAL
    // shipped records): engine-headless + filesystem-write (blender export),
    // read-only command (core manifest validation), public-assets staging
    // write (babylon integrate), declared-build-script (babylon build),
    // declared-dev-script + loopback network (babylon run).
    expect(plan.permissions.map((p) => `${p.kind}|${p.scope}`).sort()).toEqual(
      [
        "engine-headless|declared-workspace",
        "filesystem-write|declared-workspace",
        "command-execution|read-only",
        "filesystem-write|project-public-assets-staging",
        "command-execution|declared-build-script",
        "command-execution|declared-dev-script",
        "network-access|loopback",
      ].sort(),
    );
    for (const permission of plan.permissions) {
      expect(permission.rationale.length).toBeGreaterThan(0);
    }

    expect(plan.artifactExpectations).toEqual([
      { artifactKind: "file", verificationMethod: "artifact-hash", expectedPathPattern: "staging/gamos-asset.glb" },
      { artifactKind: "build", verificationMethod: "artifact-hash", expectedPathPattern: "target-babylon/dist" },
    ]);

    expect(plan.executionConstraints).toEqual({ maxConcurrency: 2, requiresApproval: true });
    expect(plan.createdAt).toBe(NOW);
    expect(plan.provenance.authoredBy).toBe("user-selected-model");
    expect(plan.conceptRef).toEqual({ conceptId: "concept-001", conceptSha256: "a".repeat(64) });
    expect(plan.acceptanceRecord).toEqual({ recordId: "acc-001", recordSha256: "b".repeat(64) });
  });

  it("flows custom assetName, interchange settings and maxConcurrency into the derived steps", () => {
    const request = babylonRequest({
      assetName: "hero-asset",
      interchange: { upAxis: "z", globalScale: 2.5 },
      maxConcurrency: 3,
    });
    const plan = buildCrossEngineAssetPlan(request);
    const [exportStep, validateStep, integrateStep, buildStep] = plan.steps;

    expect(exportStep?.capability.input).toMatchObject({
      outputPath: join(WORKSPACE_ROOT, "staging", "hero-asset.glb"),
      interchange: { upAxis: "z", globalScale: 2.5 },
    });
    expect(validateStep?.capability.input).toEqual({
      manifestPath: join(WORKSPACE_ROOT, "staging", "hero-asset.glb.manifest.json"),
      artifactPath: join(WORKSPACE_ROOT, "staging", "hero-asset.glb"),
    });
    expect(integrateStep?.capability.input).toMatchObject({ assetName: "hero-asset" });
    expect(claimTuples(exportStep!)).toContain("write generated-output staging/hero-asset.glb");
    expect(claimTuples(integrateStep!)).toContain("write generated-output target-babylon/public/assets/hero-asset.glb");
    expect(claimTuples(buildStep!)).toContain("write generated-output target-babylon/dist");
    expect(plan.executionConstraints).toEqual({ maxConcurrency: 3, requiresApproval: true });
    expect(plan.artifactExpectations).toEqual([
      { artifactKind: "file", verificationMethod: "artifact-hash", expectedPathPattern: "staging/hero-asset.glb" },
      { artifactKind: "build", verificationMethod: "artifact-hash", expectedPathPattern: "target-babylon/dist" },
    ]);
  });

  it("omits the export interchange block entirely when the request declares none (the exporter's applied settings are echoed by the engine, never assumed)", () => {
    const { interchange: _omitted, ...withoutInterchange } = babylonRequest();
    const plan = buildCrossEngineAssetPlan(withoutInterchange);
    expect(plan.steps[0]?.capability.input).toEqual({
      blendFile: join(WORKSPACE_ROOT, "source-blender/hero.blend"),
      outputPath: join(WORKSPACE_ROOT, "staging", "gamos-asset.glb"),
      format: "GLTF",
    });
  });

  it("guard families blender + babylon are derivable through the model context (script generation sees both legs)", () => {
    const context = makePipelineContext(true, "babylon", ["blender", "babylon"]);
    const plan = buildCrossEngineAssetPlan(babylonRequest());
    const artifact = buildGamePlanWorkflowScript(plan, context);

    expect(artifact.guards.map((g) => g.family).sort()).toEqual(["babylon", "blender"]);
    expect(artifact.guards.every((g) => g.state === "available")).toBe(true);
    // available engines → no fail-closed guard throws in the script
    expect(artifact.scriptText).not.toContain("Gamos engine guard");
    expect(artifact.stepSites.map((s) => s.stepId)).toEqual([...BABYLON_STEPS]);
  });
});

describe("buildCrossEngineAssetPlan — the Blender→Unity pipeline (M3.3)", () => {
  it("emits the four pipeline steps (no runtime step — the player build IS the terminal verification)", () => {
    const plan = buildCrossEngineAssetPlan(unityRequest("fbx"));
    expect(plan.steps.map((s) => s.stepId)).toEqual([...UNITY_STEPS]);
    expect(plan.steps.map((s) => `${s.capability.capabilityId}@${s.capability.capabilityVersion}`)).toEqual([
      "blender/asset.export@1.0.0",
      "core/asset.manifest-validate@1.0.0",
      "unity/asset.import@1.0.0",
      "unity/project.build@1.0.0",
    ]);
    expect(plan.steps.map((s) => s.dependsOn)).toEqual([
      [],
      ["export-asset"],
      ["validate-export"],
      ["import-asset"],
    ]);
    expect(plan.engineBinding?.engineFamily).toBe("unity");
  });

  it("the import leg carries targetAssetPath + placeInScene, the build leg carries buildTarget StandaloneLinux64, and FBX flows through the artifact paths", () => {
    const plan = buildCrossEngineAssetPlan(unityRequest("fbx"));
    const [exportStep, validateStep, importStep, buildStep] = plan.steps;

    expect(exportStep?.capability.input).toMatchObject({
      outputPath: join(WORKSPACE_ROOT, "staging", "gamos-asset.fbx"),
      format: "FBX",
    });
    expect(validateStep?.capability.input).toEqual({
      manifestPath: join(WORKSPACE_ROOT, "staging", "gamos-asset.fbx.manifest.json"),
      artifactPath: join(WORKSPACE_ROOT, "staging", "gamos-asset.fbx"),
    });
    expect(importStep?.capability.input).toEqual({
      projectRoot: join(WORKSPACE_ROOT, "target-unity"),
      artifactPath: join(WORKSPACE_ROOT, "staging", "gamos-asset.fbx"),
      targetAssetPath: "Assets/Gamos/gamos-asset.fbx",
      placeInScene: { scenePath: "Assets/Scenes/GamosScene.unity" },
    });
    expect(buildStep?.capability.input).toEqual({
      projectRoot: join(WORKSPACE_ROOT, "target-unity"),
      buildTarget: "StandaloneLinux64",
    });

    expect(claimTuples(importStep!)).toEqual([
      "read staging staging/gamos-asset.fbx",
      "write generated-output target-unity/Assets/Gamos/gamos-asset.fbx",
      "write scene target-unity/Assets/Scenes/GamosScene.unity",
    ]);
    expect(claimTuples(buildStep!)).toEqual([
      "read project target-unity",
      "write generated-output target-unity/Builds",
    ]);
  });

  it("unity also accepts the glb interchange format (GLTF op format, .glb artifact and targetAssetPath)", () => {
    const plan = buildCrossEngineAssetPlan(unityRequest("glb"));
    const [exportStep, validateStep, importStep] = plan.steps;
    expect(exportStep?.capability.input).toMatchObject({ format: "GLTF" });
    expect(validateStep?.capability.input).toMatchObject({
      artifactPath: join(WORKSPACE_ROOT, "staging", "gamos-asset.glb"),
    });
    expect(importStep?.capability.input).toMatchObject({ targetAssetPath: "Assets/Gamos/gamos-asset.glb" });
    expect(claimTuples(importStep!)).toContain("write generated-output target-unity/Assets/Gamos/gamos-asset.glb");
  });

  it("the unity artifact expectations include the scene expectation (engine-query) and the Builds pattern; the permission union carries no babylon run permissions", () => {
    const plan = buildCrossEngineAssetPlan(unityRequest("fbx"));
    expect(plan.artifactExpectations).toEqual([
      { artifactKind: "file", verificationMethod: "artifact-hash", expectedPathPattern: "staging/gamos-asset.fbx" },
      { artifactKind: "build", verificationMethod: "artifact-hash", expectedPathPattern: "target-unity/Builds" },
      { artifactKind: "scene", verificationMethod: "engine-query", expectedPathPattern: "target-unity/Assets/Scenes/GamosScene.unity" },
    ]);
    const kinds = plan.permissions.map((p) => `${p.kind}|${p.scope}`).sort();
    expect(kinds).toEqual(
      [
        "engine-headless|declared-workspace",
        "filesystem-write|declared-workspace",
        "command-execution|read-only",
      ].sort(),
    );
    expect(kinds).not.toContain("network-access|loopback");
    expect(kinds).not.toContain("command-execution|declared-dev-script");
  });

  it("guard families blender + unity are derivable through the model context", () => {
    const context = makePipelineContext(true, "unity", ["blender", "unity"]);
    const plan = buildCrossEngineAssetPlan(unityRequest("fbx"));
    const artifact = buildGamePlanWorkflowScript(plan, context);
    expect(artifact.guards.map((g) => g.family).sort()).toEqual(["blender", "unity"]);
    expect(artifact.stepSites.map((s) => s.stepId)).toEqual([...UNITY_STEPS]);
  });
});

const GODOT_STEPS = ["export-asset", "validate-export", "import-asset", "build-project", "verify-runtime"] as const;
const UNREAL_STEPS = ["export-asset", "validate-export", "attach-editor", "describe-target", "verify-target"] as const;

describe("buildCrossEngineAssetPlan — the Blender→Godot pipeline (M4 WP-7)", () => {
  it("emits the five hop-chain steps with the exact capability ids + versions and the exact dependency chain", () => {
    const plan = buildCrossEngineAssetPlan(godotRequest());
    expect(plan.steps.map((s) => s.stepId)).toEqual([...GODOT_STEPS]);
    expect(plan.steps.map((s) => s.capability.capabilityId)).toEqual([
      "blender/asset.export",
      "core/asset.manifest-validate",
      "godot/asset.import",
      "godot/project.build",
      "godot/project.run",
    ]);
    expect(plan.steps.every((s) => s.capability.capabilityVersion === "1.0.0")).toBe(true);
    expect(plan.steps.map((s) => s.dependsOn)).toEqual([[], ["export-asset"], ["validate-export"], ["import-asset"], ["build-project"]]);
    expect(plan.engineBinding.engineFamily).toBe("godot");
  });

  it("derives the godot op inputs as workspaceRoot-joined absolutes — the WP-3 runtime-verified recipe (asset.import source/target, project.build preset LinuxX11 + pre-created builds dir, project.run quitAfterFrames 3)", () => {
    const plan = buildCrossEngineAssetPlan(godotRequest());
    const [exportStep, validateStep, importStep, buildStep, runStep] = plan.steps;

    expect(exportStep.capability.input).toEqual({
      blendFile: join(WORKSPACE_ROOT, "source-blender/hero.blend"),
      outputPath: join(WORKSPACE_ROOT, "staging", "gamos-asset.glb"),
      format: "GLTF",
      interchange: { upAxis: "y" },
    });
    expect(validateStep.capability.input).toEqual({
      manifestPath: join(WORKSPACE_ROOT, "staging", "gamos-asset.glb.manifest.json"),
      artifactPath: join(WORKSPACE_ROOT, "staging", "gamos-asset.glb"),
    });
    expect(importStep.capability.input).toEqual({
      projectRoot: join(WORKSPACE_ROOT, "target-godot"),
      sourcePath: join(WORKSPACE_ROOT, "staging", "gamos-asset.glb"),
      targetAssetPath: join(WORKSPACE_ROOT, "target-godot", "assets", "gamos-asset.glb"),
    });
    expect(buildStep.capability.input).toEqual({
      projectRoot: join(WORKSPACE_ROOT, "target-godot"),
      preset: "LinuxX11",
      outPath: join(WORKSPACE_ROOT, "builds"),
    });
    expect(runStep.capability.input).toEqual({
      projectRoot: join(WORKSPACE_ROOT, "target-godot"),
      quitAfterFrames: 3,
    });
  });

  it("declares the ordered resource claims exactly (read blend, write staging, read manifest+artifact, read staging + write imported asset, read project + write builds, read project)", () => {
    const plan = buildCrossEngineAssetPlan(godotRequest());
    expect(claimTuples(plan.steps[0]!)).toEqual([
      `read asset-path source-blender/hero.blend`,
      `write generated-output staging/gamos-asset.glb`,
    ]);
    expect(claimTuples(plan.steps[1]!)).toEqual([
      `read staging staging/gamos-asset.glb.manifest.json`,
      `read staging staging/gamos-asset.glb`,
    ]);
    expect(claimTuples(plan.steps[2]!)).toEqual([
      `read staging staging/gamos-asset.glb`,
      `write generated-output target-godot/assets/gamos-asset.glb`,
    ]);
    expect(claimTuples(plan.steps[3]!)).toEqual([
      `read project target-godot`,
      `write generated-output builds`,
    ]);
    expect(claimTuples(plan.steps[4]!)).toEqual([`read project target-godot`]);
  });

  it("the built plan passes parseGamePlan including the resource-claim conflict gate — the overlapping staging/project claims are ORDERED by explicit dependsOn edges", () => {
    const plan = buildCrossEngineAssetPlan(godotRequest());
    expect(() => parseGamePlan(JSON.parse(JSON.stringify(plan)))).not.toThrow();
    const reparsed = parseGamePlan(JSON.parse(JSON.stringify(plan)));
    expect(hashGamePlan(reparsed)).toBe(hashGamePlan(plan));

    // Adversarial proof that the ordering is load-bearing: strip every
    // dependency edge and the SAME claim set fails closed at parse time.
    const unordered = plan.steps.map((step) => ({ ...step, dependsOn: [] as string[] }));
    expect(findClaimConflicts(unordered).length).toBeGreaterThan(0);
    expect(() => parseGamePlan({ ...JSON.parse(JSON.stringify(plan)), steps: unordered })).toThrow(/conflicting unordered claims/);
  });

  it("hashes deterministically — the same request and a shuffled-key-order request produce the identical plan hash", () => {
    const a = buildCrossEngineAssetPlan(godotRequest());
    const b = buildCrossEngineAssetPlan(shuffledKeyOrder(godotRequest()));
    expect(hashGamePlan(b)).toBe(hashGamePlan(a));
  });

  it("carries the engine binding, the godot permission union (engine-headless + filesystem-write + manifest read-only), the artifact expectations (staging + build)", () => {
    const plan = buildCrossEngineAssetPlan(godotRequest());
    expect(plan.engineBinding.engineFamily).toBe("godot");
    expect(plan.engineBinding.bindingReason).toContain("godot");
    expect(plan.permissions).toEqual([
      { kind: "engine-headless", scope: "declared-workspace", rationale: "typed engine operation through the real engine executable in headless/batch mode (existing permission-gated agent execution)" },
      { kind: "filesystem-write", scope: "declared-workspace", rationale: "the typed operation persists engine files (scene/project/artifact) inside the declared workspace" },
      { kind: "command-execution", scope: "read-only", rationale: "reads the interchange manifest and the exported artifact for validation only (no writes, no engine execution)" },
    ]);
    expect(plan.artifactExpectations).toEqual([
      { artifactKind: "file", verificationMethod: "artifact-hash", expectedPathPattern: "staging/gamos-asset.glb" },
      { artifactKind: "build", verificationMethod: "artifact-hash", expectedPathPattern: "builds" },
    ]);
  });

  it("guard families blender + godot are derivable through the model context (the hop's script generation sees both legs)", () => {
    const context = makePipelineContext(true, "godot", ["blender", "godot"]);
    const plan = buildCrossEngineAssetPlan(godotRequest());
    const artifact = buildGamePlanWorkflowScript(plan, context);
    expect(artifact.guards.map((g) => g.family).sort()).toEqual(["blender", "godot"]);
    expect(artifact.guards.every((g) => g.state === "available")).toBe(true);
    expect(artifact.scriptText).not.toContain("Gamos engine guard");
    expect(artifact.stepSites.map((s) => s.stepId)).toEqual([...GODOT_STEPS]);
  });

  it("the generated script instructs the manifest handoff for the godot import leg (derived manifest path + expectedIntegrity — the manifest is the integrity authority)", () => {
    const context = makePipelineContext(true, "godot", ["blender", "godot"]);
    const plan = buildCrossEngineAssetPlan(godotRequest());
    const artifact = buildGamePlanWorkflowScript(plan, context);
    expect(artifact.scriptText).toContain(join(WORKSPACE_ROOT, "staging", "gamos-asset.glb.manifest.json"));
    expect(artifact.scriptText).toContain("expectedIntegrity");
    expect(artifact.scriptText).toContain("byteLength");
    expect(artifact.scriptText).toContain("sha256");
  });

  it("flows custom assetName and interchange settings into the derived godot legs (assets/<name>.glb, interchange upAxis z + globalScale)", () => {
    const plan = buildCrossEngineAssetPlan(
      godotRequest({ assetName: "hero-asset", interchange: { upAxis: "z", globalScale: 0.01 }, maxConcurrency: 4 }),
    );
    expect(plan.steps[0]!.capability.input).toMatchObject({
      outputPath: join(WORKSPACE_ROOT, "staging", "hero-asset.glb"),
      format: "GLTF",
      interchange: { upAxis: "z", globalScale: 0.01 },
    });
    expect(plan.steps[2]!.capability.input).toMatchObject({
      sourcePath: join(WORKSPACE_ROOT, "staging", "hero-asset.glb"),
      targetAssetPath: join(WORKSPACE_ROOT, "target-godot", "assets", "hero-asset.glb"),
    });
    expect(plan.executionConstraints).toEqual({ maxConcurrency: 4, requiresApproval: true });
  });
});

describe("buildCrossEngineAssetPlan — the Blender→Unreal pipeline (M4 WP-7)", () => {
  it("emits the five RC verification-chain steps with the exact capability ids + versions and the exact dependency chain", () => {
    const plan = buildCrossEngineAssetPlan(unrealRequest());
    expect(plan.steps.map((s) => s.stepId)).toEqual([...UNREAL_STEPS]);
    expect(plan.steps.map((s) => s.capability.capabilityId)).toEqual([
      "blender/asset.export",
      "core/asset.manifest-validate",
      "unreal/connection.inspect",
      "unreal/object.inspect",
      "unreal/property.read",
    ]);
    expect(plan.steps.every((s) => s.capability.capabilityVersion === "1.0.0")).toBe(true);
    expect(plan.steps.map((s) => s.dependsOn)).toEqual([[], ["export-asset"], ["validate-export"], ["attach-editor"], ["describe-target"]]);
    expect(plan.engineBinding.engineFamily).toBe("unreal");
  });

  it("derives the unreal op inputs: attach carries the discovered-endpoint default (no fabricated endpoint), describe/verify carry the validated objectPath + propertyNames", () => {
    const plan = buildCrossEngineAssetPlan(unrealRequest());
    const [, , attachStep, describeStep, verifyStep] = plan.steps;

    expect(attachStep.capability.input).toEqual({});
    expect(describeStep.capability.input).toEqual({ objectPath: "/Game/Gamos/GamosAsset.GamosAsset" });
    expect(verifyStep.capability.input).toEqual({
      objectPath: "/Game/Gamos/GamosAsset.GamosAsset",
      propertyNames: ["StaticMesh", "Name"],
    });
  });

  it("the RC legs carry NO resource claims (network ops touch no workspace files) and the plan parses clean through the conflict gate", () => {
    const plan = buildCrossEngineAssetPlan(unrealRequest());
    expect(plan.steps[2]!.resourceClaims).toBeUndefined();
    expect(plan.steps[3]!.resourceClaims).toBeUndefined();
    expect(plan.steps[4]!.resourceClaims).toBeUndefined();
    expect(() => parseGamePlan(JSON.parse(JSON.stringify(plan)))).not.toThrow();
    const reparsed = parseGamePlan(JSON.parse(JSON.stringify(plan)));
    expect(hashGamePlan(reparsed)).toBe(hashGamePlan(plan));
    expect(claimTuples(plan.steps[0]!)).toEqual([
      `read asset-path source-blender/hero.blend`,
      `write generated-output staging/gamos-asset.fbx`,
    ]);
    expect(claimTuples(plan.steps[1]!)).toEqual([
      `read staging staging/gamos-asset.fbx.manifest.json`,
      `read staging staging/gamos-asset.fbx`,
    ]);

    // The export→validate read/write overlap is ordered by the explicit edge;
    // stripping it fails closed at parse time (the ordering is load-bearing).
    const unordered = plan.steps.map((step) => ({ ...step, dependsOn: [] as string[] }));
    expect(findClaimConflicts(unordered).length).toBeGreaterThan(0);
    expect(() => parseGamePlan({ ...JSON.parse(JSON.stringify(plan)), steps: unordered })).toThrow(/conflicting unordered claims/);
  });

  it("carries the engine binding, the unreal permission union (engine-headless + filesystem-write + manifest read-only + loopback-rc-endpoint) and the staging artifact expectation", () => {
    const plan = buildCrossEngineAssetPlan(unrealRequest());
    expect(plan.engineBinding.engineFamily).toBe("unreal");
    expect(plan.engineBinding.bindingReason).toContain("unreal");
    expect(plan.permissions).toEqual([
      { kind: "engine-headless", scope: "declared-workspace", rationale: "typed engine operation through the real engine executable in headless/batch mode (existing permission-gated agent execution)" },
      { kind: "filesystem-write", scope: "declared-workspace", rationale: "the typed operation persists engine files (scene/project/artifact) inside the declared workspace" },
      { kind: "command-execution", scope: "read-only", rationale: "reads the interchange manifest and the exported artifact for validation only (no writes, no engine execution)" },
      {
        kind: "network-access",
        scope: "loopback-rc-endpoint",
        rationale:
          "read-only requests against the verified loopback Remote Control listener (GET /remote/info, typed object describe, typed property reads); the Passphrase header is a transport-compatibility token only, never claimed as server-side authentication (readiness §2.2 U-T2)",
      },
    ]);
    expect(plan.artifactExpectations).toEqual([
      { artifactKind: "file", verificationMethod: "artifact-hash", expectedPathPattern: "staging/gamos-asset.fbx" },
    ]);
  });

  it("the unreal leg also accepts the glb interchange format (the unreal legs verify the target editor; no unreal record constrains the artifact format)", () => {
    const plan = buildCrossEngineAssetPlan(unrealRequest({ format: "glb" }));
    expect(plan.steps[0]!.capability.input).toMatchObject({ format: "GLTF", outputPath: join(WORKSPACE_ROOT, "staging", "gamos-asset.glb") });
    expect(plan.artifactExpectations).toEqual([
      { artifactKind: "file", verificationMethod: "artifact-hash", expectedPathPattern: "staging/gamos-asset.glb" },
    ]);
  });

  it("guard families blender + unreal are derivable through the model context", () => {
    const context = makePipelineContext(true, "unreal", ["blender", "unreal"]);
    const plan = buildCrossEngineAssetPlan(unrealRequest());
    const artifact = buildGamePlanWorkflowScript(plan, context);
    expect(artifact.guards.map((g) => g.family).sort()).toEqual(["blender", "unreal"]);
    expect(artifact.guards.every((g) => g.state === "available")).toBe(true);
    expect(artifact.stepSites.map((s) => s.stepId)).toEqual([...UNREAL_STEPS]);
  });

  it("the generated script does NOT instruct a manifest handoff for the unreal legs (no manifest consumer — never fabricate a reference)", () => {
    const context = makePipelineContext(true, "unreal", ["blender", "unreal"]);
    const plan = buildCrossEngineAssetPlan(unrealRequest());
    const artifact = buildGamePlanWorkflowScript(plan, context);
    expect(artifact.scriptText).not.toContain("expectedIntegrity");
  });

  it("hashes deterministically — the same request and a shuffled-key-order request produce the identical plan hash", () => {
    const a = buildCrossEngineAssetPlan(unrealRequest());
    const b = buildCrossEngineAssetPlan(shuffledKeyOrder(unrealRequest()));
    expect(hashGamePlan(b)).toBe(hashGamePlan(a));
  });
});

describe("buildCrossEngineAssetPlan — engine-family version grammar checks (M4 WP-7)", () => {
  it("the godot version predicate >=4.2 evaluates through the family grammar (4.2.2.stable.official.15073afe3 available; 3.5.stable.official fails the predicate honestly)", () => {
    const available = joinEngineState(
      { schemaVersion: 2, workspacePath: WORKSPACE_ROOT, engineBindings: [{ engineFamily: "godot" as const, versionPredicate: ">=4.2" }] },
      buildMachineDiscoveryRecord(
        WORKSPACE_ROOT,
        [{ engineFamily: "godot", installed: true, rawVersion: "4.2.2.stable.official.15073afe3", headlessCapable: true, displayServerRequired: false }],
        { platform: "linux", arch: "x64" },
        NOW,
      ),
    );
    expect(available[0]!.state).toBe("available");

    const tooOld = joinEngineState(
      { schemaVersion: 2, workspacePath: WORKSPACE_ROOT, engineBindings: [{ engineFamily: "godot" as const, versionPredicate: ">=4.2" }] },
      buildMachineDiscoveryRecord(
        WORKSPACE_ROOT,
        [{ engineFamily: "godot", installed: true, rawVersion: "3.5.stable.official", headlessCapable: true, displayServerRequired: false }],
        { platform: "linux", arch: "x64" },
        NOW,
      ),
    );
    expect(tooOld[0]!.state).toBe("unavailable");
    expect(tooOld[0]!.reason).toContain("does not satisfy");
  });

  it("the unreal version predicate >=5.3 evaluates through the family grammar (5.3.2-1234567 available; 4.27 fails the predicate honestly)", () => {
    const available = joinEngineState(
      { schemaVersion: 2, workspacePath: WORKSPACE_ROOT, engineBindings: [{ engineFamily: "unreal" as const, versionPredicate: ">=5.3" }] },
      buildMachineDiscoveryRecord(
        WORKSPACE_ROOT,
        [{ engineFamily: "unreal", installed: true, rawVersion: "5.3.2-1234567", headlessCapable: true, displayServerRequired: false }],
        { platform: "linux", arch: "x64" },
        NOW,
      ),
    );
    expect(available[0]!.state).toBe("available");

    const tooOld = joinEngineState(
      { schemaVersion: 2, workspacePath: WORKSPACE_ROOT, engineBindings: [{ engineFamily: "unreal" as const, versionPredicate: ">=5.3" }] },
      buildMachineDiscoveryRecord(
        WORKSPACE_ROOT,
        [{ engineFamily: "unreal", installed: true, rawVersion: "4.27.0-1234567", headlessCapable: true, displayServerRequired: false }],
        { platform: "linux", arch: "x64" },
        NOW,
      ),
    );
    expect(tooOld[0]!.state).toBe("unavailable");
    expect(tooOld[0]!.reason).toContain("does not satisfy");
  });

  it("the godot guard fails closed when the discovered raw version is unparseable (JOIN yields unknown — never treated as compatible)", () => {
    const states = joinEngineState(
      { schemaVersion: 2, workspacePath: WORKSPACE_ROOT, engineBindings: [{ engineFamily: "godot" as const, versionPredicate: ">=4.2" }] },
      buildMachineDiscoveryRecord(
        WORKSPACE_ROOT,
        [{ engineFamily: "godot", installed: true, rawVersion: "not-a-godot-version", headlessCapable: true, displayServerRequired: false }],
        { platform: "linux", arch: "x64" },
        NOW,
      ),
    );
    expect(states[0]!.state).toBe("unknown");
    expect(states[0]!.reason).toContain("fail closed");
  });

  it("the unreal guard fails closed when the version predicate cannot be evaluated (unparseable raw — JOIN yields unknown)", () => {
    const states = joinEngineState(
      { schemaVersion: 2, workspacePath: WORKSPACE_ROOT, engineBindings: [{ engineFamily: "unreal" as const, versionPredicate: ">=5.3" }] },
      buildMachineDiscoveryRecord(
        WORKSPACE_ROOT,
        [{ engineFamily: "unreal", installed: true, rawVersion: "garbage-version-string", headlessCapable: true, displayServerRequired: false }],
        { platform: "linux", arch: "x64" },
        NOW,
      ),
    );
    expect(states[0]!.state).toBe("unknown");
    expect(states[0]!.reason).toContain("fail closed");
  });

  it("an unavailable godot engine yields a fail-closed guard in the generated script (the M4-G3 discipline: compilation throws before any step)", () => {
    const context = makePipelineContext(false, "godot", ["blender", "godot"]);
    const plan = buildCrossEngineAssetPlan(godotRequest());
    expect(() => buildGamePlanWorkflowScript(plan, context)).toThrow(/Gamos engine guard/);
  });

  it("an unavailable unreal engine (rc-endpoint-absent) yields a fail-closed guard in the generated script", () => {
    const context = makePipelineContext(false, "unreal", ["blender", "unreal"]);
    const plan = buildCrossEngineAssetPlan(unrealRequest());
    expect(() => buildGamePlanWorkflowScript(plan, context)).toThrow(/Gamos engine guard/);
  });
});

describe("buildCrossEngineAssetPlan — no silent engine substitution (M4 WP-7)", () => {
  it("rejects unknown target engines with the honest four-leg message (the reworded fail-closed error)", () => {
    expect(() => buildCrossEngineAssetPlan(godotRequest({ target: { engine: "cryengine" as unknown as "godot", projectIdentity: "t", projectRoot: "t" } }))).toThrow(
      /must be one of unity\|babylon\|godot\|unreal \(the cross-engine asset pipeline ships exactly these four target legs\)/,
    );
  });

  it("the request target engine is never rewritten — a godot plan binds godot and an unreal plan binds unreal (no cross-binding, no substitution)", () => {
    expect(buildCrossEngineAssetPlan(godotRequest()).engineBinding.engineFamily).toBe("godot");
    expect(buildCrossEngineAssetPlan(unrealRequest()).engineBinding.engineFamily).toBe("unreal");
    expect(buildCrossEngineAssetPlan(godotRequest()).steps.map((s) => s.capability.capabilityId)).not.toContain("unreal/connection.inspect");
    expect(buildCrossEngineAssetPlan(unrealRequest()).steps.map((s) => s.capability.capabilityId)).not.toContain("godot/asset.import");
  });

  it("rejects the unreal-only target fields on every other engine (objectPath/propertyNames are never silently ignored)", () => {
    for (const engine of ["babylon", "unity", "godot"] as const) {
      const target = { engine, projectIdentity: "t", projectRoot: "t", objectPath: "/Game/Gamos/GamosAsset.GamosAsset", propertyNames: ["Name"] };
      expect(() => buildCrossEngineAssetPlan(babylonRequest({ target }))).toThrow(/target\.objectPath.*unreal/);
    }
  });

  it("requires the unreal target fields — missing objectPath or propertyNames fails closed with the honest reason", () => {
    expect(() =>
      buildCrossEngineAssetPlan(unrealRequest({ target: { engine: "unreal", projectIdentity: "t", projectRoot: "t" } })),
    ).toThrow(/target\.objectPath/);
    expect(() =>
      buildCrossEngineAssetPlan(unrealRequest({ target: { engine: "unreal", projectIdentity: "t", projectRoot: "t", objectPath: "/Game/Gamos/GamosAsset.GamosAsset" } })),
    ).toThrow(/target\.propertyNames/);
  });

  it("rejects malformed object paths (relative, traversal, empty segment, query/credential syntax, whitespace, oversize) — the domain planning floor mirrors the plugin grammar fail-closed", () => {
    const malformed = [
      "Game/Gamos/Asset", // relative — not absolute
      "/Game/../Gamos/Asset", // traversal segment
      "/Game//Gamos/Asset", // empty segment
      "/Game/Gamos/Asset?query=1", // query-string syntax
      "/Game/Gamos/Asset%20x", // URL-encoding
      "/Game/Gamos/user@host/Asset", // credential syntax
      "/Game/Gamos/My Asset", // whitespace
      "/Game/Gamos/" + "a".repeat(600), // oversize
      "/\\Game/Gamos/Asset", // backslash separator
    ];
    for (const objectPath of malformed) {
      expect(() => buildCrossEngineAssetPlan(unrealRequest({ target: { engine: "unreal", projectIdentity: "t", projectRoot: "t", objectPath, propertyNames: ["Name"] } }))).toThrow(
        /target\.objectPath/,
      );
    }
  });

  it("rejects malformed propertyNames (non-identifier names, empty array, duplicates, non-array)", () => {
    const bad = [
      ["bad-name"], // hyphen — outside the identifier grammar
      ["9starts-with-digit"],
      [""], // empty name
      ["a".repeat(129)], // oversize
      ["Name", "Name"], // duplicates — the read set is exact
    ];
    for (const propertyNames of bad) {
      expect(() =>
        buildCrossEngineAssetPlan(unrealRequest({ target: { engine: "unreal", projectIdentity: "t", projectRoot: "t", objectPath: "/Game/Gamos/GamosAsset.GamosAsset", propertyNames } })),
      ).toThrow(/target\.propertyNames/);
    }
    expect(() =>
      buildCrossEngineAssetPlan(unrealRequest({ target: { engine: "unreal", projectIdentity: "t", projectRoot: "t", objectPath: "/Game/Gamos/GamosAsset.GamosAsset", propertyNames: "Name" } })),
    ).toThrow(/target\.propertyNames/);
    expect(() =>
      buildCrossEngineAssetPlan(unrealRequest({ target: { engine: "unreal", projectIdentity: "t", projectRoot: "t", objectPath: "/Game/Gamos/GamosAsset.GamosAsset", propertyNames: [] } })),
    ).toThrow(/target\.propertyNames/);
  });

  it("rejects the Godot target with the fbx format — the verified Blender→Godot interchange is GLB (the WP-3 runtime-verified hop recipe)", () => {
    expect(() => buildCrossEngineAssetPlan(godotRequest({ format: "fbx" }))).toThrow(
      /target engine "godot" cannot consume "fbx".*the WP-3 runtime-verified Blender→Godot hop is GLB.*request format "glb"/,
    );
  });
});

describe("buildCrossEngineAssetPlan — fail-closed request validation (M3.3)", () => {
  it("rejects the Babylon target with the fbx format — the Babylon asset integration consumes GLB only", () => {
    expect(() => buildCrossEngineAssetPlan(unityRequest("fbx", { target: { engine: "babylon", projectIdentity: "target-babylon", projectRoot: "target-babylon" } }))).toThrow(
      /GAMOS\/CROSS-ENGINE-PLAN:.*the Babylon asset integration consumes GLB only/,
    );
  });

  it("rejects traversal in the relative path fields and in the workspace root", () => {
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ source: { projectIdentity: "source-blender", blendFile: "source-blender/../escape.blend" } }))).toThrow(/GAMOS\/CROSS-ENGINE-PLAN:/);
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ source: { projectIdentity: "../evil", blendFile: "source-blender/hero.blend" } }))).toThrow(/GAMOS\/CROSS-ENGINE-PLAN:/);
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ target: { engine: "babylon", projectIdentity: "target-babylon", projectRoot: "target-babylon/../outside" } }))).toThrow(/GAMOS\/CROSS-ENGINE-PLAN:/);
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ workspaceRoot: "/workspace/gamos-pipeline/../evil" }))).toThrow(/GAMOS\/CROSS-ENGINE-PLAN:/);
  });

  it("rejects absolute paths and non-canonical relative paths in the relative fields", () => {
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ source: { projectIdentity: "source-blender", blendFile: "/abs/hero.blend" } }))).toThrow(/GAMOS\/CROSS-ENGINE-PLAN:/);
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ target: { engine: "babylon", projectIdentity: "target-babylon", projectRoot: "/abs/target" } }))).toThrow(/GAMOS\/CROSS-ENGINE-PLAN:/);
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ source: { projectIdentity: "source-blender", blendFile: "./source-blender/hero.blend" } }))).toThrow(/GAMOS\/CROSS-ENGINE-PLAN:/);
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ source: { projectIdentity: "source-blender", blendFile: "source-blender\\hero.blend" } }))).toThrow(/GAMOS\/CROSS-ENGINE-PLAN:/);
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ source: { projectIdentity: "source-blender", blendFile: "source-blender/hero blend.blend" } }))).toThrow(/GAMOS\/CROSS-ENGINE-PLAN:/);
  });

  it("rejects a non-absolute or non-canonical workspace root", () => {
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ workspaceRoot: "workspace/gamos-pipeline" }))).toThrow(/GAMOS\/CROSS-ENGINE-PLAN:/);
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ workspaceRoot: "/workspace/gamos-pipeline/" }))).toThrow(/GAMOS\/CROSS-ENGINE-PLAN:/);
  });

  it("rejects malformed planId / assetName identifiers", () => {
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ planId: "Bad_Plan" }))).toThrow(/GAMOS\/CROSS-ENGINE-PLAN:/);
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ planId: "" }))).toThrow(/GAMOS\/CROSS-ENGINE-PLAN:/);
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ planId: "-leading-dash" }))).toThrow(/GAMOS\/CROSS-ENGINE-PLAN:/);
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ assetName: "Hero Asset" }))).toThrow(/GAMOS\/CROSS-ENGINE-PLAN:/);
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ assetName: "UPPER" }))).toThrow(/GAMOS\/CROSS-ENGINE-PLAN:/);
  });

  it("rejects non-ISO-8601 now values (the caller supplies it so the plan hash is deterministic)", () => {
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ now: "2026-11-12" }))).toThrow(/GAMOS\/CROSS-ENGINE-PLAN:/);
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ now: "not-a-date" }))).toThrow(/GAMOS\/CROSS-ENGINE-PLAN:/);
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ now: "November 12, 2026 10:00 AM" }))).toThrow(/GAMOS\/CROSS-ENGINE-PLAN:/);
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ now: "2026-13-45T99:99:99Z" }))).toThrow(/GAMOS\/CROSS-ENGINE-PLAN:/);
  });

  it("rejects non-positive-integer maxConcurrency", () => {
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ maxConcurrency: 0 }))).toThrow(/GAMOS\/CROSS-ENGINE-PLAN:/);
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ maxConcurrency: -1 }))).toThrow(/GAMOS\/CROSS-ENGINE-PLAN:/);
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ maxConcurrency: 1.5 }))).toThrow(/GAMOS\/CROSS-ENGINE-PLAN:/);
  });

  it("rejects missing required fields at every level", () => {
    const cases: Record<string, unknown>[] = [
      { ...babylonRequest(), target: undefined },
      { ...babylonRequest(), format: undefined },
      { ...babylonRequest(), now: undefined },
      { ...babylonRequest(), conceptRef: undefined },
      { ...babylonRequest(), workspaceRoot: undefined },
      { ...babylonRequest(), source: undefined },
      { ...babylonRequest(), source: { projectIdentity: "source-blender" } },
      { ...babylonRequest(), target: { engine: "babylon", projectIdentity: "target-babylon" } },
      { ...babylonRequest(), acceptanceRecord: undefined },
      { ...babylonRequest(), planId: undefined },
    ];
    for (const input of cases) {
      expect(() => buildCrossEngineAssetPlan(input)).toThrow(/GAMOS\/CROSS-ENGINE-PLAN:/);
    }
  });

  it("rejects unknown fields (the request contract is exact)", () => {
    expect(() => buildCrossEngineAssetPlan({ ...babylonRequest(), extra: true })).toThrow(/GAMOS\/CROSS-ENGINE-PLAN:.*unknown/i);
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ source: { projectIdentity: "source-blender", blendFile: "source-blender/hero.blend", extra: 1 } }))).toThrow(/GAMOS\/CROSS-ENGINE-PLAN:.*unknown/i);
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ target: { engine: "babylon", projectIdentity: "target-babylon", projectRoot: "target-babylon", extra: 1 } }))).toThrow(/GAMOS\/CROSS-ENGINE-PLAN:.*unknown/i);
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ interchange: { upAxis: "y", extra: 1 } }))).toThrow(/GAMOS\/CROSS-ENGINE-PLAN:.*unknown/i);
  });

  it("rejects unsupported target engines and interchange formats", () => {
    // M4 WP-7: godot and unreal are NOW first-class target legs — the
    // unknown-engine fail-closed class is exercised with genuinely unknown
    // engines and the honest four-leg message (the reworded error per
    // readiness Deliverable 8: "ships exactly these two target legs" → four).
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ target: { engine: "cryengine", projectIdentity: "t", projectRoot: "t" } }))).toThrow(/GAMOS\/CROSS-ENGINE-PLAN:.*unity\|babylon\|godot\|unreal/);
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ target: { engine: "source-2", projectIdentity: "t", projectRoot: "t" } }))).toThrow(/GAMOS\/CROSS-ENGINE-PLAN:.*four target legs/);
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ format: "obj" }))).toThrow(/GAMOS\/CROSS-ENGINE-PLAN:.*fbx\|glb/);
  });

  it("rejects malformed concept/acceptance references and interchange settings", () => {
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ conceptRef: { conceptId: "concept-001", conceptSha256: "short" } }))).toThrow(/GAMOS\/CROSS-ENGINE-PLAN:/);
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ acceptanceRecord: { recordId: "acc-001", recordSha256: "zz" } }))).toThrow(/GAMOS\/CROSS-ENGINE-PLAN:/);
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ interchange: { upAxis: "x" } }))).toThrow(/GAMOS\/CROSS-ENGINE-PLAN:/);
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ interchange: { upAxis: "y", globalScale: 0 } }))).toThrow(/GAMOS\/CROSS-ENGINE-PLAN:/);
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ interchange: { upAxis: "y", globalScale: -2 } }))).toThrow(/GAMOS\/CROSS-ENGINE-PLAN:/);
  });

  it("the builder-emitted plan ALWAYS parses for every target (the generator-honesty invariant — four legs after M4 WP-7)", () => {
    for (const request of [babylonRequest(), unityRequest("fbx"), unityRequest("glb"), godotRequest(), unrealRequest(), unrealRequest({ format: "glb" })]) {
      const plan: GamePlan = buildCrossEngineAssetPlan(request);
      const roundTripped = JSON.parse(JSON.stringify(plan));
      expect(() => parseGamePlan(roundTripped)).not.toThrow();
      expect(hashGamePlan(parseGamePlan(roundTripped))).toBe(hashGamePlan(plan));
    }
  });
});

describe("CROSS_ENGINE_CORE_CAPABILITIES — the shipped core record (M3.3)", () => {
  it("ships exactly one record: core/asset.manifest-validate@1.0.0", () => {
    expect(CROSS_ENGINE_CORE_CAPABILITIES).toHaveLength(1);
    const record = CROSS_ENGINE_CORE_CAPABILITIES[0] as CapabilityRecord;
    expect(record.id).toBe("core/asset.manifest-validate");
    expect(record.version).toBe("1.0.0");
    expect(record.engineFamily).toBe("core");
  });

  it("registers cleanly through registerCapability (complete execution-safety record, contract 02)", () => {
    const record = registerCapability(CROSS_ENGINE_CORE_CAPABILITIES[0]);
    expect(record.id).toBe("core/asset.manifest-validate");
    expect(record.provider).toEqual({
      kind: "agent-tool",
      identity: "builtin:files+export-result",
      discoveredVia: "workflow actor instructions",
    });
    expect(record.availability.state).toBe("available");
    expect(record.verification.method).toBe("output-schema");
    expect(record.input.required).toEqual(["manifestPath", "artifactPath"]);
    expect(record.output.required).toEqual(["valid", "artifactSha256"]);
    expect(record.idempotency.repeatable).toBe(true);
    expect(record.cancellation.supported).toBe(true);
    // permissions are read-only: no filesystem-write, no engine, no network
    for (const permission of record.permissions) {
      expect(permission.kind).not.toMatch(/filesystem-write|engine-headless|engine-gui|network-access/);
    }
  });

  it("resolves the builder's validate-export step input (fail-closed input schema check)", () => {
    const registry = new Map<string, CapabilityRecord>();
    const record = registerCapability(CROSS_ENGINE_CORE_CAPABILITIES[0]);
    registry.set(`${record.id}@${record.version}`, record);
    const plan = buildCrossEngineAssetPlan(babylonRequest());
    const validateInput = plan.steps[1]?.capability.input;
    const outcome = resolveCapability(registry, { id: "core/asset.manifest-validate", version: "1.0.0", input: validateInput });
    expect(outcome.ok).toBe(true);
  });

  it("exposes the request schema id gamos/cross-engine-plan@1", () => {
    expect(CROSS_ENGINE_PLAN_SCHEMA_ID).toBe("gamos/cross-engine-plan@1");
  });
});

describe("buildCrossEngineAssetPlan — adversarial hardening (M3.3 HARDEN)", () => {
  /** The full pipeline registry: the six real engine records + the new core record. */
  function pipelineRegistry(): Map<string, CapabilityRecord> {
    const registry = registerEnginePluginCapabilities();
    for (const record of CROSS_ENGINE_CORE_CAPABILITIES) {
      const registered = registerCapability(record);
      registry.set(`${registered.id}@${registered.version}`, registered);
    }
    return registry;
  }

  const BABYLON_PIPELINE_IDS = ["blender/asset.export", "core/asset.manifest-validate", "babylon/asset.integrate", "babylon/project.build", "babylon/project.run"];
  const UNITY_PIPELINE_IDS = ["blender/asset.export", "core/asset.manifest-validate", "unity/asset.import", "unity/project.build"];
  const GODOT_PIPELINE_IDS = ["blender/asset.export", "core/asset.manifest-validate", "godot/asset.import", "godot/project.build", "godot/project.run"];
  const UNREAL_PIPELINE_IDS = ["blender/asset.export", "core/asset.manifest-validate", "unreal/connection.inspect", "unreal/object.inspect", "unreal/property.read"];

  /** The records' permission union in pipeline order, deduplicated by kind|scope (first occurrence). */
  function permissionUnion(registry: ReadonlyMap<string, CapabilityRecord>, ids: readonly string[]) {
    const seen = new Set<string>();
    const union: { kind: string; scope: string; rationale: string }[] = [];
    for (const id of ids) {
      const record = [...registry.values()].find((r) => r.id === id);
      if (!record) throw new Error(`fixture: pipeline capability ${id} is not registered`);
      for (const permission of record.permissions) {
        const key = `${permission.kind}|${permission.scope}`;
        if (seen.has(key)) continue;
        seen.add(key);
        union.push({ kind: permission.kind, scope: permission.scope, rationale: permission.rationale });
      }
    }
    return union;
  }

  it("the plan's permission union mirrors the REAL shipped records exactly — verbatim rationales, no drift (drift guard)", () => {
    const registry = pipelineRegistry();
    const babylon = buildCrossEngineAssetPlan(babylonRequest());
    expect(babylon.permissions).toEqual(permissionUnion(registry, BABYLON_PIPELINE_IDS));

    const unity = buildCrossEngineAssetPlan(unityRequest("fbx"));
    expect(unity.permissions).toEqual(permissionUnion(registry, UNITY_PIPELINE_IDS));

    // M4 WP-7: the godot/unreal pipeline unions mirror their REAL records
    // exactly (the drift guard covers all four target legs).
    const godot = buildCrossEngineAssetPlan(godotRequest());
    expect(godot.permissions).toEqual(permissionUnion(registry, GODOT_PIPELINE_IDS));

    const unreal = buildCrossEngineAssetPlan(unrealRequest());
    expect(unreal.permissions).toEqual(permissionUnion(registry, UNREAL_PIPELINE_IDS));
  });

  it("every emitted step input validates against the REAL capability record's input schema (fail-closed required-field check)", () => {
    const registry = pipelineRegistry();
    for (const request of [babylonRequest(), unityRequest("fbx"), unityRequest("glb"), godotRequest(), unrealRequest(), unrealRequest({ format: "glb" })]) {
      const plan = buildCrossEngineAssetPlan(request);
      for (const step of plan.steps) {
        const record = [...registry.values()].find((r) => r.id === step.capability.capabilityId);
        expect(record).toBeDefined();
        // the declared runtime prerequisites are explicitly satisfied here so
        // resolution reaches the INPUT schema check (contract 07 separation:
        // engine availability is the runtime guard, not a data error)
        const outcome = resolveCapability(registry, {
          id: step.capability.capabilityId,
          version: step.capability.capabilityVersion,
          input: step.capability.input,
          prerequisites: record?.availability.prerequisites ?? [],
        });
        expect(outcome.ok).toBe(true);
      }
    }
  });

  it("pins exactly the shipped capability versions — every emitted id@version resolves in the real registry", () => {
    const registry = pipelineRegistry();
    for (const request of [babylonRequest(), unityRequest("fbx"), godotRequest(), unrealRequest()]) {
      const plan = buildCrossEngineAssetPlan(request);
      for (const step of plan.steps) {
        const record = [...registry.values()].find((r) => r.id === step.capability.capabilityId);
        expect(record?.version).toBe(step.capability.capabilityVersion);
      }
    }
    // the shipped records themselves are the append-only source of truth
    // (23 engine records: 4 unity + 4 blender + 4 babylon + 6 godot + 5 unreal —
    // the M4 WP-1/WP-4 registrations; the godot/unreal records became pipeline
    // members through the M4 WP-7 target legs, append-only, the M2/M3 records
    // byte-identical)
    expect(ENGINE_PLUGIN_CAPABILITIES.length).toBe(23);
  });

  it("the generated script instructs the manifest handoff for the manifest-CONSUMING targets (babylon/unity/godot; unreal is not a consumer — never a fabricated reference)", () => {
    for (const target of ["babylon", "unity", "godot"] as const) {
      const context = makePipelineContext(true, target, target === "babylon" ? ["blender", "babylon"] : target === "unity" ? ["blender", "unity"] : ["blender", "godot"]);
      const request = target === "babylon" ? babylonRequest() : target === "unity" ? unityRequest("fbx") : godotRequest();
      const plan = buildCrossEngineAssetPlan(request);
      const artifact = buildGamePlanWorkflowScript(plan, context);
      expect(artifact.scriptText).toContain(join(WORKSPACE_ROOT, "staging", `gamos-asset.${target === "babylon" || target === "godot" ? "glb" : "fbx"}.manifest.json`));
      expect(artifact.scriptText).toContain("expectedIntegrity");
      expect(artifact.scriptText).toContain("byteLength");
      expect(artifact.scriptText).toContain("sha256");
    }
  });

  it("rejects non-object requests (null, arrays, strings) fail closed", () => {
    expect(() => buildCrossEngineAssetPlan(null)).toThrow(/GAMOS\/CROSS-ENGINE-PLAN: request/);
    expect(() => buildCrossEngineAssetPlan([])).toThrow(/GAMOS\/CROSS-ENGINE-PLAN: request/);
    expect(() => buildCrossEngineAssetPlan("plan")).toThrow(/GAMOS\/CROSS-ENGINE-PLAN: request/);
    expect(() => buildCrossEngineAssetPlan(42)).toThrow(/GAMOS\/CROSS-ENGINE-PLAN: request/);
  });

  it("rejects NaN/Infinity maxConcurrency and non-numeric interchange scale", () => {
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ maxConcurrency: Number.NaN }))).toThrow(/GAMOS\/CROSS-ENGINE-PLAN: maxConcurrency/);
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ maxConcurrency: Number.POSITIVE_INFINITY }))).toThrow(/GAMOS\/CROSS-ENGINE-PLAN: maxConcurrency/);
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ interchange: { upAxis: "y", globalScale: Number.NaN } }))).toThrow(/GAMOS\/CROSS-ENGINE-PLAN: interchange.globalScale/);
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ interchange: { upAxis: "y", globalScale: Number.POSITIVE_INFINITY } }))).toThrow(/GAMOS\/CROSS-ENGINE-PLAN: interchange.globalScale/);
  });

  it("rejects now values that are ISO-shaped but not strict canonical UTC (offset form, zone-less, lowercase z)", () => {
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ now: "2026-11-12T10:00:00+00:00" }))).toThrow(/GAMOS\/CROSS-ENGINE-PLAN: now/);
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ now: "2026-11-12T10:00:00" }))).toThrow(/GAMOS\/CROSS-ENGINE-PLAN: now/);
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ now: "2026-11-12t10:00:00z" }))).toThrow(/GAMOS\/CROSS-ENGINE-PLAN: now/);
    // the canonical millisecond form IS accepted
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ now: "2026-11-12T10:00:00.123Z" }))).not.toThrow();
  });

  it("rejects blend files without the exact .blend suffix (case-sensitive)", () => {
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ source: { projectIdentity: "source-blender", blendFile: "source-blender/hero.fbx" } }))).toThrow(/GAMOS\/CROSS-ENGINE-PLAN: source.blendFile/);
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ source: { projectIdentity: "source-blender", blendFile: "source-blender/hero.Blend" } }))).toThrow(/GAMOS\/CROSS-ENGINE-PLAN: source.blendFile/);
    expect(() => buildCrossEngineAssetPlan(babylonRequest({ source: { projectIdentity: "source-blender", blendFile: "source-blender/heroblend" } }))).toThrow(/GAMOS\/CROSS-ENGINE-PLAN: source.blendFile/);
  });

  it("the core record's provenance pins a 40-hex source-of-record commit", () => {
    expect(M3_CROSS_ENGINE_SOURCE_COMMIT).toMatch(/^[0-9a-f]{40}$/);
    const record = CROSS_ENGINE_CORE_CAPABILITIES[0] as CapabilityRecord;
    expect(record.provenance.source).toMatchObject({
      type: "repository",
      repo: "payswapdotorg/Gamos-2.0",
      commitSha: M3_CROSS_ENGINE_SOURCE_COMMIT,
      path: "packages/gamos-domain/src/domain/cross-engine-plan.ts",
    });
    expect(record.provenance.surfaces).toContain("mcp");
  });
});

// ---------------------------------------------------------------------------
// Fixture: a pipeline model context (real registry records + machine discovery)
// ---------------------------------------------------------------------------

function makePipelineContext(installed: boolean, _target: "babylon" | "unity" | "godot" | "unreal", families: readonly EngineFamily[]): GamingModelContext {
  const engines: DiscoveredEngine[] = families.map((family) =>
    installed
      ? {
          engineFamily: family,
          installed: true,
          rawVersion:
            family === "blender"
              ? "blender 4.1.1"
              : family === "babylon"
                ? "24.14.0"
                : family === "godot"
                  ? "4.2.2.stable.official.15073afe3"
                  : family === "unreal"
                    ? "5.3.2-1234567"
                    : "6000.0.23f1",
          headlessCapable: true,
          // The RC connector's HTTP/WS ops need no display on THIS machine —
          // the editor's own display requirement is the maintainer-side
          // machine's concern (readiness §4.2 attach model); displayServerRequired
          // here describes the DISCOVERED endpoint's ops, not the editor GUI.
          displayServerRequired: false,
        }
      : {
          engineFamily: family,
          installed: false,
          notes: `${family} toolchain not found on this machine`,
          headlessCapable: false,
          displayServerRequired: false,
        },
  );
  const machineDiscovery = buildMachineDiscoveryRecord(WORKSPACE_ROOT, engines, { platform: "linux", arch: "x64" }, NOW);
  const engineStates = joinEngineState(
    { schemaVersion: 2, workspacePath: WORKSPACE_ROOT, engineBindings: families.map((family) => ({ engineFamily: family })) },
    machineDiscovery,
  );

  const registry = registerEnginePluginCapabilities();
  for (const coreRecord of CROSS_ENGINE_CORE_CAPABILITIES) {
    const registered = registerCapability(coreRecord);
    registry.set(`${registered.id}@${registered.version}`, registered);
  }
  // The engine records are CONDITIONAL (runtime prerequisites guarded by the
  // engine-state JOIN, contract 07); the script-generation context carries the
  // registered records as resolved DATA so the generator can derive the
  // required engine families — the fail-closed authority stays with the
  // embedded engine-state guards.
  const capabilityResults = [...registry.values()].map((record) => ({
    request: { id: record.id, version: record.version },
    ok: true as const,
    record,
  }));

  return buildGamingModelContext({
    now: NOW,
    workspaceRoot: WORKSPACE_ROOT,
    classification: classifyIntent(`Plan the cross-engine game asset pipeline from Blender into ${_target === "babylon" ? "Babylon" : _target === "unity" ? "Unity" : _target === "godot" ? "Godot" : "Unreal"}.`),
    projectDetection: {
      root: WORKSPACE_ROOT,
      isProject: true,
      detected: [
        {
          engineFamily: _target,
          isProject: true,
          evidence: [_target === "babylon" ? "package.json" : _target === "unity" ? "ProjectSettings/ProjectVersion.txt" : _target === "godot" ? "project.godot" : "GamosTarget.uproject"],
          projectName: "gamos-target",
        },
      ],
    },
    machineDiscovery,
    engineStates,
    capabilityResults,
  });
}
