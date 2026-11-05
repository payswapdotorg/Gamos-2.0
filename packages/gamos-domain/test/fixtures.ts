/**
 * Shared test fixtures for the gamos-domain suite. The GameIR fixture is a
 * structurally-valid document per the upstream kernel's own rules
 * (identity: id + displayName + kind + repository + revision + lineage with a
 * 40-hex head; entry resolves to a declared scene node).
 */

export const validIdentity = {
  id: "example-game",
  displayName: "Example Game",
  kind: "game",
  repository: { host: "github.com", owner: "payswapdotorg", repository: "example-game" },
  revision: { kind: "commit", commit: "196b305e75decfeaa162d3da479dc125cff1521a" },
  lineage: {
    head: "196b305e75decfeaa162d3da479dc125cff1521a",
    ancestors: ["a9fe401eede6e6e5e01be9048679c206fe6f02d9"],
  },
};

export const validGameIR = {
  irVersion: "1",
  identity: validIdentity,
  entry: { world: "w0", scene: "s0" },
  nodes: [
    { id: "w0", kind: "world", world: "w0", scenes: ["s0"] },
    { id: "s0", kind: "scene", world: "w0", scene: "s0", entities: [] },
  ],
};

export const validConceptInput = {
  conceptId: "concept-001",
  kind: "gaming",
  genre: ["tower-defense"],
  mechanics: ["resource-economy", "wave-spawning"],
  platformPreferences: [{ engineFamily: "babylon", preference: "preferred" }],
  references: [{ kind: "game-title", ref: "Bloons TD 6", note: "pacing reference" }],
  constraints: ["read-only inspection only"],
  projectContext: {
    projectRoot: "/workspace/my-game",
    discoveryRecordRef: "discovery-2026-11-05T20:30:00Z",
  },
  acceptanceExpectations: ["project structure is explained with evidence"],
  provenance: {
    origin: "user-message",
    sessionId: "sess_example",
    capturedAt: "2026-11-05T20:30:00Z",
  },
};

export const validPlanInput = {
  planId: "plan-001",
  conceptRef: { conceptId: "concept-001", conceptSha256: "a".repeat(64) },
  engineBinding: {
    engineFamily: "babylon",
    bindingReason: "project dependencies discovered (M1.3)",
  },
  steps: [
    {
      stepId: "step-1",
      capability: { capabilityId: "core/project.inspect", capabilityVersion: "1.0.0", input: {} },
      dependsOn: [],
      constraints: { read_only: true, timeout_ms: 30000 },
    },
    {
      stepId: "step-2",
      capability: { capabilityId: "core/capability.report", capabilityVersion: "1.0.0", input: {} },
      dependsOn: ["step-1"],
      constraints: { read_only: true },
    },
  ],
  permissions: [
    { kind: "filesystem-write", scope: "workspace:reports", rationale: "inspection report output" },
  ],
  acceptanceRecord: { recordId: "acc-001", recordSha256: "b".repeat(64) },
  artifactExpectations: [
    { artifactKind: "report", verificationMethod: "artifact-hash", expectedPathPattern: "reports/*.md" },
  ],
  executionConstraints: { read_only: true, requiresApproval: true, maxConcurrency: 2 },
  createdAt: "2026-11-05T20:30:00Z",
  provenance: {
    authoredBy: "user-selected-model",
    modelId: "nvidia/nemotron-3-ultra-550b-a55b:free",
  },
};

export const validAcceptanceInput = {
  recordId: "acc-001",
  planRef: { planId: "plan-001", planSha256: "c".repeat(64) },
  criteria: [
    {
      criterionId: "crit-1",
      description: "inspection report exists and is hashed",
      verificationMethod: "artifact-hash",
      spec: "reports/inspection.md",
    },
  ],
  results: [
    {
      criterionId: "crit-1",
      status: "passed",
      evidencePaths: ["reports/inspection.md"],
      evidenceSha256: ["d".repeat(64)],
      evaluatedAt: "2026-11-05T21:00:00Z",
    },
  ],
  status: "in-progress",
  createdAt: "2026-11-05T20:31:00Z",
};

export const expectedArtifact = {
  artifactId: "art-001-expected",
  kind: "report",
  planRef: { planId: "plan-001", stepId: "step-2" },
  description: "inspection report (expected, not yet produced)",
  createdAt: "2026-11-05T21:00:00Z",
};

export const verifiedArtifact = {
  ...expectedArtifact,
  artifactId: "art-001-verified",
  existence: {
    verifiedAt: "2026-11-05T21:05:00Z",
    verifiedBy: "artifact-hash",
    path: "reports/inspection.md",
    sha256: "e".repeat(64),
    bytes: 1024,
  },
};

export const completeCapabilityRecord = {
  id: "core/project.inspect",
  version: "1.0.0",
  title: "Inspect game project",
  description: "Read-only structural inspection of a game project.",
  engineFamily: "core",
  input: {
    type: "object",
    properties: { projectRoot: { type: "string" } },
    required: ["projectRoot"],
  },
  output: { type: "object", properties: { report: { type: "string" } }, required: ["report"] },
  permissions: [
    { kind: "command-execution", scope: "read-only", rationale: "filesystem listing only" },
  ],
  availability: { state: "available", reason: "local probes present", prerequisites: [] },
  provenance: {
    publisher: "official",
    source: "gamos-2.0 repository",
    commitSha: "a".repeat(40),
  },
  provider: { kind: "agent-tool", identity: "gamos-domain@1.0.0" },
  prerequisites: [],
  compatibility: { runtime: "node>=24", notes: "pure data" },
  reversibility: { kind: "reversible", notes: "read-only" },
  idempotency: { repeatable: true },
  timeout: { defaultMs: 30000, maxMs: 120000 },
  cancellation: { supported: true, semantics: "cooperative" },
  verification: { method: "output-schema", spec: "output schema above" },
};
