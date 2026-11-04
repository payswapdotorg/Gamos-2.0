# Gamos — Milestones and Acceptance

> Binding milestone plan (from the project handoff). All milestones are required
> for the full Gamos vision; later milestones are not optional aspirations.
> Current status of each milestone is tracked honestly in
> `IMPLEMENTATION-STATUS.md`.

---

## M0 — Fork, baseline and governance

**Deliver:** clean ZCode fork · exact upstream SHA recorded · upstream remote
configured · feature preservation matrix · baseline architecture manifest ·
protected-surface policy · current UI screenshots & golden-path evidence · CI
checks · Gamos architecture documents.

**Exit criteria:** the fork builds and launches as the original ZCode
application; the original New Task controls and core navigation work; no
inherited features removed.

## M1 — Gaming domain and capability foundation

**Deliver:** pure gaming domain (`packages/gamos-domain/`) · GameIR alignment ·
capability registry · capability discovery contracts · intent model · workflow
model · security/approval mapping · project context interfaces.

**Exit:** a real project can be inspected, its available engine capabilities
discovered, and structured context given to the model. No duplicate runtime or
application shell exists.

## M2 — Unity, Blender and Babylon

**Deliver:** all three first-party engine plugins, installed and running
through the actual ZCode plugin system.

**Exit:** a real Unity project controllable through the selected model; a real
Blender scene creatable and manipulable; a real Babylon project developable and
verifiable in the existing browser.

## M3 — Cross-engine workflows

**Deliver:** Blender→Unity and Blender→Babylon asset pipelines · engine-aware
project context · dependency-aware orchestration · specialist subagents ·
resume & cancellation · evidence collection.

**Exit:** a real workflow crossing engine boundaries without the user manually
repeating integration steps.

## M4 — Godot and Unreal

**Deliver:** both engine plugins.

**Exit:** at least one representative real project workflow per engine
(preflight, discovery, modification, execution, evidence).

## M5 — Game QA and optimization

**Deliver:** real runtime test suites · visual regression · performance
baselines · repeatable benchmarks · asset validation · game-specific Review
evidence · release qualification.

**Exit:** Gamos demonstrates that a game modification works with comparable
before/after evidence.

## M6 — Durable GameOS and publishing

**Deliver:** durable world/project registry · package graph · artifact storage ·
semantic reviews · real previews · publishing · release lifecycle ·
creator/community capabilities · discovery/player experiences.

**Exit:** a user can create a real game project, produce a release artifact,
publish it and make it available to another user through a real platform flow.

## M7 — Platform and monetization

**Deliver:** multiplayer/matchmaking · replay & leaderboard services ·
achievements & integrity · community & moderation · PaySwap integration ·
creator revenue sharing · provider route discovery (existing / conditional /
opportunity) · payment execution through approved PaySwap capabilities.

**Exit:** a game uses real configured platform capabilities and completes a
verified commercial workflow in a provider sandbox, followed by a separately
authorized live-provider test.

---

## Required end-to-end journeys (binding test contract)

- **Journey A — Original ZCode parity:** launch, onboarding, New Task, model
  config, project selection, task submit, attachments/context, Browser,
  Terminal, Review, Plugin Marketplace, ordinary non-gaming task, history &
  session recovery.
- **Journey B — Unity game modification:** connect → authenticate natively →
  select real project → inspect scene → request modification → review plan →
  approve → execute → build → test → evidence → inspect result.
- **Journey C — Blender-to-Unity asset workflow:** request asset → create in
  Blender → validate → export → import into Unity → configure scene → build →
  visual & runtime evidence.
- **Journey D — Babylon browser game:** create project → implement playable
  experience → start runtime → open in ZCode Browser Use → inspect → modify →
  verify rendering/behavior.
- **Journey E — Workflow parallelism:** independent gameplay/art/test work with
  correct delegation, dependencies, no conflicting writes, progress, cancel,
  resume, integration.
- **Journey F — Payment route planning:** sandbox providers only; existing /
  conditional / opportunity discovery, cost comparison, restrictions, auth
  requirements, consent, idempotency, reconciliation. No live payments in smoke
  tests.
- **Journey G — Publishing & player experience:** world project → build →
  release validation → publish → discover → open in supported runtime → verify
  gameplay → permissions & boundaries.

## Visual QA minimums

1660×900 · 1280×800 · 480px narrow · 390×844 mobile — the existing ZCode shell
must not regress (layout, control visibility, overflow, keyboard, focus,
errors).

## Test integrity (prohibited, always)

Mocked engine availability in production paths · static fake projects ·
fabricated screenshots · simulated successful builds · pretending to
authenticate or publish · in-memory placeholders as persistent services ·
tests that pass only because errors were swallowed. When a real engine/service
is unavailable in CI, clearly separate contract tests from integration tests
and provide a reproducible integration runner.
