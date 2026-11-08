/**
 * M3.3 — GamePlan integration of the additive resource-claim contract
 * (`steps[].resourceClaims`, optional). Written FIRST (strict TDD RED) against
 * the CURRENT parseGamePlan: the claims field is currently accepted silently
 * (steps pass through by reference) with no validation and no conflict
 * rejection, so the "rejects" tests below fail as assertion failures (valid
 * RED), and the hash-inclusion test pins deterministic extension behavior.
 *
 * Contract constraints (final-closure handoff §5.3):
 *   - additive and versioned: unchanged plans must hash byte-identically;
 *   - every step's declared write scope is enforced at validation time
 *     (fail closed on unordered conflicting claims — no silent resolution);
 *   - malformed claims (traversal, aliasing, unknown schema versions) fail
 *     closed inside parseGamePlan itself (the single validation chokepoint).
 */

import { describe, expect, it } from "vitest";
import { parseGamePlan, hashGamePlan, serializeGamePlan } from "../src/domain/game-plan.js";
import { validPlanInput } from "./fixtures.js";

function planWithClaims(claimsByStep: Record<string, unknown>) {
  return {
    ...validPlanInput,
    steps: validPlanInput.steps.map((step) =>
      claimsByStep[step.stepId] === undefined
        ? step
        : { ...step, resourceClaims: claimsByStep[step.stepId] },
    ),
  };
}

describe("GamePlan resourceClaims integration (M3.3, additive optional field)", () => {
  it("accepts a plan whose steps carry valid resource claims", () => {
    const plan = parseGamePlan(
      planWithClaims({
        "step-1": {
          schemaVersion: 1,
          claims: [{ access: "read", scope: "project", path: "workspace/game" }],
        },
        "step-2": {
          schemaVersion: 1,
          claims: [{ access: "write", scope: "generated-output", path: "workspace/game/report.md" }],
        },
      }),
    );
    expect(plan.steps[0]?.resourceClaims?.claims[0]?.access).toBe("read");
    expect(hashGamePlan(plan)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes the deterministic plan hash when claims are added (claims are plan identity)", () => {
    const without = parseGamePlan(validPlanInput);
    const withClaims = parseGamePlan(
      planWithClaims({
        "step-1": { schemaVersion: 1, claims: [{ access: "read", scope: "project", path: "proj" }] },
      }),
    );
    expect(hashGamePlan(withClaims)).not.toBe(hashGamePlan(without));
    // Deterministic: repeated parse+hash of the same input is stable.
    expect(hashGamePlan(parseGamePlan(validPlanInput))).toBe(hashGamePlan(without));
    expect(serializeGamePlan(withClaims)).toBe(serializeGamePlan(parseGamePlan(planWithClaims({
      "step-1": { schemaVersion: 1, claims: [{ access: "read", scope: "project", path: "proj" }] },
    }))));
  });

  it("rejects malformed claims through parseGamePlan (traversal fails closed)", () => {
    expect(() =>
      parseGamePlan(
        planWithClaims({
          "step-1": { schemaVersion: 1, claims: [{ access: "read", scope: "project", path: "../../etc/passwd" }] },
        }),
      ),
    ).toThrow(/RESOURCE-CLAIMS|path/i);
  });

  it("rejects an unknown claim schema version through parseGamePlan", () => {
    expect(() =>
      parseGamePlan(
        planWithClaims({
          "step-1": { schemaVersion: 2, claims: [{ access: "read", scope: "project", path: "proj" }] },
        }),
      ),
    ).toThrow(/schemaVersion|version/i);
  });

  it("rejects unordered conflicting write claims (fail closed, no silent serialization)", () => {
    // step-1 and step-2 are ordered (step-2 dependsOn step-1) in the fixture;
    // REMOVING the dependency makes the two write claims unordered-conflicting.
    const conflicting = {
      ...validPlanInput,
      steps: [
        {
          ...validPlanInput.steps[0],
          dependsOn: [],
          resourceClaims: { schemaVersion: 1, claims: [{ access: "write", scope: "asset-path", path: "shared/scene.bin" }] },
        },
        {
          ...validPlanInput.steps[1],
          dependsOn: [],
          resourceClaims: { schemaVersion: 1, claims: [{ access: "write", scope: "asset-path", path: "shared/scene.bin" }] },
        },
      ],
    };
    expect(() => parseGamePlan(conflicting)).toThrow(/conflict|dependsOn|resource/i);
  });

  it("accepts ordered conflicting write claims (explicit serialization is the remediation)", () => {
    const serialized = {
      ...validPlanInput,
      steps: [
        {
          ...validPlanInput.steps[0],
          dependsOn: [],
          resourceClaims: { schemaVersion: 1, claims: [{ access: "write", scope: "asset-path", path: "shared/scene.bin" }] },
        },
        {
          ...validPlanInput.steps[1],
          dependsOn: ["step-1"],
          resourceClaims: { schemaVersion: 1, claims: [{ access: "write", scope: "asset-path", path: "shared/scene.bin" }] },
        },
      ],
    };
    expect(() => parseGamePlan(serialized)).not.toThrow();
  });
});
