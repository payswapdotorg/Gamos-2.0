# Gamos Phase-0 Contract 09 — Plugin Trust & Provenance

- Status: **FROZEN (Phase 0, revision 1)** — hash-protected governance control file
- Owner: Gamos TL
- Revision 1 (GAMOS-AUTH-0003): corrects the distinction between the **UI plugin
  sandbox** and **MCP server process execution**, and specifies the trust/isolation
  model for external MCP processes (architect re-review correction D).

## 1. Principle

Engine plugins inherit the **existing ZCode plugin trust chain** (verified in Phase B:
official marketplace zips from cdn-zcode.z.ai with sha256 verification recorded in
`installed_plugins.json`, `known_marketplaces.json`, cache layout under
`~/.zcode/cli/plugins/`). Gamos adds provenance metadata; it does not add a second
trust system.

## 2. Two different plugin execution surfaces (revision 1 — MUST distinguish)

A plugin's declared components execute in **two fundamentally different surfaces**:

1. **UI plugin sandbox (renderer-side, no OS process):** plugin UI panels run inside
   the renderer's plugin sandbox — `packages/desktop/src/preload/pluginSandbox/`
   (host bridge, retained moves), the privileged plugin-sandbox scheme/alias builds
   (`out/plugin-sandbox`, `pluginSandbox.cjs` preload), served via the
   plugin-sandbox host from `out/renderer`/`out/plugin-sandbox` assets. Isolation is
   **browser-context isolation** (sandboxed DOM, bridge-scoped API); a UI panel never
   gains OS process capabilities, filesystem access beyond bridged APIs, or
   environment inheritance.
2. **MCP server process execution (OS process, no renderer sandbox):** a plugin that
   declares `mcpServers` in its `plugin.json` is executed as **separate OS processes**
   spawned by the agent runtime (verified layout: `mcp__plugin_<name>/<server>`
   tool namespaces; plugin MCP dists `dist/mcp/server.js` / `dist/server.mjs`).
   These processes run outside any renderer sandbox, with the host environment,
   working directory and plugin-declared env — the standard MCP stdio transport.

Consequences (MUST):
- Trust decisions MUST be made per surface: a plugin may be safe to render (sandboxed
  UI) while its MCP server is a full-privilege OS process from the user's account.
- Plugin metadata MUST declare which surfaces it uses (`ui`, `mcpServers`, both);
  the declaration MUST match the shipped content (mismatch = registration failure,
  fail closed).
- Documentation/UI disclosures MUST NOT describe MCP servers as "sandboxed by the
  plugin sandbox" — process isolation is OS-level only (§3).

## 3. Trust/isolation model for external MCP processes (revision 1 — MUST)

1. **Process isolation only.** External MCP processes (plugin MCP servers and
   user-configured external MCP servers) get OS process boundaries — nothing more.
   They inherit the agent runtime's OS user; they are NOT containerized, seccomp'd
   or otherwise sandboxed by Gamos or ZCode.
2. **Environment exposure is explicit.** The spawn env is the plugin/agent env
   surface (endpoint origins, broker sockets/tokens where applicable — see the
   cua broker env injection in `packages/services/src/node.ts`). A plugin's
   MCP server MUST be treated as potentially seeing whatever its spawn env carries;
   plugin review therefore includes env-surface inspection.
3. **Disclosure before install.** Installing a plugin that declares `mcpServers`
   MUST surface to the user, before activation, that OS processes will be spawned
   (existing install flow surfaces plugin content; the marketplace entry carries
   the same disclosure). External (non-marketplace) MCP servers configured by the
   user are the user's own trust decision, recorded as such.
4. **Provenance is stricter for process-carrying plugins.** Marketplace sha256
   verification is required at install and re-verified on update (existing
   behavior — verified by the real jupyter-notebook install). For plugins
   declaring `mcpServers`, provenance MUST additionally identify the exact server
   entry points and the review that covered them (§4 `reviewRef`).
5. **Disable on unresolvable provenance.** A plugin whose provenance cannot be
   resolved at load time MUST be disabled with an explicit state, not silently
   skipped.

## 4. Provenance ref (schema `gamos/provenance@2`, referenced by contracts 02/03)

```ts
interface ProvenanceRef {
  publisher: "zcode-official" | "gamos-tl" | "community";
  source: {
    type: "marketplace"; marketplaceId: string; version: string; sha256: string;
  } | {
    type: "repository"; repo: string; commitSha: string; path: string;
  };
  surfaces?: Array<"ui" | "mcp">;   // which execution surfaces this provenance covers
  reviewedBy?: string;              // TL login for TL-reviewed plugins
  reviewRef?: string;               // PR / ledger decision_ref (REQUIRED for
                                    // community/mcp-carrying plugins, §3.4)
}
```

MUST rules:
1. Every capability and engine plugin carries a provenance ref; unprovenanced
   declarations MUST be rejected at registration (fail closed).
2. Community plugins declare `requiresDisplayServer`/permissions honestly; UI
   components run in the renderer sandbox (§2.1) and MCP components as OS
   processes under the §3 model.
3. TL-published (gamos-tl) plugins additionally reference the governance decision
   (ledger entry or PR) that authorized their introduction — keeping the
   repository-level and runtime-level trust chains connected (repository
   governance remains separate from publishing authorization per contract 06 §3).
4. Marketplace sha256 MUST be verified at install and re-verified on update
   (existing behavior — verified by the real jupyter-notebook install).

## 5. Supply-chain notes

- Engine executables are user-installed (contract 04 discovery); Gamos never downloads
  engines implicitly. Engine SDK/package fetches during tasks require the `network`
  permission (contract 06) and record fetched artifact hashes (contract 08).
- All native engine mutations still route through permission-gated ZCode execution
  (contract 06 §2.3) — an MCP server performing engine mutations acts as an agent
  tool under the same gate; it is not an exemption.
