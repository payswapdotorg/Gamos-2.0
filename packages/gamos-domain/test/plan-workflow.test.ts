import { describe, expect, it, afterAll } from "vitest";
import { buildGamePlanWorkflowScript } from "../src/domain/plan-workflow.js";
import { parseGamePlan, hashGamePlan } from "../src/domain/game-plan.js";
import type { GamePlan } from "../src/domain/game-plan.js";
import { registerCapability } from "../src/domain/capability-registry.js";
import type { CapabilityRecord } from "../src/domain/capability-registry.js";
import { buildMachineDiscoveryRecord } from "../src/domain/discovery/discovery-record.js";
import type { DiscoveredEngine } from "../src/domain/discovery/discovery-record.js";
import { detectProjectEngines } from "../src/adapters/discovery/project-probes.js";
import { resolveGamingIntent } from "../src/domain/intent.js";
import type { GamingModelContext } from "../src/domain/intent.js";
import { completeCapabilityRecord, validPlanInput } from "./fixtures.js";

/**
 * GamePlan → Dynamic Workflow script artifact (directive §12 / contract 05 rev 2 — M1.5 TDD RED).
 *
 * The script IS the GamePlan: authored/compiled/executed by the EXISTING ZCode
 * Dynamic Workflow infrastructure (facade calls, governor, dwf_* journal).
 * The generator maps plan steps → agent() sites, dependencies → script structure,
 * unavailable engines/capabilities → explicit fail-closed guards (never mock
 * success), read-only constraints → no mutation calls, acceptance → report().
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function unityWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), "gamos-m15-"));
  mkdirSync(join(root, "ProjectSettings"), { recursive: true });
  writeFileSync(join(root, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersionWithRevision: 2022.3.10f1 (abcdef123456)\n");
  return root;
}

const UNITY_INSTALLED: DiscoveredEngine[] = [
  { engineFamily: "unity", installed: true, rawVersion: "2022.3.10f1", headlessCapable: true, displayServerRequired: false },
];
const UNITY_UNAVAILABLE: DiscoveredEngine[] = [
  { engineFamily: "unity", installed: false, notes: "Unity editor not found on PATH or common install locations", headlessCapable: false, displayServerRequired: false },
];

function makeRegistry(): Map<string, CapabilityRecord> {
  const registry = new Map<string, CapabilityRecord>();
  registry.set("core/project.inspect", registerCapability(completeCapabilityRecord));
  registry.set(
    "core/capability.report",
    registerCapability({
      ...completeCapabilityRecord,
      id: "core/capability.report",
      title: "Report capability results",
    } as never),
  );
  registry.set(
    "unity/scene.build",
    registerCapability({
      ...completeCapabilityRecord,
      id: "unity/scene.build",
      title: "Build Unity scene",
      engineFamily: "unity",
      provider: { kind: "engine-binary", identity: "unity-editor" },
    } as never),
  );
  return registry;
}

function makeContext(engines: DiscoveredEngine[], message: string): GamingModelContext {
  const root = unityWorkspace();
  contexts.push(root);
  const detection = detectProjectEngines(root);
  const resolution = resolveGamingIntent({
    message,
    workspaceRoot: root,
    projectDetection: detection,
    machineDiscovery: buildMachineDiscoveryRecord(root, engines, { platform: "linux", arch: "x64" }, "2026-11-05T22:00:00Z"),
    registry: makeRegistry(),
    requestedCapabilities: [{ id: "core/project.inspect" }, { id: "unity/scene.build" }],
    now: "2026-11-05T22:00:00Z",
  });
  if (!resolution.context) throw new Error("test fixture: resolution produced no context");
  return resolution.context;
}

const contexts: string[] = [];
afterAll(() => {
  for (const dir of contexts) rmSync(dir, { recursive: true, force: true });
});

function makePlan(overrides: Record<string, unknown> = {}): GamePlan {
  return parseGamePlan({ ...validPlanInput, ...overrides });
}

/** A plan slice without the Unity-project engine binding (the enrichment is plan-structure logic, not engine logic). */
function makePipelinePlan(steps: Record<string, unknown>[]): GamePlan {
  const { engineBinding: _stripped, ...rest } = validPlanInput as Record<string, unknown>;
  return parseGamePlan({ ...rest, steps });
}

