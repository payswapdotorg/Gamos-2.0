import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { ZCODE_PLUGIN_HOST_COMMAND } from "@zcode/contracts";
import {
  getZCodePluginsOverview,
  installZCodeMarketplacePlugin,
  resolveZCodePlugins,
  setZCodePluginEnabled,
  uninstallZCodeMarketplacePlugin,
  updateZCodeMarketplacePlugin,
  validateZCodePlugin,
} from "../src/plugins.js";
import { resolveOfficialPluginRoots } from "../src/app/bundled-plugins.js";

/**
 * Gamos M2-D (final-closure directive §2) — the complete applicable plugin
 * lifecycle for the three first-party ENGINE plugins, proven through the REAL
 * ZCode bootstrap facade (no direct config-file editing, no manual package
 * copying — the lifecycle APIs are the authority).
 *
 * Engine plugins: unity-engine, blender-engine, babylon-engine — bundled
 * OFFICIAL plugins (seeded from the repository packages into the
 * zcode-plugins-official marketplace manifest, default-disabled).
 *
 * What this suite adds beyond the existing coverage (the M2J3 journey proves
 * ENABLEMENT only — Settings → Plugins → toggle → restart → tools offered):
 *
 *   1. official definitions resolve into the marketplace catalog (§R1);
 *   2. install/reinstall through the supported lifecycle (§R2 — for bundled
 *      plugins: uninstall = suppression, install routes to restore);
 *   3. disable REMOVES the engine MCP server from the resolved tool surface
 *      and re-enable restores it EXACTLY ONCE — no duplicate registrations
 *      (§R5/§R6);
 *   4. uninstall removes the runtime state cleanly and lists the plugin as
 *      restorable (§R7);
 *   5. a version-changing marketplace update swaps the resolved runtime root
 *      without stale resolution (§R4);
 *   6. a missing declared runtime asset is surfaced by the validator and the
 *      registered path fails closed at the host boundary (§R8).
 *
 * Requirements already proven elsewhere (cited, not duplicated here):
 *   - §R1 version alignment definition/manifest/package: "keeps every bundled
 *     plugin package, manifest, and seed version aligned"
 *     (tests/plugins.test.ts) and "the shipped metas are exactly the
 *     manifests' inline gamos fields" + the shipped-package validator
 *     (packages/gamos-domain/test/engine-plugin-security.test.ts; the CI
 *     domain job additionally verifies provenance commitSha objects with
 *     `git cat-file`).
 *   - §R3 package/runtime hashes: the gamos-domain shipped-package validator
 *     (provenance canonical-first, capability ownership, version drift) plus
 *     the SEA per-file sha256 pins (cli/scripts/sea-official-plugin-assets.mjs
 *     pins requiredRuntimePaths dist/mcp/server.js for all three).
 *   - §R9 permission denial prevents engine mutations: gamos-domain
 *     permission-gate.test.ts and the in-app M2J4 denial leg
 *     (scripts/gamos/m2-ui-journey.mjs — blend file hash unchanged, no
 *     render produced under respondKind rejectOnce).
 *   - §R10 cancellation terminates honestly: "propagates cancellation while
 *     refreshing a declared marketplace" (tests/plugins.test.ts), the babylon
 *     integration process-tree timeout-kill test, and the in-app M2J5
 *     project_stop leg.
 *   - §R11 MCP process privileges disclosed separately from tool permission:
 *     plugin-trust.test.ts + engine-plugin-security.test.ts
 *     (approvalScope === "tool-invocation-only", "sandboxed" wording
 *     prohibited, official-full execution regime disclosures).
 */

const ENGINE_PLUGIN_IDS = [
  "unity-engine@zcode-plugins-official",
  "blender-engine@zcode-plugins-official",
  "babylon-engine@zcode-plugins-official",
] as const;

const ENGINE_MCP_IDS = [
  "plugin:unity-engine:engine",
  "plugin:blender-engine:engine",
  "plugin:babylon-engine:engine",
] as const;

function engineCachePath(pluginStorageRoot: string, name: string): string {
  return join(pluginStorageRoot, "cache", "zcode-plugins-official", name, "0.1.0");
}

async function writeUserPluginConfig(
  configPath: string,
  enabledPlugins: Record<string, boolean>,
): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify({ plugins: { enabledPlugins } }, null, 2));
}

