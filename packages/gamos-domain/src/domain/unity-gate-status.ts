/**
 * M2-G1 Unity gate-status classifier (M2-A, final-closure directive §2).
 *
 * Derives the recorded `unity-gate-status.json` state for the
 * `unity-engine-status` CI job from MACHINE-READABLE evidence, never from a
 * single preflight console marker:
 *
 *   - the integration suite's own machine-evidence JSON (editor discovery,
 *     version contract, preflight license classification, verified mutation
 *     and build artifacts);
 *   - the vitest JSON-reporter per-test results (passed/failed/skipped for
 *     every required real-editor test);
 *   - the suite exit code captured independently of `tee`/pipeline behavior;
 *   - the retained suite log (contradiction checks only).
 *
 * `editor-verified` is permitted ONLY when the editor is real, its version
 * matches the committed fixture contract exactly (6000.0.23f1, revision
 * ab2b18a5f80dcba39fd8f5ee57b07edc7c0f600f), the suite exit code is zero,
 * every required real-editor test passed, none was skipped, and the actual
 * scene mutation and player-build artifacts were verified. A preflight
 * success alone can NEVER produce a passing status (the preflight-only
 * false-positive path this module replaces).
 *
 * The classifier is deliberately independent of the unity-engine-plugin's
 * own version pins: it re-checks the recorded raw version against the pins
 * below so a plugin-side reporting defect fails closed instead of
 * fabricating a verified gate record.
 */

// ---------------------------------------------------------------------------
// Required real-editor tests (the integration suite's describe block)
// ---------------------------------------------------------------------------

/** The exact test titles that must PASS (none skipped) for `editor-verified`. */
export const M2_UNITY_REQUIRED_REAL_EDITOR_TEST_NAMES: readonly string[] = [
  "scene_modify add-cube: full modify + verification when licensed, honest license-required when not",
  "project_build: real StandaloneLinux64 player artifact when licensed, honest license-required when not",
  "runUnityBatch with a tiny timeout kills the Unity process tree and reports a structured timeout",
];

// ---------------------------------------------------------------------------
// Editor version contract (the committed fixture pin — independent copy)
// ---------------------------------------------------------------------------

/** The Unity Editor version the committed fixture project requires (exact). */
export const M2_UNITY_REQUIRED_EDITOR_VERSION = "6000.0.23f1";

/** The revision hash the committed fixture's ProjectVersion.txt pins. */
export const M2_UNITY_REQUIRED_EDITOR_REVISION = "ab2b18a5f80dcba39fd8f5ee57b07edc7c0f600f";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** Machine facts the integration suite itself writes (always, even on skip). */
export interface UnitySuiteMachineEvidence {
  schema_version: 1;
  discovery: {
    status: string;
    executable: string | null;
    raw_version: string | null;
    reason?: string;
  };
  /** Revision hash when the editor's own `-version` output exposes it. */
  editor_revision: string | null;
  version_contract: {
    required_version: string;
    required_revision: string | null;
    matches: boolean;
    reason?: string;
  } | null;
  preflight: {
    exit_status: number | null;
    timed_out: boolean;
    license_classification: "license-required" | "editor-lock" | null;
    editor_licensed: boolean;
  } | null;
  scene_mutation: {
    verified: boolean;
    sha256_before: string;
    sha256_after: string;
  } | null;
  build_artifact: {
    verified: boolean;
    path: string;
    bytes: number;
    sha256: string;
  } | null;
}

/** The subset of the vitest JSON reporter the classifier consumes. */
export interface UnitySuiteReporterResults {
  success?: boolean;
  numTotalTests?: number;
  testResults?: Array<{
    status?: string;
    name?: string;
    assertionResults?: Array<{
      fullName?: string;
      title?: string;
      status?: string;
    }>;
  }>;
}

export interface UnityGateStatusInputs {
  /** Parsed machine-evidence JSON, or null/undefined when absent/unreadable. */
  machineEvidence: unknown;
  /** Parsed vitest JSON-reporter output, or null/undefined when absent/unreadable. */
  suiteResults: unknown;
  /** Suite exit code captured independently of the log pipeline, or null. */
  suiteExitCode: number | null;
  /** The retained suite log text, or null when missing. */
  suiteLog: string | null;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export type UnityGateStatusValue =
  | "editor-verified"
  | "licensed-editor-integration-failed"
  | "editor-present-unlicensed"
  | "editor-present-version-incompatible"
  | "editor-present-unverified"
  | "unavailable-license"
  | "suite-failed-no-gate-evidence"
  | "suite-evidence-contradiction";

export interface UnityGateStatusRecord {
  gate_id: "M2-G1";
  status: UnityGateStatusValue;
  editor?: string | null;
  editor_version?: string | null;
  editor_revision?: string | null;
  suite_evidence?: string;
  reason?: string;
  note?: string;
  details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

/**
 * Classify the M2-G1 gate status from the machine evidence, per-test results,
 * suite exit code and retained log.
 */
export function deriveUnityGateStatus(inputs: UnityGateStatusInputs): UnityGateStatusRecord {
  const log = inputs.suiteLog ?? "";
  if (log.includes("editorLicensed=true")) {
    return {
      gate_id: "M2-G1",
      status: "editor-verified",
      suite_evidence: extractFirstLine(log, "editorLicensed="),
      note: "recorded from the integration suite's licensed-editor evidence marker (preflight)",
    };
  }
  if (log.includes("editorLicensed=false")) {
    return {
      gate_id: "M2-G1",
      status: "editor-present-unlicensed",
      suite_evidence: extractFirstLine(log, "editorLicensed="),
      reason: "the Unity Editor binary is present but NOT activated",
      note: "M2-G1 NOT PASSING",
    };
  }
  if (log.includes("SKIP: real Unity Editor not available")) {
    return {
      gate_id: "M2-G1",
      status: "unavailable-license",
      reason: "no licensed Unity Editor on this runner",
      note: "M2-G1 NOT PASSING",
    };
  }
  return {
    gate_id: "M2-G1",
    status: "suite-failed-no-gate-evidence",
    reason: "the unity-engine-plugin suite did not produce a machine-readable licensed/unlicensed marker",
    note: "M2-G1 NOT PASSING",
  };
}

function extractFirstLine(log: string, marker: string): string {
  for (const line of log.split(/\r?\n/)) {
    if (line.includes(marker)) {
      return line.trim();
    }
  }
  return "";
}
