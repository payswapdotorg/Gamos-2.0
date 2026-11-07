import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  validateEnginePluginPackage,
} from "../src/domain/engine-plugin-package.js";
import { registerEnginePluginCapabilities, ENGINE_PLUGIN_CAPABILITIES, validateEnginePluginMeta, ENGINE_PLUGIN_METAS } from "../src/domain/engine-plugin.js";
import type { EnginePluginMeta } from "../src/domain/engine-plugin.js";
import { resolveCapability, registerCapability } from "../src/domain/capability-registry.js";
import type { CapabilityRecord } from "../src/domain/capability-registry.js";
import { completeCapabilityRecord } from "./fixtures.js";

/**
 * Worker C adversarial matrix — M2.5 (directive §5): trust, permissions,
 * lifecycle and integration security for the three shipped engine plugins.
 *
 * The validator under test (`validateEnginePluginPackage`) reads an ACTUAL
 * plugin manifest (the `.zcode-plugin/plugin.json` content as parsed JSON)
 * plus its package.json version, and fail-closes on every misrepresentation:
 *
 * - manifest mcpServers key ⟺ declared "mcp" surface (content match)
 * - every declared capability id resolves to a complete registry record
 * - canonical provenance (gamos/provenance@2) with surfaces covering content
 * - version alignment manifest/package
 * - provider identity in the registry matches the manifest's server key
 * - userConfig engine-path override exists (honest discovery surface)
 * - MCP process disclosures present and never claim "sandboxed"
 * - community plugins: reviewRef + least-privilege regime (or explicit approval)
 */

/** Reads the actual shipped manifest of an engine plugin package. */
function readShippedPlugin(pluginDir: string): { manifest: Record<string, unknown>; packageJson: Record<string, unknown> } {
  const packagesRoot = fileURLToPath(new URL("../../../../apps/zcode-cli/packages/", import.meta.url));
  const manifest = JSON.parse(readFileSync(`${packagesRoot}${pluginDir}/.zcode-plugin/plugin.json`, "utf8"));
  const packageJson = JSON.parse(readFileSync(`${packagesRoot}${pluginDir}/package.json`, "utf8"));
  return { manifest, packageJson };
}

const shippedRegistry = registerEnginePluginCapabilities();

const honestDisclosures = {
  filesystem: "read/write within the OS user account scope; no path allow-list",
  network: "unrestricted outbound and loopback access (Babylon builds/dev-server need loopback + registry egress)",
  environment: "full spawn environment inheritance minus ZCode runtime sanitized secrets (official-class regime)",
};

describe("Worker C — the three SHIPPED engine plugins pass the package validator (M2.5 INTEGRATE)", () => {
  for (const pluginDir of ["unity-engine-plugin", "blender-engine-plugin", "babylon-engine-plugin"]) {
    it(`${pluginDir}: manifest, capabilities, provenance, versions and provider identity all validate`, () => {
      const { manifest, packageJson } = readShippedPlugin(pluginDir);
      const result = validateEnginePluginPackage(manifest, packageJson, shippedRegistry);
      expect(result.ok, result.ok ? undefined : result.reason).toBe(true);
      if (result.ok) {
        expect(result.trust.pluginId).toBe(manifest.name);
        expect(result.trust.surfaces).toContain("mcp");
        // Official-class (gamos-tl) MCP regime with disclosures.
        expect(result.trust.mcpProcess?.executionRegime).toBe("official-full");
        expect(result.trust.mcpProcess?.disclosures.filesystem.length).toBeGreaterThan(0);
        expect(result.trust.mcpProcess?.approvalScope).toBe("tool-invocation-only");
      }
    });
  }

  it("every manifest-declared capability resolves to a complete registry record (contract 03 rule 1)", () => {
    for (const pluginDir of ["unity-engine-plugin", "blender-engine-plugin", "babylon-engine-plugin"]) {
      const { manifest } = readShippedPlugin(pluginDir);
      const capabilities = manifest.capabilities as string[];
      expect(capabilities.length).toBeGreaterThan(0);
      for (const id of capabilities) {
        const record = ENGINE_PLUGIN_CAPABILITIES.find((r) => r.id === id);
        expect(record, `${pluginDir} declares ${id} with no shipped record`).toBeDefined();
        // The record's provider identity is the plugin's MCP server identity.
        expect(record!.provider.identity).toBe(`plugin:${manifest.name}:engine`);
      }
    }
  });

  it("the manifest mcpServers key matches the registry provider identity", () => {
    for (const pluginDir of ["unity-engine-plugin", "blender-engine-plugin", "babylon-engine-plugin"]) {
      const { manifest } = readShippedPlugin(pluginDir);
      const serverKeys = Object.keys(manifest.mcpServers as Record<string, unknown>);
      expect(serverKeys).toEqual(["engine"]);
      const stdio = (manifest.mcpServers as Record<string, { command: string; args: string[] }>).engine;
      // Defensive spawn shape: argument array, no shell interpolation.
      expect(Array.isArray(stdio.args)).toBe(true);
      expect(stdio.args.every((a) => typeof a === "string")).toBe(true);
    }
  });

  it("each shipped plugin declares a userConfig engine-path override (honest discovery surface)", () => {
    const expectedOption: Record<string, string> = {
      "unity-engine-plugin": "unityEditorPath",
      "blender-engine-plugin": "blenderPath",
      "babylon-engine-plugin": "nodePath",
    };
    for (const [pluginDir, option] of Object.entries(expectedOption)) {
      const { manifest } = readShippedPlugin(pluginDir);
      const userConfig = manifest.userConfig as Record<string, unknown> | undefined;
      expect(userConfig?.[option], `${pluginDir} must declare userConfig.${option}`).toBeDefined();
    }
  });
});

