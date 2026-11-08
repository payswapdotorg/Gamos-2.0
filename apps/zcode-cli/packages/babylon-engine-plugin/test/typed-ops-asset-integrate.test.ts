/**
 * M3.2 target leg — the typed surface of `babylon/asset.integrate` (typed-ops).
 * Written FIRST (strict TDD RED): the input schema, the fail-closed asset
 * registry parser, the registry-entry builder and the staged-path resolution
 * do not exist yet.
 *
 * Pins the reviewed asset-integration convention:
 * - the input is {projectRoot, artifactPath, assetName?, expectedIntegrity?}
 *   with assetName constrained to the lowercase-dash registry pattern
 *   (^[a-z0-9][a-z0-9-]{0,63}$; defaults to the artifact filename stem);
 * - expectedIntegrity {byteLength positive int, sha256 64 lowercase hex} is
 *   the AUTHORITATIVE cross-engine manifest record — malformed records are
 *   rejected at the typed boundary, never silently ignored;
 * - the committed registry (gamos/babylon-assets@1) parses fail-closed: a
 *   wrong schema id or any malformed entry yields null, never a guess;
 * - the staged asset path is <projectRoot>/public/assets/<file> with the same
 *   path-safety semantics as resolveWorkspacePath (no traversal, no
 *   separators, no absolute file names);
 * - registry entries are the frozen {assetName, file, sha256} triple.
 */

import { describe, expect, test } from "vitest";
import {
  AssetIntegrateInput,
  PathSafetyError,
  buildAssetRegistryEntry,
  parseAssetRegistry,
  registryFileOf,
  resolveStagedAssetPath,
} from "../src/typed-ops.js";

const GLB_SHA256 = "b8acd9cf2ce3f5e55cc0ae07566e13b2221043ff5b3e27a953905748983bd1f1";

describe("asset integrate input schema (M3.2 target leg)", () => {
  test("accepts the minimal input, the optional assetName and the expectedIntegrity block", () => {
    expect(
      AssetIntegrateInput.safeParse({ projectRoot: "/ws/app", artifactPath: "/ws/out/gamos-cube.glb" }).success,
    ).toBe(true);
    expect(
      AssetIntegrateInput.safeParse({
        projectRoot: "/ws/app",
        artifactPath: "/ws/out/scene.glb",
        assetName: "gamos-cube",
      }).success,
    ).toBe(true);
    expect(
      AssetIntegrateInput.safeParse({
        projectRoot: "/ws/app",
        artifactPath: "/ws/out/scene.glb",
        assetName: "gamos-cube",
        expectedIntegrity: { byteLength: 1988, sha256: GLB_SHA256 },
      }).success,
    ).toBe(true);
    // unknown keys are stripped (a caller cannot smuggle extra surface in)
    const smuggled = AssetIntegrateInput.safeParse({
      projectRoot: "/ws/app",
      artifactPath: "/ws/out/scene.glb",
      script: "arbitrary-script",
    });
    expect(smuggled.success).toBe(true);
    if (smuggled.success) {
      expect((smuggled.data as Record<string, unknown>).script).toBeUndefined();
    }
  });

  test("requires projectRoot and artifactPath", () => {
    expect(AssetIntegrateInput.safeParse({}).success).toBe(false);
    expect(AssetIntegrateInput.safeParse({ projectRoot: "/ws/app" }).success).toBe(false);
    expect(AssetIntegrateInput.safeParse({ artifactPath: "/ws/out/scene.glb" }).success).toBe(false);
    expect(AssetIntegrateInput.safeParse({ projectRoot: "", artifactPath: "/ws/out/scene.glb" }).success).toBe(false);
    expect(AssetIntegrateInput.safeParse({ projectRoot: "/ws/app", artifactPath: "" }).success).toBe(false);
  });

  test("rejects asset names outside the lowercase-dash registry pattern", () => {
    const base = { projectRoot: "/ws/app", artifactPath: "/ws/out/scene.glb" };
    for (const bad of [
      "GamosCube", // uppercase
      "-cube", // leading dash
      "cube_", // underscore
      "cube.name", // dot
      "cube name", // space
      "cube!", // punctuation
      "../cube", // traversal
      "a".repeat(65), // over the 64-char bound
      42, // not a string
    ]) {
      expect(AssetIntegrateInput.safeParse({ ...base, assetName: bad }).success).toBe(false);
    }
    expect(AssetIntegrateInput.safeParse({ ...base, assetName: "a" }).success).toBe(true);
    expect(AssetIntegrateInput.safeParse({ ...base, assetName: "a".repeat(64) }).success).toBe(true);
    expect(AssetIntegrateInput.safeParse({ ...base, assetName: "gamos-cube-8" }).success).toBe(true);
  });

  test("rejects malformed expectedIntegrity records (byteLength/sha256 shapes)", () => {
    const base = { projectRoot: "/ws/app", artifactPath: "/ws/out/scene.glb" };
    expect(
      AssetIntegrateInput.safeParse({ ...base, expectedIntegrity: { byteLength: 1988, sha256: GLB_SHA256 } }).success,
    ).toBe(true);
    for (const bad of [
      { byteLength: 0, sha256: GLB_SHA256 }, // non-positive
      { byteLength: -1, sha256: GLB_SHA256 }, // negative
      { byteLength: 1.5, sha256: GLB_SHA256 }, // non-integer
      { byteLength: "1988", sha256: GLB_SHA256 }, // string
      { byteLength: 1988 }, // missing sha256
      { sha256: GLB_SHA256 }, // missing byteLength
      { byteLength: 1988, sha256: GLB_SHA256.toUpperCase() }, // uppercase hex
      { byteLength: 1988, sha256: "abcd" }, // not 64 chars
      { byteLength: 1988, sha256: 42 }, // not a string
      "not-an-object", // integrity is not an object
    ]) {
      expect(AssetIntegrateInput.safeParse({ ...base, expectedIntegrity: bad }).success).toBe(false);
    }
  });
});

