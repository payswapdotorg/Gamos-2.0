import { describe, expect, it } from "vitest";
import {
  parseGamePlan,
  serializeGamePlan,
  hashGamePlan,
} from "../src/domain/game-plan.js";
import {
  parseAcceptanceRecord,
  serializeAcceptanceRecord,
  hashAcceptanceRecord,
  evaluateAcceptanceStatus,
} from "../src/domain/acceptance-record.js";
import { validPlanInput, validAcceptanceInput } from "./fixtures.js";

describe("GamePlan serialization and validation (M1.1 TDD)", () => {
  it("parses a valid GamePlan", () => {
    const plan = parseGamePlan(validPlanInput);
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[1]?.dependsOn).toContain("step-1");
  });

  it("rejects a plan with a duplicate step id", () => {
    const dup = {
      ...validPlanInput,
      steps: [validPlanInput.steps[0], { ...validPlanInput.steps[0] }],
    };
    expect(() => parseGamePlan(dup)).toThrow(/duplicate|step/i);
  });

  it("rejects a plan whose step depends on a nonexistent step", () => {
    const bad = {
      ...validPlanInput,
      steps: [
        { ...validPlanInput.steps[0], dependsOn: ["nope"] },
      ],
    };
    expect(() => parseGamePlan(bad)).toThrow(/depend/i);
  });

  it("rejects a plan without an acceptance-record reference (criteria are mandatory)", () => {
    const { acceptanceRecord: _a, ...noAcc } = validPlanInput as Record<string, unknown>;
    expect(() => parseGamePlan(noAcc)).toThrow(/acceptance/i);
  });

  it("rejects a plan embedding acceptance criteria inline in a spec-like field", () => {
    // Acceptance criteria live in the referenced AcceptanceRecord, never inline.
    const bad = { ...validPlanInput, acceptance: { criteria: [] } } as unknown;
    expect(() => parseGamePlan(bad)).toThrow(/acceptance/i);
  });

  it("serializes and hashes deterministically; round-trips", () => {
    const a = parseGamePlan(validPlanInput);
    const b = parseGamePlan(JSON.parse(JSON.stringify(validPlanInput)));
    expect(serializeGamePlan(a)).toBe(serializeGamePlan(b));
    expect(hashGamePlan(a)).toBe(hashGamePlan(b));
    const rt = parseGamePlan(JSON.parse(serializeGamePlan(a)));
    expect(serializeGamePlan(rt)).toBe(serializeGamePlan(a));
  });
});

describe("AcceptanceRecord separation and evaluation (M1.1 TDD)", () => {
  it("parses a valid AcceptanceRecord referenced from a plan", () => {
    const record = parseAcceptanceRecord(validAcceptanceInput);
    expect(record.planRef.planId).toBe("plan-001");
  });

  it("rejects a record whose result references an unknown criterion", () => {
    const bad = {
      ...validAcceptanceInput,
      results: [{ ...validAcceptanceInput.results[0], criterionId: "ghost" }],
    };
    expect(() => parseAcceptanceRecord(bad)).toThrow(/criterion/i);
  });

  it("evaluateAcceptanceStatus: passed only when every criterion has evidence-backed results", () => {
    const record = parseAcceptanceRecord(validAcceptanceInput);
    expect(evaluateAcceptanceStatus(record)).toBe("passed");
  });

  it("evaluateAcceptanceStatus: pending result → not passed", () => {
    const pending = {
      ...validAcceptanceInput,
      results: [{ ...validAcceptanceInput.results[0], status: "pending" }],
    };
    expect(evaluateAcceptanceStatus(parseAcceptanceRecord(pending))).toBe("in-progress");
  });

  it("evaluateAcceptanceStatus: failed result → failed", () => {
    const failed = {
      ...validAcceptanceInput,
      results: [{ ...validAcceptanceInput.results[0], status: "failed" }],
    };
    expect(evaluateAcceptanceStatus(parseAcceptanceRecord(failed))).toBe("failed");
  });

  it("evaluateAcceptanceStatus: a passing result without evidence paths is NOT accepted", () => {
    const noEvidence = {
      ...validAcceptanceInput,
      results: [
        { ...validAcceptanceInput.results[0], evidencePaths: [], evidenceSha256: [] },
      ],
    };
    expect(evaluateAcceptanceStatus(parseAcceptanceRecord(noEvidence))).not.toBe("passed");
  });

  it("evaluateAcceptanceStatus: not-applicable results are acceptable", () => {
    const na = {
      ...validAcceptanceInput,
      results: [
        { ...validAcceptanceInput.results[0], status: "not-applicable", evidencePaths: [], evidenceSha256: [] },
      ],
    };
    expect(evaluateAcceptanceStatus(parseAcceptanceRecord(na))).toBe("passed");
  });

  it("serializes deterministically; round-trips", () => {
    const a = parseAcceptanceRecord(validAcceptanceInput);
    const rt = parseAcceptanceRecord(JSON.parse(JSON.stringify(validAcceptanceInput)));
    expect(serializeAcceptanceRecord(a)).toBe(serializeAcceptanceRecord(rt));
    expect(hashAcceptanceRecord(a)).toBe(hashAcceptanceRecord(rt));
  });
});
