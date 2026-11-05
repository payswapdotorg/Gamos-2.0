# Gamos Phase-0 Contract 06 — Permission & Approval Mapping

- Status: **FROZEN (Phase 0, revision 2)** — hash-protected governance control file
- Owner: Gamos TL
- Revision 1 (GAMOS-AUTH-0003): all native engine mutations routed through
  permission-gated ZCode execution, and repository-governance authorization separated
  from the user's game-release/publishing authorization (architect re-review
  correction D).
- Revision 2 (GAMOS-AUTH-0004): **approval layers distinguished** — capability-invocation
  approval (this contract's permission gate) is explicitly NOT a grant or description
  of plugin/MCP OS-process authority; cross-references contract 09 §2.5 (architect
  M0-closure correction B).

## 1. Principle

Gamos reuses the **existing ZCode permission system** end-to-end: agent tool permissions
(`permission` records in the agent store), the composer's "Ask before changes" mode, the
CUA permission broker surfaces (`packages/services/src/cua-permission-broker/`), and the
Gamos governance ledger for repository-level authorization (ADR-0002/0004).
**No second permission system.**

## 2. Permission spec (schema `gamos/permission@2`, used by capability records)

```ts
type PermissionSpec =
  | { kind: "fs-write";     paths: string[] }                 // agent file tools
  | { kind: "exec";         command: string }                 // terminal/exec engine CLI
  | { kind: "network";      hosts: string[] }                 // engine package/asset fetches
  | { kind: "engine-headless"; engineFamily: EngineFamily }   // batch/headless engine run
  | { kind: "engine-gui";     engineFamily: EngineFamily }    // requires display server
  | { kind: "artifact-publish"; scope: "workspace" | "release" };
```

MUST rules:
1. Every capability declares its permission kinds; the dispatch layer checks them
   against the session's existing permission state before invoking the tool.
2. `engine-gui` implies `engine-headless` is insufficient — when no display server is
   available the capability MUST resolve to unavailable (contract 07), not silently
   downgrade.
3. **All native engine mutations are routed through permission-gated ZCode execution**
   (revision 1). Native engine processes (Unity batch, Blender headless, Babylon CLI,
   engine SDK tools) are invoked ONLY as agent tool executions that pass the existing
   permission gate (`exec`/`engine-*` kinds, `permission` records as the audit trail).
   Engine binaries are never invoked by Gamos-side background daemons, plugin code
   outside the gated path, or the renderer. This holds for mutations performed inside
   Dynamic Workflow runs as well (workflow sites resolve to the same gated tools).
4. Approval UI = the existing permission prompts (plus the workflow confirmation
   window, contract 05 §4); approval audit = existing permission records.
5. **Approval layers are distinct (revision 2).** An approval issued through this
   gate authorizes a **capability invocation** — an agent tool call — and nothing
   else. It MUST NOT be read, presented, or recorded as (a) a grant of OS-process
   authority to any plugin/MCP server involved behind the tool (that authority is
   governed and disclosed separately — contract 09 §2.5/§3), or (b) a repository-
   governance authorization (§3). Permission prompts that surface plugin-backed
   tools MUST reflect the actual process privileges of the backing plugin where
   contract 09 §3.5 requires disclosure. Gamos adds no second approval semantics —
   this rule only clarifies what the existing approval does and does not cover.

## 3. Repository governance authorization vs game-release/publishing authorization
   (revision 1 — MUST keep separate)

Two distinct authority domains that MUST NOT be conflated:

| Domain | What it authorizes | Authority |
|---|---|---|
| **Repository governance** | Changes to protected repository surfaces (baseline tree, governance controls, contracts) | The Gamos governance ledger (`.gamos-authorized-modifications.json`, complete v2 entries, CODEOWNERS + rulesets — ADR-0002/0004) |
| **Game release/publishing** | A USER publishing/releasing their game artifacts (builds, packages) to distribution channels (PlayLiquid delivery conventions, PaySwap-monetized channels) | The user's own publishing authorization on the target platform — e.g. PaySwap account scopes/entitlements. PaySwap remains the financial authority |

Rules:
1. `artifact-publish: release` resolves against the **user's publishing authorization**
   (platform account scope), NOT against the repository governance ledger. An in-app
   approval can never grant repository-governance powers, and a governance ledger entry
   never implies publishing entitlement.
2. In-app approvals authorize agent actions in the workspace/session (existing
   semantics); they never weaken repository governance (protected files stay governed
   by the ledger + rulesets regardless of any in-app approval).
3. Publishing flows record their authorization evidence in the artifact evidence
   contract (08): who authorized (account identity), scope, and channel — separate
   fields from any repository decision references.

## 4. Governance interlock

- Worker PRs touching protected surfaces require CODEOWNERS review + required status
  checks (rulesets 26558836/26558837 — active).
- In-app approvals never weaken repository governance: they authorize agent actions in
  the workspace, not changes to protected files.