describe("asset registry parsing (gamos/babylon-assets@1, fail closed)", () => {
  const validEntry = { assetName: "gamos-cube", file: "gamos-cube.glb", sha256: GLB_SHA256 };

  test("parses the canonical committed registry shape", () => {
    expect(parseAssetRegistry(JSON.stringify({ schema: "gamos/babylon-assets@1", assets: [] }))).toEqual({
      schema: "gamos/babylon-assets@1",
      assets: [],
    });
    expect(parseAssetRegistry(JSON.stringify({ schema: "gamos/babylon-assets@1", assets: [validEntry] }))).toEqual({
      schema: "gamos/babylon-assets@1",
      assets: [validEntry],
    });
    // multiple entries survive in order (append-only registry)
    const second = { assetName: "second-cube", file: "second-cube.glb", sha256: "0".repeat(64) };
    expect(
      parseAssetRegistry(JSON.stringify({ schema: "gamos/babylon-assets@1", assets: [validEntry, second] })),
    ).toEqual({ schema: "gamos/babylon-assets@1", assets: [validEntry, second] });
  });

  test("fails closed on the wrong schema id or a non-registry shape", () => {
    expect(parseAssetRegistry(JSON.stringify({ schema: "gamos/babylon-assets@2", assets: [] }))).toBeNull();
    expect(parseAssetRegistry(JSON.stringify({ schema: "gamos/babylon-assets", assets: [] }))).toBeNull();
    expect(parseAssetRegistry(JSON.stringify({ assets: [] }))).toBeNull();
    expect(parseAssetRegistry(JSON.stringify({ schema: "gamos/babylon-assets@1" }))).toBeNull(); // assets missing
    expect(parseAssetRegistry(JSON.stringify({ schema: "gamos/babylon-assets@1", assets: {} }))).toBeNull(); // not an array
    expect(parseAssetRegistry("not json at all")).toBeNull();
    expect(parseAssetRegistry("[]")).toBeNull();
    expect(parseAssetRegistry("null")).toBeNull();
    expect(parseAssetRegistry("")).toBeNull();
  });

  test("fails closed on malformed entries (never a partial guess)", () => {
    for (const bad of [
      { assetName: "GamosCube", file: "gamos-cube.glb", sha256: GLB_SHA256 }, // uppercase name
      { assetName: "../evil", file: "evil.glb", sha256: GLB_SHA256 }, // traversal name
      { assetName: "gamos-cube", file: "Gamos Cube.glb", sha256: GLB_SHA256 }, // bad file name
      { assetName: "gamos-cube", file: "../escape.glb", sha256: GLB_SHA256 }, // traversal file
      { assetName: "gamos-cube", file: "/abs/path.glb", sha256: GLB_SHA256 }, // absolute file
      { assetName: "gamos-cube", file: "gamos-cube.gltf", sha256: GLB_SHA256 }, // wrong extension
      { assetName: "gamos-cube", file: "gamos-cube.glb", sha256: "abcd" }, // bad sha256
      { assetName: "gamos-cube", file: "gamos-cube.glb", sha256: 42 }, // non-string sha256
      { assetName: "gamos-cube", file: "gamos-cube.glb" }, // missing sha256
      { assetName: "gamos-cube", sha256: GLB_SHA256 }, // missing file
      { file: "gamos-cube.glb", sha256: GLB_SHA256 }, // missing assetName
      "not-an-object",
      null,
      42,
    ]) {
      expect(parseAssetRegistry(JSON.stringify({ schema: "gamos/babylon-assets@1", assets: [bad] }))).toBeNull();
    }
  });
});

