# Gamos Phase-0 Contract 09 — Plugin Trust & Provenance

- Status: **FROZEN (Phase 0, revision 2)** — hash-protected governance control file
- Owner: Gamos TL
- Revision 1 (GAMOS-AUTH-0003): corrects the distinction between the **UI plugin
  sandbox** and **MCP server process execution**, and specifies the trust/isolation
  model for external MCP processes (architect re-review correction D).
- Revision 2 (GAMOS-AUTH-0004): **capability-invocation approval is distinct from
  actual OS-process access**; the filesystem/network/environment authority actually
  available to MCP processes is documented explicitly; a least-privilege execution
  strategy for community engine plugins is defined; user disclosure and approval
  MUST reflect the actual process privileges (architect M0-closure correction B).

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

## 2.5 Capability-invocation approval vs actual OS-process access (revision 2 — MUST)

Two different authorizations are frequently conflated; they MUST be kept distinct:

1. **Capability-invocation approval** — the agent-permission gate (contract 06 §2)
  governing whether the AGENT may call a tool (including an MCP tool exposed by a
  plugin's server). It is a decision about a *tool invocation*, recorded in the
  existing permission records.
2. **Actual OS-process access** — what the plugin's MCP server PROCESS can do on the
  machine by virtue of being a live process under the user's account (§3.1). No
  permission prompt about a tool invocation constrains what that process itself can
   do once spawned.

MUST rules:
- Approving a capability invocation MUST NOT be presented as limiting, describing, or
  vouching for the MCP process's own authority. The approval governs the agent's tool
  call only.
- Any UI text, permission prompt, or marketplace disclosure that mentions a plugin's
  MCP components MUST reflect the actual process privileges (§3.2 inventory), not
  the invocation-approval semantics.
- Capability metadata (contracts 02/03) MAY describe what a tool invocation does;
  process-level authority is disclosed separately and truthfully (§3.2/§3.5).
- A "sandboxed" qualifier is reserved for the renderer-side UI sandbox (§2.1) and
  MUST NOT be applied to MCP processes in any Gamos-authored surface.

## 3. Trust/isolation model for external MCP processes (revision 2 — MUST)

1. **Process isolation only.** External MCP processes (plugin MCP servers and
   user-configured external MCP servers) get OS process boundaries — nothing more.
   They inherit the agent runtime's OS user; they are NOT containerized, seccomp'd
   or otherwise sandboxed by Gamos or ZCode.
2. **Actual process authority inventory (revision 2).** Until a least-privilege
   context from §3.4 is explicitly applied, an MCP server process spawned by the
   agent runtime effectively has, under the OS user account:
   - **Filesystem:** full read/write access to everything the OS user can touch —
     the session workspace, the user's home directory (`~/.zcode` included: provider
     configuration with stored API keys, session data, plugin storage), and any
     other user-readable path. There is no path allow-list for MCP processes.
   - **Network:** unrestricted outbound and loopback network access — internet
     hosts, localhost services, and the local agent/broker endpoints. There is no
     egress filtering for MCP processes.
   - **Environment:** the full spawn environment (the agent runtime environment
     surface — endpoint origins, broker sockets/tokens where applicable, plus any
     plugin-declared env vars). Anything present in that environment (including
     credential-bearing variables) is readable by the process.
   This inventory is the honest disclosure baseline: Gamos-authored UI/docs MUST
   describe MCP process authority in these terms (or stricter, when §3.4 applies).
3. **Environment exposure is explicit.** The spawn env is the plugin/agent env
   surface (endpoint origins, broker sockets/tokens where applicable — see the
   cua broker env injection in `packages/services/src/node.ts`). A plugin's
   MCP server MUST be treated as potentially seeing whatever its spawn env carries;
   plugin review therefore includes env-surface inspection.
4. **Least-privilege execution strategy for community engine plugins (revision 2).**
   Community engine plugins that declare `mcpServers` MUST be executed under a
   progressively stricter regime than the baseline above:
   - **Env minimization (MUST, first shipped increment):** community MCP spawns are
     stripped to a minimal environment — plugin-declared variables plus only the
     variables the MCP transport itself requires; broker tokens, endpoint
     credentials and unrelated agent runtime secrets are withheld unless the plugin
     declares an explicit, reviewed need for them (declaration mismatch = fail
     closed at registration, per contract 02).
   - **Working-directory containment (MUST):** the process working directory is the
     plugin's own install path (or the session workspace when the plugin's declared
     function requires it), not an arbitrary user-chosen directory.
   - **Dedicated low-privilege context (SHOULD, platform-gated):** where the OS
     supports it, community MCP processes run under a dedicated, reduced-privilege
     OS context. Where the platform (or packaging) does not yet support this, the
     fallback MUST be honest disclosure + explicit user approval of FULL OS-process
     authority (§3.5) — never silent full-privilege execution.
   - **No privilege escalation by config:** a plugin cannot widen its own regime —
     env/needs declarations are review inputs, not self-granted permissions.
5. **Disclosure before install (revision 2 — reflects actual privileges).**
   Installing a plugin that declares `mcpServers` MUST surface to the user, before
   activation, that OS processes will be spawned AND what those processes can
   actually do: filesystem reach (user-account scope), network reach (unrestricted
   unless constrained), and environment inheritance (§3.2 inventory, or the §3.4
   regime when applied). The disclosure shown MUST name the regime actually in
   effect for that plugin — official/community, minimized/full — and the user's
   approval is an approval of THAT regime. "Sandboxed" wording is prohibited for
   MCP processes. External (non-marketplace) MCP servers configured by the user are
   the user's own trust decision, recorded as such.
6. **Provenance is stricter for process-carrying plugins.** Marketplace sha256
   verification is required at install and re-verified on update (existing
   behavior — verified by the real jupyter-notebook install). For plugins
   declaring `mcpServers`, provenance MUST additionally identify the exact server
   entry points and the review that covered them (§4 `reviewRef`).
7. **Disable on unresolvable provenance.** A plugin whose provenance cannot be
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
                                    // community/mcp-carrying plugins, §3.6)
}
```

MUST rules:
1. Every capability and engine plugin carries a provenance ref; unprovenanced
   declarations MUST be rejected at registration (fail closed).
2. Community plugins declare `requiresDisplayServer`/permissions honestly; UI
   components run in the renderer sandbox (§2.1) and MCP components as OS
   processes under the §3 model — with the §2.5 approval/access distinction and
   the §3.4 least-privilege regime applied to community `mcpServers`.
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
