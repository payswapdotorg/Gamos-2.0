/**
 * GamePlan — the workflow plan associated with a GameSpec/GameConcept
 * (roadmap M1.1; contract 05 revision 2). Gamos-specific concerns live here:
 * engine binding, capability references, workflow steps, execution
 * constraints, permissions and the ACCEPTANCE CRITERIA reference — never in
 * the GameSpec itself.
 *
 * A GamePlan is ultimately a Dynamic Workflow script artifact executed by the
 * EXISTING ZCode infrastructure (contract 05); this module is the pure,
 * serializable plan document, not a scheduler or runtime.
 */

import { canonicalJson, assertJsonSafe, canonicalSha256 } from "../adapters/canonical.js";
import type { EngineFamily } from "./game-concept.js";
import {
  validateResourceClaims,
  findClaimConflicts,
} from "./resource-claims.js";
import type { StepResourceClaims, ClaimConflict } from "./resource-claims.js";

/** Reference to the GameSpec this plan was built for (never embedded). */
export interface GameSpecRef {
  readonly specSha256: string;
}

/** Reference to a capability in the `gamos/capability@2` registry. */
export interface CapabilityStepRef {
  readonly capabilityId: string;
  readonly capabilityVersion: string;
  readonly input: unknown;
}

/** One plan step: a capability invocation (read-only or mutation). */
export interface GamePlanStep {
  readonly stepId: string;
  readonly capability: CapabilityStepRef;
  readonly dependsOn: readonly string[];
  readonly constraints?: {
    readonly read_only?: boolean;
    readonly timeout_ms?: number;
  };
  /**
   * M3.3 additive (gamos/resource-claims@1): declared read/write resource
   * claims for this step. Optional — unchanged plans hash byte-identically;
   * when present, unordered conflicting claims fail closed at parse time.
   */
  readonly resourceClaims?: StepResourceClaims;
}

/** An engine binding decision recorded in the plan. */
export interface EngineBinding {
  readonly engineFamily: EngineFamily;
  readonly engineVersionRange?: string;
  readonly bindingReason: string;
}

/** Required permissions, mapped to the existing ZCode permission surface. */
export interface PlanPermissionRequirement {
  readonly kind:
    | "filesystem-write"
    | "command-execution"
    | "network-access"
    | "engine-headless"
    | "engine-gui"
    | "artifact-publish";
  readonly scope: string;
  readonly rationale: string;
}

/** Reference to the separate AcceptanceRecord (never embedded in GameSpec). */
export interface AcceptanceRecordRef {
  readonly recordId: string;
  readonly recordSha256: string;
}

/** Expected outputs of the plan — verified by evidence, never assumed. */
export interface PlanArtifactExpectation {
  readonly artifactKind: "file" | "scene" | "build" | "render" | "screenshot" | "report";
  readonly verificationMethod: "artifact-hash" | "filesystem-probe" | "engine-query" | "output-schema";
  readonly expectedPathPattern?: string;
}

/** The plan document (pure data). */
export interface GamePlan {
  readonly planId: string;
  readonly conceptRef: {
    readonly conceptId: string;
    readonly conceptSha256: string;
  };
  readonly specRef?: GameSpecRef;
  readonly engineBinding?: EngineBinding;
  readonly steps: readonly GamePlanStep[];
  readonly permissions: readonly PlanPermissionRequirement[];
  readonly acceptanceRecord: AcceptanceRecordRef;
  readonly artifactExpectations: readonly PlanArtifactExpectation[];
  readonly executionConstraints: {
    readonly maxConcurrency?: number;
    readonly requiresApproval?: boolean;
    readonly read_only?: boolean;
  };
  readonly createdAt: string;
  readonly provenance: {
    readonly authoredBy: "user-selected-model" | "tl" | "worker";
    readonly modelId?: string;
    readonly sessionId?: string;
  };
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9a-zA-Z.-]+)?$/;
const CAPABILITY_ID_PATTERN = /^[a-z0-9-]+\/[a-z0-9.-]+$/;

const PERMISSION_KINDS = [
  "filesystem-write",
  "command-execution",
  "network-access",
  "engine-headless",
  "engine-gui",
  "artifact-publish",
] as const;

const ARTIFACT_KINDS = ["file", "scene", "build", "render", "screenshot", "report"] as const;