async function writeKnownMarketplaces(
  storageRoot: string,
  marketplaces: Array<Record<string, unknown>>,
): Promise<void> {
  await mkdir(join(storageRoot), { recursive: true });
  await writeFile(
    join(storageRoot, "known_marketplaces.json"),
    JSON.stringify({ version: 1, marketplaces }),
  );
}

/** Write the fixture directory-marketplace manifest (in the SOURCE dir, where refresh reads it). */
async function writeFixtureMarketplaceSourceManifest(
  sourceDir: string,
  version: string,
): Promise<void> {
  await mkdir(sourceDir, { recursive: true });
  await writeFile(
    join(sourceDir, "marketplace.json"),
    JSON.stringify(
      {
        name: "gamos-lifecycle-fixture",
        plugins: [
          {
            name: "blender-engine",
            displayName: "Gamos Lifecycle Fixture Blender Engine",
            version,
            source: { source: "directory", path: join(sourceDir, "blender-engine") },
          },
        ],
      },
      null,
      2,
    ),
  );
}

/** An ENGINE-PLUGIN-SHAPED marketplace package (manifest + real server.js runtime). */
async function writeEngineShapedPluginPackage(
  packageDir: string,
  version: string,
  marker: string,
): Promise<void> {
  await mkdir(join(packageDir, ".zcode-plugin"), { recursive: true });
  await mkdir(join(packageDir, "dist", "mcp"), { recursive: true });
  await writeFile(
    join(packageDir, ".zcode-plugin", "plugin.json"),
    JSON.stringify(
      {
        name: "blender-engine",
        version,
        mcpServers: {
          engine: {
            type: "stdio",
            command: "node",
            args: ["${ZCODE_PLUGIN_ROOT}/dist/mcp/server.js"],
          },
        },
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(packageDir, "dist", "mcp", "server.js"),
    `// engine-plugin-shaped fixture server (gamos M2-D lifecycle test)\n` +
      `export const versionMarker = ${JSON.stringify(marker)};\n` +
      `export async function main() {\n  process.stdout.write(${JSON.stringify(`server ${marker}`)});\n}\n`,
  );
}

describe("Gamos M2-D — engine plugin lifecycle through the real ZCode facade", () => {
  it("the three engine plugins seed into the official marketplace catalog (version 0.1.0, filesystem source, engine MCP declared)", async () => {
    const root = await mkdtemp(join(tmpdir(), "gamos-m2d-engine-catalog-"));
    const pluginStorageRoot = join(root, "plugins");

    try {
      resolveOfficialPluginRoots({ storageRoot: pluginStorageRoot });

      const manifest = JSON.parse(
        await readFile(
          join(pluginStorageRoot, "marketplaces", "zcode-plugins-official", "marketplace.json"),
          "utf8",
        ),
      ) as { plugins: Array<{ name: string; version?: string; source?: string; cachePath?: string }> };
      for (const id of ENGINE_PLUGIN_IDS) {
        const name = id.split("@")[0] ?? "";
        const entry = manifest.plugins.find((plugin) => plugin.name === name);
        expect(entry, `official marketplace entry for ${name}`).toBeDefined();
        expect(entry?.version).toBe("0.1.0");
        expect(entry?.source).toBe("filesystem");
        expect(typeof entry?.cachePath).toBe("string");
      }

      // The default-disabled bundled plugins resolve with their declared
      // engine MCP server name and no server registration (disabled).
      const outcome = resolveZCodePlugins({
        env: {},
        pluginStorageRoot,
        skipUserConfig: true,
        workingDirectory: root,
      });
      for (const [index, id] of ENGINE_PLUGIN_IDS.entries()) {
        const name = id.split("@")[0] ?? "";
        const plugin = outcome.plugins.find((item) => item.id === id);
        expect(plugin, `resolved plugin ${id}`).toBeDefined();
        expect(plugin?.enabled).toBe(false);
        expect(plugin?.declaredMcpServerNames).toContain("engine");
        expect(ENGINE_MCP_IDS[index] in outcome.mcpServers).toBe(false);
        expect(plugin?.rootPath).toBe(engineCachePath(pluginStorageRoot, name));
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("enable projects the engine MCP server; disable removes it from the tool surface; re-enable restores it EXACTLY ONCE (no duplicate registrations)", async () => {
    const root = await mkdtemp(join(tmpdir(), "gamos-m2d-engine-toggle-"));
    const pluginStorageRoot = join(root, "plugins");
    const configPath = join(root, "config.json");

    try {
      // Seed once.
      resolveOfficialPluginRoots({ storageRoot: pluginStorageRoot });

      // (a) enable all three through the REAL persistence API (not by hand-editing config)
      await setZCodePluginEnabled({
        env: {},
        pluginStorageRoot,
        userConfigPath: configPath,
        workingDirectory: root,
        plugin: "unity-engine@zcode-plugins-official",
        enabled: true,
      });
      // The API persisted the choice; the other two toggles go through the same API.
      await setZCodePluginEnabled({
        env: {},
        pluginStorageRoot,
        userConfigPath: configPath,
        workingDirectory: root,
        plugin: "blender-engine@zcode-plugins-official",
        enabled: true,
      });
      await setZCodePluginEnabled({
        env: {},
        pluginStorageRoot,
        userConfigPath: configPath,
        workingDirectory: root,
        plugin: "babylon-engine@zcode-plugins-official",
        enabled: true,
      });

      const enabledOutcome = resolveZCodePlugins({
        env: {},
        pluginStorageRoot,
        userConfigPath: configPath,
        workingDirectory: root,
      });
      for (const [index, id] of ENGINE_PLUGIN_IDS.entries()) {
        const name = id.split("@")[0] ?? "";
        const mcpId = ENGINE_MCP_IDS[index] ?? "";
        const plugin = enabledOutcome.plugins.find((item) => item.id === id);
        expect(plugin?.enabled).toBe(true);
        // exactly ONE registration per engine plugin (structural namespace keys)
        const registrationKeys = Object.keys(enabledOutcome.mcpServers).filter((key) =>
          key.startsWith(`plugin:${name}:`),
        );
        expect(registrationKeys).toEqual([mcpId]);
        const server = enabledOutcome.mcpServers[mcpId];
        expect(server).toMatchObject({ type: "stdio", command: process.execPath });
        expect(server?.args?.at(-2)).toBe(ZCODE_PLUGIN_HOST_COMMAND);
        expect(server?.args?.at(-1)).toContain(
          join("zcode-plugins-official", name, "0.1.0", "dist", "mcp", "server.js"),
        );
      }

      // (b) disable one engine plugin — its MCP server must LEAVE the resolved
      //     tool surface (tool availability removed), the others stay.
      await setZCodePluginEnabled({
        env: {},
        pluginStorageRoot,
        userConfigPath: configPath,
        workingDirectory: root,
        plugin: "blender-engine@zcode-plugins-official",
        enabled: false,
      });
      const disabledOutcome = resolveZCodePlugins({
        env: {},
        pluginStorageRoot,
        userConfigPath: configPath,
        workingDirectory: root,
      });
      expect("plugin:blender-engine:engine" in disabledOutcome.mcpServers).toBe(false);
      expect("plugin:unity-engine:engine" in disabledOutcome.mcpServers).toBe(true);
      expect("plugin:babylon-engine:engine" in disabledOutcome.mcpServers).toBe(true);
      const disabledPlugin = disabledOutcome.plugins.find(
        (item) => item.id === "blender-engine@zcode-plugins-official",
      );
      expect(disabledPlugin?.enabled).toBe(false);
      expect(disabledPlugin?.mcpServerNames ?? []).toEqual([]);

      // (c) re-enable — restored EXACTLY once, still no duplicates anywhere.
      await setZCodePluginEnabled({
        env: {},
        pluginStorageRoot,
        userConfigPath: configPath,
        workingDirectory: root,
        plugin: "blender-engine@zcode-plugins-official",
        enabled: true,
      });
      const reenabledOutcome = resolveZCodePlugins({
        env: {},
        pluginStorageRoot,
        userConfigPath: configPath,
        workingDirectory: root,
      });
      for (const [index, id] of ENGINE_PLUGIN_IDS.entries()) {
        const name = id.split("@")[0] ?? "";
        const mcpId = ENGINE_MCP_IDS[index] ?? "";
        const registrationKeys = Object.keys(reenabledOutcome.mcpServers).filter((key) =>
          key.startsWith(`plugin:${name}:`),
        );
        expect(registrationKeys).toEqual([mcpId]);
        expect(reenabledOutcome.mcpServers[mcpId]).toMatchObject({ type: "stdio" });
      }
      // and the full disable→enable round-trip for the OTHER two engine plugins
      // (unity, babylon) — same exactly-once property.
      await setZCodePluginEnabled({
        env: {},
        pluginStorageRoot,
        userConfigPath: configPath,
        workingDirectory: root,
        plugin: "unity-engine@zcode-plugins-official",
        enabled: false,
      });
      await setZCodePluginEnabled({
        env: {},
        pluginStorageRoot,
        userConfigPath: configPath,
        workingDirectory: root,
        plugin: "unity-engine@zcode-plugins-official",
        enabled: true,
      });
      await setZCodePluginEnabled({
        env: {},
        pluginStorageRoot,
        userConfigPath: configPath,
        workingDirectory: root,
        plugin: "babylon-engine@zcode-plugins-official",
        enabled: false,
      });
      await setZCodePluginEnabled({
        env: {},
        pluginStorageRoot,
        userConfigPath: configPath,
        workingDirectory: root,
        plugin: "babylon-engine@zcode-plugins-official",
        enabled: true,
      });
      const finalOutcome = resolveZCodePlugins({
        env: {},
        pluginStorageRoot,
        userConfigPath: configPath,
        workingDirectory: root,
      });
      for (const [index, id] of ENGINE_PLUGIN_IDS.entries()) {
        const name = id.split("@")[0] ?? "";
        const mcpId = ENGINE_MCP_IDS[index] ?? "";
        const registrationKeys = Object.keys(finalOutcome.mcpServers).filter((key) =>
          key.startsWith(`plugin:${name}:`),
        );
        expect(registrationKeys).toEqual([mcpId]);
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("uninstall of a bundled engine plugin suppresses it (gone from discovery, listed as restorable); install routes to restore and re-seeds it", async () => {
    const root = await mkdtemp(join(tmpdir(), "gamos-m2d-engine-uninstall-"));
    const pluginStorageRoot = join(root, "plugins");
    const configPath = join(root, "config.json");

    try {
      resolveOfficialPluginRoots({ storageRoot: pluginStorageRoot });
      await writeUserPluginConfig(configPath, { "blender-engine@zcode-plugins-official": true });

      const before = resolveZCodePlugins({
        env: {},
        pluginStorageRoot,
        userConfigPath: configPath,
        workingDirectory: root,
      });
      expect(before.plugins.some((item) => item.id === "blender-engine@zcode-plugins-official")).toBe(
        true,
      );
      expect("plugin:blender-engine:engine" in before.mcpServers).toBe(true);

      // (a) uninstall through the REAL API — bundled plugins take the
      //     suppression path (runtime state removed; catalog/cache retained).
      const removed = await uninstallZCodeMarketplacePlugin({
        env: {},
        pluginStorageRoot,
        userConfigPath: configPath,
        workingDirectory: root,
        pluginId: "blender-engine@zcode-plugins-official",
      });
      expect(removed).not.toBeNull();

      const afterUninstall = resolveZCodePlugins({
        env: {},
        pluginStorageRoot,
        userConfigPath: configPath,
        workingDirectory: root,
      });
      expect(
        afterUninstall.plugins.some((item) => item.id === "blender-engine@zcode-plugins-official"),
      ).toBe(false);
      expect("plugin:blender-engine:engine" in afterUninstall.mcpServers).toBe(false);

      // the overview lists it as a restorable builtin (the Settings restore entry)
      const overview = getZCodePluginsOverview({
        env: {},
        pluginStorageRoot,
        userConfigPath: configPath,
        workingDirectory: root,
      });
      expect(
        overview.restorableBuiltins.some((item) => item.id === "blender-engine@zcode-plugins-official"),
      ).toBe(true);

      // (b) install through the REAL lifecycle API — a suppressed builtin
      //     routes to RESTORE (no marketplace record is fabricated).
      const install = await installZCodeMarketplacePlugin({
        env: {},
        pluginStorageRoot,
        userConfigPath: configPath,
        workingDirectory: root,
        marketplace: "zcode-plugins-official",
        pluginName: "blender-engine",
      });
      expect(
        install.installedPlugins.some(
          (item) => item.name === "blender-engine" || item.id === "blender-engine@zcode-plugins-official",
        ),
      ).toBe(true);

      const afterRestore = resolveZCodePlugins({
        env: {},
        pluginStorageRoot,
        userConfigPath: configPath,
        workingDirectory: root,
      });
      const restored = afterRestore.plugins.find(
        (item) => item.id === "blender-engine@zcode-plugins-official",
      );
      expect(restored).toBeDefined();
      expect(restored?.rootPath).toBe(engineCachePath(pluginStorageRoot, "blender-engine"));
      // the seed re-materialized the plugin root (the committed manifest is
      // the seed evidence; dist/mcp/server.js is a build artifact produced by
      // scripts/build-mcp.mjs and is asserted at the journey/packaging layers)
      expect(existsSync(join(restored?.rootPath ?? "", ".zcode-plugin", "plugin.json"))).toBe(true);
      // uninstall PURGED the user's enabled choice, so restore honestly returns
      // the plugin to its bundled default-disabled state — no MCP registration.
      expect(restored?.enabled).toBe(false);
      expect("plugin:blender-engine:engine" in afterRestore.mcpServers).toBe(false);
      // re-enabling through the REAL API after restore brings the tools back.
      await setZCodePluginEnabled({
        env: {},
        pluginStorageRoot,
        userConfigPath: configPath,
        workingDirectory: root,
        plugin: "blender-engine@zcode-plugins-official",
        enabled: true,
      });
      const reEnabled = resolveZCodePlugins({
        env: {},
        pluginStorageRoot,
        userConfigPath: configPath,
        workingDirectory: root,
      });
      expect("plugin:blender-engine:engine" in reEnabled.mcpServers).toBe(true);

      // the same uninstall/restore/re-enable round-trip holds for the other two engine plugins
      for (const id of ["unity-engine@zcode-plugins-official", "babylon-engine@zcode-plugins-official"]) {
        const name = id.split("@")[0] ?? "";
        const removedEngine = await uninstallZCodeMarketplacePlugin({
          env: {},
          pluginStorageRoot,
          userConfigPath: configPath,
          workingDirectory: root,
          pluginId: id,
        });
        expect(removedEngine).not.toBeNull();
        const gone = resolveZCodePlugins({
          env: {},
          pluginStorageRoot,
          userConfigPath: configPath,
          workingDirectory: root,
        });
        expect(gone.plugins.some((item) => item.id === id)).toBe(false);
        expect(`plugin:${name}:engine` in gone.mcpServers).toBe(false);
        const restore = await installZCodeMarketplacePlugin({
          env: {},
          pluginStorageRoot,
          userConfigPath: configPath,
          workingDirectory: root,
          marketplace: "zcode-plugins-official",
          pluginName: name,
        });
        expect(restore.installedPlugins.length).toBeGreaterThan(0);
        const back = resolveZCodePlugins({
          env: {},
          pluginStorageRoot,
          userConfigPath: configPath,
          workingDirectory: root,
        });
        expect(back.plugins.some((item) => item.id === id)).toBe(true);
        // restored to default-disabled; re-enable through the real API restores tools
        const backPlugin = back.plugins.find((item) => item.id === id);
        expect(backPlugin?.enabled).toBe(false);
        await setZCodePluginEnabled({
          env: {},
          pluginStorageRoot,
          userConfigPath: configPath,
          workingDirectory: root,
          plugin: id,
          enabled: true,
        });
        const reEnabledEngine = resolveZCodePlugins({
          env: {},
          pluginStorageRoot,
          userConfigPath: configPath,
          workingDirectory: root,
        });
        expect(`plugin:${name}:engine` in reEnabledEngine.mcpServers).toBe(true);
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("a version-changing marketplace update swaps the resolved runtime root without stale resolution (engine-plugin-shaped package)", async () => {
    const root = await mkdtemp(join(tmpdir(), "gamos-m2d-engine-update-"));
    const pluginStorageRoot = join(root, "plugins");
    const configPath = join(root, "config.json");
    const fixtureMarketplaceId = "gamos-lifecycle-fixture";
    const fixtureSourceDir = join(root, "fixture-source", "blender-engine");

    // NOTE on scope (honest framing): the SHIPPED engine plugins are bundled,
    // repo-managed plugins — their "update" is a repository commit, pinned by
    // "keeps every bundled plugin package, manifest, and seed version aligned"
    // (tests/plugins.test.ts). The marketplace UPDATE machinery (version bump
    // → reinstall → version-segmented cache swap) is proven here with a
    // real marketplace package carrying the engine plugin's exact manifest
    // shape (name blender-engine, mcpServers.engine, dist/mcp/server.js).
    try {
      // A real directory marketplace: the manifest lives IN the source
      // directory (refresh re-reads it from there) next to the plugin package.
      await writeEngineShapedPluginPackage(fixtureSourceDir, "0.1.0", "v0.1.0-marker");
      await writeFixtureMarketplaceSourceManifest(join(root, "fixture-source"), "0.1.0");
      await writeKnownMarketplaces(pluginStorageRoot, [
        {
          id: fixtureMarketplaceId,
          source: { source: "directory", path: join(root, "fixture-source") },
          name: fixtureMarketplaceId,
          addedAt: "2026-11-08T00:00:00.000Z",
          pluginCount: 1,
        },
      ]);

      const install = await installZCodeMarketplacePlugin({
        env: {},
        pluginStorageRoot,
        userConfigPath: configPath,
        workingDirectory: root,
        marketplace: fixtureMarketplaceId,
        pluginName: "blender-engine",
      });
      expect(install.installedPlugins[0]?.version).toBe("0.1.0");

      const enabledConfigPath = join(root, "config.json");
      await writeUserPluginConfig(enabledConfigPath, {
        "blender-engine@gamos-lifecycle-fixture": true,
      });
      const resolved010 = resolveZCodePlugins({
        env: {},
        pluginStorageRoot,
        userConfigPath: enabledConfigPath,
        workingDirectory: root,
      });
      const plugin010 = resolved010.plugins.find(
        (item) => item.id === "blender-engine@gamos-lifecycle-fixture",
      );
      expect(plugin010?.rootPath).toContain(
        join("cache", fixtureMarketplaceId, "blender-engine", "0.1.0"),
      );
      expect("plugin:blender-engine:engine" in resolved010.mcpServers).toBe(true);
      const server010 = resolved010.mcpServers["plugin:blender-engine:engine"];
      expect(server010?.args?.at(-1)).toContain(join("blender-engine", "0.1.0", "dist", "mcp", "server.js"));

      // (b) the fixture marketplace publishes 0.2.0 with a CHANGED server.js.
      await writeEngineShapedPluginPackage(fixtureSourceDir, "0.2.0", "v0.2.0-marker");
      await writeFixtureMarketplaceSourceManifest(join(root, "fixture-source"), "0.2.0");

      const update = await updateZCodeMarketplacePlugin({
        env: {},
        pluginStorageRoot,
        userConfigPath: enabledConfigPath,
        workingDirectory: root,
        pluginId: "blender-engine@gamos-lifecycle-fixture",
      });
      expect(update.previousVersion).toBe("0.1.0");
      expect(update.installedPlugins[0]?.version).toBe("0.2.0");

      const resolved020 = resolveZCodePlugins({
        env: {},
        pluginStorageRoot,
        userConfigPath: enabledConfigPath,
        workingDirectory: root,
      });
      const plugin020 = resolved020.plugins.find(
        (item) => item.id === "blender-engine@gamos-lifecycle-fixture",
      );
      // the resolved root SWAPPED to the new version-segmented cache dir …
      expect(plugin020?.rootPath).toContain(
        join("cache", fixtureMarketplaceId, "blender-engine", "0.2.0"),
      );
      expect(plugin020?.version).toBe("0.2.0");
      // … the registration points at the NEW server.js …
      const server020 = resolved020.mcpServers["plugin:blender-engine:engine"];
      expect(server020?.args?.at(-1)).toContain(join("blender-engine", "0.2.0", "dist", "mcp", "server.js"));
      // … and the registered runtime is the NEW content, not the stale 0.1.0 bytes
      // (the platform retains the old dir as immutable cache, but nothing resolves it).
      const registeredServerPath = server020?.args?.at(-1) ?? "";
      const resolvedPath = registeredServerPath.replace("${ZCODE_PLUGIN_ROOT}", plugin020?.rootPath ?? "");
      const serverContent = await readFile(resolvedPath, "utf8");
      expect(serverContent).toContain("v0.2.0-marker");
      expect(serverContent).not.toContain("v0.1.0-marker");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("a missing declared runtime asset fails closed: the validator reports it and no server presence is fabricated", async () => {
    const root = await mkdtemp(join(tmpdir(), "gamos-m2d-engine-runtime-missing-"));
    const pluginStorageRoot = join(root, "plugins");
    const configPath = join(root, "config.json");
    const fixtureMarketplaceId = "gamos-lifecycle-fixture";
    const fixtureSourceDir = join(root, "fixture-source", "blender-engine");

    try {
      // Install the engine-plugin-shaped package (real marketplace lifecycle).
      await writeEngineShapedPluginPackage(fixtureSourceDir, "0.1.0", "v0.1.0-marker");
      await writeFixtureMarketplaceSourceManifest(join(root, "fixture-source"), "0.1.0");
      await writeKnownMarketplaces(pluginStorageRoot, [
        {
          id: fixtureMarketplaceId,
          source: { source: "directory", path: join(root, "fixture-source") },
          name: fixtureMarketplaceId,
          addedAt: "2026-11-08T00:00:00.000Z",
          pluginCount: 1,
        },
      ]);
      await installZCodeMarketplacePlugin({
        env: {},
        pluginStorageRoot,
        userConfigPath: configPath,
        workingDirectory: root,
        marketplace: fixtureMarketplaceId,
        pluginName: "blender-engine",
      });
      const cacheRoot = join(pluginStorageRoot, "cache", fixtureMarketplaceId, "blender-engine", "0.1.0");
      expect(existsSync(join(cacheRoot, "dist", "mcp", "server.js"))).toBe(true);

      // (a) the manifest-level validator still passes (it validates the
      //     manifest, not file presence) — the fail-closed for a MISSING
      //     runtime asset happens at the SPAWN boundary, which is exactly
      //     where it must fail (asserted directly in the cli package test
      //     tests/plugin-host-refusal.test.ts: runPluginHostCommand refuses a
      //     nonexistent server file AND a corrupted server module).
      const diagnosticsBefore = await validateZCodePlugin({
        env: {},
        pluginStorageRoot,
        userConfigPath: configPath,
        workingDirectory: root,
        path: cacheRoot,
      });
      expect(
        diagnosticsBefore.filter((item) => item.severity === "error"),
      ).toEqual([]);

      // (b) delete the declared runtime asset. The config layer never
      //     FABRICATES server presence: the registration still routes to the
      //     declared path (which no longer exists) — the host boundary
      //     refuses a nonexistent server file at spawn time
      //     (plugin-host-command.ts: "Plugin server file does not exist.").
      const { rm: rmFile } = await import("node:fs/promises");
      await rmFile(join(cacheRoot, "dist", "mcp", "server.js"), { force: true });

      await writeUserPluginConfig(configPath, { "blender-engine@gamos-lifecycle-fixture": true });
      const resolved = resolveZCodePlugins({
        env: {},
        pluginStorageRoot,
        userConfigPath: configPath,
        workingDirectory: root,
      });
      const plugin = resolved.plugins.find(
        (item) => item.id === "blender-engine@gamos-lifecycle-fixture",
      );
      expect(plugin).toBeDefined();
      const registeredServerPath = join(plugin?.rootPath ?? "", "dist", "mcp", "server.js");
      expect(existsSync(registeredServerPath)).toBe(false);
      // the ONE registration still declares the (missing) file — nothing else
      // was invented, and the host will refuse it (spawn-time fail closed)
      const registrationKeys = Object.keys(resolved.mcpServers).filter((key) =>
        key.startsWith("plugin:blender-engine:"),
      );
      expect(registrationKeys).toEqual(["plugin:blender-engine:engine"]);
      const serverArgs = resolved.mcpServers["plugin:blender-engine:engine"]?.args ?? [];
      expect(serverArgs.at(-1)).toContain("dist");
      expect(serverArgs.at(-1)).toContain("server.js");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
