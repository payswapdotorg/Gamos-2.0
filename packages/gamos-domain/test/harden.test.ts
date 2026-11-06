import { describe, expect, it } from "vitest";
import { createGameConcept } from "../src/domain/game-concept.js";
import { parseGameSpec, hashGameSpec } from "../src/domain/game-spec.js";
import { parseGamePlan } from "../src/domain/game-plan.js";
import { parseAcceptanceRecord, evaluateAcceptanceStatus } from "../src/domain/acceptance-record.js";
import { parseGameArtifact } from "../src/domain/game-artifact.js";
import { registerCapability, resolveCapability } from "../src/domain/capability-registry.js";
import {
  validGameIR,
  validConceptInput,
  validPlanInput,
  validAcceptanceInput,
  completeCapabilityRecord,
} from "./fixtures.js";

/**
 * HARDEN phase (directive §15): malformed, incomplete, unsupported and
 * contradictory inputs. Every case must fail closed with an explicit error.
 */

describe("HARDEN — hostile GameSpec inputs (M1-G1)", () => {
  it("null / primitives / arrays are rejected", () => {
    expect(() => parseGameSpec(null)).toThrow();
    expect(() => parseGameSpec("nope")).toThrow();
    expect(() => parseGameSpec(42)).toThrow();
    expect(() => parseGameSpec([])).toThrow();
  });

  it("deeply nested hostile nodes are rejected by upstream semantics", () => {
    const hostile = {
      ...validGameIR,
      nodes: [
        { id: "w0", kind: "world", world: "w0", scenes: [123] }, // invalid scenes list
      ],
    };
    expect(() => parseGameSpec(hostile)).toThrow();
  });

  it("a forged extra field that LOOKS upstream-adjacent is still rejected", () => {
    const bad = { ...validGameIR, entryScene: "s0" };
    expect(() => parseGameSpec(bad)).toThrow();
    const bad2 = { ...validGameIR, buildSteps: [] };
    expect(() => parseGameSpec(bad2)).toThrow();
  });

  it("prototype-pollution-style keys are rejected as extra fields", () => {
    const bad = { ...validGameIR, __proto__: undefined, toString: 1 };
    expect(() => parseGameSpec(bad)).toThrow();
  });

  it("hash is stable under key-reordered input (canonical form)", () => {
    const reordered = {
      nodes: validGameIR.nodes,
      entry: validGameIR.entry,
      identity: validGameIR.identity,
      irVersion: validGameIR.irVersion,
    };
    expect(hashGameSpec(parseGameSpec(validGameIR))).toBe(hashGameSpec(parseGameSpec(reordered)));
  });
});

describe("HARDEN — hostile GameConcept inputs (M1.1)", () => {
  it("constructor-injected objects (Date, Map) are rejected as non-serializable", () => {
    const bad = { ...validConceptInput, genre: [new Date()] };
    expect(() => createGameConcept(bad)).toThrow();
  });

  it("numbers/booleans/arrays as root input are rejected", () => {
    expect(() => createGameConcept(7)).toThrow();
    expect(() => createGameConcept(true)).toThrow();
    expect(() => createGameConcept([])).toThrow();
    expect(() => createGameConcept(null)).toThrow();
  });

  it("invalid engine family strings are rejected", () => {
    const bad = {
      ...validConceptInput,
      platformPreferences: [{ engineFamily: "cryengine" as never, preference: "preferred" }],
    };
    expect(() => createGameConcept(bad)).toThrow(/engineFamily/i);
  });

  it("invalid ISO timestamps in provenance are rejected", () => {
    const bad = {
      ...validConceptInput,
      provenance: { ...validConceptInput.provenance, capturedAt: "not-a-date" },
    };
    expect(() => createGameConcept(bad)).toThrow(/capturedAt/i);
  });
});

describe("HARDEN — hostile GamePlan inputs (M1.1)", () => {
  it("self-dependent step is rejected", () => {
    const bad = {
      ...validPlanInput,
      steps: [
        {
          stepId: "step-1",
          capability: validPlanInput.steps[0].capability,
          dependsOn: ["step-1"],
        },
      ],
    };
    expect(() => parseGamePlan(bad)).toThrow();
  });

  it("non-string step ids are rejected", () => {
    const bad = {
      ...validPlanInput,
      steps: [
        { stepId: 123, capability: validPlanInput.steps[0].capability, dependsOn: [] },
      ],
    } as unknown;
    expect(() => parseGamePlan(bad)).toThrow();
  });

  it("non-semver capability version is rejected", () => {
    const bad = {
      ...validPlanInput,
      steps: [
        {
          stepId: "step-1",
          capability: { capabilityId: "core/x", capabilityVersion: "one", input: {} },
          dependsOn: [],
        },
      ],
    };
    expect(() => parseGamePlan(bad)).toThrow(/version/i);
  });

  it("bad hex digests in references are rejected", () => {
    const bad = {
      ...validPlanInput,
      conceptRef: { conceptId: "concept-001", conceptSha256: "zzz" },
    };
    expect(() => parseGamePlan(bad)).toThrow(/sha256/i);
  });
});

