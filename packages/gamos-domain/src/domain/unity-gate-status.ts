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
 * ab2b18a5f80dcba39fd8f5ee57b07edc7c0f600f where exposed), the suite exit
 * code is zero, every required real-editor test passed, none was skipped,
 * and the actual scene mutation and player-build artifacts were verified. A
 * preflight success alone can NEVER produce a passing status (the
 * preflight-only false-positive path this module replaces).
 *
 * The classifier is deliberately independent of the unity-engine-plugin's
 * own version pins: it re-checks the recorded raw version against the pins
 * below so a plugin-side reporting defect fails closed instead of
 * fabricating a verified gate record.
 *
 * Contradiction policy: the machine evidence is authoritative for WHY the
 * gate is closed; the retained log is cross-checked against it, and any
 * marker-level contradiction fails closed to `suite-evidence-contradiction`
 * (both readings are non-passing, but contradictory evidence must never be
 * recorded as a clean state). A reporter claiming "passed" while discovery
 * says the editor is unavailable can never reach `editor-verified` (the
 * discovery gate runs first); it is recorded as a warning detail on the
 * honest unavailable state rather than promoted to a contradiction.
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

const NOT_PASSING = "M2-G1 NOT PASSING";

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

/**
 * Classify the M2-G1 gate status from the machine evidence, per-test results,
 * suite exit code and retained log. Pure: no I/O, no clock, no process.
 */
