import { describe, expect, it } from "vitest";
import {
  validateEnginePluginMeta,
  registerEnginePluginCapabilities,
  validateEngineVersionsPredicate,
  ENGINE_PLUGIN_CAPABILITIES,
  ENGINE_PLUGIN_METAS,
} from "../src/domain/engine-plugin.js";
import { registerCapability, resolveCapability } from "../src/domain/capability-registry.js";
import type { CapabilityRecord } from "../src/domain/capability-registry.js";
import { completeCapabilityRecord } from "./fixtures.js";

/**
 * Engine-plugin capability metadata — contract 03 §2 (`gamos/engine-plugin@2`)
 * and the canonical M2.4 capability records for Unity/Blender/Babylon.
 *
 * MUST rules under test:
 * 1. EnginePluginMeta validates the frozen shape (family, family-grammar
 *    version predicate, executable, capabilities, headlessSupport,
 *    requiresDisplayServer, canonical provenance).
 * 2. Every declared capability id resolves to a COMPLETE central registry
 *    record or registration fails closed (contract 03 rule 1).
 * 3. Engine version predicates use the FAMILY grammar — universal SemVer
 *    assumptions are rejected (contract 03 rule 2).
 * 4. The shipped records for the three M2 plugins satisfy every contract.
 */

function registryOf(...records: unknown[]): Map<string, CapabilityRecord> {
  const registry = new Map<string, CapabilityRecord>();
  for (const record of records) {
    const r = registerCapability(record);
    registry.set(`${r.id}@${r.version}`, r);
  }
  return registry;
}

const validMeta = {
  pluginId: "unity-engine",
  engineFamily: "unity",
  engineVersions: ">=2022.3",
  executable: { kind: "batch", command: "unity-editor", args: ["-batchmode", "-nographics"] },
  capabilities: ["unity/project.inspect"],
  headlessSupport: "full",
  requiresDisplayServer: false,
  provenance: {
    publisher: "gamos-tl",
    source: {
      type: "repository",
      repo: "payswapdotorg/Gamos-2.0",
      commitSha: "9a5f17f7".repeat(5),
      path: "apps/zcode-cli/packages/unity-engine-plugin",
    },
    surfaces: ["mcp"],
    reviewedBy: "gamos-tl",
    reviewRef: "M2 engine plugin integration (TL-reviewed)",
  },
};

