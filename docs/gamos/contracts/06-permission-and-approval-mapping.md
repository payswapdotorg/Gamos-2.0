# Gamos Phase-0 Contract 06 — Permission & Approval Mapping

- Status: **FROZEN (Phase 0)** — hash-protected governance control file
- Owner: Gamos TL

## 1. Principle

Gamos reuses the **existing ZCode permission system** end-to-end: agent tool permissions
(`permission` records in the CLI store), the composer's "Ask before changes" mode, the
CUA permission broker surfaces (`packages/services/src/cua-permission-broker/`), and the
Gamos governance ledger for repository-level authorization (ADR-0002/0004).
**No second permission system.**

## 2. Permission spec (schema `gamos/permission@1`, used by capability records)

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
3. `artifact-publish: release` additionally requires a governance authorization record
   (complete v2 entry — truthy approvals are rejected by design) when it modifies
   protected repository surfaces.
4. Approval UI = the existing permission prompts; approval audit = existing permission
   records + (for repo surfaces) the governance ledger with content-bound hashes.

## 3. Governance interlock

- Worker PRs touching protected surfaces require CODEOWNERS review + required status
  checks (rulesets 26558836/26558837 — active).
- In-app approvals never weaken repository governance: they authorize agent actions in
  the workspace, not changes to protected files.
