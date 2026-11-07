import { describe, expect, it } from "vitest";
import {
  validateProvenanceRef,
  PROVENANCE_SCHEMA_ID,
} from "../src/domain/provenance.js";
import type { ProvenanceRef } from "../src/domain/provenance.js";
import {
  registerCapability,
  resolveCapability,
} from "../src/domain/capability-registry.js";
import type { CapabilityRecord } from "../src/domain/capability-registry.js";
import { validatePluginProcessTrust } from "../src/domain/plugin-trust.js";
import { completeCapabilityRecord } from "./fixtures.js";

/** Registers a record and returns a single-entry registry (test helper). */
function registerAndIndex(record: unknown): { stored: CapabilityRecord; registry: Map<string, CapabilityRecord> } {
  const stored = registerCapability(record);
  const registry = new Map<string, CapabilityRecord>([[`${stored.id}@${stored.version}`, stored]]);
  return { stored, registry };
}

/**
 * Provenance contract conformance (M2 directive §4 preflight — BLOCKING
 * prerequisite for the first M2 engine-plugin registration).
 *
 * Contract 09 §4 defines the canonical `gamos/provenance@2` schema:
 *   publisher: "zcode-official" | "gamos-tl" | "community"
 *   source: { type: "marketplace"; marketplaceId; version; sha256 }
 *         | { type: "repository"; repo; commitSha; path }
 *   surfaces?: Array<"ui" | "mcp">
 *   reviewedBy?: string
 *   reviewRef?: string   // REQUIRED for community mcp-carrying plugins
 *
 * Both capability records (contract 02) and engine-plugin records
 * (contract 03/09) must consume the SAME canonical semantics.
 */

const canonicalRepositoryProvenance: ProvenanceRef = {
  publisher: "gamos-tl",
  source: {
    type: "repository",
    repo: "payswapdotorg/Gamos-2.0",
    commitSha: "9a5f17f7".repeat(5), // 40-hex
    path: "packages/gamos-domain",
  },
  surfaces: ["mcp"],
  reviewedBy: "gamos-tl",
  reviewRef: "PR #3 (M2 provenance conformance)",
};

const canonicalMarketplaceProvenance: ProvenanceRef = {
  publisher: "zcode-official",
  source: {
    type: "marketplace",
    marketplaceId: "zcode-plugins-official",
    version: "0.1.0",
    sha256: "b".repeat(64),
  },
  surfaces: ["ui", "mcp"],
};

