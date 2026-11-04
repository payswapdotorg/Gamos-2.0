# Gamos Phase-0 Contract 05 — Intent & Workflow Orchestration

- Status: **FROZEN (Phase 0, revision 1)** — hash-protected governance control file
- Owner: Gamos TL
- Revision 1 (GAMOS-AUTH-0003): explicit integration with the existing ZCode
  **Dynamic Workflow definition/compiler/runtime**; GamePlan orchestration is mapped
  onto that infrastructure — database tables alone are NOT a substitute for the
  workflow runtime (architect re-review correction C).

## 1. Principle

User intent ("make me a tower-defense prototype in Unity") is resolved into a
**GamePlan executed by the existing agent turn loop and the existing Dynamic Workflow
machinery**. Gamos adds domain vocabulary, not a second workflow runtime.

The authoritative workflow infrastructure (all existing, verified in-tree):

- **Definition/authoring**: workflow scripts (`/* zcode-workflow */` files), the
  authoring skill and `docs/dynamic-workflow/authoring.md` (facade: `agent`, `ask`,
  `files.*`, `git.*`, `world.run`, `report`, `artifact.*`, `phase`, `log`, prompts,
  snippet service); saved workflows live in `.zcode/workflows/` (project + global)
  and surface in the Automations hub (verified surface).
- **Compiler**: compile-time analysis — sites, the actor graph, control flow,
  diagnostics (`docs/dynamic-workflow/analysis.md`; `apps/zcode-cli/packages/dynamic-workflow`).
- **Runtime**: the execution engine (`apps/zcode-cli/packages/dynamic-workflow-runtime`;
  `docs/dynamic-workflow/execution-engine.md`): Run (`dwfrun-<uuid>`), Site
  (`ask#3`, `agent#1`), Hole (`hole<T>()` + `FillWorkflowHole`), Instance
  (`siteId@ordinal`), Subagent, Ask, World read, Node.
- **Journal**: durable run records `dwf_run`, `dwf_actor`, `dwf_node`, `dwf_event`
  (present in the verified agent store schema).
- **Model-request governor**: retry budget, model-error policy, stall clock,
  parallelism via `max_concurrency` (`docs/dynamic-workflow/concurrency.md`).
- **Transit/notifications**: `<task-notification>`, run pane, completion/question
  notifications (`docs/dynamic-workflow/transcript-and-notifications.md`;
  `WorkflowRunSidePane.tsx`, `workflowResumeGate.ts`, `useWorkflowRunJournalSummaries.ts`).
- **Launch surfaces** (`docs/dynamic-workflow/launch.md`): `CreateWorkflow` tool
  (inline `script` or `saved` source, confirmation window), `AmendWorkflow`,
  run-hub "Run" button, Configure, `/dwf resume`/`ResumeWorkflowRun`.

## 2. GamePlan = a Dynamic Workflow script (MUST)

A GamePlan is expressed as a **Dynamic Workflow script artifact** authored/compiled/
executed by the infrastructure above:

| GamePlan concern | Mapped onto existing infrastructure (MUST) |
|---|---|
| Plan steps | Workflow script sites (facade calls); capability invocations are `world.run`/agent actions inside the script |
| Dependencies | Script structure + compile-time actor/site graph (the compiler proves them) |
| Parallelism | The governor's `max_concurrency` (Configure/Amend retunes live runs) — no Gamos-side scheduler |
| Progress | Journal nodes (`dwf_node`) + run pane + transcript notifications |
| Journaling | The `dwf_*` journal (durable, crash-safe) — Gamos adds NO journal tables |
| Resume | `/dwf resume` / `ResumeWorkflowRun` / run-pane Resume (workflowResumeGate) |
| Cancellation | Run id = background task id = cancel work id (existing cancel path; capability-level semantics per contract 02 `cancellation`) |
| Failure handling | The engine's terminal states + governor model-error policy (provider stop, `ContextLimit` node failure, transient redrive) |
| Model-code extension | Holes (`hole<T>()` + `FillWorkflowHole`) where a step needs main-agent code |
| Approval gates | `CreateWorkflow` confirmation window + per-tool permission flow (§4) |

Explicit prohibitions (MUST NOT):
1. **Database tables alone are not a substitute for the workflow runtime.** The
   `workflow_definition`/`workflow_run`/`workflow_activity`/`workflow_event` tables
   referenced by the original revision are legacy/secondary surfaces; authoring a
   GamePlan as rows in those tables without the definition/compiler/runtime above
   is a contract violation.
2. No Gamos-owned step scheduler, no second journal, no second progress stream,
   no parallel cancel/resume mechanism.

## 3. Intent resolution flow

```
User message (New Task composer or CLI prompt)
  → intent classification (data-only; may be model-assisted in-conversation)
  → GameConcept (contract 01)
  → GameSpec normalization (PlayLiquid GameIR document — contract 01 §2)
  → GamePlan = Dynamic Workflow script artifact (+ acceptance checks)
  → started via the existing launch surfaces (CreateWorkflow / saved-workflow Run)
  → executed by the engine with journaling, resume, cancellation, notifications
```

MUST rules:
1. Every step of a GamePlan is an ordinary workflow site or agent action — auditable
   in the existing conversation/rollout records and the `dwf_*` journal.
2. Long-running engine steps (build/export/render) MUST stream progress as ordinary
   tool/journal events and remain resumable after process restart (engine resume
   verified concept; session persistence verified).
3. If a capability is unavailable (contract 07), the affected workflow node fails or
   pauses with an explicit user-facing unavailable state — never mock success
   (fail-closed selection per contract 02 §3).

## 4. Approval gates

Steps whose `permissions` include an approval requirement (contract 06) integrate with
the existing approval surfaces: the `CreateWorkflow` confirmation window at start, the
existing permission-prompt flow for gated tools (composer "Ask before changes" control
verified; `permission` table exists in the agent store). No parallel approval UI.

## 5. Automations alignment

Gamos recurring game-ops (nightly builds, asset re-imports) are saved workflows under
`.zcode/workflows/` configured through the existing **Automations** hub — no new
scheduler.
