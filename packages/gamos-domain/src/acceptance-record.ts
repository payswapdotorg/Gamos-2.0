/**
 * AcceptanceRecord — Gamos-specific acceptance criteria and verifiable
 * outcomes (roadmap M1.1; contract 01 revision 2). Referenced FROM the
 * GamePlan, NEVER embedded in the GameSpec.
 */

/** One verifiable acceptance criterion. */
export interface AcceptanceCriterion {
  readonly criterionId: string;
  readonly description: string;
  readonly verificationMethod: "artifact-hash" | "filesystem-probe" | "engine-query" | "output-schema" | "manual-review";
  readonly spec: string;
}

/** Outcome of evaluating one criterion (evidence-backed, never assumed). */
export interface AcceptanceCriterionResult {
  readonly criterionId: string;
  readonly status: "pending" | "passed" | "failed" | "not-applicable";
  readonly evidencePaths: readonly string[];
  readonly evidenceSha256: readonly string[];
  readonly evaluatedAt?: string;
  readonly note?: string;
}

/** The acceptance record document (pure data). */
export interface AcceptanceRecord {
  readonly recordId: string;
  readonly planRef: {
    readonly planId: string;
    readonly planSha256: string;
  };
  readonly criteria: readonly AcceptanceCriterion[];
  readonly results: readonly AcceptanceCriterionResult[];
  readonly status: "draft" | "in-progress" | "passed" | "failed";
  readonly createdAt: string;
  readonly updatedAt?: string;
}

// ---------------------------------------------------------------------------
// RED stubs — behavior implemented in the GREEN commit.
// ---------------------------------------------------------------------------

/** Validates + constructs an AcceptanceRecord from raw input. Fail-closed. */
export function parseAcceptanceRecord(_input: unknown): AcceptanceRecord {
  throw new Error("GAMOS/M1.1/RED: parseAcceptanceRecord is not implemented yet");
}

/** Deterministic canonical serialization. */
export function serializeAcceptanceRecord(_record: AcceptanceRecord): string {
  throw new Error("GAMOS/M1.1/RED: serializeAcceptanceRecord is not implemented yet");
}

/** Stable content digest of the canonical serialization. */
export function hashAcceptanceRecord(_record: AcceptanceRecord): string {
  throw new Error("GAMOS/M1.1/RED: hashAcceptanceRecord is not implemented yet");
}

/**
 * Evaluates record completeness: an AcceptanceRecord may only be `passed`
 * when every criterion has a `passed` (or explicitly `not-applicable`) result
 * with at least one evidence path + hash. Fail-closed.
 */
export function evaluateAcceptanceStatus(_record: AcceptanceRecord): AcceptanceRecord["status"] {
  throw new Error("GAMOS/M1.1/RED: evaluateAcceptanceStatus is not implemented yet");
}