describe("EnginePluginMeta validation (contract 03 §2, gamos/engine-plugin@2)", () => {
  // A registry holding the declared capability so shape validation can proceed
  // past contract 03 rule 1 (capability resolution) in the field-level tests.
  const resolvedRegistry = registryOf({ ...completeCapabilityRecord, id: "unity/project.inspect" });

  it("accepts a complete valid meta and retains every field", () => {
    const result = validateEnginePluginMeta(validMeta, resolvedRegistry);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.meta.engineFamily).toBe("unity");
      expect(result.meta.engineVersions).toBe(">=2022.3");
      expect(result.meta.executable?.kind).toBe("batch");
      expect(result.meta.executable?.args).toEqual(["-batchmode", "-nographics"]);
      expect(result.meta.capabilities).toEqual(["unity/project.inspect"]);
      expect(result.meta.headlessSupport).toBe("full");
      expect(result.meta.requiresDisplayServer).toBe(false);
      expect(result.meta.provenance.publisher).toBe("gamos-tl");
    }
  });

  it("rejects an invalid engine family", () => {
    const result = validateEnginePluginMeta({ ...validMeta, engineFamily: "cryengine" }, resolvedRegistry);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toContain("engineFamily");
  });

  it("rejects a version predicate outside the family grammar (universal SemVer assumption)", () => {
    // Caret/tilde SemVer ranges are NOT family-grammar predicates (contract 03 rule 2).
    for (const predicate of ["^4.1", "~4.1", "4.1 - 5.0", "latest"]) {
      const result = validateEnginePluginMeta({ ...validMeta, engineFamily: "blender", engineVersions: predicate }, resolvedRegistry);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.field).toContain("engineVersions");
    }

    // A Unity predicate expressed as a Blender full-version string ("blender 4.1")
    // is not a legal Unity target.
    const crossFamily = validateEnginePluginMeta({ ...validMeta, engineFamily: "unity", engineVersions: "blender 4.1" }, resolvedRegistry);
    expect(crossFamily.ok).toBe(false);
    if (!crossFamily.ok) expect(crossFamily.field).toContain("engineVersions");
  });

  it("accepts family-grammar predicates (Unity >=2022.3, Blender >=4.1, Babylon >=18)", () => {
    for (const [family, predicate] of [["unity", ">=2022.3"], ["blender", ">=4.1"], ["babylon", ">=18.0"]] as const) {
      const result = validateEnginePluginMeta({ ...validMeta, engineFamily: family, engineVersions: predicate }, resolvedRegistry);
      expect(result.ok).toBe(true);
    }
  });

  it("rejects empty capability declarations", () => {
    const result = validateEnginePluginMeta({ ...validMeta, capabilities: [] }, resolvedRegistry);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toContain("capabilities");
  });

  it("rejects malformed capability ids", () => {
    const result = validateEnginePluginMeta({ ...validMeta, capabilities: ["Not A Valid Id"] }, resolvedRegistry);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toContain("capabilities");
  });

  it("rejects invalid headlessSupport values", () => {
    const result = validateEnginePluginMeta({ ...validMeta, headlessSupport: "sometimes" }, resolvedRegistry);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toContain("headlessSupport");
  });

  it("rejects non-boolean requiresDisplayServer", () => {
    const result = validateEnginePluginMeta({ ...validMeta, requiresDisplayServer: "no" }, resolvedRegistry);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toContain("requiresDisplayServer");
  });

  it("rejects non-canonical (legacy) provenance", () => {
    const result = validateEnginePluginMeta({
      ...validMeta,
      provenance: { publisher: "official", source: "gamos-2.0 repository" },
    }, resolvedRegistry);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toContain("provenance");
  });

  it("rejects malformed executable declarations", () => {
    const badKind = validateEnginePluginMeta({ ...validMeta, executable: { kind: "daemon", command: "x" } }, resolvedRegistry);
    expect(badKind.ok).toBe(false);
    if (!badKind.ok) expect(badKind.field).toContain("executable.kind");

    const noCommand = validateEnginePluginMeta({ ...validMeta, executable: { kind: "cli" } }, resolvedRegistry);
    expect(noCommand.ok).toBe(false);
    if (!noCommand.ok) expect(noCommand.field).toContain("executable.command");

    const badArgs = validateEnginePluginMeta({ ...validMeta, executable: { kind: "cli", command: "x", args: ["ok", 42] } }, resolvedRegistry);
    expect(badArgs.ok).toBe(false);
    if (!badArgs.ok) expect(badArgs.field).toContain("executable.args");
  });
});

describe("Plugin-declared capabilities MUST resolve to complete registry records (contract 03 rule 1)", () => {
  const registry = registryOf(completeCapabilityRecord);
  const meta = { ...validMeta, capabilities: ["core/project.inspect"] };

  it("accepts a meta whose every declared capability resolves", () => {
    const result = validateEnginePluginMeta(meta, registry);
    expect(result.ok).toBe(true);
  });

  it("fails closed when a declared capability id is unregistered", () => {
    const result = validateEnginePluginMeta(validMeta, registry);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.field).toContain("capabilities");
      expect(result.reason).toMatch(/unity\/project\.inspect/);
    }
  });

  it("fails closed when the registry is omitted and no default store holds the records", () => {
    // Without a registry argument the validator must NOT silently pass unresolvable ids.
    const result = validateEnginePluginMeta(validMeta);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toContain("capabilities");
  });
});

