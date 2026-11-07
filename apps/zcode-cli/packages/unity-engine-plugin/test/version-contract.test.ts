import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  REQUIRED_UNITY_EDITOR_REVISION,
  REQUIRED_UNITY_EDITOR_VERSION,
  checkUnityVersionContract,
  parseProjectVersionFile,
  parseUnityRevisionFromVersionOutput,
  type UnityProjectVersionPin,
} from "../src/typed-ops.js";

/**
 * M2-B (final-closure directive §2) — the Unity project/editor version
 * contract must be EXACT.
 *
 * The committed fixture's `ProjectSettings/ProjectVersion.txt` pins
 * `6000.0.23f1` with revision `ab2b18a5f80dcba39fd8f5ee57b07edc7c0f600f`.
 * The current de-facto behavior is a 2022.3+ discovery FLOOR that would
 * silently accept an older (or newer, or revision-different) editor against
 * a project that requires an exact version. These tests demand the exact
 * contract: an incompatible editor is reported as incompatible — never
 * licensed or verified — and missing/malformed version metadata fails
 * closed.
 */

const FIXTURE_DIR = fileURLToPath(new URL("./fixture/unity-project", import.meta.url));

function fixtureProjectVersionPin(): UnityProjectVersionPin {
  const content = readFileSync(
    (() => {
      // Construct the path lazily so import-time failures stay impossible.
      const parts = FIXTURE_DIR.split("/");
      parts.push("ProjectSettings", "ProjectVersion.txt");
      return parts.join("/");
    })(),
    "utf8",
  );
  const pin = parseProjectVersionFile(content);
  expect(pin).not.toBeNull();
  return pin!;
}

describe("Unity ProjectVersion.txt parsing (M2-B)", () => {
  test("parses the committed fixture pin: 6000.0.23f1 with revision ab2b18a5…", () => {
    const pin = fixtureProjectVersionPin();
    expect(pin.version).toBe("6000.0.23f1");
    expect(pin.revision).toBe("ab2b18a5f80dcba39fd8f5ee57b07edc7c0f600f");
  });

  test("parses m_EditorVersion alone when the revision line is absent", () => {
    const pin = parseProjectVersionFile("m_EditorVersion: 6000.0.23f1\n");
    expect(pin).toEqual({ version: "6000.0.23f1", revision: null });
  });

  test("missing m_EditorVersion metadata fails closed (null, never a guess)", () => {
    expect(parseProjectVersionFile("m_EditorVersionWithRevision: 6000.0.23f1 (ab2b18a5f80dcba39fd8f5ee57b07edc7c0f600f)\n")).toBeNull();
    expect(parseProjectVersionFile("")).toBeNull();
  });

  test("malformed version or revision fails closed (null, never a partial pin)", () => {
    expect(parseProjectVersionFile("m_EditorVersion: not-a-version\n")).toBeNull();
    expect(
      parseProjectVersionFile("m_EditorVersion: 6000.0.23f1\nm_EditorVersionWithRevision: 6000.0.23f1 (not-a-hash)\n"),
    ).toBeNull();
    expect(parseProjectVersionFile("m_EditorVersion: 6000.0.23f1\nm_EditorVersionWithRevision: 6000.0.23f1 ()\n")).toBeNull();
  });
});

describe("Unity editor revision extraction from -version output (M2-B)", () => {
  test("extracts the 40-hex revision when the editor exposes it", () => {
    expect(parseUnityRevisionFromVersionOutput("6000.0.23f1 (ab2b18a5f80dcba39fd8f5ee57b07edc7c0f600f)\n")).toBe(
      "ab2b18a5f80dcba39fd8f5ee57b07edc7c0f600f",
    );
    expect(parseUnityRevisionFromVersionOutput("Unity 6000.0.23f1 (ab2b18a5f80dcba39fd8f5ee57b07edc7c0f600f) some noise\n")).toBe(
      "ab2b18a5f80dcba39fd8f5ee57b07edc7c0f600f",
    );
  });

  test("returns null when the official -version output does not expose a revision", () => {
    expect(parseUnityRevisionFromVersionOutput("6000.0.23f1\n")).toBeNull();
    expect(parseUnityRevisionFromVersionOutput("")).toBeNull();
  });
});

describe("Unity project/editor version contract — EXACT, not a floor (M2-B)", () => {
  const project = (): UnityProjectVersionPin => ({ version: "6000.0.23f1", revision: "ab2b18a5f80dcba39fd8f5ee57b07edc7c0f600f" });

  test("an exactly-matching editor (revision not exposed by -version) satisfies the contract", () => {
    const result = checkUnityVersionContract("6000.0.23f1", null, project());
    expect(result.ok).toBe(true);
  });

  test("an exactly-matching editor with a matching exposed revision satisfies the contract", () => {
    const result = checkUnityVersionContract("6000.0.23f1", "ab2b18a5f80dcba39fd8f5ee57b07edc7c0f600f", project());
    expect(result.ok).toBe(true);
  });

  test("an OLDER editor (2022.3.10f1 — above today's floor) is INCOMPATIBLE against the Unity 6 fixture", () => {
    const result = checkUnityVersionContract("2022.3.10f1", null, project());
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe("editor-version-incompatible");
    expect(result.ok === false && result.reason).toMatch(/6000\.0\.23f1/);
  });

  test("a NEWER editor (6000.0.30f1) is INCOMPATIBLE — the contract is exact, not a minimum", () => {
    const result = checkUnityVersionContract("6000.0.30f1", null, project());
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe("editor-version-incompatible");
  });

  test("an editor with a MISMATCHED exposed revision is INCOMPATIBLE (the fixture pin includes the revision)", () => {
    const result = checkUnityVersionContract("6000.0.23f1", "0000000000000000000000000000000000000000", project());
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe("editor-revision-incompatible");
  });

  test("missing editor version metadata fails closed — never silently accepted", () => {
    const result = checkUnityVersionContract(null, null, project());
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe("editor-version-missing");
  });

  test("malformed editor version fails closed", () => {
    const result = checkUnityVersionContract("not-a-version", null, project());
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe("editor-version-incompatible");
  });

  test("the committed required pins match the shipped fixture exactly (no drift between constants and fixture)", () => {
    expect(REQUIRED_UNITY_EDITOR_VERSION).toBe("6000.0.23f1");
    expect(REQUIRED_UNITY_EDITOR_REVISION).toBe("ab2b18a5f80dcba39fd8f5ee57b07edc7c0f600f");
    const pin = fixtureProjectVersionPin();
    expect(pin.version).toBe(REQUIRED_UNITY_EDITOR_VERSION);
    expect(pin.revision).toBe(REQUIRED_UNITY_EDITOR_REVISION);
  });
});
