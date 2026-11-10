import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  validateEnginePluginPackage,
} from "../src/domain/engine-plugin-package.js";
import { registerEnginePluginCapabilities, ENGINE_PLUGIN_CAPABILITIES, validateEnginePluginMeta, ENGINE_PLUGIN_METAS, M2_ENGINE_PLUGIN_SOURCE_COMMIT, M4_ENGINE_PLUGIN_SOURCE_COMMIT } from "../src/domain/engine-plugin.js";
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
function packagesRoot(): string {
  return fileURLToPath(new URL("../../../apps/zcode-cli/packages/", import.meta.url));
}

function readShippedPlugin(pluginDir: string): { manifest: Record<string, unknown>; packageJson: Record<string, unknown> } {
  const manifest = JSON.parse(readFileSync(`${packagesRoot()}${pluginDir}/.zcode-plugin/plugin.json`, "utf8"));
  const packageJson = JSON.parse(readFileSync(`${packagesRoot()}${pluginDir}/package.json`, "utf8"));
  return { manifest, packageJson };
}

const shippedRegistry = registerEnginePluginCapabilities();

const honestDisclosures = {
  filesystem: "read/write within the OS user account scope; no path allow-list",
  network: "unrestricted outbound and loopback access (Babylon builds/dev-server need loopback + registry egress)",
  environment: "full spawn environment inheritance minus ZCode runtime sanitized secrets (official-class regime)",
};

