import { describe, expect, it } from "vitest";
import {
  M2_UNITY_REQUIRED_EDITOR_REVISION,
  M2_UNITY_REQUIRED_EDITOR_VERSION,
  M2_UNITY_REQUIRED_REAL_EDITOR_TEST_NAMES,
  deriveUnityGateStatus,
  type UnitySuiteMachineEvidence,
  type UnitySuiteReporterResults,
  type UnityGateStatusInputs,
} from "../src/domain/unity-gate-status.js";

/**
 * M2-A (final-closure directive §2) — the Unity gate-status classifier.
 *
 * The exact defect being closed: the preflight-only path printed
 * `editorLicensed=true` BEFORE the real integration tests ran, so a licensed
 * editor could pass preflight and then FAIL scene modification or the player
 * build while the `always()` status step still recorded `editor-verified`.
 * `editor-verified` must require the complete verified path; every other
 * outcome — including preflight success + later failure — must record a
 * non-passing state.
 */

const EDITOR = "/opt/Unity/Hub/Editor/6000.0.23f1/Editor/Unity";

function licensedMachineEvidence(overrides: Partial<UnitySuiteMachineEvidence> = {}): UnitySuiteMachineEvidence {
  return {
    schema_version: 1,
    discovery: {
      status: "available",
      executable: EDITOR,
      raw_version: M2_UNITY_REQUIRED_EDITOR_VERSION,
    },
    editor_revision: M2_UNITY_REQUIRED_EDITOR_REVISION,
    version_contract: {
      required_version: M2_UNITY_REQUIRED_EDITOR_VERSION,
      required_revision: M2_UNITY_REQUIRED_EDITOR_REVISION,
      matches: true,
    },
    preflight: {
      exit_status: 0,
      timed_out: false,
      license_classification: null,
      editor_licensed: true,
    },
    scene_mutation: {
      verified: true,
      sha256_before: "b".repeat(64),
      sha256_after: "c".repeat(64),
    },
    build_artifact: {
      verified: true,
      path: "/tmp/ws/unity-project/Builds/StandaloneLinux64/LinuxPlayer",
      bytes: 12345,
      sha256: "d".repeat(64),
    },
    ...overrides,
  };
}

function unlicensedMachineEvidence(): UnitySuiteMachineEvidence {
  return {
    schema_version: 1,
    discovery: {
      status: "available",
      executable: EDITOR,
      raw_version: M2_UNITY_REQUIRED_EDITOR_VERSION,
    },
    editor_revision: M2_UNITY_REQUIRED_EDITOR_REVISION,
    version_contract: {
      required_version: M2_UNITY_REQUIRED_EDITOR_VERSION,
      required_revision: M2_UNITY_REQUIRED_EDITOR_REVISION,
      matches: true,
    },
    preflight: {
      exit_status: 1,
      timed_out: false,
      license_classification: "license-required",
      editor_licensed: false,
    },
    scene_mutation: null,
    build_artifact: null,
  };
}

function unavailableMachineEvidence(): UnitySuiteMachineEvidence {
  return {
    schema_version: 1,
    discovery: {
      status: "unavailable",
      executable: null,
      raw_version: null,
      reason: "no Unity Editor executable found",
    },
    editor_revision: null,
    version_contract: null,
    preflight: null,
    scene_mutation: null,
    build_artifact: null,
  };
}

/** vitest JSON-reporter shape: fullName = "<describe> <title>" (space-joined). */
function allRequiredPassedReporter(): UnitySuiteReporterResults {
  return {
    success: true,
    numTotalTests: M2_UNITY_REQUIRED_REAL_EDITOR_TEST_NAMES.length,
    testResults: [
      {
        status: "passed",
        name: "test/engine-real-unity.integration.test.ts",
        assertionResults: M2_UNITY_REQUIRED_REAL_EDITOR_TEST_NAMES.map((title) => ({
          fullName: `unity-engine plugin real-Unity integration ${title}`,
          title,
          status: "passed",
        })),
      },
    ],
  };
}

