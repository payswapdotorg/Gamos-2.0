/**
 * GamePlan — the workflow plan associated with a GameSpec/GameConcept
 * (roadmap M1.1; contract 05 revision 2). This is where Gamos-specific
 * concerns live: engine binding, capability references, workflow steps,
 * execution constraints, permissions and the ACCEPTANCE CRITERIA — never in
 * the GameSpec itself.
 *
 * A GamePlan is ultimately represented as a Dynamic Workflow script artifact
 * executed by the EXISTING ZCode infrastructure (contract 05); this module is
 * the pure, serializable plan document, not a scheduler or runtime.
 */

import type { EngineFamily } from "./game-concept.js";

/** Reference to the GameSpec this plan was built for (never embedded). */
export interface GameSpecRef {
  /** Content digest of the GameSpec's canonical serialization. */
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
  readonly expectedPathPattern?: string;
  readonly verificationMethod: "artifact-hash" | "filesystem-probe" | "engine-query" | "output-schema";
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

// ---------------------------------------------------------------------------
// RED stubs — behavior implemented in the GREEN commit.
// ---------------------------------------------------------------------------

/** Validates + constructs a GamePlan from raw input. Fail-closed. */
export function parseGamePlan(_input: unknown): GamePlan {
  throw new Error("GAMOS/M1.1/RED: parseGamePlan is not implemented yet");
}

/** Deterministic canonical serialization. */
export function serializeGamePlan(_plan: GamePlan): string {
  throw new Error("GAMOS/M1.1/RED: serializeGamePlan is not implemented yet");
}

/** Stable content digest of the canonical serialization. */
export function hashGamePlan(_plan: GamePlan): string {
  throw new Error("GAMOS/M1.1/RED: hashGamePlan is not implemented yet");
}
