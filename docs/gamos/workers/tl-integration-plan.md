# TL Integration Plan — Roadmap and TDD Governance

The Tech Lead owns architecture, sequencing, shared contracts, integration,
permissions, security, CI, regression, evidence integrity and phase transitions.

## 1. Single source of truth

docs/gamos/ROADMAP.json is the sole normative roadmap. It owns M0–M7 scope,
dependency graph, status, work packages, owners, acceptance gate IDs and
completion evidence pointers. All other documents are explanatory/subordinate.
Do not maintain a competing phase checklist or status table.

Run from repository root:

~~~bash
node scripts/gamos/roadmap-self-test.mjs
node scripts/gamos/roadmap-check.mjs
~~~

The validator derives dependency-ready phases. Current status is not inferred
from chat, worker messages, green checkmarks or IMPLEMENTATION-STATUS.md prose.

## 2. Integration flow

Worker A/B/C branches (gamos/worker-a, gamos/worker-b, gamos/worker-c)
  → focused PRs to gamos/development
  → source-level TL review and required CI
  → TL integrates; main remains the pristine upstream mirror.

The existing required Upstream architecture gate must run:
- pnpm run architecture:check
- node scripts/gamos/roadmap-self-test.mjs
- node scripts/gamos/roadmap-check.mjs

The existing Governance and Governance self-test jobs remain required. Do not
weaken or replace CODEOWNERS/ruleset enforcement. Contract/governance control
changes still use the complete authorization + rebaseline procedure.

## 3. TDD integration contract

Every vertical slice follows:
RED (test-only failing proof) → GREEN (minimal implementation) → HARDEN
(negative/security cases) → INTEGRATE (real authority) → REGRESSION
(focused + inherited) → EVIDENCE (reproducible committed record).

Reject PRs that have tests only after implementation, unexplained skipped tests,
faked engine/service success, missing negative tests, hidden feature regressions,
or claims without source and CI evidence. Use the PR template.

## 4. Autonomous phase advancement — no user approval loop

The TL does not ask the user to approve the next planned milestone. After all
required gates for a milestone pass, the TL:
1. verifies each gate's actual CI/run and committed artifacts;
2. creates evidence/roadmap/M<n>.json with exact gate results;
3. sets status=complete and records the evidence pointer/tested commit/workflow run
   in ROADMAP.json;
4. reruns roadmap-self-test and roadmap-check; waits for required CI on that
   completion commit to pass;
5. activates any now-ready milestone(s), up to parallel_active_milestones_max;
6. assigns vertical work packages to A/B/C and continues.

No user phase-approval checkpoint exists between M0 and M7. A failure blocks the
phase and its dependents; fix the earliest failing gate and rerun it. If M3 and
M4 become ready together after M2, the TL may activate them concurrently within
the limit and coordinate integration.

Only these events require separate authorization: native engine mutations via
ZCode permissions; release/publishing via the user's platform account entitlement;
live money movement via explicit user/provider authorization; protected repository
or frozen-contract changes via CODEOWNER/ruleset governance.

## 5. TL-owned surfaces and review

- Shared contracts, cross-worker interfaces, registry policy, architecture and
  authority boundaries.
- Security: plugin provenance, MCP OS-process privileges, permissions,
  filesystem/network/environment access, and safe process invocation.
- Concurrency: isolated branches, bounded PRs, dependency graph, file ownership
  and conflict avoidance.
- Integration: inspect changed source, callers, data flow, tests, runtime behavior
  and actual CI logs; do not accept agent summaries as proof.
- Regression: architecture/gov/roadmap checks plus affected original ZCode
  composer, session, Browser, Terminal, Review, Plugin Marketplace and packaging.
- Status: update IMPLEMENTATION-STATUS.md with evidence and incidents, but update
  milestone state only in ROADMAP.json.

## 6. M0 closure and subsequent phases

M0 stays active until its six required roadmap gates pass with real evidence:
pinned baseline integrity, governance CI/self-tests, original app build/launch,
strict original-app S0–S9 journey, all inherited E2E specs including the separate
upstream-provider live test, and feature/architecture preservation.

Do not start M1/M2 broad implementation early. The validator and dependency
states release them automatically after M0 is marked complete with verified
evidence. Continue through M7 without returning to the user for phase approval.