/** The preflight marker the real suite prints BEFORE the tests run. */
const LOG_WITH_LICENSED_MARKER = [
  "[gamos-evidence] real Unity Editor executable: " + EDITOR,
  "[gamos-evidence] raw version: 6000.0.23f1",
  "[gamos-evidence] pre-flight batch … licenseClassification=none editorLicensed=true",
].join("\n");

function inputs(overrides: Partial<UnityGateStatusInputs> = {}): UnityGateStatusInputs {
  return {
    machineEvidence: licensedMachineEvidence(),
    suiteResults: allRequiredPassedReporter(),
    suiteExitCode: 0,
    suiteLog: LOG_WITH_LICENSED_MARKER,
    ...overrides,
  };
}

describe("M2-A — the Unity gate-status classifier closes the preflight false-positive path", () => {
  it("editor-verified ONLY on the complete verified licensed path (version match, exit 0, every required test passed, mutation and build verified)", () => {
    const record = deriveUnityGateStatus(inputs());
    expect(record.status).toBe("editor-verified");
    expect(record.editor).toBe(EDITOR);
    expect(record.editor_version).toBe(M2_UNITY_REQUIRED_EDITOR_VERSION);
    expect(record.editor_revision).toBe(M2_UNITY_REQUIRED_EDITOR_REVISION);
  });

  it("THE M2-A DEFECT: preflight prints editorLicensed=true but a later integration assertion fails — the status must NOT be editor-verified", () => {
    const reporter = allRequiredPassedReporter();
    const assertions = reporter.testResults![0]!.assertionResults!;
    assertions[1]!.status = "failed";
    const record = deriveUnityGateStatus(
      inputs({ suiteExitCode: 1, suiteResults: reporter, suiteLog: LOG_WITH_LICENSED_MARKER }),
    );
    expect(record.status).not.toBe("editor-verified");
    expect(record.status).toBe("licensed-editor-integration-failed");
  });

  it("a licensed editor with a nonzero suite exit code is integration-failed even when the log marker is present and the JSON says all passed", () => {
    const record = deriveUnityGateStatus(inputs({ suiteExitCode: 1, suiteLog: LOG_WITH_LICENSED_MARKER }));
    expect(record.status).not.toBe("editor-verified");
    expect(record.status).toBe("licensed-editor-integration-failed");
  });

  it("a licensed editor whose required scene mutation was not verified is never editor-verified", () => {
    const evidence = licensedMachineEvidence();
    evidence.scene_mutation = { verified: false, sha256_before: "b".repeat(64), sha256_after: "b".repeat(64) };
    const record = deriveUnityGateStatus(inputs({ machineEvidence: evidence }));
    expect(record.status).not.toBe("editor-verified");
  });

  it("a licensed editor whose player-build artifact was not verified is never editor-verified", () => {
    const evidence = licensedMachineEvidence();
    evidence.build_artifact = null;
    const record = deriveUnityGateStatus(inputs({ machineEvidence: evidence }));
    expect(record.status).not.toBe("editor-verified");
  });

  it("no required real-editor test may be skipped on the licensed path (suite exit 0 is not enough)", () => {
    const reporter = allRequiredPassedReporter();
    const assertions = reporter.testResults![0]!.assertionResults!;
    assertions[0]!.status = "skipped";
    const record = deriveUnityGateStatus(inputs({ suiteResults: reporter }));
    expect(record.status).not.toBe("editor-verified");
    expect(record.reason).toMatch(/scene_modify add-cube/);
  });

  it("an incomplete suite (a required test missing from the reporter output) fails closed", () => {
    const reporter = allRequiredPassedReporter();
    const assertions = reporter.testResults![0]!.assertionResults!;
    assertions.splice(2, 1); // drop the timeout-kill test
    const record = deriveUnityGateStatus(inputs({ suiteResults: reporter }));
    expect(record.status).not.toBe("editor-verified");
    expect(record.status).toBe("suite-failed-no-gate-evidence");
    expect(record.reason).toMatch(/runUnityBatch with a tiny timeout/);
  });

  it("missing vitest reporter results fail closed on the licensed path", () => {
    const record = deriveUnityGateStatus(inputs({ suiteResults: null }));
    expect(record.status).toBe("suite-failed-no-gate-evidence");
  });

  it("a missing suite exit code fails closed on the licensed path", () => {
    const record = deriveUnityGateStatus(inputs({ suiteExitCode: null }));
    expect(record.status).toBe("suite-failed-no-gate-evidence");
  });

  it("missing machine evidence fails closed (a suite crash can never record a passing gate)", () => {
    const record = deriveUnityGateStatus(inputs({ machineEvidence: null, suiteExitCode: 1, suiteLog: null }));
    expect(record.status).toBe("suite-failed-no-gate-evidence");
  });

  it("malformed machine evidence fails closed", () => {
    for (const malformed of ["garbage", 42, { schema_version: 99 }, { discovery: null }, []]) {
      const record = deriveUnityGateStatus(inputs({ machineEvidence: malformed }));
      expect(record.status).toBe("suite-failed-no-gate-evidence");
    }
  });

  it("malformed suite results fail closed", () => {
    for (const malformed of ["nope", 7, { testResults: "x" }, []]) {
      const record = deriveUnityGateStatus(inputs({ suiteResults: malformed }));
      expect(record.status).toBe("suite-failed-no-gate-evidence");
    }
  });

  it("contradictory markers: the log claims editorLicensed=true while the machine evidence says unlicensed — fail closed, never editor-verified", () => {
    const record = deriveUnityGateStatus(
      inputs({ machineEvidence: unlicensedMachineEvidence(), suiteLog: LOG_WITH_LICENSED_MARKER }),
    );
    expect(record.status).not.toBe("editor-verified");
    expect(record.status).toBe("suite-evidence-contradiction");
  });

  it("contradictory markers: the log claims editorLicensed=false while the machine evidence says licensed — fail closed", () => {
    const logFalse = LOG_WITH_LICENSED_MARKER.replace("editorLicensed=true", "editorLicensed=false");
    const record = deriveUnityGateStatus(inputs({ suiteLog: logFalse }));
    expect(record.status).toBe("suite-evidence-contradiction");
  });

  it("contradictory markers: the log shows the SKIP banner while the machine evidence says an editor ran — fail closed", () => {
    const record = deriveUnityGateStatus(
      inputs({ suiteLog: "SKIP: real Unity Editor not available on this runner" }),
    );
    expect(record.status).toBe("suite-evidence-contradiction");
  });
});