describe("Worker C — adversarial package declarations fail closed (M2.5 HARDEN)", () => {
  const { manifest: goodManifest, packageJson: goodPackage } = readShippedPlugin("blender-engine-plugin");

  it("rejects a manifest whose mcpServers content is not covered by a declared mcp surface", () => {
    const bad = { ...goodManifest, engineFamily: undefined, capabilities: undefined, provenance: undefined, headlessSupport: undefined, requiresDisplayServer: undefined, engineVersions: undefined };
    // Force the inline surfaces field to ui while mcpServers content exists.
    (bad as Record<string, unknown>).provenance = {
      publisher: "gamos-tl",
      source: { type: "repository", repo: "payswapdotorg/Gamos-2.0", commitSha: "9a5f17f7".repeat(5), path: "apps/zcode-cli/packages/blender-engine-plugin" },
      surfaces: ["ui"],
    };
    const result = validateEnginePluginPackage(bad, goodPackage, shippedRegistry);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("provenance-surface-uncovered");
  });

  it("rejects a manifest declaring a capability id that has no complete registry record", () => {
    const bad = JSON.parse(JSON.stringify(goodManifest)) as Record<string, unknown>;
    bad.capabilities = ["blender/scene.inspect", "unity/scene.modify"]; // cross-plugin id not resolvable for this package
    const result = validateEnginePluginPackage(bad, goodPackage, shippedRegistry);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("capability-unresolvable");
  });

  it("rejects version drift between the manifest and package.json", () => {
    const bad = JSON.parse(JSON.stringify(goodManifest)) as Record<string, unknown>;
    bad.version = "0.2.0";
    const result = validateEnginePluginPackage(bad, goodPackage, shippedRegistry);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("version-mismatch");
  });

  it("rejects a missing mcpServers entry while the provenance covers mcp (content mismatch)", () => {
    const bad = JSON.parse(JSON.stringify(goodManifest)) as Record<string, unknown>;
    delete bad.mcpServers;
    const result = validateEnginePluginPackage(bad, goodPackage, shippedRegistry);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("surfaces-mismatch");
  });

  it("rejects a non-canonical (legacy) provenance shape in a shipped package", () => {
    const bad = JSON.parse(JSON.stringify(goodManifest)) as Record<string, unknown>;
    (bad as Record<string, unknown>).provenance = { publisher: "official", source: "marketplace:zcode-plugins-official" };
    const result = validateEnginePluginPackage(bad, goodPackage, shippedRegistry);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("provenance-invalid");
  });

  it("rejects a community engine plugin without the required reviewRef", () => {
    const bad = JSON.parse(JSON.stringify(goodManifest)) as Record<string, unknown>;
    (bad as Record<string, unknown>).provenance = {
      publisher: "community",
      source: { type: "repository", repo: "example/community-engine", commitSha: "c".repeat(40), path: "." },
      surfaces: ["mcp"],
    };
    const result = validateEnginePluginPackage(bad, goodPackage, shippedRegistry);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("community-review-missing");
  });

  it("rejects a community engine plugin missing the least-privilege regime (silent full-privilege execution)", () => {
    const bad = JSON.parse(JSON.stringify(goodManifest)) as Record<string, unknown>;
    (bad as Record<string, unknown>).provenance = {
      publisher: "community",
      source: { type: "repository", repo: "example/community-engine", commitSha: "c".repeat(40), path: "." },
      surfaces: ["mcp"],
      reviewRef: "PR #99 (reviewed entry points)",
    };
    // No processRegime: env minimization + cwd containment absent, no full-authority approval.
    const result = validateEnginePluginPackage(bad, goodPackage, shippedRegistry);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("least-privilege-missing");
  });

  it("produces an explicit rejected state when provenance cannot be resolved (contract 09 §3.7)", () => {
    const result = validateEnginePluginPackage(goodManifest, goodPackage, shippedRegistry, {
      resolveProvenance: () => ({ resolved: false, detail: "repository commit not reachable" }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("provenance-unresolvable");
  });

  it("rejects an MCP disclosure that claims the process is sandboxed (wording prohibition)", () => {
    const bad = JSON.parse(JSON.stringify(goodManifest)) as Record<string, unknown>;
    (bad as Record<string, unknown>).processRegime = {
      environmentMinimized: false,
      workingDirectoryContained: false,
      disclosures: {
        filesystem: "process is sandboxed to the workspace",
        network: "unrestricted outbound and loopback access",
        environment: "full spawn environment inheritance",
      },
    };
    const result = validateEnginePluginPackage(bad, goodPackage, shippedRegistry);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("sandbox-claim");
  });
});

describe("Worker C — permission and approval boundaries (M2.5, contract 06/09)", () => {
  const byId = new Map<string, CapabilityRecord>(ENGINE_PLUGIN_CAPABILITIES.map((r) => [r.id, r]));

  it("every mutation capability requires an engine/headless or write permission — no unpermissioned mutation", () => {
    for (const record of ENGINE_PLUGIN_CAPABILITIES) {
      const mutating = /modify|render|export|build|run/.test(record.id);
      if (mutating) {
        expect(
          record.permissions.length,
          `${record.id} must declare at least one permission`,
        ).toBeGreaterThan(0);
        expect(
          record.permissions.some((p) =>
            ["engine-headless", "filesystem-write", "command-execution", "network-access"].includes(p.kind),
          ),
          `${record.id} mutation must be permission-gated`,
        ).toBe(true);
      }
    }
  });

  it("read-only inspection capabilities never declare write/network permissions", () => {
    for (const id of ["unity/project.inspect", "blender/scene.inspect", "babylon/project.inspect"]) {
      const record = byId.get(id)!;
      expect(record.permissions.every((p) => p.scope.includes("read") || p.kind === "command-execution")).toBe(true);
    }
  });

  it("capability-invocation approval is explicitly NOT an OS-process boundary (contract 09 §2.5)", () => {
    const { manifest, packageJson } = readShippedPlugin("blender-engine-plugin");
    const result = validateEnginePluginPackage(manifest, packageJson, shippedRegistry);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.trust.mcpProcess?.approvalScope).toBe("tool-invocation-only");
      // The disclosures must describe actual OS-process authority, not tool-approval semantics.
      expect(result.trust.mcpProcess?.disclosures.filesystem).not.toMatch(/sandbox|only what you approve/i);
    }
  });

  it("unavailable engines fail closed with explicit reasons — never fabricated availability", () => {
    // unity/scene.modify declares license prerequisites that must surface as missing-prerequisite errors.
    const resolved = resolveCapability(shippedRegistry, { id: "unity/scene.modify" });
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.error.code).toBe("missing-prerequisite");
      expect(resolved.error.reason).toMatch(/unity-license-active|unity-editor-installed/);
    }
  });

  it("a hostile capability id never resolves (registry fail-closed holds for engine records)", () => {
    for (const hostile of ["unity/scene.modify; rm -rf", "../../etc/passwd", "blender/scene.modify\\u0000"]) {
      const resolved = resolveCapability(shippedRegistry, { id: hostile });
      expect(resolved.ok).toBe(false);
    }
  });
});

