import { describe, expect, it } from "vitest";
import {
  parseUnityVersion,
  compareUnityVersions,
  parseBlenderVersion,
  compareBlenderVersions,
  parseGodotVersion,
  compareGodotVersions,
  parseUnrealVersion,
  compareUnrealVersions,
  parseBabylonToolchainVersion,
  compareBabylonToolchainVersions,
  evaluateVersionPredicate,
} from "../src/domain/discovery/engine-versions.js";

/**
 * Engine-specific version grammars (contract 04 §4 — M1.3 TDD RED).
 * NO universal SemVer: each family has its own parser + comparison; failures
 * are recorded raw-only with a diagnostic (fail closed, never "compatible").
 */

describe("Unity version grammar (contract 04 §4)", () => {
  it("parses a 2022-era final stream version", () => {
    const v = parseUnityVersion("2022.3.10f1");
    expect(v).toMatchObject({ major: 2022, minor: 3, patch: 10, stream: "f", sequence: 1 });
  });
  it("parses Unity 6 (6000.x) versions", () => {
    const v = parseUnityVersion("6000.0.23f1");
    expect(v).toMatchObject({ major: 6000, minor: 0, patch: 23, stream: "f", sequence: 1 });
  });
  it("parses alpha/beta/china/patch streams", () => {
    expect(parseUnityVersion("2023.1.0a5")).toMatchObject({ stream: "a", sequence: 5 });
    expect(parseUnityVersion("2023.1.0b7")).toMatchObject({ stream: "b", sequence: 7 });
    expect(parseUnityVersion("2021.3.35c1")).toMatchObject({ stream: "c", sequence: 1 });
    expect(parseUnityVersion("2022.2.1p3")).toMatchObject({ stream: "p", sequence: 3 });
  });
  it("parses ProjectVersion.txt m_EditorVersionWithRevision with revision sha", () => {
    const v = parseUnityVersion("2022.3.10f1 (abcdef123456)");
    expect(v).toMatchObject({ major: 2022, minor: 3, patch: 10, stream: "f", sequence: 1, revision: "abcdef123456" });
  });
  it("rejects malformed Unity versions with a diagnostic (fail closed)", () => {
    const r = parseUnityVersion("not-a-unity-version");
    expect(r.ok).toBe(false);
    expect(r.diagnostic).toBeTruthy();
    expect(r.raw).toBe("not-a-unity-version");
  });
  it("stream sequence participates in ordering: 2022.3.10f1 < 2022.3.2f1 is FALSE", () => {
    // Contract 04 §4 rule 2: the stream sequence is PART of the ordering.
    expect(compareUnityVersions(parseUnityVersion("2022.3.10f1"), parseUnityVersion("2022.3.2f1")) > 0).toBe(true);
  });
  it("same version compares equal; major/minor/patch order correctly", () => {
    expect(compareUnityVersions(parseUnityVersion("2022.3.10f1"), parseUnityVersion("2022.3.10f1"))).toBe(0);
    expect(compareUnityVersions(parseUnityVersion("2022.3.9f1"), parseUnityVersion("2022.3.10f1")) < 0).toBe(true);
    expect(compareUnityVersions(parseUnityVersion("2022.4.0f1"), parseUnityVersion("2023.1.0a1")) < 0).toBe(true);
  });
});

describe("Blender version grammar", () => {
  it("parses 'Blender 4.1.1' output", () => {
    const v = parseBlenderVersion("Blender 4.1.1");
    expect(v).toMatchObject({ major: 4, minor: 1, patch: 1 });
  });
  it("parses LTS-tagged versions", () => {
    const v = parseBlenderVersion("Blender 4.2 LTS");
    expect(v).toMatchObject({ major: 4, minor: 2, lts: true });
  });
  it("rejects garbage with raw + diagnostic", () => {
    const r = parseBlenderVersion("Blender unknown");
    expect(r.ok).toBe(false);
    expect(r.raw).toBe("Blender unknown");
  });
  it("compares: 4.1.1 < 4.2.0; LTS flag does not invent ordering", () => {
    expect(compareBlenderVersions(parseBlenderVersion("Blender 4.1.1"), parseBlenderVersion("Blender 4.2.0")) < 0).toBe(true);
    expect(compareBlenderVersions(parseBlenderVersion("Blender 4.2 LTS"), parseBlenderVersion("Blender 4.2 LTS"))).toBe(0);
  });
});