export function deriveUnityGateStatus(inputs: UnityGateStatusInputs): UnityGateStatusRecord {
  // (1) Machine evidence is mandatory and must be well-formed — a missing or
  //     malformed evidence file means the suite crashed before recording its
  //     facts; that can never be a passing gate.
  const evidence = parseMachineEvidence(inputs.machineEvidence);
  if (evidence === null) {
    return {
      gate_id: "M2-G1",
      status: "suite-failed-no-gate-evidence",
      reason:
        "the suite's machine-evidence file is missing or malformed (schema mismatch — the suite may have crashed before recording its facts)",
      note: NOT_PASSING,
    };
  }

  // (2) Marker-level contradiction checks: the retained log is only evidence
  //     about what the suite PRINTED; the machine evidence is what it RECORDED.
  //     A disagreement means the evidence bundle is not trustworthy → fail closed.
  const contradiction = findLogEvidenceContradiction(evidence, inputs.suiteLog);
  if (contradiction !== null) {
    return {
      gate_id: "M2-G1",
      status: "suite-evidence-contradiction",
      reason: contradiction,
      note: `${NOT_PASSING} — contradictory evidence fails closed`,
      details: { editor: evidence.discovery.executable ?? undefined },
    };
  }

  // (3) Internal consistency of the machine evidence itself.
  if (evidence.preflight !== null && evidence.preflight.editor_licensed && evidence.preflight.exit_status !== 0) {
    return {
      gate_id: "M2-G1",
      status: "suite-evidence-contradiction",
      reason: `machine evidence records editor_licensed=true with preflight exit_status=${String(
        evidence.preflight.exit_status,
      )} (incoherent)`,
      note: NOT_PASSING,
    };
  }

  // (4) Discovery outcome first: no editor → honest unavailable state.
  const discoveryStatus = evidence.discovery.status;
  if (discoveryStatus === "unavailable" || discoveryStatus === "license-required") {
    const warnings = reporterClaimsPassedWhileUnavailable(inputs.suiteResults);
    return {
      gate_id: "M2-G1",
      status: "unavailable-license",
      reason:
        evidence.discovery.reason ??
        "no usable Unity Editor on this runner; Unity licensing is an external, user-controlled prerequisite and is never fabricated",
      note: `${NOT_PASSING} — the milestone cannot complete until a licensed runner provides UNITY_EDITOR_PATH and the real integration passes; the compliant free path is documented in docs/gamos/UNITY-M2G1-PROVISIONING.md`,
      details: {
        discovery_status: discoveryStatus,
        ...(warnings.length > 0 ? { warnings } : {}),
      },
    };
  }
  if (discoveryStatus === "version-unknown") {
    return {
      gate_id: "M2-G1",
      status: "editor-present-unverified",
      editor: evidence.discovery.executable,
      reason:
        evidence.discovery.reason ??
        "the editor executable is present but its version could not be determined (discovery probe rejected it)",
      note: NOT_PASSING,
    };
  }
  if (discoveryStatus !== "available") {
    return {
      gate_id: "M2-G1",
      status: "suite-failed-no-gate-evidence",
      reason: `machine evidence records an unknown discovery status "${discoveryStatus}"`,
      note: NOT_PASSING,
    };
  }

  // (5) Version contract (M2-B): an editor that does not EXACTLY match the
  //     committed fixture pin is incompatible — never licensed or verified.
  if (evidence.version_contract === null) {
    return {
      gate_id: "M2-G1",
      status: "suite-failed-no-gate-evidence",
      reason: "machine evidence is missing the version-contract record (mandatory for an available editor)",
      note: NOT_PASSING,
    };
  }
  if (evidence.version_contract.required_version !== M2_UNITY_REQUIRED_EDITOR_VERSION) {
    return {
      gate_id: "M2-G1",
      status: "suite-failed-no-gate-evidence",
      reason: `version-contract pin drift: the suite checked against "${evidence.version_contract.required_version}" but the gate classifier requires "${M2_UNITY_REQUIRED_EDITOR_VERSION}"`,
      note: NOT_PASSING,
    };
  }
  if (evidence.discovery.raw_version === null || evidence.discovery.raw_version === "") {
    return {
      gate_id: "M2-G1",
      status: "suite-failed-no-gate-evidence",
      reason: "machine evidence records an available editor without a raw version",
      note: NOT_PASSING,
    };
  }
  if (evidence.discovery.raw_version !== M2_UNITY_REQUIRED_EDITOR_VERSION) {
    return {
      gate_id: "M2-G1",
      status: "editor-present-version-incompatible",
      editor: evidence.discovery.executable,
      editor_version: evidence.discovery.raw_version,
      reason: `editor ${evidence.discovery.raw_version} does not match the fixture requirement ${M2_UNITY_REQUIRED_EDITOR_VERSION} exactly (the version contract is exact, not a floor)`,
      note: NOT_PASSING,
    };
  }
  if (evidence.editor_revision !== null && evidence.editor_revision !== M2_UNITY_REQUIRED_EDITOR_REVISION) {
    return {
      gate_id: "M2-G1",
      status: "editor-present-version-incompatible",
      editor: evidence.discovery.executable,
      editor_version: evidence.discovery.raw_version,
      editor_revision: evidence.editor_revision,
      reason: `editor revision ${evidence.editor_revision} does not match the fixture requirement ${M2_UNITY_REQUIRED_EDITOR_REVISION}`,
      note: NOT_PASSING,
    };
  }
  if (evidence.version_contract.matches !== true) {
    return {
      gate_id: "M2-G1",
      status: "editor-present-version-incompatible",
      editor: evidence.discovery.executable,
      editor_version: evidence.discovery.raw_version,
      reason:
        evidence.version_contract.reason ??
        `the suite's own version-contract check reported a mismatch against ${M2_UNITY_REQUIRED_EDITOR_VERSION}`,
      note: NOT_PASSING,
    };
  }

  // (6) Preflight: the license classification is what the REAL batch
  //     invocation proved. No preflight record → the suite never got there.
  if (evidence.preflight === null) {
    return {
      gate_id: "M2-G1",
      status: "editor-present-unverified",
      editor: evidence.discovery.executable,
      editor_version: evidence.discovery.raw_version,
      reason: "machine evidence has no preflight record — the suite did not reach the real batch invocation",
      note: NOT_PASSING,
    };
  }
  if (evidence.preflight.license_classification === "license-required" || !evidence.preflight.editor_licensed) {
    return {
      gate_id: "M2-G1",
      status: "editor-present-unlicensed",
      editor: evidence.discovery.executable,
      editor_version: evidence.discovery.raw_version,
      suite_evidence: `preflight exit=${String(evidence.preflight.exit_status)} licenseClassification=${
        evidence.preflight.license_classification ?? "none"
      } editorLicensed=false`,
      reason:
        "the Unity Editor binary is present and invoked for real, but it is NOT activated — Unity Personal activation requires a Unity Hub sign-in by the eligible account (docs/gamos/UNITY-M2G1-PROVISIONING.md §6); the honest license-required negative path is what the suite proved",
      note: `${NOT_PASSING} — an unactivated editor is never a passing integration gate`,
    };
  }
  if (evidence.preflight.license_classification === "editor-lock") {
    return {
      gate_id: "M2-G1",
      status: "editor-present-unverified",
      editor: evidence.discovery.executable,
      editor_version: evidence.discovery.raw_version,
      reason:
        "another Unity instance holds the project lock — the suite could not verify this editor (distinct from a license failure)",
      note: NOT_PASSING,
    };
  }

  // (7) Licensed editor: the whole suite must now prove itself.
  if (inputs.suiteExitCode === null || !Number.isFinite(inputs.suiteExitCode)) {
    return {
      gate_id: "M2-G1",
      status: "suite-failed-no-gate-evidence",
      editor: evidence.discovery.executable,
      reason: "the suite exit code was not captured (missing/malformed exit-code record) — cannot prove the suite passed",
      note: NOT_PASSING,
    };
  }
  if (inputs.suiteExitCode !== 0) {
    return {
      gate_id: "M2-G1",
      status: "licensed-editor-integration-failed",
      editor: evidence.discovery.executable,
      editor_version: evidence.discovery.raw_version,
      reason: `the licensed-editor integration suite FAILED (exit code ${inputs.suiteExitCode}) after a successful preflight — a preflight success alone is never a passing status; the failure output is retained in the uploaded suite log`,
      note: NOT_PASSING,
      details: { suite_exit_code: inputs.suiteExitCode },
    };
  }

  const reporter = parseReporterResults(inputs.suiteResults);
  if (reporter === null) {
    return {
      gate_id: "M2-G1",
      status: "suite-failed-no-gate-evidence",
      editor: evidence.discovery.executable,
      reason:
        "the vitest JSON-reporter results are missing or malformed — per-test outcomes for the required real-editor tests cannot be proven",
      note: NOT_PASSING,
    };
  }
  if (reporter.success === false) {
    return {
      gate_id: "M2-G1",
      status: "suite-evidence-contradiction",
      editor: evidence.discovery.executable,
      reason: "the reporter records success=false while the suite exit code is 0 (incoherent evidence)",
      note: NOT_PASSING,
    };
  }

  // (8) Every required real-editor test must be present exactly once and PASS.
  const requiredCheck = checkRequiredTests(reporter);
  if (requiredCheck !== null) {
    return {
      gate_id: "M2-G1",
      status: requiredCheck.failed ? "licensed-editor-integration-failed" : "suite-failed-no-gate-evidence",
      editor: evidence.discovery.executable,
      editor_version: evidence.discovery.raw_version,
      reason: requiredCheck.reason,
      note: NOT_PASSING,
    };
  }

  // (9) The actual mutation and build artifacts must be verified evidence.
  if (evidence.scene_mutation === null || evidence.scene_mutation.verified !== true) {
    return {
      gate_id: "M2-G1",
      status: "suite-failed-no-gate-evidence",
      editor: evidence.discovery.executable,
      reason: "the scene mutation was not verified (no verified before/after scene-hash record in the machine evidence)",
      note: NOT_PASSING,
    };
  }
  if (evidence.build_artifact === null || evidence.build_artifact.verified !== true) {
    return {
      gate_id: "M2-G1",
      status: "suite-failed-no-gate-evidence",
      editor: evidence.discovery.executable,
      reason: "the player-build artifact was not verified (no verified nonempty artifact record in the machine evidence)",
      note: NOT_PASSING,
    };
  }

  // (10) The complete verified licensed path — the ONLY editor-verified record.
  return {
    gate_id: "M2-G1",
    status: "editor-verified",
    editor: evidence.discovery.executable,
    editor_version: evidence.discovery.raw_version,
    editor_revision: evidence.editor_revision,
    suite_evidence: `editorLicensed=true; suiteExitCode=0; required real-editor tests ${
      M2_UNITY_REQUIRED_REAL_EDITOR_TEST_NAMES.length
    }/${M2_UNITY_REQUIRED_REAL_EDITOR_TEST_NAMES.length} passed (none skipped); scene mutation verified (${
      evidence.scene_mutation.sha256_before.slice(0, 12)
    }…→${evidence.scene_mutation.sha256_after.slice(0, 12)}…); build artifact verified (${
      evidence.build_artifact.bytes
    } bytes, sha256=${evidence.build_artifact.sha256.slice(0, 16)}…)`,
    note: "recorded ONLY from the complete verified licensed path: real editor, exact version contract, suite exit 0, every required real-editor test passed with none skipped, and verified mutation + build artifacts",
    details: {
      suite_exit_code: 0,
      required_tests_passed: M2_UNITY_REQUIRED_REAL_EDITOR_TEST_NAMES.length,
      scene_sha256_before: evidence.scene_mutation.sha256_before,
      scene_sha256_after: evidence.scene_mutation.sha256_after,
      build_artifact_path: evidence.build_artifact.path,
      build_artifact_bytes: evidence.build_artifact.bytes,
      build_artifact_sha256: evidence.build_artifact.sha256,
    },
  };
}

