# Gamos Phase-0 Contract 05 — Intent & Workflow Orchestration

- Status: **FROZEN (Phase 0)** — hash-protected governance control file
- Owner: Gamos TL

## 1. Principle

User intent ("make me a tower-defense prototype in Unity") is resolved into a
**GamePlan** executed by the **existing agent turn loop and workflow machinery**
(the CLI store already ships `workflow_definition`, `workflow_run`, `workflow_activity`,
`workflow_event` tables; the UI ships Automations). Gamos adds domain vocabulary,
not a second workflow runtime.

## 2. Intent resolution flow

```
User message (New Task composer or CLI prompt)
  → intent classification (data-only; may be model-assisted in-conversation)
  → GameConcept (contract 01)
  → GameSpec normalization
  → GamePlan = ordered capability steps + acceptance checks
  → executed as normal agent turns with capability tool calls (contract 02)
```

MUST rules:
1. Every step of a GamePlan is an ordinary agent action (tool call or message) —
   auditable in the existing conversation/rollout records (verified model-io JSONL).
2. Plan-level state (pending/running/done/failed per step) is stored via the existing
   workflow tables when a plan is registered as a workflow — no new store.
3. Long-running engine steps (build/export/render) MUST stream progress as ordinary
   tool events and remain resumable after process restart (session persistence verified).
4. If a capability is unavailable (contract 07), the plan MUST pause with an explicit
   user-facing unavailable state — never mock success.

## 3. Approval gates

Steps whose `permissions` include an approval requirement (contract 06) integrate with
the existing "Ask before changes" / permission-prompt flow (composer control verified;
`permission` table exists in the CLI store). No parallel approval UI.

## 4. Automations alignment

Gamos recurring game-ops (nightly builds, asset re-imports) are configured through the
existing **Automations** hub — no new scheduler.
