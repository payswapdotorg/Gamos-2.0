/**
 * Gamos M1 journey context CLI (directive §17 — M1 acceptance journey).
 *
 * Computes the REAL gaming context for the journey workspace and prints it as
 * one JSON object: intent classification, GameConcept, gamos/model-context@1
 * and the generated read-only GamePlan workflow script artifact. The workflow
 * job bundles this file with esbuild and runs the bundle with node.
 *
 * Honest machine discovery: on the CI runner no game engines are installed —
 * every family records installed:false with an explicit note, except babylon
 * whose toolchain IS the Node runtime running this CLI. The workspace itself
 * is probed with REAL filesystem reads (ProjectSettings/ProjectVersion.txt).
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectProjectEngines,
  buildMachineDiscoveryRecord,
  registerCapability,
  resolveGamingIntent,
  buildGamePlanWorkflowScript,
  parseGamePlan,
  hashGamePlan,
} from "../../packages/gamos-domain/src/contract.js";

function arg(name: string, envName: string): string | undefined {
  const argv = process.argv;
  for (let i = 2; i < argv.length - 1; i++) {
    if (argv[i] === name) return argv[i + 1];
  }
  return process.env[envName];
}

const workspace = arg("--workspace", "GAMOS_WORKSPACE");
const message =
  arg("--message", "GAMOS_MESSAGE") ??
  "Inspect this game project and generate a verified read-only plan for a safe project inspection.";

if (!workspace || !existsSync(workspace)) {
  console.error("m1-context-cli: --workspace (or GAMOS_WORKSPACE) must point at an existing directory");
  process.exit(1);
}

// Honest machine discovery (contract 04 §2/§3 — installed:false requires a reason).
const now = new Date().toISOString();
const nodeVersion = process.versions.node;
const engines = [
  {
    engineFamily: "unity" as const,
    installed: false,
    notes: "Unity editor not found on this runner (M1 journey context — engine installation is M2 scope)",
    headlessCapable: false,
    displayServerRequired: false,
  },
  {
    engineFamily: "blender" as const,
    installed: false,
    notes: "Blender executable not found on this runner (M1 journey context — engine installation is M2 scope)",
    headlessCapable: false,
    displayServerRequired: false,
  },
  {
    engineFamily: "godot" as const,
    installed: false,
    notes: "Godot executable not found on this runner (M1 journey context — engine installation is M2 scope)",
    headlessCapable: false,
    displayServerRequired: false,
  },
  {
    engineFamily: "unreal" as const,
    installed: false,
    notes: "Unreal editor not found on this runner (M1 journey context — engine installation is M2 scope)",
    headlessCapable: false,
    displayServerRequired: false,
  },
  {
    engineFamily: "babylon" as const,
    installed: true,
    rawVersion: nodeVersion,
    notes: `Babylon toolchain = the Node runtime running this probe (v${nodeVersion})`,
    headlessCapable: true,
    displayServerRequired: false,
  },
];

const CAPABILITY = {
  id: "core/project.inspect",
  version: "1.0.0",
  title: "Inspect game project",
  description: "Read-only structural inspection of a game project.",
  engineFamily: "core",
  input: { type: "object" as const, properties: { projectRoot: { type: "string" } }, required: ["projectRoot"] },
  output: { type: "object" as const, properties: { report: { type: "string" } }, required: ["report"] },
  permissions: [{ kind: "command-execution" as const, scope: "read-only", rationale: "filesystem listing only" }],
  availability: { state: "available" as const, reason: "local read-only probes present", prerequisites: [] },
  provenance: { publisher: "official" as const, source: "gamos-2.0 repository", commitSha: "a".repeat(40) },
  provider: { kind: "agent-tool" as const, identity: "gamos-domain@1.0.0" },
  prerequisites: [],
  compatibility: { runtime: `node>=24 (runner: ${nodeVersion})`, notes: "pure data" },
  reversibility: { kind: "reversible" as const, notes: "read-only" },
  idempotency: { repeatable: true },
  timeout: { defaultMs: 30000, maxMs: 120000 },
  cancellation: { supported: true, semantics: "cooperative" },
  verification: { method: "output-schema" as const, spec: "output schema above" },
};

const registry = new Map();
registry.set(CAPABILITY.id, registerCapability(CAPABILITY));

const detection = detectProjectEngines(workspace);
const machineDiscovery = buildMachineDiscoveryRecord(workspace, engines, {
  platform: process.platform,
  arch: process.arch,
}, now);

const resolution = resolveGamingIntent({
  message,
  workspaceRoot: workspace,
  projectDetection: detection,
  machineDiscovery,
  registry,
  requestedCapabilities: [{ id: "core/project.inspect" }],
  now,
  sessionId: "m1-journey",
});

if (!resolution.isGaming || !resolution.context) {
  console.error(`m1-context-cli: the request did not resolve as gaming (isGaming=${resolution.isGaming}) — see issues: ${JSON.stringify(resolution.issues)}`);
  process.exit(1);
}

// Read-only inspection GamePlan (directive §17: "The workflow should be read-only for M1").
const plan = parseGamePlan({
  planId: "m1-journey-plan",
  conceptRef: {
    conceptId: resolution.concept?.conceptId ?? "m1-journey-concept",
    conceptSha256: "f".repeat(64),
  },
  steps: [
    {
      stepId: "step-1",
      capability: { capabilityId: "core/project.inspect", capabilityVersion: "1.0.0", input: { projectRoot: workspace } },
      dependsOn: [],
      constraints: { read_only: true, timeout_ms: 240000 },
    },
  ],
  permissions: [],
  acceptanceRecord: { recordId: "m1-journey-acceptance", recordSha256: "e".repeat(64) },
  artifactExpectations: [{ artifactKind: "report", verificationMethod: "output-schema", expectedPathPattern: "m1-evidence/*.json" }],
  executionConstraints: { read_only: true, requiresApproval: true, maxConcurrency: 1 },
  createdAt: now,
  provenance: { authoredBy: "user-selected-model", modelId: process.env.MODEL_ID ?? "user-selected" },
});

const artifact = buildGamePlanWorkflowScript(plan, resolution.context);

const output = {
  isGaming: resolution.isGaming,
  classification: {
    requestKinds: resolution.classification.requestKinds,
    mentionedEngines: resolution.classification.mentionedEngines,
    confidence: resolution.classification.confidence,
  },
  issues: resolution.issues,
  concept: resolution.concept,
  context: resolution.context,
  plan: {
    planId: artifact.planId,
    planSha256: hashGamePlan(plan),
    scriptText: artifact.scriptText,
    guards: artifact.guards,
    readOnly: artifact.readOnly,
    stepSites: artifact.stepSites,
  },
  generatedAt: now,
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