describe("Worker C — the four SHIPPED engine plugins pass the package validator (M2.5 INTEGRATE; M4 WP-2 adds godot)", () => {
  for (const pluginDir of ["unity-engine-plugin", "blender-engine-plugin", "babylon-engine-plugin", "godot-engine-plugin"]) {
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
    for (const pluginDir of ["unity-engine-plugin", "blender-engine-plugin", "babylon-engine-plugin", "godot-engine-plugin"]) {
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
    for (const pluginDir of ["unity-engine-plugin", "blender-engine-plugin", "babylon-engine-plugin", "godot-engine-plugin"]) {
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
      // M4 sequencing closure: WP-1 registered the godot-engine records+meta
      // BEFORE the package existed (delivery plan §3 order 1), and this test's
      // existsSync branch honestly asserted the INTERIM invariant then (meta
      // validates fail-closed against the shipped registry; WP-1 repair
      // 4976483a). As of WP-2 (order 2) the godot-engine-plugin package IS
      // shipped with .zcode-plugin/plugin.json, so the full manifest-agreement
      // assertions engage for it automatically — the self-heal closed. The
      // existsSync branch is retained for future sequencing (records-first is
      // the standing pattern; a not-yet-shipped meta still validates honestly
      // instead of crashing, and a shipped package can never dodge the check).
      if (!existsSync(`${packagesRoot()}${dir}/.zcode-plugin/plugin.json`)) {
        const result = validateEnginePluginMeta(meta, shippedRegistry);
        expect(result.ok, `${dir} (package not yet shipped): meta must validate against the shipped registry — ${result.ok ? "" : result.reason}`).toBe(true);
        continue;
      }
      const { manifest } = readShippedPlugin(dir);
      // The manifest's inline gamos fields must independently validate against the
      // SAME registry (the manifest `name` maps to the meta `pluginId`).
      const result = validateEnginePluginMeta({ ...manifest, pluginId: manifest.name }, shippedRegistry);
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

describe("M2 audit — shipped provenance identifies the REAL integration commit (contract 09 §4)", () => {
  /**
   * The M2 handoff audit (§4/§8: "exact provenance") found the shipped provenance
   * commitSha values were `"9a5f17f7".repeat(5)` — a 40-hex value that passes the
   * FORMAT check but is NOT a real commit object (the in-code comment said it
   * would be "replaced by the shipping commit's sha at integration time" and
   * that replacement never happened). A provenance ref that names a nonexistent
   * commit cannot identify a repository source: contract 09 §4 requires the
   * structured source to identify "a repository, commit and path".
   *
   * These tests pin the REAL source-of-record commit per shipped line: the M2
   * 0.1.0 line (unity/blender/babylon) is pinned to the PR #5 integration merge
   * that first shipped all three plugin packages in the integrated tree (CI run
   * 42356695328 verified that exact tree); the M4 godot 1.0.0 line (WP-1) is
   * pinned to M4_ENGINE_PLUGIN_SOURCE_COMMIT — the capability-contracts branch
   * commit where the field-level record contracts those records implement
   * verbatim were authored and CI-verified (run 42703013035), merged onto the
   * integrated tree at 0afbc650 (CI 42718440007); the M4 unreal 1.0.0 line
   * (WP-4) pins to the SAME contracts commit — its records implement the §3
   * contracts VERBATIM, and its plugin package ships in WP-5 (the manifest-side
   * loops grow then). The CI workflow additionally
   * proves object-realness with `git cat-file -t <sha>` (the domain package
   * stays pure — no git subprocess here; format + exact-value + cross-surface
   * agreement is what the domain can and must enforce).
   */
  const REAL_INTEGRATION_COMMIT = M2_ENGINE_PLUGIN_SOURCE_COMMIT;

  /** The per-line source-of-record pin: every family's line names its OWN real commit (no cross-line drift, no synthetic values). */
  function expectedSourceCommit(engineFamily: string): string {
    return engineFamily === "godot" || engineFamily === "unreal" ? M4_ENGINE_PLUGIN_SOURCE_COMMIT : REAL_INTEGRATION_COMMIT;
  }

  /** Detects synthetic placeholder SHAs: an 8-hex block repeated 5×, all zeros, or all one char. */
  function isSyntheticPlaceholder(commitSha: string): boolean {
    if (!/^[0-9a-f]{40}$/.test(commitSha)) return true;
    if (/^(.)\1{39}$/.test(commitSha)) return true; // "0".repeat(40) etc. (disclosed local-run placeholder)
    const block = commitSha.slice(0, 8);
    if (block.repeat(5) === commitSha) return true; // "9a5f17f7".repeat(5) — looks real, is not
    return false;
  }

  // M4 WP-2: the godot-engine package ships — the manifest-side loops grow
  // with it (enumerative growth only; the per-family source-of-record pin
  // already governs the domain side above).
  const pluginDirs = ["unity-engine-plugin", "blender-engine-plugin", "babylon-engine-plugin", "godot-engine-plugin"];

  it("no shipped manifest carries a synthetic/placeholder provenance commitSha", () => {
    for (const pluginDir of pluginDirs) {
      const { manifest } = readShippedPlugin(pluginDir);
      const provenance = manifest.provenance as { source?: { commitSha?: string } };
      const commitSha = provenance?.source?.commitSha ?? "";
      expect(
        isSyntheticPlaceholder(commitSha),
        `${pluginDir} provenance commitSha ${commitSha} is a synthetic/placeholder value — a shipped provenance ref must identify a REAL repository commit (contract 09 §4)`,
      ).toBe(false);
    }
  });

  it("every shipped manifest identifies the exact real source-of-record commit of its line (PR #5 merge for the M2 plugins; M4 contracts commit for the godot line)", () => {
    for (const pluginDir of pluginDirs) {
      const { manifest } = readShippedPlugin(pluginDir);
      const provenance = manifest.provenance as { source?: { commitSha?: string; repo?: string; path?: string } };
      const family = typeof manifest.engineFamily === "string" ? manifest.engineFamily : "";
      expect(provenance?.source?.commitSha, `${pluginDir} must carry its line's real source-of-record commit`).toBe(expectedSourceCommit(family));
      expect(provenance?.source?.repo).toBe("payswapdotorg/Gamos-2.0");
    }
  });

  it("no manifest/domain provenance drift: every shipped manifest carries the SAME commit its domain meta pins", () => {
    for (const meta of ENGINE_PLUGIN_METAS as EnginePluginMeta[]) {
      const dir = `${meta.pluginId}-plugin`;
      if (!existsSync(`${packagesRoot()}${dir}/.zcode-plugin/plugin.json`)) continue;
      const { manifest } = readShippedPlugin(dir);
      const provenance = manifest.provenance as { source?: { commitSha?: string } };
      expect(provenance?.source?.commitSha, `${dir} manifest must agree with its domain meta's source-of-record commit`).toBe(
        meta.provenance.source.type === "repository" ? meta.provenance.source.commitSha : "",
      );
    }
  });

  it("the domain records (metas + capabilities) carry the SAME real commit as their line — no manifest/domain provenance drift", () => {
    for (const meta of ENGINE_PLUGIN_METAS as EnginePluginMeta[]) {
      expect(
        isSyntheticPlaceholder(meta.provenance.source.type === "repository" ? meta.provenance.source.commitSha : ""),
        `${meta.pluginId} domain meta provenance is synthetic`,
      ).toBe(false);
      expect(meta.provenance.source.type).toBe("repository");
      if (meta.provenance.source.type === "repository") {
        expect(meta.provenance.source.commitSha).toBe(expectedSourceCommit(meta.engineFamily));
      }
    }
    for (const record of ENGINE_PLUGIN_CAPABILITIES) {
      const source = record.provenance.source;
      if (source.type === "repository") {
        expect(
          isSyntheticPlaceholder(source.commitSha),
          `${record.id} capability provenance commitSha is synthetic`,
        ).toBe(false);
        const family = record.engineFamily ?? "core";
        expect(source.commitSha).toBe(expectedSourceCommit(family));
      }
    }
  });
});
