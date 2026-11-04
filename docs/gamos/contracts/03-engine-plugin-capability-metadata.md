# Gamos Phase-0 Contract 03 — Engine Plugin Capability Metadata

- Status: **FROZEN (Phase 0, revision 1)** — hash-protected governance control file
- Owner: Gamos TL
- Revision 1 (GAMOS-AUTH-0003): consistency with corrected contracts — engine-family
  version grammar (04 rev 1), `gamos/capability@2` execution-safety records (02 rev 1)
  and `gamos/provenance@2` surfaces (09 rev 1).

## 1. Principle

Engine plugins (Unity/Blender/Babylon first; Godot/Unreal planned) are **ZCode plugins**
in the existing plugin system (marketplace install verified in evidence/phase-b:
`installed_plugins.json`, cache layout, sha256-verified zips from cdn-zcode.z.ai).
They MUST NOT introduce a second plugin marketplace or plugin runtime.

## 2. Plugin manifest additions (schema `gamos/engine-plugin@2`)

An engine plugin extends the standard plugin manifest with:

```ts
interface EnginePluginMeta {
  engineFamily: "unity" | "blender" | "babylon" | "godot" | "unreal";
  engineVersions: string;          // engine-family version predicate in that family's
                                   // grammar (contract 04 §4 — NOT universal SemVer;
                                   // e.g. Unity "2022.3.f+/6000.0+", Blender ">=4.1")
  executable?: {                   // how to reach a local engine/editor headlessly
    kind: "cli" | "batch" | "server";
    command: string;               // resolved via contract 04 machine-local discovery
    args?: string[];
  };
  capabilities: string[];          // capability ids declared (contract 02, records @2)
  headlessSupport: "full" | "partial" | "none";
  requiresDisplayServer: boolean;  // true → availability degrades off-desktop (contract 07)
  provenance: ProvenanceRef;       // contract 09 (gamos/provenance@2, with surfaces)
}
```

MUST rules:
1. The plugin declares capabilities; the registry (contract 02) is the single source of
   truth for contracts — a plugin cannot redefine an existing capability, and every
   declared id must resolve to a complete `gamos/capability@2` record (execution-safety
   block included) or registration fails closed.
2. Engine version support is a predicate in the family grammar; discovery (contract 04)
   reports the actual installed version (raw + parsed) and the binding MUST reject
   out-of-range or unparseable versions with an explicit unavailable state — no silent
   best-effort (fail closed per contract 02 §3).
3. Plugins expose their functionality as MCP tools (namespace `mcp__plugin_<name>_<engine>__*`,
   matching the verified existing app-plugin naming) and, where interactive, as side-panel
   surfaces via the existing UI plugin API (see upstream `UI_PLUGIN.md`). The two surfaces
   carry distinct trust models (contract 09 §2–§3): UI panels run renderer-sandboxed;
   MCP servers run as OS processes.
4. Plugin packaging, install, enable/disable, update flows are the **existing** ones
   (CLI `plugins` command group + Settings → Plugins page — both verified).

## 3. Engine families, initial scope

- Worker A delivers: `unity-engine-plugin`, `blender-engine-plugin`, `babylon-engine-plugin`
  under `apps/zcode-cli/packages/` (paths pre-declared in
  `.gamos-architecture-baseline.json` planned_additive_surfaces).
- Godot/Unreal remain planned entries — NOT implemented in Phase 0 workers' scope.
