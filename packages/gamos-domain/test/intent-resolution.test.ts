import { afterAll, describe, expect, it } from "vitest";
import {
  classifyIntent,
  resolveGamingIntent,
  buildGamingModelContext,
} from "../src/domain/intent.js";
import type { IntentResolutionInput } from "../src/domain/intent.js";
import { registerCapability } from "../src/domain/capability-registry.js";
import type { CapabilityRecord } from "../src/domain/capability-registry.js";
import { buildMachineDiscoveryRecord } from "../src/domain/discovery/discovery-record.js";
import type { MachineEngineDiscovery, DiscoveredEngine } from "../src/domain/discovery/discovery-record.js";
import { detectProjectEngines } from "../src/adapters/discovery/project-probes.js";
import type { ProjectEngineDetection } from "../src/adapters/discovery/project-probes.js";
import { completeCapabilityRecord } from "./fixtures.js";

/**
 * Intent resolution and structured model context (directive §11 / contract 05 §3 — M1.4 TDD RED).
 *
 * The ten directive scenarios:
 *  1 gaming intent            6 missing project
 *  2 non-gaming intent         7 unavailable capability
 *  3 ambiguous engine          8 unsupported request
 *  4 explicit engine pref      9 meaningful substitution requiring approval
 *  5 project mismatch         10 correct context provenance
 *
 * Context must reflect REAL observations (detection + discovery + registry) — never guesses.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "gamos-m14-"));
}

function unityWorkspace(): string {
  const root = tempRoot();
  mkdirSync(join(root, "Assets"), { recursive: true });
  mkdirSync(join(root, "ProjectSettings"), { recursive: true });
  writeFileSync(join(root, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersionWithRevision: 2022.3.10f1 (abcdef123456)\n");
  return root;
}

function godotWorkspace(): string {
  const root = tempRoot();
  writeFileSync(join(root, "project.godot"), 'config_version=5\n[application]\nconfig/name="MyGodotGame"\n');
  return root;
}

function makeRegistry(): Map<string, CapabilityRecord> {
  const registry = new Map<string, CapabilityRecord>();
  registry.set("core/project.inspect", registerCapability(completeCapabilityRecord));
  registry.set(
    "unity/scene.build",
    registerCapability({
      ...completeCapabilityRecord,
      id: "unity/scene.build",
      title: "Build Unity scene",
      engineFamily: "unity",
      availability: { state: "unavailable", reason: "Unity editor binary not found on this machine", prerequisites: [] },
      provider: { kind: "engine-binary", identity: "unity-editor" },
    } as never),
  );
  return registry;
}

function machineDiscovery(engines: DiscoveredEngine[]): MachineEngineDiscovery {
  return buildMachineDiscoveryRecord("/workspace/game", engines, { platform: "linux", arch: "x64" }, "2026-11-05T22:00:00Z");
}

const UNITY_INSTALLED: DiscoveredEngine[] = [
  { engineFamily: "unity", installed: true, rawVersion: "2022.3.10f1", headlessCapable: true, displayServerRequired: false },
];
const GODOT_INSTALLED: DiscoveredEngine[] = [
  { engineFamily: "godot", installed: true, rawVersion: "4.2.1.stable.official.1234567890", headlessCapable: true, displayServerRequired: false },
];

function baseInput(message: string, detection: ProjectEngineDetection, discovery: MachineEngineDiscovery): IntentResolutionInput {
  return {
    message,
    workspaceRoot: detection.root,
    projectDetection: detection,
    machineDiscovery: discovery,
    registry: makeRegistry(),
    now: "2026-11-05T22:00:00Z",
    sessionId: "session-1",
  };
}

describe("classifyIntent — data-only first pass (M1.4)", () => {
  it("recognizes gaming requests with their request kinds", () => {
    expect(classifyIntent("Inspect this game project and explain how it is structured.")).toMatchObject({ isGaming: true });
    expect(classifyIntent("Identify which game engines and gaming capabilities are available here.")).toMatchObject({ isGaming: true });
    expect(classifyIntent("Plan the creation of a tower-defense prototype in Unity.").requestKinds).toContain("plan");
    expect(classifyIntent("Check whether this project can be prepared for a Babylon.js runtime.").requestKinds).toContain("check-runtime");
    expect(classifyIntent("Generate a read-only plan for validating this game project.").requestKinds).toContain("validate");
  });
  it("classifies non-gaming messages as NOT gaming", () => {
    const c = classifyIntent("Fix the failing unit tests in this repository and lint the code.");
    expect(c.isGaming).toBe(false);
    expect(c.mentionedEngines).toHaveLength(0);
  });
  it("detects explicit engine mentions vs an ambiguous multi-engine question", () => {
    const explicit = classifyIntent("Make me a tower-defense prototype in Unity.");
    expect(explicit.mentionedEngines).toEqual([{ family: "unity", strength: "explicit" }]);
    const ambiguous = classifyIntent("Make me a game — should I use Unity or Godot?");
    expect(ambiguous.mentionedEngines.map((e) => e.family).sort()).toEqual(["godot", "unity"]);
    expect(ambiguous.mentionedEngines.every((e) => e.strength === "ambiguous")).toBe(true);
  });
});

describe("Intent resolution — the ten directive scenarios (M1.4)", () => {
  let cleanup: string[] = [];
  afterAll(() => {
    for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
  });

  it("1. gaming intent resolves to a GameConcept + structured context from a REAL workspace", () => {
    const root = unityWorkspace();
    cleanup.push(root);
    const detection = detectProjectEngines(root);
    const resolution = resolveGamingIntent(
      baseInput("Plan the creation of a tower-defense prototype in Unity.", detection, machineDiscovery(UNITY_INSTALLED)),
    );
    expect(resolution.isGaming).toBe(true);
    expect(resolution.classification.requestKinds).toContain("plan");
    expect(resolution.concept?.kind).toBe("gaming");
    expect(resolution.concept?.genre).toContain("tower-defense");
    expect(resolution.concept?.platformPreferences[0]).toMatchObject({ engineFamily: "unity", preference: "required" });
    expect(resolution.concept?.provenance.origin).toBe("user-message");
    expect(resolution.concept?.provenance.sessionId).toBe("session-1");
    expect(resolution.context).toBeDefined();
    expect(resolution.context?.schemaVersion).toBe("gamos/model-context@1");
    expect(resolution.context?.engines.find((e) => e.family === "unity")?.state).toBe("available");
    expect(resolution.issues.filter((i) => i.severity === "blocking")).toHaveLength(0);
  });

  it("2. non-gaming intent retains normal ZCode behavior — no concept, no gaming context, no issues", () => {
    const root = unityWorkspace();
    cleanup.push(root);
    const detection = detectProjectEngines(root);
    const resolution = resolveGamingIntent(
      baseInput("Fix the failing unit tests in this repository and lint the code.", detection, machineDiscovery(UNITY_INSTALLED)),
    );
    expect(resolution.isGaming).toBe(false);
    expect(resolution.concept).toBeUndefined();
    expect(resolution.context).toBeUndefined();
    expect(resolution.issues).toHaveLength(0);
    expect(resolution.engineStates).toHaveLength(0);
  });

  it("3. ambiguous engine selection surfaces an approval issue with the candidates", () => {
    const root = unityWorkspace();
    cleanup.push(root);
    const detection = detectProjectEngines(root);
    const resolution = resolveGamingIntent(
      baseInput("Make me a game — should I use Unity or Godot?", detection, machineDiscovery(UNITY_INSTALLED)),
    );
    const issue = resolution.issues.find((i) => i.code === "ambiguous-engine");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("approval");
    expect(issue?.candidates?.sort()).toEqual(["godot", "unity"]);
    // soft preferences only — no required engine until the user disambiguates
    expect(resolution.concept?.platformPreferences.every((p) => p.preference === "acceptable")).toBe(true);
  });

  it("4. explicit user engine preference becomes a required platform preference", () => {
    const root = tempRoot();
    cleanup.push(root);
    const detection = detectProjectEngines(root);
    const resolution = resolveGamingIntent(
      baseInput("Check whether this project can be prepared for a Babylon.js runtime.", detection, machineDiscovery(GODOT_INSTALLED)),
    );
    expect(resolution.classification.mentionedEngines).toEqual([{ family: "babylon", strength: "explicit" }]);
    expect(resolution.concept?.platformPreferences).toEqual([{ engineFamily: "babylon", preference: "required" }]);
    expect(resolution.classification.requestKinds).toContain("check-runtime");
  });

  it("5. project mismatch: user says Unity, detection finds Godot — explicit mismatch, no silent switch", () => {
    const root = godotWorkspace();
    cleanup.push(root);
    const detection = detectProjectEngines(root);
    const resolution = resolveGamingIntent(
      baseInput("Plan a new level for this Unity project.", detection, machineDiscovery(GODOT_INSTALLED)),
    );
    const issue = resolution.issues.find((i) => i.code === "project-mismatch");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("approval");
    expect(issue?.message).toContain("godot");
    // the concept keeps the USER preference (unity) — detection is never silently substituted in
    expect(resolution.concept?.platformPreferences.map((p) => p.engineFamily)).toEqual(["unity"]);
  });

  it("6. missing project: explicit missing-project state, never fabricated project data", () => {
    const root = tempRoot();
    cleanup.push(root);
    writeFileSync(join(root, "readme.md"), "nothing here");
    const detection = detectProjectEngines(root);
    expect(detection.isProject).toBe(false);
    const resolution = resolveGamingIntent(
      baseInput("Inspect this game project and explain how it is structured.", detection, machineDiscovery(UNITY_INSTALLED)),
    );
    const issue = resolution.issues.find((i) => i.code === "missing-project");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("blocking");
    expect(resolution.context).toBeDefined();
    expect(resolution.context?.project.isProject).toBe(false);
    expect(resolution.context?.project.detected).toHaveLength(0);
    expect(resolution.context?.project.nonProjectReason).toBeTruthy();
  });

  it("7. unavailable capability fails closed with the registry error surfaced as an issue", () => {
    const root = unityWorkspace();
    cleanup.push(root);
    const detection = detectProjectEngines(root);
    const input = baseInput("Plan the creation of a tower-defense prototype in Unity.", detection, machineDiscovery(UNITY_INSTALLED));
    input.requestedCapabilities = ["unity/scene.build"];
    const resolution = resolveGamingIntent(input);
    const failed = resolution.capabilityResults.find((c) => c.request.id === "unity/scene.build");
    expect(failed?.ok).toBe(false);
    expect(failed?.error.code).toBe("unavailable");
    const issue = resolution.issues.find((i) => i.code === "unavailable-capability");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("blocking");
    expect(issue?.message).toContain("unity/scene.build");
  });

  it("8. unsupported gaming request: no concept, no gaming context — normal ZCode answer path", () => {
    const root = tempRoot();
    cleanup.push(root);
    const detection = detectProjectEngines(root);
    const resolution = resolveGamingIntent(
      baseInput("Sell my game on Steam and set up the payments for me.", detection, machineDiscovery(UNITY_INSTALLED)),
    );
    expect(resolution.isGaming).toBe(true);
    expect(resolution.classification.supported).toBe(false);
    expect(resolution.concept).toBeUndefined();
    expect(resolution.context).toBeUndefined();
    const issue = resolution.issues.find((i) => i.code === "unsupported-request");
    expect(issue?.severity).toBe("blocking");
  });

  it("9. meaningful substitution requires approval — never a silent engine swap", () => {
    const root = tempRoot();
    cleanup.push(root);
    const detection = detectProjectEngines(root);
    const noUnityHere: DiscoveredEngine[] = [
      { engineFamily: "unity", installed: false, notes: "Unity editor not found on PATH or common install locations", headlessCapable: false, displayServerRequired: false },
      ...GODOT_INSTALLED,
    ];
    const resolution = resolveGamingIntent(
      baseInput("Make me a tower-defense prototype in Unity.", detection, machineDiscovery(noUnityHere)),
    );
    const issue = resolution.issues.find((i) => i.code === "substitution-proposed");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("approval");
    expect(issue?.candidates).toContain("godot");
    // the concept keeps the user's REQUIRED unity — the substitution is disclosed, not applied
    expect(resolution.concept?.platformPreferences).toEqual([{ engineFamily: "unity", preference: "required" }]);
    expect(resolution.engineStates.find((e) => e.engineFamily === "unity")?.state).toBe("unavailable");
    expect(resolution.context?.engines.find((e) => e.family === "unity")?.state).toBe("unavailable");
  });

  it("10. context provenance: every section traces to the real observations", () => {
    const root = unityWorkspace();
    cleanup.push(root);
    const detection = detectProjectEngines(root);
    const discovery = machineDiscovery(UNITY_INSTALLED);
    const input = baseInput("Plan the creation of a tower-defense prototype in Unity.", detection, discovery);
    input.requestedCapabilities = ["core/project.inspect"];
    const resolution = resolveGamingIntent(input);
    const ctx = resolution.context;
    // project identity + evidence come from the real detection
    const detected = detection.detected[0];
    expect(ctx?.project.identity).toBe(detected?.projectName);
    expect(ctx?.project.detected[0]?.family).toBe("unity");
    expect(ctx?.project.detected[0]?.evidence).toEqual(detected?.evidence);
    // engine state + rawVersion come from the machine discovery JOIN
    expect(ctx?.engines.find((e) => e.family === "unity")?.rawVersion).toBe("2022.3.10f1");
    // discovery timestamp + environment come from the machine record
    expect(ctx?.discovery.discoveredAt).toBe(discovery.discoveredAt);
    expect(ctx?.discovery.host).toEqual({ platform: "linux", arch: "x64" });
    // capabilities come from the registry records
    const cap = ctx?.capabilities.find((c) => c.id === "core/project.inspect");
    expect(cap?.version).toBe("1.0.0");
    expect(cap?.provider).toEqual({ kind: "agent-tool", identity: "gamos-domain@1.0.0" });
    expect(cap?.availability.state).toBe("available");
    expect(cap?.permissions[0]?.kind).toBe("command-execution");
    // source files are the real detection evidence
    expect(ctx?.sourceFiles).toEqual(detected?.evidence);
    // provenance block records the observation sources
    expect(ctx?.provenance.observedVia).toContain("project-probes");
    expect(ctx?.provenance.observedVia).toContain("machine-discovery");
    expect(ctx?.provenance.observedVia).toContain("capability-registry");
  });
});

describe("buildGamingModelContext — fail-closed provenance (M1.4)", () => {
  it("rejects an engine state for a family ABSENT from the machine discovery (never fabricated)", () => {
    const root = unityWorkspace();
    const detection = detectProjectEngines(root);
    const discovery = machineDiscovery(UNITY_INSTALLED);
    expect(() =>
      buildGamingModelContext({
        now: "2026-11-05T22:00:00Z",
        workspaceRoot: root,
        classification: classifyIntent("Inspect this game project."),
        projectDetection: detection,
        machineDiscovery: discovery,
        // godot state NOT observed on this machine — fabricating it must throw
        engineStates: [
          { engineFamily: "godot", state: "available" },
        ],
        capabilityResults: [],
      }),
    ).toThrow(/godot/);
  });
  it("includes unavailable capabilities WITH their reasons (constraints are context, not silence)", () => {
    const root = unityWorkspace();
    const detection = detectProjectEngines(root);
    const registry = makeRegistry();
    const resolution = resolveGamingIntent({
      message: "Plan the creation of a tower-defense prototype in Unity.",
      workspaceRoot: root,
      projectDetection: detection,
      machineDiscovery: machineDiscovery(UNITY_INSTALLED),
      registry,
      requestedCapabilities: ["core/project.inspect", "unity/scene.build"],
      now: "2026-11-05T22:00:00Z",
    });
    const failed = resolution.context?.capabilities.find((c) => c.id === "unity/scene.build");
    expect(failed?.resolved).toBe(false);
    expect(failed?.reason).toContain("Unity editor binary not found");
  });
});