describe("Canonical provenance schema (gamos/provenance@2)", () => {
  it("exposes the contract schema id", () => {
    expect(PROVENANCE_SCHEMA_ID).toBe("gamos/provenance@2");
  });

  it("accepts a canonical repository provenance and retains every field", () => {
    const result = validateProvenanceRef(canonicalRepositoryProvenance);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ref.publisher).toBe("gamos-tl");
      expect(result.ref.source.type).toBe("repository");
      if (result.ref.source.type === "repository") {
        expect(result.ref.source.repo).toBe("payswapdotorg/Gamos-2.0");
        expect(result.ref.source.commitSha).toBe("9a5f17f7".repeat(5));
        expect(result.ref.source.path).toBe("packages/gamos-domain");
      }
      expect(result.ref.surfaces).toEqual(["mcp"]);
      expect(result.ref.reviewedBy).toBe("gamos-tl");
      expect(result.ref.reviewRef).toBe("PR #3 (M2 provenance conformance)");
    }
  });

  it("accepts a canonical marketplace provenance and retains source, version and hash", () => {
    const result = validateProvenanceRef(canonicalMarketplaceProvenance);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ref.publisher).toBe("zcode-official");
      expect(result.ref.source.type).toBe("marketplace");
      if (result.ref.source.type === "marketplace") {
        expect(result.ref.source.marketplaceId).toBe("zcode-plugins-official");
        expect(result.ref.source.version).toBe("0.1.0");
        expect(result.ref.source.sha256).toBe("b".repeat(64));
      }
      expect(result.ref.surfaces).toEqual(["ui", "mcp"]);
    }
  });

  it("rejects the legacy publisher values (official/community/local) and other invalid publishers", () => {
    for (const publisher of ["official", "local", "zcode-official ", "", "gamos", 42, null]) {
      const result = validateProvenanceRef({ ...canonicalRepositoryProvenance, publisher });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.field).toContain("publisher");
        expect(result.reason).toMatch(/zcode-official/);
      }
    }
  });

  it("rejects a repository source missing commitSha or path", () => {
    const noCommit = validateProvenanceRef({
      ...canonicalRepositoryProvenance,
      source: { type: "repository", repo: "payswapdotorg/Gamos-2.0", path: "packages/gamos-domain" },
    });
    expect(noCommit.ok).toBe(false);
    if (!noCommit.ok) expect(noCommit.field).toContain("source.commitSha");

    const noPath = validateProvenanceRef({
      ...canonicalRepositoryProvenance,
      source: { type: "repository", repo: "payswapdotorg/Gamos-2.0", commitSha: "9a5f17f7".repeat(5) },
    });
    expect(noPath.ok).toBe(false);
    if (!noPath.ok) expect(noPath.field).toContain("source.path");

    const noRepo = validateProvenanceRef({
      ...canonicalRepositoryProvenance,
      source: { type: "repository", commitSha: "9a5f17f7".repeat(5), path: "packages/gamos-domain" },
    });
    expect(noRepo.ok).toBe(false);
    if (!noRepo.ok) expect(noRepo.field).toContain("source.repo");
  });

  it("rejects a malformed repository commitSha", () => {
    const result = validateProvenanceRef({
      ...canonicalRepositoryProvenance,
      source: { type: "repository", repo: "payswapdotorg/Gamos-2.0", commitSha: "short", path: "x" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toContain("source.commitSha");
  });

  it("rejects a marketplace source missing version or sha256, or with a malformed hash", () => {
    const noVersion = validateProvenanceRef({
      ...canonicalMarketplaceProvenance,
      source: { type: "marketplace", marketplaceId: "zcode-plugins-official", sha256: "b".repeat(64) },
    });
    expect(noVersion.ok).toBe(false);
    if (!noVersion.ok) expect(noVersion.field).toContain("source.version");

    const noHash = validateProvenanceRef({
      ...canonicalMarketplaceProvenance,
      source: { type: "marketplace", marketplaceId: "zcode-plugins-official", version: "0.1.0" },
    });
    expect(noHash.ok).toBe(false);
    if (!noHash.ok) expect(noHash.field).toContain("source.sha256");

    const badHash = validateProvenanceRef({
      ...canonicalMarketplaceProvenance,
      source: { type: "marketplace", marketplaceId: "zcode-plugins-official", version: "0.1.0", sha256: "zz" },
    });
    expect(badHash.ok).toBe(false);
    if (!badHash.ok) expect(badHash.field).toContain("source.sha256");
  });

  it("rejects a source that is neither a marketplace nor a repository object", () => {
    for (const source of ["gamos-2.0 repository", 42, null, {}, { type: "gcs" }]) {
      const result = validateProvenanceRef({ ...canonicalRepositoryProvenance, source });
      expect(result.ok).toBe(false);
    }
  });

  it("rejects invalid surfaces values", () => {
    const result = validateProvenanceRef({ ...canonicalRepositoryProvenance, surfaces: ["cli", "mcp"] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toContain("surfaces");
  });
});

describe("Capability records consume the canonical provenance (contract 02 + 09)", () => {
  it("registers a capability with canonical provenance and retains it on lookup", () => {
    const record = {
      ...completeCapabilityRecord,
      id: "gamos/test-canonical-provenance",
      provenance: canonicalRepositoryProvenance,
    };
    const { stored, registry } = registerAndIndex(record);
    expect(stored.provenance).toEqual(canonicalRepositoryProvenance);
    const resolved = resolveCapability(registry, { id: "gamos/test-canonical-provenance" });
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.record.provenance).toEqual(canonicalRepositoryProvenance);
  });

  it("rejects a capability whose provenance uses the legacy publisher values", () => {
    const legacy = { ...completeCapabilityRecord, id: "gamos/test-legacy-provenance" };
    (legacy as Record<string, unknown>).provenance = {
      publisher: "official",
      source: "gamos-2.0 repository",
      commitSha: "a".repeat(40),
    };
    expect(() => registerCapability(legacy)).toThrow(/provenance/i);
  });

  it("rejects a capability whose provenance source is a loose string (legacy shape)", () => {
    const legacy = { ...completeCapabilityRecord, id: "gamos/test-loose-source" };
    (legacy as Record<string, unknown>).provenance = {
      publisher: "gamos-tl",
      source: "gamos-2.0 repository",
    };
    expect(() => registerCapability(legacy)).toThrow(/provenance/i);
  });

  it("still rejects a capability missing provenance entirely (registration failure)", () => {
    const bad = { ...completeCapabilityRecord, id: "gamos/test-no-provenance" };
    delete (bad as Record<string, unknown>).provenance;
    expect(() => registerCapability(bad)).toThrow(/provenance/i);
  });
});

describe("Engine-plugin records consume the canonical provenance (contract 03 + 09)", () => {
  const basePlugin = {
    pluginId: "gamos/test-engine-plugin",
    surfaces: ["mcp"] as const,
    mcpServers: [{ name: "engine", entryPoint: "dist/mcp/server.js" }],
    processRegime: {
      environmentMinimized: true,
      workingDirectoryContained: true,
      disclosures: {
        filesystem: "user-account filesystem reach",
        network: "unrestricted outbound and loopback",
        environment: "full spawn environment minus minimized secrets",
      },
    },
  };

  it("accepts a canonical community provenance WITH the required reviewRef for an mcp-carrying plugin", () => {
    const result = validatePluginProcessTrust({
      ...basePlugin,
      provenance: {
        publisher: "community",
        source: {
          type: "repository",
          repo: "example/community-engine-plugin",
          commitSha: "c".repeat(40),
          path: ".",
        },
        surfaces: ["mcp"],
        reviewRef: "PR #42 (community engine plugin review)",
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.trust.provenance.publisher).toBe("community");
      expect(result.trust.provenance.source.type).toBe("repository");
      expect(result.trust.mcpProcess?.executionRegime).toBe("community-minimized");
    }
  });

  it("rejects a community mcp-carrying plugin WITHOUT the required reviewRef", () => {
    const result = validatePluginProcessTrust({
      ...basePlugin,
      provenance: {
        publisher: "community",
        source: {
          type: "repository",
          repo: "example/community-engine-plugin",
          commitSha: "c".repeat(40),
          path: ".",
        },
        surfaces: ["mcp"],
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("community-review-missing");
  });

  it("rejects a plugin whose provenance uses the legacy publisher value 'official'", () => {
    const result = validatePluginProcessTrust({
      ...basePlugin,
      provenance: {
        publisher: "official",
        source: "marketplace:zcode-plugins-official",
        commitSha: "a".repeat(40),
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("provenance-invalid");
  });

  it("rejects a plugin whose provenance source is a loose string (legacy shape)", () => {
    const result = validatePluginProcessTrust({
      ...basePlugin,
      provenance: { publisher: "gamos-tl", source: "gamos-2.0 repository" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("provenance-invalid");
  });

  it("still rejects a plugin with missing provenance and mismatched surfaces", () => {
    const missing = validatePluginProcessTrust({ ...basePlugin, provenance: undefined });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe("provenance-missing");

    const mismatch = validatePluginProcessTrust({
      ...basePlugin,
      provenance: canonicalRepositoryProvenance,
      surfaces: ["ui"],
      mcpServers: basePlugin.mcpServers,
    });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.code).toBe("surfaces-mismatch");
  });

  it("rejects provenance that covers none of the plugin's declared surfaces (uncovered content)", () => {
    const result = validatePluginProcessTrust({
      ...basePlugin,
      provenance: { ...canonicalRepositoryProvenance, surfaces: ["ui"] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The plugin ships mcp content but the provenance covers only ui — fail closed.
      expect(result.code).toBe("provenance-surface-uncovered");
    }
  });

  it("produces an explicit rejected/disabled state when the provenance reference cannot be resolved", () => {
    const result = validatePluginProcessTrust(
      {
        ...basePlugin,
        provenance: canonicalRepositoryProvenance,
      },
      {
        resolveProvenance: () => ({ resolved: false, detail: "repository commit not reachable" }),
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("provenance-unresolvable");
      expect(result.reason).toContain("repository commit not reachable");
    }

    const resolved = validatePluginProcessTrust(
      {
        ...basePlugin,
        provenance: canonicalRepositoryProvenance,
      },
      {
        resolveProvenance: () => ({ resolved: true, detail: "commit reachable; content hash matches" }),
      },
    );
    expect(resolved.ok).toBe(true);
  });
});

describe("Capability and engine-plugin records share the SAME canonical semantics", () => {
  it("the same canonical provenance object passes both registration and plugin-trust validation", () => {
    // One object, two consumers — contract 09 §4 is a single schema.
    const shared: ProvenanceRef = canonicalRepositoryProvenance;

    const { stored, registry } = registerAndIndex({
      ...completeCapabilityRecord,
      id: "gamos/test-shared-provenance",
      provenance: shared,
    });
    expect(stored.provenance).toEqual(shared);
    const resolved = resolveCapability(registry, { id: "gamos/test-shared-provenance" });
    expect(resolved.ok).toBe(true);

    const trust = validatePluginProcessTrust({
      pluginId: "gamos/test-shared",
      surfaces: ["mcp"],
      mcpServers: [{ name: "engine", entryPoint: "dist/mcp/server.js" }],
      provenance: shared,
      processRegime: {
        environmentMinimized: true,
        workingDirectoryContained: true,
        disclosures: {
          filesystem: "user-account filesystem reach",
          network: "unrestricted outbound and loopback",
          environment: "full spawn environment minus minimized secrets",
        },
      },
    });
    expect(trust.ok).toBe(true);
    if (trust.ok) expect(trust.trust.provenance).toEqual(shared);
  });

  it("the same invalid provenance object is rejected by both consumers", () => {
    const invalid = {
      publisher: "official",
      source: "gamos-2.0 repository",
    };

    const cap = { ...completeCapabilityRecord, id: "gamos/test-invalid-shared" };
    (cap as Record<string, unknown>).provenance = invalid;
    expect(() => registerCapability(cap)).toThrow(/provenance/i);

    const trust = validatePluginProcessTrust({
      pluginId: "gamos/test-shared-invalid",
      surfaces: ["mcp"],
      mcpServers: [{ name: "engine", entryPoint: "dist/mcp/server.js" }],
      provenance: invalid,
    });
    expect(trust.ok).toBe(false);
    if (!trust.ok) expect(trust.code).toBe("provenance-invalid");
  });
});
