/**
 * M3.3/M3.5 — the additive, versioned resource-claim contract
 * (`gamos/resource-claims@1`). Written FIRST (strict TDD RED) per the
 * final-closure handoff §5.3 rules:
 *   1. two read-only steps may run concurrently when their claims are compatible;
 *   2. a write must not run concurrently with an overlapping read or write;
 *   3. conflicting unordered writes fail closed or are serialized explicitly;
 *   4. no silent race resolution;
 *   5. resource paths are canonicalized and workspace-confined (relative);
 *   6. traversal, path aliasing and ambiguous ownership fail closed.
 *
 * The GamePlan wire format gains the claims as an OPTIONAL per-step field
 * (`steps[].resourceClaims`) so unchanged plans hash byte-identically.
 */

import { describe, expect, it } from "vitest";
import {
  RESOURCE_CLAIMS_SCHEMA_ID,
  RESOURCE_CLAIMS_SCHEMA_VERSION,
  canonicalizeClaimPath,
  validateResourceClaims,
  claimsOverlap,
  findClaimConflicts,
} from "../src/domain/resource-claims.js";
import type { GamePlanStep } from "../src/domain/game-plan.js";

const validClaims = {
  schemaVersion: 1,
  claims: [
    { access: "read", scope: "project", path: "blender-project" },
    { access: "write", scope: "asset-path", path: "unity-project/Assets/Gamos/cube.fbx" },
  ],
};

describe("resource-claim path canonicalization (workspace-confined, fail closed)", () => {
  it("accepts canonical relative POSIX paths", () => {
    expect(canonicalizeClaimPath("unity-project/Assets/Gamos/cube.fbx")).toBe(
      "unity-project/Assets/Gamos/cube.fbx",
    );
    expect(canonicalizeClaimPath("a")).toBe("a");
    expect(canonicalizeClaimPath("my-asset.v2_final.glb")).toBe("my-asset.v2_final.glb");
  });

  it("rejects absolute paths and traversal segments", () => {
    expect(canonicalizeClaimPath("/etc/passwd")).toBeNull();
    expect(canonicalizeClaimPath("a/../../etc/passwd")).toBeNull();
    expect(canonicalizeClaimPath("../escape")).toBeNull();
    expect(canonicalizeClaimPath("a/./b")).toBeNull();
    expect(canonicalizeClaimPath("a/..")).toBeNull();
  });

  it("rejects non-canonical separators, empty segments and trailing separators", () => {
    expect(canonicalizeClaimPath("a\\b")).toBeNull();
    expect(canonicalizeClaimPath("a//b")).toBeNull();
    expect(canonicalizeClaimPath("a/")).toBeNull();
    expect(canonicalizeClaimPath("")).toBeNull();
  });

  it("rejects control characters and Windows-unsafe characters", () => {
    expect(canonicalizeClaimPath("a\u0000b")).toBeNull();
    expect(canonicalizeClaimPath("a\nb")).toBeNull();
    expect(canonicalizeClaimPath("a:b")).toBeNull();
    expect(canonicalizeClaimPath("a*b")).toBeNull();
    expect(canonicalizeClaimPath("a?b")).toBeNull();
    expect(canonicalizeClaimPath('a"b')).toBeNull();
    expect(canonicalizeClaimPath("a<b")).toBeNull();
    expect(canonicalizeClaimPath("a|b")).toBeNull();
  });

  it("rejects non-ASCII, spaces, leading dots/hyphens and trailing dots per segment", () => {
    expect(canonicalizeClaimPath("my asset.fbx")).toBeNull();
    expect(canonicalizeClaimPath("assets/café.fbx")).toBeNull();
    expect(canonicalizeClaimPath(".hidden")).toBeNull();
    expect(canonicalizeClaimPath("-flag")).toBeNull();
    expect(canonicalizeClaimPath("foo.")).toBeNull();
  });

  it("rejects Windows reserved device names case-insensitively", () => {
    expect(canonicalizeClaimPath("CON")).toBeNull();
    expect(canonicalizeClaimPath("com1/out.fbx")).toBeNull();
    expect(canonicalizeClaimPath("assets/NUL")).toBeNull();
    expect(canonicalizeClaimPath("Lpt1")).toBeNull();
  });

  it("rejects oversized paths and segments", () => {
    expect(canonicalizeClaimPath("a".repeat(513))).toBeNull();
    expect(canonicalizeClaimPath(`${"a".repeat(256)}.fbx`)).toBeNull();
    expect(canonicalizeClaimPath(Array.from({ length: 25 }, () => "a").join("/"))).toBeNull();
  });
});