describe("Godot version grammar", () => {
  it("parses '4.2.1.stable.official.<build>'", () => {
    const v = parseGodotVersion("4.2.1.stable.official.1234567890");
    expect(v).toMatchObject({ major: 4, minor: 2, patch: 1, channel: "stable" });
  });
  it("parses rc/beta/alpha/dev channels", () => {
    expect(parseGodotVersion("4.3.rc1.official.abc")).toMatchObject({ channel: "rc", channelOrdinal: 1 });
    expect(parseGodotVersion("4.3.beta2.official.abc")).toMatchObject({ channel: "beta", channelOrdinal: 2 });
    expect(parseGodotVersion("4.0.alpha1.mono.abc")).toMatchObject({ channel: "alpha", mono: true });
  });
  it("rejects malformed godot versions", () => {
    expect(parseGodotVersion("godot??").ok).toBe(false);
  });
  it("compares: stable > rc > beta > alpha > dev", () => {
    const stable = parseGodotVersion("4.2.1.stable.official.x");
    const rc = parseGodotVersion("4.2.1.rc1.official.x");
    const beta = parseGodotVersion("4.2.1.beta3.official.x");
    const alpha = parseGodotVersion("4.2.1.alpha1.official.x");
    expect(compareGodotVersions(alpha, beta) < 0).toBe(true);
    expect(compareGodotVersions(beta, rc) < 0).toBe(true);
    expect(compareGodotVersions(rc, stable) < 0).toBe(true);
  });
});

describe("Unreal version grammar", () => {
  it("parses '<major>.<minor>.<patch>-<branch>+<commit>'", () => {
    const v = parseUnrealVersion("5.3.2-+++UE+Release-5.3+abc123");
    expect(v).toMatchObject({ major: 5, minor: 3, patch: 2 });
  });
  it("strips engine-brand prefixes like ++UE5+Release-5.3", () => {
    const v = parseUnrealVersion("++UE5+Release-5.3");
    expect(v).toMatchObject({ major: 5, minor: 3, patch: 0 });
  });
  it("rejects malformed unreal versions", () => {
    expect(parseUnrealVersion("Unreal??").ok).toBe(false);
  });
  it("compares 5.3.2 > 5.3.1 > 5.2.0", () => {
    expect(compareUnrealVersions(parseUnrealVersion("5.3.2-+++UE+Release-5.3"), parseUnrealVersion("5.3.1-+++UE+Release-5.3")) > 0).toBe(true);
    expect(compareUnrealVersions(parseUnrealVersion("5.3.1-+++UE+Release-5.3"), parseUnrealVersion("5.2.0-+++UE+Release-5.2")) > 0).toBe(true);
  });
});

describe("Babylon toolchain grammar (runtime's own version)", () => {
  it("parses Node-style semver toolchain versions", () => {
    const v = parseBabylonToolchainVersion("v24.22.2");
    expect(v).toMatchObject({ major: 24, minor: 22, patch: 2 });
  });
  it("parses bare semver", () => {
    expect(parseBabylonToolchainVersion("20.11.0")).toMatchObject({ major: 20, minor: 11, patch: 0 });
  });
  it("rejects malformed toolchain versions", () => {
    expect(parseBabylonToolchainVersion("node?").ok).toBe(false);
  });
});

describe("Version predicates (shared metadata, family grammar — contract 04 §4 rule 2)", () => {
  it("evaluates a Unity predicate against a parsed Unity version", () => {
    const installed = parseUnityVersion("2022.3.10f1");
    expect(evaluateVersionPredicate("unity", ">=2022.3", installed)).toBe(true);
    expect(evaluateVersionPredicate("unity", ">=2023.1", installed)).toBe(false);
    expect(evaluateVersionPredicate("unity", "2022.3.*", installed)).toBe(true);
  });
  it("an UNPARSEABLE version fails closed: predicate resolves to incompatible/unknown", () => {
    const raw = parseUnityVersion("garbage");
    const r = evaluateVersionPredicate("unity", ">=2022.3", raw);
    expect(r).toBe("unknown");
  });
  it("a malformed predicate fails closed (never 'treat as compatible')", () => {
    const installed = parseUnityVersion("2022.3.10f1");
    expect(evaluateVersionPredicate("unity", "???", installed)).toBe("unknown");
  });
});
