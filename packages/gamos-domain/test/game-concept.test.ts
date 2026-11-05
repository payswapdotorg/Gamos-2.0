import { describe, expect, it } from "vitest";
import {
  createGameConcept,
  serializeGameConcept,
  hashGameConcept,
} from "../src/domain/game-concept.js";
import { validConceptInput } from "./fixtures.js";

const _unused = {
  conceptId: "concept-001",
  kind: "gaming",
  genre: ["tower-defense"],
  mechanics: ["resource-economy", "wave-spawning"],
  platformPreferences: [
    { engineFamily: "babylon", preference: "preferred" },
  ],
  references: [
    { kind: "game-title", ref: "Bloons TD 6", note: "pacing reference" },
  ],
  constraints: ["read-only inspection only"],
  projectContext: {
    projectRoot: "/workspace/my-game",
    discoveryRecordRef: "discovery-2026-11-05T20:30:00Z",
  },
  acceptanceExpectations: ["project structure is explained with evidence"],
  provenance: {
    origin: "user-message",
    sessionId: "sess_example",
    capturedAt: "2026-11-05T20:30:00Z",
  },
};
void _unused;

describe("GameConcept construction and serialization (M1.1 TDD)", () => {
  it("constructs a valid GameConcept from raw input", () => {
    const concept = createGameConcept(validConceptInput);
    expect(concept.kind).toBe("gaming");
    expect(concept.genre).toContain("tower-defense");
    expect(concept.platformPreferences[0]?.engineFamily).toBe("babylon");
  });

  it("rejects non-gaming input (fail closed)", () => {
    expect(() => createGameConcept({ ...validConceptInput, kind: "finance" })).toThrow();
  });

  it("rejects input missing mandatory provenance", () => {
    const { provenance: _omit, ...noProvenance } = validConceptInput as Record<string, unknown>;
    expect(() => createGameConcept(noProvenance)).toThrow();
  });

  it("rejects a non-serializable (circular) input", () => {
    const circular: Record<string, unknown> = { ...validConceptInput };
    circular.self = circular;
    expect(() => createGameConcept(circular)).toThrow();
  });

  it("serializes deterministically (same content → same bytes)", () => {
    const a = createGameConcept(validConceptInput);
    const b = createGameConcept({ ...validConceptInput });
    expect(serializeGameConcept(a)).toBe(serializeGameConcept(b));
  });

  it("hashes deterministically (same content → same digest)", () => {
    const a = createGameConcept(validConceptInput);
    const b = createGameConcept({ ...validConceptInput });
    expect(hashGameConcept(a)).toBe(hashGameConcept(b));
  });

  it("different content → different digest", () => {
    const a = createGameConcept(validConceptInput);
    const b = createGameConcept({
      ...validConceptInput,
      genre: ["rpg"],
    });
    expect(hashGameConcept(a)).not.toBe(hashGameConcept(b));
  });

  it("round-trips: serialization parses back to an equal concept", () => {
    const concept = createGameConcept(validConceptInput);
    const parsed = createGameConcept(JSON.parse(serializeGameConcept(concept)));
    expect(serializeGameConcept(parsed)).toBe(serializeGameConcept(concept));
  });
});
