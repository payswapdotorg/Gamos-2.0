import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS,
  OFFICIAL_PLUGIN_DEFINITIONS,
} from "../src/app/official-plugin-definitions.js";
import { officialSeaPlugins } from "../../cli/scripts/sea-official-plugin-assets.mjs";

/**
 * M4 WP-8 — the host-catalog registration of the two M4 engine plugins
 * (delivery plan §3 order 8: "permission mapping wired through the EXISTING
 * ZCode permission broker").
 *
 * The blender M2 precedent is the wiring contract: an engine plugin rides the
 * host's permission-gated MCP path by being registered as an official plugin
 * definition (default-disabled — the heavy-engine-plugin class) plus a SEA
 * asset entry whose runtime artifact is dist/mcp/server.js. Once registered,
 * the plugin's MCP tools surface as `mcp__plugin_<name>_engine__<tool>` and
 * EVERY tool call passes the executor's permission flow
 * (resolveToolPermission → broker → user) before any engine code runs — the
 * existing generic gate, no new permission system (contract 06 rev 2).
 *
 * The generic consumers (plugins.test.ts alignment loops, the SEA manifest
 * loops) already validate every entry of both lists; this file pins the TWO
 * M4 rows explicitly so their absence is a named failure.
 */

const PACKAGES_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const M4_ENGINE_PLUGINS = [
  {
    name: "godot-engine",
    packageName: "@zcode/godot-engine-plugin",
    rootCandidate: "packages/godot-engine-plugin",
    packageDir: "godot-engine-plugin",
    displayName: "Godot Engine",
    version: "0.1.0",
  },
  {
    name: "unreal-engine",
    packageName: "@zcode/unreal-engine-plugin",
    rootCandidate: "packages/unreal-engine-plugin",
    packageDir: "unreal-engine-plugin",
    displayName: "Unreal Engine",
    version: "0.1.0",
  },
] as const;

describe("M4 WP-8 — the godot/unreal engine plugins are registered in the host catalog (the broker path is reachable)", () => {
  for (const plugin of M4_ENGINE_PLUGINS) {
    it(`${plugin.name}: the official plugin definition exists, version-aligned, heavy-engine class (default-disabled)`, () => {
      const definition = OFFICIAL_PLUGIN_DEFINITIONS.find((entry) => entry.name === plugin.name);
      expect(definition, `OFFICIAL_PLUGIN_DEFINITIONS must contain ${plugin.name}`).toBeDefined();
      if (!definition) return;
      expect(definition.rootCandidates[0]).toBe(plugin.rootCandidate);
      expect(definition.version).toBe(plugin.version);
      expect(definition.listing.displayName).toBe(plugin.displayName);
      // The M2 engine-plugin class: heavy plugins are default-DISABLED — the
      // user must explicitly enable them (android-emulator/ios-simulator class).
      expect(DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS.has(`${plugin.name}@zcode-plugins-official`)).toBe(false);
    });

    it(`${plugin.name}: the package manifest declares the engine MCP server the host bridges into the permission-gated tool surface`, () => {
      const packageRoot = join(PACKAGES_ROOT, plugin.packageDir);
      expect(existsSync(join(packageRoot, ".zcode-plugin", "plugin.json")), `${packageRoot} manifest missing`).toBe(
        true,
      );
      const manifest = JSON.parse(readFileSync(join(packageRoot, ".zcode-plugin", "plugin.json"), "utf8")) as {
        version: string;
        mcpServers?: Record<string, { type?: string; command?: string; args?: string[] }>;
      };
      expect(manifest.version).toBe(plugin.version);
      const engine = manifest.mcpServers?.engine;
      expect(engine, "mcpServers.engine must be declared").toBeDefined();
      expect(engine?.type).toBe("stdio");
      expect(engine?.command).toBe("node");
      expect(engine?.args?.[0]).toBe("${ZCODE_PLUGIN_ROOT}/dist/mcp/server.js");
    });

    it(`${plugin.name}: the SEA asset entry ships the runtime MCP server (requiresRuntime, dist/mcp/server.js)`, () => {
      const sea = officialSeaPlugins.find((entry) => entry.name === plugin.name);
      expect(sea, `officialSeaPlugins must contain ${plugin.name}`).toBeDefined();
      if (!sea) return;
      expect(sea.packageName).toBe(plugin.packageName);
      expect(sea.requiresRuntime).toBe(true);
      expect(sea.requiredRuntimePaths).toEqual(["dist/mcp/server.js"]);
      expect(sea.rootPath).toContain(join("packages", plugin.packageDir));
      const packageRoot = join(PACKAGES_ROOT, plugin.packageDir);
      const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { version: string };
      expect(sea.version).toBe(packageJson.version);
    });
  }

  it("the M2 engine trio stays registered alongside the M4 pair (enumerative growth, nothing displaced)", () => {
    for (const m2Name of ["unity-engine", "blender-engine", "babylon-engine"]) {
      expect(OFFICIAL_PLUGIN_DEFINITIONS.some((entry) => entry.name === m2Name), m2Name).toBe(true);
      expect(officialSeaPlugins.some((entry) => entry.name === m2Name), `${m2Name} SEA entry`).toBe(true);
    }
  });
});