describe("resource-claim set validation (gamos/resource-claims@1, fail closed)", () => {
  it("exposes the schema identity and accepts a valid claim set", () => {
    expect(RESOURCE_CLAIMS_SCHEMA_ID).toBe("gamos/resource-claims@1");
    expect(RESOURCE_CLAIMS_SCHEMA_VERSION).toBe(1);
    const parsed = validateResourceClaims(validClaims);
    expect(parsed.claims).toHaveLength(2);
    expect(parsed.claims[0]?.access).toBe("read");
  });

  it("rejects unknown schema versions and non-object input", () => {
    expect(() => validateResourceClaims({ schemaVersion: 2, claims: validClaims.claims })).toThrow(
      /schemaVersion|version/i,
    );
    expect(() => validateResourceClaims(null)).toThrow(/object/i);
    expect(() => validateResourceClaims([])).toThrow(/object/i);
  });

  it("rejects missing or malformed claim fields", () => {
    expect(() => validateResourceClaims({ claims: validClaims.claims })).toThrow(/schemaVersion/i);
    expect(() => validateResourceClaims({ schemaVersion: 1 })).toThrow(/claims/i);
    expect(() => validateResourceClaims({ schemaVersion: 1, claims: [] })).toThrow(/at least one/i);
    expect(() =>
      validateResourceClaims({ schemaVersion: 1, claims: [{ access: "execute", scope: "project", path: "a" }] }),
    ).toThrow(/access/i);
    expect(() =>
      validateResourceClaims({ schemaVersion: 1, claims: [{ access: "read", scope: "galaxy", path: "a" }] }),
    ).toThrow(/scope/i);
    expect(() =>
      validateResourceClaims({ schemaVersion: 1, claims: [{ access: "read", scope: "project" }] }),
    ).toThrow(/path/i);
    expect(() =>
      validateResourceClaims({ schemaVersion: 1, claims: [{ access: "read", scope: "project", path: "../a" }] }),
    ).toThrow(/path/i);
  });

  it("rejects a read claim over a generated output (outputs are written, never read)", () => {
    expect(() =>
      validateResourceClaims({
        schemaVersion: 1,
        claims: [{ access: "read", scope: "generated-output", path: "out/cube.fbx" }],
      }),
    ).toThrow(/generated-output/i);
  });

  it("rejects exact duplicate claims within one step (ambiguous duplication)", () => {
    expect(() =>
      validateResourceClaims({
        schemaVersion: 1,
        claims: [
          { access: "write", scope: "asset-path", path: "a/b.fbx" },
          { access: "write", scope: "asset-path", path: "a/b.fbx" },
        ],
      }),
    ).toThrow(/duplicate/i);
  });

  it("accepts an optional non-empty label and rejects a non-string label", () => {
    expect(() =>
      validateResourceClaims({
        schemaVersion: 1,
        claims: [{ access: "write", scope: "asset-path", path: "a/b.fbx", label: "target mesh" }],
      }),
    ).not.toThrow();
    expect(() =>
      validateResourceClaims({
        schemaVersion: 1,
        claims: [{ access: "write", scope: "asset-path", path: "a/b.fbx", label: "  " }],
      }),
    ).toThrow(/label/i);
    expect(() =>
      validateResourceClaims({
        schemaVersion: 1,
        claims: [{ access: "write", scope: "asset-path", path: "a/b.fbx", label: 7 }],
      }),
    ).toThrow(/label/i);
  });
});

describe("claim overlap semantics", () => {
  it("overlaps on equal paths and on segment-wise containment", () => {
    expect(
      claimsOverlap({ access: "read", scope: "asset-path", path: "a/b.fbx" }, { access: "write", scope: "asset-path", path: "a/b.fbx" }),
    ).toBe(true);
    expect(
      claimsOverlap({ access: "read", scope: "project", path: "unity-project" }, { access: "write", scope: "asset-path", path: "unity-project/Assets/x.fbx" }),
    ).toBe(true);
    expect(
      claimsOverlap({ access: "write", scope: "scene", path: "blend/main.blend" }, { access: "read", scope: "project", path: "blend" }),
    ).toBe(true);
  });

  it("does not overlap sibling prefixes or disjoint trees", () => {
    expect(
      claimsOverlap({ access: "write", scope: "asset-path", path: "a/b" }, { access: "write", scope: "asset-path", path: "a/bc" }),
    ).toBe(false);
    expect(
      claimsOverlap({ access: "write", scope: "asset-path", path: "x/a.fbx" }, { access: "write", scope: "asset-path", path: "y/a.fbx" }),
    ).toBe(false);
  });

  it("treats case-fold-equal paths as overlapping (case-insensitive engines alias them)", () => {
    expect(
      claimsOverlap({ access: "write", scope: "asset-path", path: "Assets/Cube.fbx" }, { access: "write", scope: "asset-path", path: "assets/cube.fbx" }),
    ).toBe(true);
  });
});