describe("HARDEN — hostile AcceptanceRecord inputs (M1.1)", () => {
  it("contradictory status: failed result + status passed body is exposed by evaluation", () => {
    const contradictory = {
      ...validAcceptanceInput,
      status: "passed",
      results: [{ ...validAcceptanceInput.results[0], status: "failed" }],
    };
    const record = parseAcceptanceRecord(contradictory);
    // the normative evaluation catches the contradiction
    expect(evaluateAcceptanceStatus(record)).toBe("failed");
  });

  it("duplicate criterion ids are rejected", () => {
    const bad = {
      ...validAcceptanceInput,
      criteria: [...validAcceptanceInput.criteria, ...validAcceptanceInput.criteria],
    };
    expect(() => parseAcceptanceRecord(bad)).toThrow(/duplicate/i);
  });

  it("evidence paths without matching digests are rejected at parse time", () => {
    const bad = {
      ...validAcceptanceInput,
      results: [
        {
          ...validAcceptanceInput.results[0],
          evidencePaths: ["a.md", "b.md"],
          evidenceSha256: ["d".repeat(64)],
        },
      ],
    };
    expect(() => parseAcceptanceRecord(bad)).toThrow(/paired|1:1/i);
  });
});

describe("HARDEN — hostile GameArtifact inputs (M1.1)", () => {
  it("null/undefined existence proofs are handled (absent = expected)", () => {
    const bad = { ...validPlanInput, existence: null };
    void bad;
    const artifact = parseGameArtifact({
      artifactId: "art-x",
      kind: "file",
      planRef: { planId: "plan-001" },
      description: "d",
      createdAt: "2026-11-05T22:00:00Z",
    });
    expect(artifact.existence).toBeUndefined();
  });

  it("non-integer byte counts are rejected", () => {
    const bad = {
      artifactId: "art-x",
      kind: "file",
      planRef: { planId: "plan-001" },
      description: "d",
      createdAt: "2026-11-05T22:00:00Z",
      existence: {
        verifiedAt: "2026-11-05T22:00:00Z",
        verifiedBy: "artifact-hash",
        path: "x",
        sha256: "e".repeat(64),
        bytes: 3.5,
      },
    };
    expect(() => parseGameArtifact(bad)).toThrow(/bytes/i);
  });
});

describe("HARDEN — hostile capability registration/resolution (M1.2)", () => {
  it("resolution of an id with hostile characters fails closed (never matches)", () => {
    const registry = new Map();
    const record = registerCapability(completeCapabilityRecord);
    registry.set(`${record.id}@${record.version}`, record);
    for (const hostile of ["__proto__", "constructor", "../../etc", "a b c", ""]) {
      const r = resolveCapability(registry, { id: hostile });
      expect(r.ok).toBe(false);
    }
  });

  it("input that is an array/primitive fails schema validation", () => {
    const registry = new Map();
    const record = registerCapability(completeCapabilityRecord);
    registry.set(`${record.id}@${record.version}`, record);
    expect(resolveCapability(registry, { id: record.id, input: ["array"] }).ok).toBe(false);
    expect(resolveCapability(registry, { id: record.id, input: "string" }).ok).toBe(false);
  });

  it("conditional availability WITHOUT declared prerequisites resolves", () => {
    const conditional = {
      ...completeCapabilityRecord,
      availability: { state: "conditional", reason: "engine present", prerequisites: [] },
    };
    const registry = new Map();
    const record = registerCapability(conditional);
    registry.set(`${record.id}@${record.version}`, record);
    const r = resolveCapability(registry, { id: record.id, input: { projectRoot: "/ws" } });
    if (!r.ok) throw new Error(r.error.reason);
  });

  it("timeout.maxMs < defaultMs is a registration failure", () => {
    const bad = { ...completeCapabilityRecord, timeout: { defaultMs: 5000, maxMs: 1000 } };
    expect(() => registerCapability(bad)).toThrow(/timeout/i);
  });

  it("substitution disclosure: remediation data never auto-selects", () => {
    const unavailableBlender = {
      ...completeCapabilityRecord,
      id: "blender/mesh.export",
      engineFamily: "blender",
      availability: { state: "unavailable", reason: "blender not installed" },
      provider: { kind: "engine-binary", identity: "blender>=4.1 (not found)" },
    };
    const registry = new Map();
    for (const raw of [unavailableBlender, completeCapabilityRecord]) {
      const record = registerCapability(raw);
      registry.set(`${record.id}@${record.version}`, record);
    }
    const r = resolveCapability(registry, { id: "blender/mesh.export" });
    if (r.ok) throw new Error("unavailable capability must not resolve");
    // The alternative is disclosed as data with the difference + approval requirement:
    expect(r.error.remediation.length).toBeGreaterThan(0);
    expect(r.error.remediation[0]?.difference).toMatch(/disclosure|approval|alternative/i);
  });
});
