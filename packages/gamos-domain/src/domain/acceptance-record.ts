/**
 * AcceptanceRecord — Gamos-specific acceptance criteria and verifiable
 * outcomes (roadmap M1.1; contract 01 revision 2). Referenced FROM the
 * GamePlan, NEVER embedded in the GameSpec.
 */

import { canonicalJson, assertJsonSafe, canonicalSha256 } from "../adapters/canonical.js";

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

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const VERIFICATION_METHODS = [
  "artifact-hash",
  "filesystem-probe",
  "engine-query",
  "output-schema",
  "manual-review",
] as const;
const RESULT_STATUSES = ["pending", "passed", "failed", "not-applicable"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(field: string, reason: string): never {
  throw new Error(`GAMOS/ACCEPTANCE-RECORD: ${field} — ${reason}`);
}

/**
 * Validates + constructs an AcceptanceRecord from raw input. Fail-closed:
 * results must reference declared criteria; digests must be 64-hex; a
 * `passed` status in the record body is only allowed when the evidence
 * backs it (see evaluateAcceptanceStatus for the normative evaluation).
 */
export function parseAcceptanceRecord(input: unknown): AcceptanceRecord {
  if (!isRecord(input)) fail("input", "must be a non-null object");
  if (typeof input.recordId !== "string" || !ID_PATTERN.test(input.recordId)) {
    fail("recordId", `must match ${ID_PATTERN}`);
  }

  const planRef = input.planRef;
  if (!isRecord(planRef)) fail("planRef", "must be an object");
  if (typeof planRef.planId !== "string" || !ID_PATTERN.test(planRef.planId)) {
    fail("planRef.planId", `must match ${ID_PATTERN}`);
  }
  if (typeof planRef.planSha256 !== "string" || !SHA256_PATTERN.test(planRef.planSha256)) {
    fail("planRef.planSha256", "must be a 64-hex sha256");
  }

  if (!Array.isArray(input.criteria)) fail("criteria", "must be an array");
  const criterionIds = new Set<string>();
  for (const criterion of input.criteria) {
    if (!isRecord(criterion)) fail("criteria[]", "each criterion must be an object");
    const criterionId = criterion.criterionId;
    if (typeof criterionId !== "string" || !ID_PATTERN.test(criterionId)) {
      fail("criteria[].criterionId", `must match ${ID_PATTERN}`);
    }
    if (criterionIds.has(criterionId)) {
      fail("criteria[].criterionId", `duplicate criterion id ${criterionId}`);
    }
    criterionIds.add(criterionId);
    const criterionDescription = criterion.description;
    if (typeof criterionDescription !== "string" || criterionDescription.length === 0) {
      fail("criteria[].description", "must be a non-empty string");
    }
    const criterionVerification = criterion.verificationMethod;
    if (!(VERIFICATION_METHODS as readonly string[]).includes(criterionVerification as string)) {
      fail("criteria[].verificationMethod", `must be one of ${VERIFICATION_METHODS.join("|")}`);
    }
    const criterionSpec = criterion.spec;
    if (typeof criterionSpec !== "string" || criterionSpec.length === 0) {
      fail("criteria[].spec", "must be a non-empty string");
    }
  }

  if (!Array.isArray(input.results)) fail("results", "must be an array");
  for (const result of input.results) {
    if (!isRecord(result)) fail("results[]", "each result must be an object");
    const resultCriterionId = result.criterionId;
    if (typeof resultCriterionId !== "string" || !criterionIds.has(resultCriterionId)) {
      fail("results[].criterionId", `references unknown criterion ${resultCriterionId}`);
    }
    const resultStatus = result.status;
    if (resultStatus !== "pending" && resultStatus !== "passed" && resultStatus !== "failed" && resultStatus !== "not-applicable") {
      fail("results[].status", `must be one of ${RESULT_STATUSES.join("|")}`);
    }
    if (!Array.isArray(result.evidencePaths)) fail("results[].evidencePaths", "must be an array");
    if (!Array.isArray(result.evidenceSha256)) fail("results[].evidenceSha256", "must be an array");
    if (result.evidencePaths.length !== result.evidenceSha256.length) {
      fail("results[].evidence", "evidencePaths and evidenceSha256 must be paired 1:1");
    }
    for (const digest of result.evidenceSha256) {
      if (typeof digest !== "string" || !SHA256_PATTERN.test(digest)) {
        fail("results[].evidenceSha256", "each digest must be 64-hex sha256");
      }
    }
    if (result.evaluatedAt !== undefined && (typeof result.evaluatedAt !== "string" || !Number.isFinite(Date.parse(result.evaluatedAt)))) {
      fail("results[].evaluatedAt", "must be an ISO-8601 timestamp when present");
    }
    if (result.note !== undefined && typeof result.note !== "string") {
      fail("results[].note", "must be a string when present");
    }
  }

  if (typeof input.status !== "string" || !["draft", "in-progress", "passed", "failed"].includes(input.status)) {
    fail("status", 'must be "draft" | "in-progress" | "passed" | "failed"');
  }
  if (typeof input.createdAt !== "string" || !Number.isFinite(Date.parse(input.createdAt))) {
    fail("createdAt", "must be an ISO-8601 timestamp");
  }
  if (input.updatedAt !== undefined && (typeof input.updatedAt !== "string" || !Number.isFinite(Date.parse(input.updatedAt)))) {
    fail("updatedAt", "must be an ISO-8601 timestamp when present");
  }

  assertJsonSafe(input);

  const record: AcceptanceRecord = {
    recordId: input.recordId,
    planRef: { planId: planRef.planId as string, planSha256: planRef.planSha256 as string },
    criteria: input.criteria as readonly AcceptanceCriterion[],
    results: input.results as readonly AcceptanceCriterionResult[],
    status: input.status as AcceptanceRecord["status"],
    createdAt: input.createdAt,
    ...(input.updatedAt !== undefined ? { updatedAt: input.updatedAt as string } : {}),
  };
  assertJsonSafe(record);
  return record;
}

/** Deterministic canonical serialization. */
export function serializeAcceptanceRecord(record: AcceptanceRecord): string {
  return canonicalJson(record);
}

/** Stable SHA-256 content digest of the canonical serialization. */
export function hashAcceptanceRecord(record: AcceptanceRecord): string {
  return canonicalSha256(record);
}

/**
 * Evaluates record completeness (normative): `passed` ONLY when every
 * criterion has a `passed` (or explicitly `not-applicable`) result carrying
 * at least one evidence path + digest. `failed` if any criterion failed.
 * Otherwise `in-progress`. Evidence-free `passed` results never count.
 */
export function evaluateAcceptanceStatus(record: AcceptanceRecord): AcceptanceRecord["status"] {
  const byCriterion = new Map<string, AcceptanceCriterionResult>();
  for (const result of record.results) {
    byCriterion.set(result.criterionId, result);
  }
  let sawFailed = false;
  let sawPending = false;
  for (const criterion of record.criteria) {
    const result = byCriterion.get(criterion.criterionId);
    if (result === undefined) return "in-progress"; // criterion not evaluated yet
    if (result.status === "failed") {
      sawFailed = true;
      continue;
    }
    if (result.status === "pending") {
      sawPending = true;
      continue;
    }
    if (result.status === "not-applicable") continue;
    // status === "passed": must carry real evidence (path + digest).
    if (result.evidencePaths.length === 0 || result.evidenceSha256.length === 0) {
      sawPending = true; // a passing result without evidence is NOT accepted
      continue;
    }
  }
  if (sawFailed) return "failed";
  if (sawPending) return "in-progress";
  return "passed";
}
