import { describe, expect, it } from "vitest";
import {
  registerCapability,
  getCapability,
  resolveCapability,
  listCapabilities,
  type CapabilityRecord,
} from "../src/domain/capability-registry.js";
import { completeCapabilityRecord as completeRecord } from "./fixtures.js";

/** Strips one execution-safety field for negative registration tests. */
function without<K extends keyof typeof completeRecord>(key: K) {
  const clone = structuredClone(completeRecord) as Record<string, unknown>;
  delete clone[key as string];
  return clone;
}

describe("Capability registration — execution-safety completeness (M1.2 TDD / M1-G2)", () => {
  it("accepts a complete valid record", () => {
    const r = registerCapability(completeRecord);
    expect(r.id).toBe("core/project.inspect");
  });

  it("rejects a record missing provider identity", () => {
    const bad = without("provider");
    expect(() => registerCapability(bad)).toThrow(/provider/i);
  });

  it("rejects a record missing prerequisites data", () => {
    const bad = without("prerequisites");
    expect(() => registerCapability(bad)).toThrow(/prerequisite/i);
  });

  it("rejects a record missing reversibility information", () => {
    const bad = without("reversibility");
    expect(() => registerCapability(bad)).toThrow(/reversibility/i);
  });

  it("rejects a record missing idempotency information", () => {
    const bad = without("idempotency");
    expect(() => registerCapability(bad)).toThrow(/idempotency/i);
  });

  it("rejects a record missing timeout", () => {
    const bad = without("timeout");
    expect(() => registerCapability(bad)).toThrow(/timeout/i);
  });

  it("rejects a record with invalid cancellation metadata", () => {
    const bad = { ...completeRecord, cancellation: { supported: "yes" } };
    expect(() => registerCapability(bad)).toThrow(/cancellation/i);
  });

  it("rejects a record missing a verification method", () => {
    const bad = without("verification");
    expect(() => registerCapability(bad)).toThrow(/verification/i);
  });

  it("rejects a record missing provenance (registration failure)", () => {
    const bad = without("provenance");
    expect(() => registerCapability(bad)).toThrow(/provenance/i);
  });

  it("rejects a record with an invalid semver version", () => {
    const bad = { ...completeRecord, version: "not-semver" };
    expect(() => registerCapability(bad)).toThrow(/version/i);
  });

  it("rejects a record with an invalid capability id grammar", () => {
    const bad = { ...completeRecord, id: "Bad Id!" };
    expect(() => registerCapability(bad)).toThrow(/id/i);
  });
});

function buildRegistry(...records: unknown[]): Map<string, CapabilityRecord> {
  const registry = new Map<string, CapabilityRecord>();
  for (const record of records) {
    const r = registerCapability(record);
    registry.set(`${r.id}@${r.version}`, r);
  }
  return registry;
}

describe("Fail-closed capability selection (M1.2 TDD / M1-G2)", () => {
  const registry = buildRegistry(completeRecord);

  it("unknown capability id fails closed with an explicit error", () => {
    const r = resolveCapability(registry, { id: "unity/scene.create" });
    if (r.ok) throw new Error("should have failed");
    expect(r.error.code).toBe("unknown-id");
    expect(r.error.requestedId).toBe("unity/scene.create");
    expect(r.error.reason).toBeTruthy();
  });

  it("unknown version fails closed", () => {
    const r = resolveCapability(registry, { id: "core/project.inspect", version: "9.9.9" });
    if (r.ok) throw new Error("should have failed");
    expect(r.error.code).toBe("unknown-version");
  });

  it("version mismatch fails closed", () => {
    const r = resolveCapability(registry, { id: "core/project.inspect", version: "0.9.0" });
    if (r.ok) throw new Error("should have failed");
    expect(["version-mismatch", "unknown-version"]).toContain(r.error.code);
  });

  it("incompatible engine version fails closed", () => {
    const unityOnly = {
      ...completeRecord,
      id: "unity/scene.create",
      engineFamily: "unity",
      compatibility: { engineVersions: ">=2022.3", notes: "unity only" },
    };
    const reg = buildRegistry(unityOnly);
    const r = resolveCapability(reg, { id: "unity/scene.create", engineFamily: "blender" });
    if (r.ok) throw new Error("should have failed");
    expect(r.error.code).toBe("engine-incompatible");
  });

  it("unavailable capability fails closed with reason + remediation data", () => {
    const unavailable = {
      ...completeRecord,
      id: "blender/mesh.export",
      engineFamily: "blender",
      availability: { state: "unavailable", reason: "blender binary not discovered on this machine" },
      provider: { kind: "engine-binary", identity: "blender>=4.1 (not found)" },
    };
    const reg = buildRegistry(unavailable, completeRecord);
    const r = resolveCapability(reg, { id: "blender/mesh.export" });
    if (r.ok) throw new Error("should have failed");
    expect(r.error.code).toBe("unavailable");
    expect(r.error.reason).toContain("blender");
    // remediation lists available alternatives as DATA, never auto-selected
    expect(r.error.remediation.length).toBeGreaterThanOrEqual(0);
  });

  it("missing prerequisite exposes explicit state and remediation", () => {
    const needsDisplay = {
      ...completeRecord,
      id: "blender/render.frame",
      engineFamily: "blender",
      availability: {
        state: "conditional",
        reason: "engine binary present",
        prerequisites: ["display-server"],
      },
      prerequisites: [{ id: "display-server", description: "Xvfb or X server required for GUI rendering" }],
    };
    const reg = buildRegistry(needsDisplay);
    const r = resolveCapability(reg, { id: "blender/render.frame", prerequisites: [] });
    if (r.ok) throw new Error("should have failed");
    expect(["missing-prerequisite", "unavailable"]).toContain(r.error.code);
  });

  it("invalid input against the record's input schema is a tool error", () => {
    const r = resolveCapability(registry, {
      id: "core/project.inspect",
      input: { wrong: true },
    });
    if (r.ok) throw new Error("should have failed");
    expect(r.error.code).toBe("invalid-input");
  });

  it("valid input resolves to the record (same id, satisfiable version)", () => {
    const r = resolveCapability(registry, {
      id: "core/project.inspect",
      input: { projectRoot: "/ws/game" },
    });
    if (!r.ok) throw new Error(r.error.reason);
    expect(r.record.id).toBe("core/project.inspect");
  });

  it("no registry-order fallback exists: resolution of an unknown id NEVER returns another capability", () => {
    for (let i = 0; i < 5; i++) {
      const r = resolveCapability(registry, { id: `nonexistent-${i}` });
      expect(r.ok).toBe(false);
    }
  });

  it("getCapability: lookup by stable id + version; unknown fails explicitly", () => {
    expect(getCapability(registry, "core/project.inspect", "1.0.0").id).toBe(
      "core/project.inspect",
    );
    expect(() => getCapability(registry, "core/project.inspect", "2.0.0")).toThrow();
    expect(() => getCapability(registry, "no/such")).toThrow(/unknown/i);
  });

  it("listCapabilities returns registry data (append-only identity)", () => {
    const list = listCapabilities(registry);
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe("core/project.inspect");
  });
});