describe("buildGamePlanWorkflowScript — script generation (M1.5)", () => {
  it("generates the workflow script artifact with plan identity + provenance + step sites", () => {
    const context = makeContext(UNITY_INSTALLED, "Generate a read-only plan for validating this game project.");
    const plan = makePlan();
    const artifact = buildGamePlanWorkflowScript(plan, context);
    expect(artifact.planId).toBe("plan-001");
    expect(artifact.planSha256).toBe(hashGamePlan(plan));
    expect(artifact.scriptText).toContain("plan-001");
    expect(artifact.scriptText).toContain(hashGamePlan(plan));
    // context provenance is embedded (observedVia + generation timestamp)
    expect(artifact.scriptText).toContain("project-probes");
    expect(artifact.scriptText).toContain("machine-discovery");
    expect(artifact.scriptText).toContain("capability-registry");
    expect(artifact.scriptText).toContain("2026-11-05T22:00:00Z");
    // every step becomes an agent site
    expect(artifact.stepSites.map((s) => s.stepId).sort()).toEqual(["step-1", "step-2"]);
    expect(artifact.stepSites.every((s) => s.agentName.length > 0)).toBe(true);
    expect(artifact.stepSites[0]?.capabilityId).toBe("core/project.inspect");
  });

  it("is deterministic — the same plan + context produce a byte-identical script (idempotent generation)", () => {
    const context = makeContext(UNITY_INSTALLED, "Generate a read-only plan for validating this game project.");
    const plan = makePlan();
    const a = buildGamePlanWorkflowScript(plan, context);
    const b = buildGamePlanWorkflowScript(plan, context);
    expect(a.scriptText).toBe(b.scriptText);
  });

  it("maps dependencies to script structure: dependents run after their dependencies, independents parallelize", () => {
    const context = makeContext(UNITY_INSTALLED, "Generate a read-only plan for validating this game project.");
    const plan = makePlan({
      steps: [
        { stepId: "step-a", capability: { capabilityId: "core/project.inspect", capabilityVersion: "1.0.0", input: {} }, dependsOn: [], constraints: { read_only: true } },
        { stepId: "step-b", capability: { capabilityId: "core/capability.report", capabilityVersion: "1.0.0", input: {} }, dependsOn: ["step-a"], constraints: { read_only: true } },
        { stepId: "step-c", capability: { capabilityId: "core/capability.report", capabilityVersion: "1.0.0", input: {} }, dependsOn: ["step-a"], constraints: { read_only: true } },
      ],
    });
    const artifact = buildGamePlanWorkflowScript(plan, context);
    const text = artifact.scriptText;
    // topological order: step-a completes before b/c start
    const posA = text.indexOf("gamos-plan-001-step-a");
    const posB = text.indexOf("gamos-plan-001-step-b");
    const posC = text.indexOf("gamos-plan-001-step-c");
    expect(posA).toBeGreaterThanOrEqual(0);
    expect(posB).toBeGreaterThan(posA);
    expect(posC).toBeGreaterThan(posA);
    // b and c form one parallel level (Promise.all) strictly after awaiting step-a
    expect(text).toMatch(/Promise\.all\(/);
    const awaitA = text.indexOf("await n_step_a");
    const allPos = text.indexOf("Promise.all(");
    expect(awaitA).toBeGreaterThanOrEqual(0);
    expect(allPos).toBeGreaterThan(awaitA);
  });

  it("emits fail-closed guards for unavailable engines BEFORE any step (never mock success)", () => {
    const context = makeContext(UNITY_UNAVAILABLE, "Generate a read-only plan for validating this game project.");
    const plan = makePlan({
      engineBinding: { engineFamily: "unity", bindingReason: "project dependencies discovered (M1.3)" },
      steps: [
        { stepId: "step-1", capability: { capabilityId: "unity/scene.build", capabilityVersion: "1.0.0", input: {} }, dependsOn: [], constraints: { read_only: true } },
      ],
    });
    const artifact = buildGamePlanWorkflowScript(plan, context);
    // a guard is recorded for the unavailable family with its reason
    expect(artifact.guards.length).toBeGreaterThan(0);
    const unityGuard = artifact.guards.find((g) => g.family === "unity");
    expect(unityGuard?.state).toBe("unavailable");
    expect(unityGuard?.reason).toBeTruthy();
    // the script throws the guard BEFORE the first agent site
    const text = artifact.scriptText;
    const guardPos = text.indexOf("throw new Error");
    const firstAgent = text.indexOf("agent(");
    expect(guardPos).toBeGreaterThanOrEqual(0);
    expect(guardPos).toBeLessThan(firstAgent);
    expect(text).toContain("unity");
    expect(text).toContain("fail closed");
  });

  it("emits fail-closed guards for capabilities the context resolved as unavailable", () => {
    const context = makeContext(UNITY_INSTALLED, "Generate a read-only plan for validating this game project.");
    // core/project.inspect IS resolved; unity/scene.build is registered available here.
    // Use an unavailable capability: rebuild the registry without unity availability.
    const plan = makePlan({
      steps: [
        { stepId: "step-1", capability: { capabilityId: "core/project.inspect", capabilityVersion: "1.0.0", input: {} }, dependsOn: [], constraints: { read_only: true } },
      ],
    });
    const artifact = buildGamePlanWorkflowScript(plan, context);
    // resolved capability → no guard for the available core family
    expect(artifact.guards.filter((g) => g.family === "core")).toHaveLength(0);
  });

  it("read-only plan: the emitted script contains no mutation facade calls", () => {
    const context = makeContext(UNITY_INSTALLED, "Generate a read-only plan for validating this game project.");
    const plan = makePlan();
    const artifact = buildGamePlanWorkflowScript(plan, context);
    expect(artifact.readOnly).toBe(true);
    const text = artifact.scriptText;
    expect(text).not.toMatch(/world\.run\(/);
    expect(text).not.toMatch(/git\.commit\(/);
    expect(text).not.toMatch(/git\.push\(/);
    expect(text).not.toMatch(/files\.write\(/);
    expect(text).toMatch(/read-only/);
  });

  it("references the acceptance record and reports completion", () => {
    const context = makeContext(UNITY_INSTALLED, "Generate a read-only plan for validating this game project.");
    const plan = makePlan();
    const artifact = buildGamePlanWorkflowScript(plan, context);
    const text = artifact.scriptText;
    expect(text).toContain("acc-001");
    expect(text).toMatch(/report\(/);
    expect(text).toMatch(/return\s*\{/);
  });

  it("aggregated metadata reflects the plan topology", () => {
    const context = makeContext(UNITY_INSTALLED, "Generate a read-only plan for validating this game project.");
    const plan = makePlan();
    const artifact = buildGamePlanWorkflowScript(plan, context);
    expect(artifact.stepCount).toBe(2);
    expect(artifact.parallelLevels).toBe(2); // [step-1] then [step-2]
    expect(artifact.generatedFrom).toBe("gamos/model-context@1");
  });
});

describe("buildGamePlanWorkflowScript — cross-engine manifest-integrity instruction enrichment (M3.3)", () => {
  const MANIFEST_PATH = "/workspace/gamos/staging/gamos-asset.glb.manifest.json";

  /** The cross-engine pipeline steps as a hand-authored plan slice (shape-only: parseGamePlan does not resolve the registry). */
  function pipelineSteps(consumerCapabilityId: string): Record<string, unknown>[] {
    return [
      {
        stepId: "export-asset",
        capability: {
          capabilityId: "blender/asset.export",
          capabilityVersion: "1.0.0",
          input: { blendFile: "/workspace/gamos/source/hero.blend", outputPath: "/workspace/gamos/staging/gamos-asset.glb", format: "GLTF" },
        },
        dependsOn: [],
      },
      {
        stepId: "validate-export",
        capability: {
          capabilityId: "core/asset.manifest-validate",
          capabilityVersion: "1.0.0",
          input: { manifestPath: MANIFEST_PATH, artifactPath: "/workspace/gamos/staging/gamos-asset.glb" },
        },
        dependsOn: ["export-asset"],
      },
      {
        stepId: "integrate-asset",
        capability: {
          capabilityId: consumerCapabilityId,
          capabilityVersion: "1.0.0",
          input: { projectRoot: "/workspace/gamos/target", artifactPath: "/workspace/gamos/staging/gamos-asset.glb" },
        },
        dependsOn: ["validate-export"],
      },
    ];
  }

  it("an integrate/import step preceded by a manifest-validate step is instructed to read the manifest and pass expectedIntegrity", () => {
    const context = makeContext(UNITY_INSTALLED, "Generate a read-only plan for validating this game project.");
    for (const consumer of ["babylon/asset.integrate", "unity/asset.import"]) {
      const plan = makePipelinePlan(pipelineSteps(consumer));
      const artifact = buildGamePlanWorkflowScript(plan, context);
      // the instruction references the manifest path and the integrity record
      expect(artifact.scriptText).toContain(MANIFEST_PATH);
      expect(artifact.scriptText).toContain("expectedIntegrity");
      expect(artifact.scriptText).toContain("byteLength");
      expect(artifact.scriptText).toContain("sha256");
      // it is attached to the CONSUMER step's ask only, never to other steps
      const integrateAsk = artifact.scriptText.split("\n").find((line) => line.includes("gamos-plan-001-integrate-asset"));
      expect(integrateAsk).toBeDefined();
      expect(integrateAsk).toContain("expectedIntegrity");
      const exportAsk = artifact.scriptText.split("\n").find((line) => line.includes("agent("));
      expect(exportAsk).toBeDefined();
      expect(exportAsk).not.toContain("expectedIntegrity");
    }
  });

  it("a manifest-consuming step WITHOUT a manifest-validate step in the plan keeps the unchanged instruction (no fabricated manifest reference)", () => {
    const context = makeContext(UNITY_INSTALLED, "Generate a read-only plan for validating this game project.");
    const integrateOnly = { ...pipelineSteps("babylon/asset.integrate")[2]!, dependsOn: [] };
    const plan = makePipelinePlan([integrateOnly]);
    const artifact = buildGamePlanWorkflowScript(plan, context);
    expect(artifact.scriptText).not.toContain("expectedIntegrity");
    expect(artifact.scriptText).not.toContain("manifest");
  });

  it("a manifest-consuming step that appears BEFORE the manifest-validate step gets no instruction (order is load-bearing)", () => {
    const context = makeContext(UNITY_INSTALLED, "Generate a read-only plan for validating this game project.");
    const steps = pipelineSteps("babylon/asset.integrate");
    const plan = makePipelinePlan([steps[2]!, steps[0]!, steps[1]!]);
    const artifact = buildGamePlanWorkflowScript(plan, context);
    expect(artifact.scriptText).not.toContain("expectedIntegrity");
  });

  it("plans without manifest-consuming capabilities keep the exact legacy ask template (byte-identical generation)", () => {
    const context = makeContext(UNITY_INSTALLED, "Generate a read-only plan for validating this game project.");
    const plan = makePlan();
    const artifact = buildGamePlanWorkflowScript(plan, context);
    // the M1.5 ask template is pinned verbatim — enrichment must never drift it
    expect(artifact.scriptText).toContain(
      "Execute capability core/project.inspect (1.0.0) for GamePlan plan-001. Input: {}. Read-only: observe and report; do not modify anything. Report what you actually observed.",
    );
    expect(artifact.scriptText).not.toContain("expectedIntegrity");
    const again = buildGamePlanWorkflowScript(plan, context);
    expect(again.scriptText).toBe(artifact.scriptText);
  });

  it("enriched generation is deterministic — the same plan + context produce a byte-identical script", () => {
    const context = makeContext(UNITY_INSTALLED, "Generate a read-only plan for validating this game project.");
    const plan = makePipelinePlan(pipelineSteps("babylon/asset.integrate"));
    const a = buildGamePlanWorkflowScript(plan, context);
    const b = buildGamePlanWorkflowScript(plan, context);
    expect(a.scriptText).toBe(b.scriptText);
  });
});