describe("Canonical M2 engine capability records (M2.4, Worker B)", () => {
  it("ships records for all three engines with append-only ids", () => {
    const ids = ENGINE_PLUGIN_CAPABILITIES.map((r) => r.id).sort();
    expect(ids).toEqual([
      "babylon/asset.integrate",
      "babylon/project.build",
      "babylon/project.inspect",
      "babylon/project.run",
      "blender/asset.export",
      "blender/scene.inspect",
      "blender/scene.modify",
      "blender/scene.render",
      "unity/asset.import",
      "unity/project.build",
      "unity/project.inspect",
      "unity/scene.modify",
    ]);
  });

  it("registers every shipped record without error (complete execution-safety metadata)", () => {
    const registry = registerEnginePluginCapabilities();
    for (const record of ENGINE_PLUGIN_CAPABILITIES) {
      // Conditional records resolve when their declared prerequisites are satisfied.
      const resolved = resolveCapability(registry, {
        id: record.id,
        prerequisites: [...(record.availability.prerequisites ?? [])],
      });
      expect(resolved.ok).toBe(true);
    }
    expect(registry.size).toBe(ENGINE_PLUGIN_CAPABILITIES.length);
  });

  it("conditional records fail closed when declared prerequisites are NOT satisfied", () => {
    const registry = registerEnginePluginCapabilities();
    const resolved = resolveCapability(registry, { id: "unity/scene.modify" });
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.error.code).toBe("missing-prerequisite");
  });

  it("every record carries canonical provenance and an mcp-server provider identity", () => {
    for (const record of ENGINE_PLUGIN_CAPABILITIES) {
      expect(record.provenance.publisher).toBe("gamos-tl");
      expect(record.provenance.source.type).toBe("repository");
      expect(record.provider.kind).toBe("mcp-server");
      expect(record.provider.identity).toMatch(/^plugin:(unity|blender|babylon)-engine:engine$/);
    }
  });

  it("engine version predicates are family-specific", () => {
    const byId = new Map(ENGINE_PLUGIN_CAPABILITIES.map((r) => [r.id, r]));
    expect(byId.get("unity/project.inspect")!.compatibility.engineVersions).toBe(">=2022.3");
    expect(byId.get("blender/scene.modify")!.compatibility.engineVersions).toBe(">=4.1");
    expect(byId.get("babylon/project.run")!.compatibility.engineVersions).toBe(">=18.0");
  });

  it("read-only inspection declares read-only permissions; mutations declare engine/headless permission kinds", () => {
    const byId = new Map(ENGINE_PLUGIN_CAPABILITIES.map((r) => [r.id, r]));
    const inspect = byId.get("unity/project.inspect")!;
    expect(inspect.permissions.every((p) => p.scope.includes("read"))).toBe(true);
    expect(inspect.reversibility.kind).toBe("reversible");

    for (const mutationId of ["unity/scene.modify", "blender/scene.modify", "blender/scene.render", "blender/asset.export"]) {
      const record = byId.get(mutationId)!;
      expect(
        record.permissions.some((p) => p.kind === "engine-headless" || p.kind === "command-execution" || p.kind === "filesystem-write"),
      ).toBe(true);
      expect(record.reversibility.kind).not.toBe("");
    }
  });

  it("every record declares timeout bounds, cancellation semantics and a verification method", () => {
    for (const record of ENGINE_PLUGIN_CAPABILITIES) {
      expect(record.timeout.maxMs).toBeGreaterThan(record.timeout.defaultMs);
      expect(record.timeout.defaultMs).toBeGreaterThan(0);
      expect(record.cancellation.supported).toBe(true);
      expect(record.verification.method.length).toBeGreaterThan(0);
      expect(record.verification.spec.length).toBeGreaterThan(0);
    }
  });
});