describe("M2-A — every honest non-passing state is preserved", () => {
  it("editor unavailable: the skipped suite (exit 0) records unavailable-license — never a passing gate", () => {
    const reporter = allRequiredPassedReporter();
    for (const assertion of reporter.testResults![0]!.assertionResults!) {
      assertion.status = "skipped";
    }
    const record = deriveUnityGateStatus(
      inputs({
        machineEvidence: unavailableMachineEvidence(),
        suiteResults: reporter,
        suiteExitCode: 0,
        suiteLog: "SKIP: real Unity Editor not available on this runner",
      }),
    );
    expect(record.status).toBe("unavailable-license");
    expect(record.note).toMatch(/NOT PASSING/i);
  });

  it("editor unavailable with a MISSING log still records unavailable-license from the machine evidence (missing logs must not crash the classifier)", () => {
    const record = deriveUnityGateStatus(
      inputs({ machineEvidence: unavailableMachineEvidence(), suiteLog: null, suiteExitCode: 0 }),
    );
    expect(record.status).toBe("unavailable-license");
  });

  it("editor present but unlicensed records editor-present-unlicensed with the license reason", () => {
    const record = deriveUnityGateStatus(inputs({ machineEvidence: unlicensedMachineEvidence(), suiteLog: null }));
    expect(record.status).toBe("editor-present-unlicensed");
    expect(record.note).toMatch(/NOT PASSING/i);
  });

  it("a successful license-required negative path is NOT a passing Unity integration gate (exit 0 stays non-passing)", () => {
    const reporter = allRequiredPassedReporter();
    const record = deriveUnityGateStatus(
      inputs({
        machineEvidence: unlicensedMachineEvidence(),
        suiteResults: reporter,
        suiteExitCode: 0,
      }),
    );
    expect(record.status).not.toBe("editor-verified");
  });
});

