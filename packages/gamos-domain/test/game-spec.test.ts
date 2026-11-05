import { describe, expect, it } from "vitest";
import {
  validate,
} from "../src/vendor/playliquid-gameos/src/game-ir/validate.js";
import {
  parseGameSpec,
  serializeGameSpec,
  hashGameSpec,
  GAME_SPEC_FIELD_SET,
} from "../src/game-spec.js";
import { validGameIR, validIdentity } from "./fixtures.js";

describe("GameSpec exact GameIR compatibility (M1.1 TDD / M1-G1)", () => {
  it("a valid upstream GameIRDocument is a valid GameSpec", () => {
    const upstream = validate(validGameIR);
    expect(upstream.ok).toBe(true);
    const spec = parseGameSpec(validGameIR);
    expect(spec.irVersion).toBe("1");
  });

  it("unknown irVersion is explicitly rejected (not coerced)", () => {
    const bad = { ...validGameIR, irVersion: "2" };
    expect(() => parseGameSpec(bad)).toThrow(/irVersion/i);
  });

  it("rejects a Gamos-specific `acceptance` field (schema violation, not tolerated)", () => {
    const bad = { ...validGameIR, acceptance: { criteria: [] } };
    expect(() => parseGameSpec(bad)).toThrow(/acceptance/i);
  });

  it("rejects engine-binding fields on the document", () => {
    const bad = { ...validGameIR, engineBinding: { engineFamily: "unity" } };
    expect(() => parseGameSpec(bad)).toThrow(/engine/i);
  });

  it("rejects capability references on the document", () => {
    const bad = { ...validGameIR, capabilities: ["unity/scene.create"] };
    expect(() => parseGameSpec(bad)).toThrow(/capabilit/i);
  });

  it("rejects any unknown EXTRA field beyond the exact upstream field set", () => {
    const bad = { ...validGameIR, gamosExtra: true };
    expect(() => parseGameSpec(bad)).toThrow(/gamosExtra|extra|unknown/i);
  });

  it("optional upstream fields (lifecycle, world ACR-001) remain legal", () => {
    const withOptionals = {
      ...validGameIR,
      lifecycle: "draft" as const,
      world: { kind: "game" as const, targetProfile: "web" as const },
    };
    const spec = parseGameSpec(withOptionals);
    expect(spec.lifecycle).toBe("draft");
  });

  it("upstream validation failures fail closed for GameSpec too", () => {
    const bad = { ...validGameIR, entry: { world: "w0", scene: "missing" } };
    expect(() => parseGameSpec(bad)).toThrow();
    const dup = {
      ...validGameIR,
      nodes: [...validGameIR.nodes, { ...validGameIR.nodes[0] }],
    };
    expect(() => parseGameSpec(dup)).toThrow();
  });

  it("invalid identity (per upstream rules) fails closed", () => {
    const bad = { ...validGameIR, identity: { ...validIdentity, id: "" } };
    expect(() => parseGameSpec(bad)).toThrow();
    const badSha = {
      ...validGameIR,
      identity: { ...validIdentity, lineage: { head: "xyz", ancestors: [] } },
    };
    expect(() => parseGameSpec(badSha)).toThrow();
  });

  it("serializes deterministically and round-trips", () => {
    const a = parseGameSpec(validGameIR);
    const b = parseGameSpec(JSON.parse(JSON.stringify(validGameIR)));
    expect(serializeGameSpec(a)).toBe(serializeGameSpec(b));
    const parsed = parseGameSpec(JSON.parse(serializeGameSpec(a)));
    expect(serializeGameSpec(parsed)).toBe(serializeGameSpec(a));
  });

  it("hashes deterministically (upstream deterministic-serialization requirement)", () => {
    const a = parseGameSpec(validGameIR);
    const b = parseGameSpec(JSON.parse(JSON.stringify(validGameIR)));
    expect(hashGameSpec(a)).toBe(hashGameSpec(b));
    const changed = parseGameSpec({
      ...validGameIR,
      identity: { ...validIdentity, displayName: "Different" },
    });
    expect(hashGameSpec(a)).not.toBe(hashGameSpec(changed));
  });

  it("the exact field set matches the upstream document contract", () => {
    expect(GAME_SPEC_FIELD_SET).toEqual([
      "irVersion",
      "identity",
      "lifecycle",
      "world",
      "entry",
      "nodes",
    ]);
  });
});
