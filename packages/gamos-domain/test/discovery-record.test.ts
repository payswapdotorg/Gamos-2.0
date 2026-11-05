import { describe, expect, it } from "vitest";
import {
  buildMachineDiscoveryRecord,
  joinEngineState,
  isRecordStale,
} from "../src/domain/discovery/discovery-record.js";
import type { DiscoveredEngine } from "../src/domain/discovery/discovery-record.js";

/**
 * Machine-local discovery records (contract 04 §2/§3 — M1.3 TDD RED):
 * - workspacePath + discoveredAt + host fingerprint (stale detection)
 * - explicit unavailable states with reasons
 * - shared-metadata JOIN machine-local at task time (transient join)
 */

const engines: DiscoveredEngine[] = [
  {
    engineFamily: "unity",
    installed: true,
    rawVersion: "2022.3.10f1",
    parsedVersion: { major: 2022, minor: 3, patch: 10, stream: "f", sequence: 1 },
    executablePath: "/opt/Unity/2022.3.10f1/Editor/Unity",
    headlessCapable: true,
    displayServerRequired: false,
  },
  {
    engineFamily: "blender",
    installed: false,
    notes: "blender executable not found on PATH or common install locations",
    headlessCapable: false,
    displayServerRequired: false,
  },
];

describe("MachineEngineDiscovery record (M1.3)", () => {
  it("builds a valid record with workspace provenance + host fingerprint", () => {
    const rec = buildMachineDiscoveryRecord("/workspace/game", engines, { platform: "linux", arch: "x64" });
    expect(rec.schemaVersion).toBe(2);
    expect(rec.workspacePath).toBe("/workspace/game");
    expect(rec.host).toEqual({ platform: "linux", arch: "x64" });
    expect(rec.discoveredAt).toBeTruthy();
    expect(rec.engines).toHaveLength(2);
    expect(rec.discoveryVersion).toBe("gamos/engine-discovery@2");
  });

  it("installed:false carries an explicit reason (never silent)", () => {
    const rec = buildMachineDiscoveryRecord("/workspace/game", engines, { platform: "linux", arch: "x64" });
    const blender = rec.engines.find((e) => e.engineFamily === "blender");
    expect(blender?.installed).toBe(false);
    expect(blender?.notes).toBeTruthy();
  });

  it("stale detection: cross-machine host fingerprint marks the record stale", () => {
    const rec = buildMachineDiscoveryRecord("/workspace/game", engines, { platform: "linux", arch: "x64" });
    expect(isRecordStale(rec, { platform: "darwin", arch: "arm64" })).toBe(true);
    expect(isRecordStale(rec, { platform: "linux", arch: "x64" })).toBe(false);
  });

  it("join: shared declaration + machine-local discovery produce the effective state", () => {
    const shared = {
      schemaVersion: 2 as const,
      workspacePath: "/workspace/game",
      engineBindings: [{ engineFamily: "unity" as const, versionPredicate: ">=2022.3" }],
    };
    const local = buildMachineDiscoveryRecord("/workspace/game", engines, { platform: "linux", arch: "x64" });
    const joined = joinEngineState(shared, local);
    const unity = joined.find((j) => j.engineFamily === "unity");
    expect(unity?.state).toBe("available");
    expect(unity?.versionMatch).toBe(true);
    // Declared but NOT installed → unavailable with reason.
    const declaredNotInstalled = joinEngineState(
      { ...shared, engineBindings: [{ engineFamily: "blender" as const }] },
      local,
    );
    expect(declaredNotInstalled.find((j) => j.engineFamily === "blender")?.state).toBe("unavailable");
  });

  it("join: unparseable raw version → incompatible/unknown (fail closed)", () => {
    const weird: DiscoveredEngine[] = [
      {
        engineFamily: "unity",
        installed: true,
        rawVersion: "custom-unity-fork",
        headlessCapable: true,
        displayServerRequired: false,
      },
    ];
    const shared = {
      schemaVersion: 2 as const,
      workspacePath: "/w",
      engineBindings: [{ engineFamily: "unity" as const, versionPredicate: ">=2022.3" }],
    };
    const local = buildMachineDiscoveryRecord("/w", weird, { platform: "linux", arch: "x64" });
    const joined = joinEngineState(shared, local);
    expect(joined.find((j) => j.engineFamily === "unity")?.state).toBe("unknown");
  });
});