// ---------------------------------------------------------------------------
// Parsers (fail-closed)
// ---------------------------------------------------------------------------

function parseMachineEvidence(value: unknown): UnitySuiteMachineEvidence | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Partial<UnitySuiteMachineEvidence> & Record<string, unknown>;
  if (candidate.schema_version !== 1) {
    return null;
  }
  const discovery = candidate.discovery;
  if (typeof discovery !== "object" || discovery === null || Array.isArray(discovery)) {
    return null;
  }
  const discoveryRecord = discovery as Record<string, unknown>;
  if (typeof discoveryRecord.status !== "string") {
    return null;
  }
  if (
    discoveryRecord.executable !== null &&
    typeof discoveryRecord.executable !== "string"
  ) {
    return null;
  }
  if (discoveryRecord.raw_version !== null && typeof discoveryRecord.raw_version !== "string") {
    return null;
  }
  return candidate as unknown as UnitySuiteMachineEvidence;
}

function parseReporterResults(value: unknown): UnitySuiteReporterResults | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Partial<UnitySuiteReporterResults> & Record<string, unknown>;
  if (!Array.isArray(candidate.testResults)) {
    return null;
  }
  for (const file of candidate.testResults) {
    if (typeof file !== "object" || file === null || Array.isArray(file)) {
      return null;
    }
    if (file.assertionResults !== undefined && !Array.isArray(file.assertionResults)) {
      return null;
    }
  }
  return candidate as unknown as UnitySuiteReporterResults;
}