const VERIFICATION_METHODS = ["artifact-hash", "filesystem-probe", "engine-query", "output-schema"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(field: string, reason: string): never {
  throw new Error(`GAMOS/GAME-PLAN: ${field} — ${reason}`);
}

/**
 * Validates + constructs a GamePlan from raw input. Fail-closed on: duplicate
 * step ids, dangling step dependencies, missing acceptance-record
 * reference, inline acceptance criteria, malformed ids/hashes/versions.
 */
export function parseGamePlan(input: unknown): GamePlan {
  if (!isRecord(input)) fail("input", "must be a non-null object");
  if (input.planId === undefined || typeof input.planId !== "string" || !ID_PATTERN.test(input.planId)) {
    fail("planId", `must match ${ID_PATTERN}`);
  }

  // Concept reference: id + 64-hex digest.
  const conceptRef = input.conceptRef;
  if (!isRecord(conceptRef)) fail("conceptRef", "must be an object");
  if (typeof conceptRef.conceptId !== "string" || !ID_PATTERN.test(conceptRef.conceptId)) {
    fail("conceptRef.conceptId", `must match ${ID_PATTERN}`);
  }
  if (typeof conceptRef.conceptSha256 !== "string" || !SHA256_PATTERN.test(conceptRef.conceptSha256)) {
    fail("conceptRef.conceptSha256", "must be a 64-hex sha256");
  }

  // Optional spec reference: 64-hex digest only (the spec is never embedded).
  let specRef: GameSpecRef | undefined;
  if (input.specRef !== undefined) {
    if (!isRecord(input.specRef)) fail("specRef", "must be an object");
    if (typeof input.specRef.specSha256 !== "string" || !SHA256_PATTERN.test(input.specRef.specSha256)) {
      fail("specRef.specSha256", "must be a 64-hex sha256");
    }
    specRef = { specSha256: input.specRef.specSha256 };
  }

  // Optional engine binding.
  let engineBinding: EngineBinding | undefined;
  if (input.engineBinding !== undefined) {
    const eb = input.engineBinding;
    if (!isRecord(eb)) fail("engineBinding", "must be an object");
    if (typeof eb.engineFamily !== "string" || !["unity", "blender", "babylon", "godot", "unreal", "core"].includes(eb.engineFamily)) {
      fail("engineBinding.engineFamily", "must be a known engine family");
    }
    if (typeof eb.bindingReason !== "string" || eb.bindingReason.length === 0) {
      fail("engineBinding.bindingReason", "must be a non-empty string");
    }
    if (eb.engineVersionRange !== undefined && typeof eb.engineVersionRange !== "string") {
      fail("engineBinding.engineVersionRange", "must be a string when present");
    }
    engineBinding = {
      engineFamily: eb.engineFamily as EngineFamily,
      ...(eb.engineVersionRange !== undefined ? { engineVersionRange: eb.engineVersionRange } : {}),
      bindingReason: eb.bindingReason,
    };
  }

  // Steps: unique ids, valid capability refs, resolvable dependencies.
  if (!Array.isArray(input.steps)) fail("steps", "must be an array");
  const stepIds = new Set<string>();
  const validatedClaimsByStep = new Map<string, StepResourceClaims>();
  for (const step of input.steps) {
    if (!isRecord(step)) fail("steps[]", "each step must be an object");
    if (typeof step.stepId !== "string" || !ID_PATTERN.test(step.stepId)) {
      fail("steps[].stepId", `must match ${ID_PATTERN}`);
    }
    if (stepIds.has(step.stepId)) fail("steps[].stepId", `duplicate step id ${step.stepId}`);
    stepIds.add(step.stepId);
    const cap = step.capability;
    if (!isRecord(cap)) fail("steps[].capability", "must be an object");
    if (typeof cap.capabilityId !== "string" || !CAPABILITY_ID_PATTERN.test(cap.capabilityId)) {
      fail("steps[].capability.capabilityId", `must match ${CAPABILITY_ID_PATTERN}`);
    }
    if (typeof cap.capabilityVersion !== "string" || !SEMVER_PATTERN.test(cap.capabilityVersion)) {
      fail("steps[].capability.capabilityVersion", "must be a semver string");
    }
    if (!Array.isArray(step.dependsOn)) fail("steps[].dependsOn", "must be an array");
    for (const dep of step.dependsOn) {
      if (typeof dep !== "string" || !ID_PATTERN.test(dep)) {
        fail("steps[].dependsOn", "each dependency must be a step-id string");
      }
    }
    if (step.constraints !== undefined && !isRecord(step.constraints)) {
      fail("steps[].constraints", "must be an object when present");
    }
    if (isRecord(step.constraints)) {
      if (step.constraints.read_only !== undefined && typeof step.constraints.read_only !== "boolean") {
        fail("steps[].constraints.read_only", "must be boolean when present");
      }
      if (step.constraints.timeout_ms !== undefined && typeof step.constraints.timeout_ms !== "number") {
        fail("steps[].constraints.timeout_ms", "must be a number when present");
      }
    }
    // M3.3 resource claims: validated through the versioned contract; the
    // normalized claim set replaces the raw field so the plan (and its
    // deterministic hash) carries exactly the validated claims.
    if (step.resourceClaims !== undefined) {
      validatedClaimsByStep.set(step.stepId as string, validateResourceClaims(step.resourceClaims));
    }
  }
  // Dependencies must resolve AFTER all steps are collected (DAG order),
  // and the dependency graph must be ACYCLIC (a self- or circularly-dependent
  // plan can never execute through the workflow runtime).
  for (const step of input.steps as Record<string, unknown>[]) {
    for (const dep of (step as { dependsOn: unknown[] }).dependsOn) {
      if (!stepIds.has(dep as string)) {
        fail("steps[].dependsOn", `step ${String(step.stepId)} depends on nonexistent step ${String(dep)}`);
      }
    }
  }
  const adjacency = new Map<string, string[]>();
  for (const step of input.steps as Record<string, unknown>[]) {
    adjacency.set(
      step.stepId as string,
      ((step as { dependsOn: unknown[] }).dependsOn ?? []).map((d) => String(d)),
    );
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const detectCycle = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      fail("steps[].dependsOn", `dependency cycle detected involving step ${id}`);
    }
    visiting.add(id);
    for (const dep of adjacency.get(id) ?? []) detectCycle(dep);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of adjacency.keys()) detectCycle(id);

  // M3.3 resource-claim conflict gate: unordered conflicting claims fail
  // closed (handoff §5.3 rules 2-4). Serialization through an explicit
  // dependsOn edge is the remediation; there is no silent resolution.
  const stepsWithValidatedClaims = (input.steps as Record<string, unknown>[]).map((step) => {
    const validated = validatedClaimsByStep.get(step.stepId as string);
    return validated === undefined ? step : { ...step, resourceClaims: validated };
  }) as unknown as readonly GamePlanStep[];
  const claimConflicts: readonly ClaimConflict[] = findClaimConflicts(stepsWithValidatedClaims);
  if (claimConflicts.length > 0) {
    const first = claimConflicts[0] as ClaimConflict;
    fail(
      "steps[].resourceClaims",
      `conflicting unordered claims between step ${first.stepA} and step ${first.stepB} over ${first.path} (${first.kind}) — add an explicit dependsOn edge or narrow the claims (${claimConflicts.length} conflict(s); no silent serialization)`,
    );
  }

  // Permissions.
  if (input.permissions !== undefined && !Array.isArray(input.permissions)) {
    fail("permissions", "must be an array");
  }
  for (const perm of (input.permissions ?? []) as Record<string, unknown>[]) {
    if (!isRecord(perm)) fail("permissions[]", "each entry must be an object");
    if (!(PERMISSION_KINDS as readonly string[]).includes(perm.kind as string)) {
      fail("permissions[].kind", `must be one of ${PERMISSION_KINDS.join("|")}`);
    }
    if (typeof perm.scope !== "string" || perm.scope.length === 0) fail("permissions[].scope", "must be a non-empty string");
    if (typeof perm.rationale !== "string" || perm.rationale.length === 0) fail("permissions[].rationale", "must be a non-empty string");
  }

  // Acceptance-record REFERENCE is mandatory; inline acceptance criteria are forbidden.
  if (input.acceptance === undefined && !isRecord(input.acceptanceRecord)) {
    fail("acceptanceRecord", "a plan must reference a separate AcceptanceRecord (contract 01 revision 2)");
  }
  if (input.acceptance !== undefined) {
    fail("acceptance", "acceptance criteria are NEVER embedded in the plan; reference an AcceptanceRecord instead (contract 01 revision 2)");
  }
  const ar = input.acceptanceRecord as Record<string, unknown>;
  if (typeof ar.recordId !== "string" || !ID_PATTERN.test(ar.recordId)) {
    fail("acceptanceRecord.recordId", `must match ${ID_PATTERN}`);
  }
  if (typeof ar.recordSha256 !== "string" || !SHA256_PATTERN.test(ar.recordSha256)) {
    fail("acceptanceRecord.recordSha256", "must be a 64-hex sha256");
  }

  // Artifact expectations.
  if (input.artifactExpectations !== undefined && !Array.isArray(input.artifactExpectations)) {
    fail("artifactExpectations", "must be an array");
  }
  for (const ae of (input.artifactExpectations ?? []) as Record<string, unknown>[]) {
    if (!isRecord(ae)) fail("artifactExpectations[]", "each entry must be an object");
    if (!(ARTIFACT_KINDS as readonly string[]).includes(ae.artifactKind as string)) {
      fail("artifactExpectations[].artifactKind", `must be one of ${ARTIFACT_KINDS.join("|")}`);
    }
    if (!(VERIFICATION_METHODS as readonly string[]).includes(ae.verificationMethod as string)) {
      fail("artifactExpectations[].verificationMethod", `must be one of ${VERIFICATION_METHODS.join("|")}`);
    }
  }

  // Execution constraints.
  let executionConstraints: GamePlan["executionConstraints"];
  if (input.executionConstraints !== undefined) {
    const ec = input.executionConstraints;
    if (!isRecord(ec)) fail("executionConstraints", "must be an object");
    if (ec.maxConcurrency !== undefined && (!Number.isInteger(ec.maxConcurrency) || (ec.maxConcurrency as number) < 1)) {
      fail("executionConstraints.maxConcurrency", "must be a positive integer");
    }
    if (ec.requiresApproval !== undefined && typeof ec.requiresApproval !== "boolean") {
      fail("executionConstraints.requiresApproval", "must be boolean when present");
    }
    if (ec.read_only !== undefined && typeof ec.read_only !== "boolean") {
      fail("executionConstraints.read_only", "must be boolean when present");
    }
    executionConstraints = {
      ...(ec.maxConcurrency !== undefined ? { maxConcurrency: ec.maxConcurrency as number } : {}),
      ...(ec.requiresApproval !== undefined ? { requiresApproval: ec.requiresApproval as boolean } : {}),
      ...(ec.read_only !== undefined ? { read_only: ec.read_only as boolean } : {}),
    };
  } else {
    executionConstraints = {};
  }

  if (typeof input.createdAt !== "string" || !Number.isFinite(Date.parse(input.createdAt))) {
    fail("createdAt", "must be an ISO-8601 timestamp");
  }

  // Provenance of plan authorship.
  const prov = input.provenance;
  if (!isRecord(prov)) fail("provenance", "must be an object");
  if (!["user-selected-model", "tl", "worker"].includes(prov.authoredBy as string)) {
    fail("provenance.authoredBy", 'must be "user-selected-model" | "tl" | "worker"');
  }
  if (prov.modelId !== undefined && typeof prov.modelId !== "string") fail("provenance.modelId", "must be a string when present");
  if (prov.sessionId !== undefined && typeof prov.sessionId !== "string") fail("provenance.sessionId", "must be a string when present");

  // Non-serializable input fails closed.
  assertJsonSafe(input);

  const plan: GamePlan = {
    planId: input.planId as string,
    conceptRef: {
      conceptId: conceptRef.conceptId as string,
      conceptSha256: conceptRef.conceptSha256 as string,
    },
    ...(specRef ? { specRef } : {}),
    ...(engineBinding ? { engineBinding } : {}),
    steps: stepsWithValidatedClaims,
    permissions: (input.permissions ?? []) as readonly PlanPermissionRequirement[],
    acceptanceRecord: {
      recordId: ar.recordId as string,
      recordSha256: ar.recordSha256 as string,
    },
    artifactExpectations: (input.artifactExpectations ?? []) as readonly PlanArtifactExpectation[],
    executionConstraints,
    createdAt: input.createdAt as string,
    provenance: {
      authoredBy: prov.authoredBy as GamePlan["provenance"]["authoredBy"],
      ...(prov.modelId !== undefined ? { modelId: prov.modelId as string } : {}),
      ...(prov.sessionId !== undefined ? { sessionId: prov.sessionId as string } : {}),
    },
  };
  assertJsonSafe(plan);
  return plan;
}

/** Deterministic canonical serialization. */
export function serializeGamePlan(plan: GamePlan): string {
  return canonicalJson(plan);
}

/** Stable SHA-256 content digest of the canonical serialization. */
export function hashGamePlan(plan: GamePlan): string {
  return canonicalSha256(plan);
}
