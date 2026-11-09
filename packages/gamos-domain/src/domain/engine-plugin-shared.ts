/**
 * Shared engine-plugin record helpers — the permission constants, provider
 * identity helper and canonical provenance helpers used by EVERY engine
 * family's capability records (M2 unity/blender/babylon in engine-plugin.ts,
 * M4 godot in engine-plugin-godot.ts, M4 unreal in its future WP-4 module).
 *
 * Extracted from engine-plugin.ts when the M4 WP-1 godot registration would
 * otherwise have pushed that file past the repository max-lines lint bound:
 * the shared definitions move verbatim (the M2 records' call sites are
 * unchanged text), and the module keeps a single source of truth for the
 * permission-shape contract (contract 06 mapping — no per-family copies that
 * could drift).
 *
 * This module is pure data + helpers (the domain package stays pure).
 */

import type { ProvenanceRef } from "./provenance.js";

/**
 * The REAL source-of-record commit for the engine plugins' 0.1.0 line: the PR #5
 * integration merge that first shipped all three plugin packages in the
 * integrated tree (CI run 42356695328 verified that exact tree). Provenance is
 * exact (contract 09 §4): a shipped ref must name a commit object that exists.
 * A later plugin version bump points at ITS own shipping commit — the 0.1.0
 * source-of-record stays pinned here (append-only semantics, directive §5).
 */
export const M2_ENGINE_PLUGIN_SOURCE_COMMIT = "c9c397a1ac29dbdab2b7cbad89cad17a394d9d00";

/**
 * The REAL source-of-record commit for the M4 godot capability records' 1.0.0
 * line: the capability-contracts branch commit (gamos/m4-capability-contracts
 * @ eebcf6b7) where the field-level record contracts these records implement
 * VERBATIM were authored and CI-verified (run 42703013035, all three
 * governance jobs green on that exact tree) — and which the order-0
 * post-activation merge (0afbc650, CI 42718440007) brought onto the integrated
 * development tree. The records themselves ship in the WP-1 registration commit
 * of this slice; a later plugin version bump points at ITS own shipping commit
 * — the 1.0.0 source-of-record stays pinned here (append-only semantics, the
 * M2 precedent above).
 */
export const M4_ENGINE_PLUGIN_SOURCE_COMMIT = "eebcf6b788a9ad5b2f510f20ad260232443fc01d";

/** M2 provenance: canonical `gamos/provenance@2`, surfaces ["mcp"], repository source. */
export const enginePluginProvenance = (path: string): ProvenanceRef => ({
  publisher: "gamos-tl",
  source: {
    type: "repository",
    repo: "payswapdotorg/Gamos-2.0",
    commitSha: M2_ENGINE_PLUGIN_SOURCE_COMMIT,
    path,
  },
  surfaces: ["mcp"],
  reviewedBy: "gamos-tl",
  reviewRef: "M2 engine plugin integration (TL-reviewed)",
});

/** M4 provenance: identical canonical shape, source-of-record commit and review ref per the M4 line. */
export const m4EnginePluginProvenance = (path: string): ProvenanceRef => ({
  publisher: "gamos-tl",
  source: {
    type: "repository",
    repo: "payswapdotorg/Gamos-2.0",
    commitSha: M4_ENGINE_PLUGIN_SOURCE_COMMIT,
    path,
  },
  surfaces: ["mcp"],
  reviewedBy: "gamos-tl",
  reviewRef: "M4 capability contracts (TL-authored, maintainer-accepted; WP-1 registration TL-reviewed)",
});

export const mcpProvider = (pluginId: string) => ({
  kind: "mcp-server" as const,
  identity: `plugin:${pluginId}:engine`,
  discoveredVia: "zcode-plugin-lifecycle (installed_plugins.json + marketplace cache)",
});

export const readOnlyCommandPermission: import("./capability-registry.js").PermissionSpec = {
  kind: "command-execution",
  scope: "read-only",
  rationale: "read-only filesystem probes of the declared project/workspace",
};

export const engineHeadlessPermission: import("./capability-registry.js").PermissionSpec = {
  kind: "engine-headless",
  scope: "declared-workspace",
  rationale: "typed engine operation through the real engine executable in headless/batch mode (existing permission-gated agent execution)",
};

export const fileWritePermission: import("./capability-registry.js").PermissionSpec = {
  kind: "filesystem-write",
  scope: "declared-workspace",
  rationale: "the typed operation persists engine files (scene/project/artifact) inside the declared workspace",
};

export const networkLocalPermission: import("./capability-registry.js").PermissionSpec = {
  kind: "network-access",
  scope: "loopback",
  rationale: "the runtime bridge starts a local dev server on a loopback port",
};