describe("M2-B — the version contract participates in the gate classification", () => {
  it("a present editor whose version does not exactly match the fixture pin is version-incompatible — never licensed or verified", () => {
    const evidence = licensedMachineEvidence();
    evidence.discovery.raw_version = "2022.3.10f1";
    evidence.version_contract = {
      required_version: M2_UNITY_REQUIRED_EDITOR_VERSION,
      required_revision: M2_UNITY_REQUIRED_EDITOR_REVISION,
      matches: false,
      reason: "editor 2022.3.10f1 does not match the fixture requirement 6000.0.23f1",
    };
    const record = deriveUnityGateStatus(inputs({ machineEvidence: evidence, suiteLog: LOG_WITH_LICENSED_MARKER }));
    expect(record.status).toBe("editor-present-version-incompatible");
    expect(record.reason).toMatch(/6000\.0\.23f1/);
  });

  it("a newer editor version (6000.0.30f1) is still version-incompatible — the contract is exact, not a floor", () => {
    const evidence = licensedMachineEvidence();
    evidence.discovery.raw_version = "6000.0.30f1";
    evidence.version_contract = {
      required_version: M2_UNITY_REQUIRED_EDITOR_VERSION,
      required_revision: M2_UNITY_REQUIRED_EDITOR_REVISION,
      matches: false,
      reason: "editor 6000.0.30f1 does not match the fixture requirement 6000.0.23f1",
    };
    const record = deriveUnityGateStatus(inputs({ machineEvidence: evidence }));
    expect(record.status).toBe("editor-present-version-incompatible");
  });

  it("a licensed editor with a MISSING version contract fails closed (version metadata is mandatory evidence)", () => {
    const evidence = licensedMachineEvidence();
    evidence.version_contract = null;
    const record = deriveUnityGateStatus(inputs({ machineEvidence: evidence }));
    expect(record.status).not.toBe("editor-verified");
    expect(record.status).toBe("suite-failed-no-gate-evidence");
  });

  it("the classifier independently re-checks the raw version: a self-reported contract match with the WRONG raw version fails closed", () => {
    const evidence = licensedMachineEvidence();
    evidence.discovery.raw_version = "2022.3.10f1";
    // the suite's own contract claim says matches (defective self-report):
    evidence.version_contract = {
      required_version: M2_UNITY_REQUIRED_EDITOR_VERSION,
      required_revision: M2_UNITY_REQUIRED_EDITOR_REVISION,
      matches: true,
    };
    const record = deriveUnityGateStatus(inputs({ machineEvidence: evidence }));
    expect(record.status).not.toBe("editor-verified");
    expect(record.status).toBe("editor-present-version-incompatible");
  });

  it("a revision mismatch on the exposed revision is version-incompatible (the fixture pin includes the revision)", () => {
    const evidence = licensedMachineEvidence();
    evidence.editor_revision = "0000000000000000000000000000000000000000";
    evidence.version_contract = {
      required_version: M2_UNITY_REQUIRED_EDITOR_VERSION,
      required_revision: M2_UNITY_REQUIRED_EDITOR_REVISION,
      matches: false,
      reason: "revision mismatch",
    };
    const record = deriveUnityGateStatus(inputs({ machineEvidence: evidence }));
    expect(record.status).toBe("editor-present-version-incompatible");
  });

  it("a version-unknown discovery (executable present, version unparsable) records editor-present-unverified", () => {
    const evidence = unavailableMachineEvidence();
    evidence.discovery = {
      status: "version-unknown",
      executable: "/opt/Unity/Editor/Unity",
      raw_version: null,
      reason: "could not parse Unity version from -version output",
    };
    const record = deriveUnityGateStatus(inputs({ machineEvidence: evidence }));
    expect(record.status).toBe("editor-present-unverified");
    expect(record.note).toMatch(/NOT PASSING/i);
  });
});