describe("buildAssetRegistryEntry", () => {
  test("builds the exact frozen {assetName, file, sha256} triple", () => {
    expect(buildAssetRegistryEntry({ assetName: "gamos-cube", file: "gamos-cube.glb", sha256: GLB_SHA256 })).toEqual({
      assetName: "gamos-cube",
      file: "gamos-cube.glb",
      sha256: GLB_SHA256,
    });
  });

  test("refuses to construct entries with invalid constituents", () => {
    expect(() => buildAssetRegistryEntry({ assetName: "../evil", file: "evil.glb", sha256: GLB_SHA256 })).toThrow();
    expect(() => buildAssetRegistryEntry({ assetName: "GamosCube", file: "evil.glb", sha256: GLB_SHA256 })).toThrow();
    expect(() => buildAssetRegistryEntry({ assetName: "ok-name", file: "../evil.glb", sha256: GLB_SHA256 })).toThrow();
    expect(() => buildAssetRegistryEntry({ assetName: "ok-name", file: "cube.gltf", sha256: GLB_SHA256 })).toThrow();
    expect(() => buildAssetRegistryEntry({ assetName: "ok-name", file: "cube.glb", sha256: "nothex" })).toThrow();
    expect(() => buildAssetRegistryEntry({ assetName: "ok-name", file: "cube.glb", sha256: "" })).toThrow();
  });
});

describe("staged asset path resolution (public/assets, path-safe)", () => {
  test("places staged files exactly under <projectRoot>/public/assets", () => {
    expect(resolveStagedAssetPath("/ws/app", "gamos-cube.glb")).toBe("/ws/app/public/assets/gamos-cube.glb");
    expect(resolveStagedAssetPath("/ws/deep/app", "a.glb")).toBe("/ws/deep/app/public/assets/a.glb");
  });

  test("rejects traversal, absolute and separator-crafted file names", () => {
    for (const bad of [
      "../../etc/passwd", // traversal out of the staging root
      "sub/../../x.glb", // traversal via separators
      "a/b.glb", // forward separator
      "a\\b.glb", // backslash separator (Windows-style smuggling)
      "/etc/passwd", // absolute file name
      "..", // parent reference
      ".", // self reference
      "", // empty
    ]) {
      expect(() => resolveStagedAssetPath("/ws/app", bad)).toThrow(PathSafetyError);
    }
  });

  test("registryFileOf points at the committed registry path", () => {
    expect(registryFileOf("/ws/app")).toBe("/ws/app/src/gamos-assets.json");
    expect(registryFileOf("/ws/deep/app")).toBe("/ws/deep/app/src/gamos-assets.json");
  });
});
