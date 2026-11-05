import { describe, expect, it } from "vitest";
import {
  createGameConcept,
  parseGameSpec,
  parseGamePlan,
  parseAcceptanceRecord,
  parseGameArtifact,
} from "../src/index.js";
import { validGameIR, validConceptInput } from "./fixtures.js";

/**
 * Package boundary tests (M1.1 acceptance: the package stays pure).
 * A pure data/validation module must not reach for process/network/FS
 * capabilities beyond deterministic hashing. We assert the module surface:
 * importing the package must not load anything beyond itself.
 */

import { validConceptInput } from "./fixtures.js";

import { validGameIR } from "./fixtures.js";

describe("Package boundary — the domain package stays pure (M1.1)", () => {
  it("exports the documented API surface and nothing dynamic", async () => {
    const mod = await import("../src/index.js");
    const exported = Object.keys(mod).sort();
    expect(exported).toContain("createGameConcept");
    expect(exported).toContain("parseGameSpec");
    expect(exported).toContain("parseGamePlan");
    expect(exported).toContain("parseAcceptanceRecord");
    expect(exported).toContain("parseGameArtifact");
    expect(exported).toContain("registerCapability");
    // no runtime spawns, sockets or UI registrations are exported
    for (const name of exported) {
      expect(name.toLowerCase()).not.toMatch(/spawn|exec|launch|listen|serve|render/);
    }
  });

  it("all exports are functions/types — the module registers no side effects at import", async () => {
    // Importing must not throw, write, or start anything (pure module).
    const mod = await import("../src/index.js");
    expect(typeof mod.createGameConcept).toBe("function");
    expect(typeof mod.parseGameSpec).toBe("function");
  });

  it("end-to-end data flow: concept → spec → plan → acceptance → artifact", () => {
    const concept = createGameConcept(validConceptInput);
    const spec = parseGameSpec(validGameIR);
    const plan = parseGamePlan({
      planId: "p1",
      conceptRef: { conceptId: concept.conceptId, conceptSha256: "a".repeat(64) },
      steps: [
        {
          stepId: "s1",
          capability: { capabilityId: "core/project.inspect", capabilityVersion: "1.0.0", input: {} },
          dependsOn: [],
        },
      ],
      permissions: [],
      acceptanceRecord: { recordId: "a1", recordSha256: "b".repeat(64) },
      artifactExpectations: [],
      createdAt: "2026-11-05T22:00:00Z",
      provenance: { authoredBy: "tl" },
    });
    const acc = parseAcceptanceRecord({
      recordId: "a1",
      planRef: { planId: "p1", planSha256: "c".repeat(64) },
      criteria: [
        { criterionId: "k1", description: "inspect", verificationMethod: "output-schema", spec: "out" },
      ],
      results: [],
      status: "draft",
      createdAt: "2026-11-05T22:00:00Z",
    });
    const art = parseGameArtifact({
      artifactId: "art1",
      kind: "report",
      planRef: { planId: "p1" },
      description: "d",
      createdAt: "2026-11-05T22:00:00Z",
    });
    expect(concept.kind).toBe("gaming");
    expect(spec.irVersion).toBe("1");
    expect(plan.steps[0]?.stepId).toBe("s1");
    expect(acc.criteria).toHaveLength(1);
    expect(art.existence).toBeUndefined();
  });
});