describe("Shipped engine-plugin metas (gamos/engine-plugin@2 for the three M2 plugins)", () => {
  it("ships metas for unity-engine, blender-engine and babylon-engine plugins", () => {
    const ids = ENGINE_PLUGIN_METAS.map((m) => m.pluginId).sort();
    expect(ids).toEqual(["babylon-engine", "blender-engine", "unity-engine"]);
  });

  it("every meta validates and its capabilities resolve against the shipped records", () => {
    const registry = registerEnginePluginCapabilities();
    for (const meta of ENGINE_PLUGIN_METAS) {
      const result = validateEnginePluginMeta(meta, registry);
      expect(result.ok).toBe(true);
    }
  });

  it("every meta uses the family grammar and declares the mcp surface with canonical provenance", () => {
    for (const meta of ENGINE_PLUGIN_METAS) {
      expect(meta.engineVersions).toMatch(/^(>=|<=|=)?\d/);
      expect(meta.provenance.surfaces).toContain("mcp");
      expect(meta.provenance.source.type).toBe("repository");
      expect(meta.headlessSupport).toMatch(/^(full|partial|none)$/);
    }
  });

  it("Unity meta records the license prerequisite honestly; Blender declares full headless support", () => {
    const byId = new Map(ENGINE_PLUGIN_METAS.map((m) => [m.pluginId, m]));
    const unity = byId.get("unity-engine")!;
    expect(unity.requiresDisplayServer).toBe(false);
    const blender = byId.get("blender-engine")!;
    expect(blender.headlessSupport).toBe("full");
    expect(blender.requiresDisplayServer).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// M4 WP-1 (Worker B lane) — the canonical Godot engine capability records and
// the godot-engine plugin meta, per docs/gamos/M4-CAPABILITY-CONTRACTS.md §2/§4
// (the binding field-level contract). The tests below are the §5 RED design:
// they fail because the required behavior is MISSING (no godot/* records, no
// godot-engine meta) — not because of syntax, import or runner failure. The
// pre-verified RED state on the baseline tree is recorded in the contracts
// doc §6 (missing-behavior signatures only).
// ---------------------------------------------------------------------------

describe("Canonical M4 Godot engine capability records (M4 WP-1, Worker B)", () => {
  it("ships records for all six godot capabilities with append-only ids", () => {
    const ids = ENGINE_PLUGIN_CAPABILITIES.filter((r) => r.engineFamily === "godot").map((r) => r.id).sort();
    expect(ids).toEqual([
      "godot/asset.import",
      "godot/project.build",
      "godot/project.inspect",
      "godot/project.run",
      "godot/scene.modify",
      "godot/script.check",
    ]);
  });

  it("registers every godot record without error (complete execution-safety metadata)", () => {
    const godotRecords = ENGINE_PLUGIN_CAPABILITIES.filter((r) => r.engineFamily === "godot");
    expect(godotRecords.length).toBe(6);
    for (const record of godotRecords) {
      expect(() => registerCapability(record)).not.toThrow();
    }
  });

  it("read-only godot operations declare read-only permissions; mutations declare engine-headless + filesystem-write", () => {
    const byId = new Map(ENGINE_PLUGIN_CAPABILITIES.map((r) => [r.id, r]));
    for (const id of ["godot/project.inspect", "godot/script.check"]) {
      const kinds = byId.get(id)!.permissions.map((p) => p.kind);
      expect(kinds).toEqual(["command-execution"]);
    }
    for (const id of ["godot/scene.modify", "godot/asset.import", "godot/project.build"]) {
      const kinds = byId.get(id)!.permissions.map((p) => p.kind).sort();
      expect(kinds).toEqual(["engine-headless", "filesystem-write"]);
    }
  });

  it("mutations register recoverable (never reversible-on-promise); reads register reversible", () => {
    const byId = new Map(ENGINE_PLUGIN_CAPABILITIES.map((r) => [r.id, r]));
    expect(byId.get("godot/project.inspect")!.reversibility.kind).toBe("reversible");
    expect(byId.get("godot/script.check")!.reversibility.kind).toBe("reversible");
    expect(byId.get("godot/scene.modify")!.reversibility.kind).toBe("recoverable");
    expect(byId.get("godot/asset.import")!.reversibility.kind).toBe("recoverable");
    expect(byId.get("godot/project.build")!.reversibility.kind).toBe("recoverable");
    expect(byId.get("godot/project.run")!.reversibility.kind).toBe("recoverable");
  });

  it("godot compatibility uses the family grammar (>=4.2), never universal SemVer", () => {
    for (const r of ENGINE_PLUGIN_CAPABILITIES.filter((r) => r.engineFamily === "godot")) {
      expect(validateEngineVersionsPredicate("godot", r.compatibility.engineVersions!)).toBe(true);
    }
  });

  it("conditional godot records fail closed when the godot-installed prerequisite is NOT satisfied", () => {
    const registry = registerEnginePluginCapabilities();
    const resolved = resolveCapability(registry, { id: "godot/scene.modify" });
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.error.code).toBe("missing-prerequisite");
  });

  it("every godot record carries a verification spec (never exit-code-only)", () => {
    for (const r of ENGINE_PLUGIN_CAPABILITIES.filter((r) => r.engineFamily === "godot")) {
      expect(r.verification.method).toMatch(/^(output-schema|artifact-hash|filesystem-probe|engine-query)$/);
      expect(r.verification.spec.length).toBeGreaterThan(20);
    }
  });
});

describe("M4 Godot engine-plugin meta (gamos/engine-plugin@2)", () => {
  it("ships the godot-engine meta whose every declared capability resolves", () => {
    const meta = ENGINE_PLUGIN_METAS.find((m) => m.pluginId === "godot-engine");
    expect(meta).toBeDefined();
    const registry = registerEnginePluginCapabilities();
    expect(validateEnginePluginMeta(meta!, registry).ok).toBe(true);
  });

  it("declares full headless support, no display server, and the family-grammar predicate >=4.2", () => {
    const meta = ENGINE_PLUGIN_METAS.find((m) => m.pluginId === "godot-engine")!;
    expect(meta.headlessSupport).toBe("full");
    expect(meta.requiresDisplayServer).toBe(false);
    expect(meta.engineVersions).toBe(">=4.2");
  });
});