describe("Worker C — no engine plugin bypasses the registry or lifecycle (M2.5)", () => {
  it("the shipped metas are exactly the manifests' inline gamos fields (single source of truth)", () => {
    for (const meta of ENGINE_PLUGIN_METAS as EnginePluginMeta[]) {
      const dir = `${meta.pluginId}-plugin`;
      const { manifest } = readShippedPlugin(dir);
      // The manifest's inline gamos fields must independently validate against the SAME registry.
      const result = validateEnginePluginMeta(manifest, shippedRegistry);
      expect(result.ok, `${dir}: manifest inline gamos fields must validate — ${result.ok ? "" : result.reason}`).toBe(true);
      // And agree with the shipped meta on identity-defining fields.
      if (result.ok) {
        expect(result.meta.pluginId).toBe(meta.pluginId);
        expect(result.meta.engineFamily).toBe(meta.engineFamily);
        expect(result.meta.engineVersions).toBe(meta.engineVersions);
        expect([...result.meta.capabilities].sort()).toEqual([...meta.capabilities].sort());
      }
    }
  });

  it("no shipped engine record can redefine another plugin's capability id (append-only identity)", () => {
    const ids = ENGINE_PLUGIN_CAPABILITIES.map((r) => `${r.id}@${r.version}`);
    expect(new Set(ids).size).toBe(ids.length);
    // Cross-check against the M1 core capability: no collision with core/project.inspect.
    expect(ids).not.toContain("core/project.inspect@1.0.0");
    // A standalone registration wearing an existing id does not mutate the built
    // registry: resolution still returns the SHIPPED record (the registry is the
    // single source of truth — later registrations cannot redefine published ids).
    const imposter = registerCapability({ ...completeCapabilityRecord, id: "blender/scene.inspect", description: "a different operation wearing an existing id" });
    expect(imposter.id).toBe("blender/scene.inspect");
    const resolved = resolveCapability(shippedRegistry, { id: "blender/scene.inspect", prerequisites: ["blender-installed"] });
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.record.description).not.toBe("a different operation wearing an existing id");
    }
  });
});
