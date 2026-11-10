/**
 * Cross-engine plan builder - the M4 WP-7 target legs (godot hop chain +
 * unreal RC verification chain) and their fail-closed discipline: version
 * grammar checks, no silent engine substitution, the unreal-only target
 * fields and the domain planning floor. Split from the M3.3 suite when the
 * WP-7 legs pushed the single file past the max-lines bound; the shared
 * fixtures live in cross-engine-plan-fixtures.ts.
 */

import { describe, expect, it } from "vitest";
import { join } from "node:path";

import { buildCrossEngineAssetPlan } from "../src/domain/cross-engine-plan.js";
import { parseGamePlan, hashGamePlan } from "../src/domain/game-plan.js";
import { findClaimConflicts } from "../src/domain/resource-claims.js";
import { joinEngineState, buildMachineDiscoveryRecord } from "../src/domain/discovery/discovery-record.js";
import { buildGamePlanWorkflowScript } from "../src/domain/plan-workflow.js";
import type { EngineFamily } from "../src/engine-family.js";
import {
  NOW,
  WORKSPACE_ROOT,
  GODOT_STEPS,
  UNREAL_STEPS,
  babylonRequest,
  godotRequest,
  unrealRequest,
  shuffledKeyOrder,
  claimTuples,
  claimsOf,
  makePipelineContext,
} from "./cross-engine-plan-fixtures.js";


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

  it("an unavailable godot engine yields a fail-closed guard in the generated script (the M4-G3 discipline: the guard throws before any step)", () => {
    const context = makePipelineContext(false, "godot", ["blender", "godot"]);
    const plan = buildCrossEngineAssetPlan(godotRequest());
    const artifact = buildGamePlanWorkflowScript(plan, context);
    expect(artifact.guards.some((g) => g.family === "godot" && g.state === "unavailable")).toBe(true);
    expect(artifact.scriptText).toContain("Gamos engine guard: godot is unavailable");
    // the embedded guard throws BEFORE any step agent (never mock success)
    const guardPos = artifact.scriptText.indexOf("Gamos engine guard");
    const firstAgent = artifact.scriptText.indexOf("agent(");
    expect(guardPos).toBeGreaterThanOrEqual(0);
    expect(guardPos).toBeLessThan(firstAgent);
  });

  it("an unavailable unreal engine (rc-endpoint-absent) yields a fail-closed guard in the generated script", () => {
    const context = makePipelineContext(false, "unreal", ["blender", "unreal"]);
    const plan = buildCrossEngineAssetPlan(unrealRequest());
    const artifact = buildGamePlanWorkflowScript(plan, context);
    expect(artifact.guards.some((g) => g.family === "unreal" && g.state === "unavailable")).toBe(true);
    expect(artifact.scriptText).toContain("Gamos engine guard: unreal is unavailable");
    // the embedded guard throws BEFORE any step agent (never mock success)
    const guardPos = artifact.scriptText.indexOf("Gamos engine guard");
    const firstAgent = artifact.scriptText.indexOf("agent(");
    expect(guardPos).toBeGreaterThanOrEqual(0);
    expect(guardPos).toBeLessThan(firstAgent);
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
      "/Game/Gamos.My/Asset", // dotted non-final segment (grammar violation)
      "/Game/Gamos/Asset.Object:A:B:C:D", // sub-object component count outside 1..3
      "/Game/Gamos/Asset.Object.Object2", // more than one dotted object-name component
      "/Game/Gamos/Asset:", // trailing colon — empty sub-object component
    ];
    for (const objectPath of malformed) {
      expect(() => buildCrossEngineAssetPlan(unrealRequest({ target: { engine: "unreal", projectIdentity: "t", projectRoot: "t", objectPath, propertyNames: ["Name"] } }))).toThrow(
        /target\.objectPath/,
      );
    }
  });

  it("accepts the documented Unreal object-path shapes (the plugin grammar's own examples flow through the planning floor)", () => {
    for (const objectPath of [
      "/Game/FirstPerson/Maps/FirstPersonMap.FirstPersonMap:PersistentLevel.Light_1",
      "/Script/Engine.PointLight",
      "/Game/UI/MyWidget.MyWidget_C:WidgetTree:Panel:Opacity",
    ]) {
      const plan = buildCrossEngineAssetPlan(unrealRequest({ target: { engine: "unreal", projectIdentity: "t", projectRoot: "t", objectPath, propertyNames: ["Name"] } }));
      expect(plan.steps[3]!.capability.input).toEqual({ objectPath });
      expect(plan.steps[4]!.capability.input).toEqual({ objectPath, propertyNames: ["Name"] });
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
      /target engine "godot" cannot consume "fbx".*WP-3 runtime-verified.*request format "glb"/,
    );
  });
});
