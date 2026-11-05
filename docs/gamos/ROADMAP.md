# Gamos Roadmap — normative index

**Normative source:** [ROADMAP.json](./ROADMAP.json). This is the only normative
record of product scope, M0–M7 order, dependencies, phase status, owners,
acceptance gates and phase completion. Do not maintain a second milestone
checklist or phase-status table in Markdown.

## Product destination

Gamos evolves the existing ZCode application into a gaming-specialized
development harness. Users continue to work in the original New Task composer
and with their selected model. Gamos adds gaming-domain context, real engine
integrations, cross-engine workflows, QA, packaging, publishing and platform
capabilities without replacing ZCode's shell, runtime, model/provider system,
session/task system, permissions, plugin lifecycle or Dynamic Workflow runtime.

## Authority boundaries

| Concern | Authority |
|---|---|
| App shell, agent runtime, tasks/sessions, model/provider, permissions, plugins, Browser, Terminal, Review and workflows | Existing ZCode |
| Engine project and scene state | The respective native engine |
| GameIR semantics | PlayLiquid GameIR at the exact commit pinned in ROADMAP.json |
| GamePlan execution and journal | Existing ZCode Dynamic Workflow |
| Game publishing entitlement | User's target-platform account |
| Financial intent, routes, authorization, ledger, execution and reconciliation | PaySwap |

## Milestone dependency graph

M0 → M1 → M2 → {M3, M4} → M5 → M6 → M7

M3 and M4 become eligible independently after M2 and may run in parallel,
subject to the active-milestone limit and TL resource allocation. Current phase
states are stored only in ROADMAP.json. Readiness is derived by:

~~~bash
node scripts/gamos/roadmap-self-test.mjs
node scripts/gamos/roadmap-check.mjs
~~~

The validator prints active milestones, dependency-blocked work and the next
milestones ready to start. A planned milestone becomes ready automatically
when all of its dependencies are complete.

## How phases advance

The TL marks a milestone complete only after every required gate in ROADMAP.json
has a committed evidence file and the required CI is green on the tested commit.
The validator rejects missing gates, incomplete evidence and invalid dependency
transitions. The TL then activates any newly-ready milestone(s), up to the
configured parallel limit. No separate user phase approval is required.

Approvals that remain are real authority checks, not phase approvals: ZCode
permission prompts for native operations; user/platform authorization for
publishing; explicit authorization for live-provider or live-money movement;
and CODEOWNER/ruleset review for protected repository governance changes.

## TDD execution

See [TDD Execution Playbook](./TDD-EXECUTION-PLAYBOOK.md). Every behavior
starts with a meaningful failing test (RED), proceeds to the smallest passing
implementation (GREEN), then negative/security tests, real integration,
regression and committed evidence. Mocked engine availability, fake successful
builds, fabricated screenshots, simulated publishing and swallowed failures
are never acceptable acceptance evidence.

## Subordinate records

- PRODUCT-NORTH-STAR.md: product intent and non-negotiable rules.
- ARCHITECTURE.md: source-verified upstream topology and planned additive surfaces.
- IMPLEMENTATION-STATUS.md: factual evidence and incident ledger, not a second phase-status authority.
- MILESTONES-AND-ACCEPTANCE.md: historical handoff; superseded for normative milestones by ROADMAP.json.
- contracts/: frozen technical constraints referenced by the roadmap.
- workers/: execution assignments subordinate to the roadmap.
- evidence/roadmap/: committed gate evidence for completed milestones.