function step(stepId: string, dependsOn: readonly string[], claims: unknown): GamePlanStep {
  return {
    stepId,
    capability: { capabilityId: "blender/asset.export", capabilityVersion: "1.0.0", input: {} },
    dependsOn,
    ...(claims === undefined ? {} : { resourceClaims: claims as never }),
  } as GamePlanStep;
}

const writeClaim = (path: string) => ({
  schemaVersion: 1,
  claims: [{ access: "write", scope: "asset-path", path }],
});
const readClaim = (path: string) => ({
  schemaVersion: 1,
  claims: [{ access: "read", scope: "asset-path", path }],
});

describe("conflict detection across plan steps (handoff §5.3 rules 1-4)", () => {
  it("permits two unordered read-only steps over the same resource (rule 1)", () => {
    const conflicts = findClaimConflicts([
      step("inspect-a", [], readClaim("blend/main.blend")),
      step("inspect-b", [], readClaim("blend/main.blend")),
    ]);
    expect(conflicts).toEqual([]);
  });

  it("flags an unordered write against an overlapping read (rule 2)", () => {
    const conflicts = findClaimConflicts([
      step("inspect", [], readClaim("blend/main.blend")),
      step("mutate", [], writeClaim("blend/main.blend")),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.kind).toBe("read-write");
    expect(conflicts[0]?.stepA).toBe("inspect");
    expect(conflicts[0]?.stepB).toBe("mutate");
    expect(conflicts[0]?.path).toBe("blend/main.blend");
  });

  it("flags unordered write-write over the same resource and over contained resources (rules 2-3)", () => {
    const same = findClaimConflicts([
      step("write-a", [], writeClaim("scene/main.unity")),
      step("write-b", [], writeClaim("scene/main.unity")),
    ]);
    expect(same).toHaveLength(1);
    expect(same[0]?.kind).toBe("write-write");

    const contained = findClaimConflicts([
      step("project-wide", [], { schemaVersion: 1, claims: [{ access: "write", scope: "project", path: "unity-project" }] }),
      step("asset", [], writeClaim("unity-project/Assets/x.fbx")),
    ]);
    expect(contained).toHaveLength(1);
    expect(contained[0]?.kind).toBe("write-write");
    expect(contained[0]?.path).toBe("unity-project");
  });

  it("does not flag conflicts between steps serialized by an explicit dependency (rule 3)", () => {
    expect(
      findClaimConflicts([
        step("export", [], writeClaim("staging/cube.fbx")),
        step("import", ["export"], writeClaim("staging/cube.fbx")),
      ]),
    ).toEqual([]);
  });

  it("does not flag conflicts between transitively ordered steps", () => {
    expect(
      findClaimConflicts([
        step("a", [], writeClaim("out/f.bin")),
        step("b", ["a"], writeClaim("out/f.bin")),
        step("c", ["b"], writeClaim("out/f.bin")),
      ]),
    ).toEqual([]);
  });

  it("flags unordered conflicting writes even when unrelated third steps exist", () => {
    const conflicts = findClaimConflicts([
      step("isolate", [], readClaim("other/tree")),
      step("w1", [], writeClaim("shared/asset.bin")),
      step("w2", [], writeClaim("shared/asset.bin")),
      step("reader", [], readClaim("shared/asset.bin")),
    ]);
    // w1 vs w2 (write-write), w1 vs reader (read-write), w2 vs reader (read-write)
    expect(conflicts).toHaveLength(3);
    expect(conflicts.map((c) => c.kind).sort()).toEqual(["read-write", "read-write", "write-write"]);
  });

  it("flags case-aliased claims as ambiguous ownership (rule 6, fail closed)", () => {
    const conflicts = findClaimConflicts([
      step("lower", [], writeClaim("assets/cube.fbx")),
      step("upper", [], writeClaim("Assets/Cube.fbx")),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.kind).toBe("ambiguous-alias");
  });

  it("ignores steps without claims and returns a deterministic conflict order", () => {
    const conflicts = findClaimConflicts([
      step("z-step", [], writeClaim("b/asset.bin")),
      step("plain", [], undefined),
      step("a-step", [], writeClaim("b/asset.bin")),
      step("m-step", [], writeClaim("a/other.bin")),
      step("k-step", [], writeClaim("a/other.bin")),
    ]);
    expect(conflicts.map((c) => `${c.stepA}:${c.stepB}:${c.path}`)).toEqual([
      "k-step:m-step:a/other.bin",
      "a-step:z-step:b/asset.bin",
    ]);
  });

  it("reports a remediation reason that names explicit serialization (rule 3/4, no silent resolution)", () => {
    const conflicts = findClaimConflicts([
      step("w1", [], writeClaim("scene.bin")),
      step("w2", [], writeClaim("scene.bin")),
    ]);
    expect(conflicts[0]?.reason).toMatch(/dependsOn|serial/i);
    expect(conflicts[0]?.reason).toMatch(/fail closed|conflict/i);
  });
});
