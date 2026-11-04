# Gamos Phase-0 Contract 03 — Engine Plugin Capability Metadata

- Status: **FROZEN (Phase 0)** — hash-protected governance control file
- Owner: Gamos TL

## 1. Principle

Engine plugins (Unity/Blender/Babylon first; Godot/Unreal planned) are **ZCode plugins**
in the existing plugin system (marketplace install verified in evidence/phase-b:
`installed_plugins.json`, cache layout, sha256-verified zips from cdn-zcode.z.ai).
They MUST NOT introduce a second plugin marketplace or plugin runtime.

## 2. Plugin manifest additions (schema `gamos/engine-plugin@1`)

An engine plugin extends the standard plugin manifest with:

```ts
interface EnginePluginMeta {
  engineFamily: "unity" | "blender" | "babylon" | "godot" | "unreal";
  engineVersions: string;          // semver range supported, e.g. ">=2022.3 <6000"
  executable?: {                   // how to reach a local engine/editor headlessly
    kind: "cli" | "batch" | "server";
    command: string;               // resolved via contract 04 discovery
    args?: string[];
  };
  capabilities: string[];          // capability ids declared (contract 02)
  headlessSupport: "full" | "partial" | "none";
  requiresDisplayServer: boolean;  // true → availability degrades off-desktop (contract 07)
  provenance: ProvenanceRef;       // contract 09
}
```

MUST rules:
1. The plugin declares capabilities; the registry (contract 02) is the single source of
   truth for contracts — a plugin cannot redefine an existing capability.
2. Engine version support is a **range**; discovery (contract 04) reports the actual
   installed version and the binding MUST reject out-of-range with an explicit
   unavailable state — no silent best-effort.
3. Plugins expose their functionality as MCP tools (namespace `mcp__plugin_<name>_<engine>__*`,
   matching the verified existing app-plugin naming) and, where interactive, as side-panel
   surfaces via the existing UI plugin API (see upstream `UI_PLUGIN.md`).
4. Plugin packaging, install, enable/disable, update flows are the **existing** ones
   (CLI `plugins` command group + Settings → Plugins page — both verified).

## 3. Engine families, initial scope

- Worker A delivers: `unity-engine-plugin`, `blender-engine-plugin`, `babylon-engine-plugin`
  under `apps/zcode-cli/packages/` (paths pre-declared in
  `.gamos-architecture-baseline.json` planned_additive_surfaces).
- Godot/Unreal remain planned entries — NOT implemented in Phase 0 workers' scope.