// ---------------------------------------------------------------------------
// Contradiction and required-test checks
// ---------------------------------------------------------------------------

function findLogEvidenceContradiction(evidence: UnitySuiteMachineEvidence, log: string | null): string | null {
  if (log === null) {
    return null; // a missing log alone is not a contradiction (recorded state comes from the evidence)
  }
  const licensedInLog = log.includes("editorLicensed=true");
  const unlicensedInLog = log.includes("editorLicensed=false");
  const skipBannerInLog = log.includes("SKIP: real Unity Editor not available");
  const evidenceLicensed = evidence.preflight?.editor_licensed === true;
  const evidenceEditorPresent = evidence.discovery.status === "available";

  if (licensedInLog && !evidenceLicensed && evidenceEditorPresent) {
    return "the retained log prints editorLicensed=true while the machine evidence records an unlicensed/failed preflight";
  }
  if (unlicensedInLog && evidenceLicensed) {
    return "the retained log prints editorLicensed=false while the machine evidence records a licensed preflight";
  }
  if (skipBannerInLog && evidenceEditorPresent) {
    return "the retained log shows the SKIP banner while the machine evidence records an available editor";
  }
  return null;
}

function reporterClaimsPassedWhileUnavailable(suiteResults: unknown): string[] {
  const reporter = parseReporterResults(suiteResults);
  if (reporter === null) {
    return [];
  }
  const warnings: string[] = [];
  for (const required of M2_UNITY_REQUIRED_REAL_EDITOR_TEST_NAMES) {
    if (findAssertionsFor(reporter, required).some((assertion) => assertion.status === "passed")) {
      warnings.push(`reporter claims "${required}" passed while discovery records no usable editor`);
    }
  }
  return warnings;
}

interface RequiredTestProblem {
  reason: string;
  failed: boolean;
}

function checkRequiredTests(reporter: UnitySuiteReporterResults): RequiredTestProblem | null {
  for (const required of M2_UNITY_REQUIRED_REAL_EDITOR_TEST_NAMES) {
    const matches = findAssertionsFor(reporter, required);
    if (matches.length === 0) {
      return {
        reason: `required real-editor test missing from the suite results (incomplete suite): ${required}`,
        failed: false,
      };
    }
    if (matches.length > 1) {
      return {
        reason: `required real-editor test appears ${matches.length} times in the suite results (incoherent evidence): ${required}`,
        failed: false,
      };
    }
    const status = matches[0]!.status;
    if (status === "skipped") {
      return {
        reason: `required real-editor test skipped — a skipped Unity integration test is a non-passing Unity integration result: ${required}`,
        failed: false,
      };
    }
    if (status === "failed") {
      return {
        reason: `required real-editor test FAILED: ${required}`,
        failed: true,
      };
    }
    if (status !== "passed") {
      return {
        reason: `required real-editor test has non-passing reporter status "${String(status)}": ${required}`,
        failed: false,
      };
    }
  }
  return null;
}

function findAssertionsFor(
  reporter: UnitySuiteReporterResults,
  requiredName: string,
): Array<{ fullName?: string; title?: string; status?: string }> {
  const matches: Array<{ fullName?: string; title?: string; status?: string }> = [];
  for (const file of reporter.testResults ?? []) {
    for (const assertion of file.assertionResults ?? []) {
      // vitest joins ancestor titles + title with a single space in fullName;
      // match on the exact title, falling back to a fullName suffix match.
      if (assertion.title === requiredName || (assertion.fullName ?? "").endsWith(requiredName)) {
        matches.push(assertion);
      }
    }
  }
  return matches;
}
