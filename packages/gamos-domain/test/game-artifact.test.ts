import { describe, expect, it } from "vitest";
import {
  parseGameArtifact,
  serializeGameArtifact,
  hashGameArtifact,
  isVerifiedArtifact,
} from "../src/game-artifact.js";
import { expectedArtifact, verifiedArtifact } from "./fixtures.js";

describe("GameArtifact identity and evidence references (M1.1 TDD)", () => {
  it("parses a valid expected artifact (no existence proof)", () => {
    const art = parseGameArtifact(expectedArtifact);
    expect(art.existence).toBeUndefined();
  });

  it("parses a valid verified artifact with an existence proof", () => {
    const art = parseGameArtifact(verifiedArtifact);
    expect(art.existence?.sha256).toBe("e".repeat(64));
  });

  it("distinguishes expected from verified: only verified artifacts pass isVerifiedArtifact", () => {
    expect(isVerifiedArtifact(parseGameArtifact(expectedArtifact))).toBe(false);
    expect(isVerifiedArtifact(parseGameArtifact(verifiedArtifact))).toBe(true);
  });

  it("rejects a malformed existence proof (bad sha256 length)", () => {
    const bad = {
      ...verifiedArtifact,
      existence: { ...verifiedArtifact.existence, sha256: "xyz" },
    };
    expect(() => parseGameArtifact(bad)).toThrow(/sha256/i);
  });

  it("rejects an existence proof without a path", () => {
    const bad = {
      ...verifiedArtifact,
      existence: { ...verifiedArtifact.existence, path: "" },
    };
    expect(() => parseGameArtifact(bad)).toThrow();
  });

  it("rejects an unknown artifact kind", () => {
    const bad = { ...expectedArtifact, kind: "quantum" };
    expect(() => parseGameArtifact(bad)).toThrow(/kind/i);
  });

  it("serializes and hashes deterministically; round-trips", () => {
    const a = parseGameArtifact(verifiedArtifact);
    const b = parseGameArtifact(JSON.parse(JSON.stringify(verifiedArtifact)));
    expect(serializeGameArtifact(a)).toBe(serializeGameArtifact(b));
    expect(hashGameArtifact(a)).toBe(hashGameArtifact(b));
    const rt = parseGameArtifact(JSON.parse(serializeGameArtifact(a)));
    expect(serializeGameArtifact(rt)).toBe(serializeGameArtifact(a));
  });
});
