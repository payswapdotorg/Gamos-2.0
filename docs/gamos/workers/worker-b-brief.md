# Worker B — Gaming Domain, Capability Registry, Intent & Workflow Integration

- Reports to: Gamos TL.
- Branch: gamos/worker-b; integrate through TL-reviewed PRs into gamos/development.
- Active scope and gate IDs: read docs/gamos/ROADMAP.json.
- M1 begins only after the canonical M0 acceptance gates pass.

## Scope

Deliver packages/gamos-domain as an additive pure-domain package:

- GameConcept and GameSpec, where GameSpec is exactly the PlayLiquid GameIRDocument
  from payswapdotorg/PlayLiquid-2.0, package path
  packages/playliquid-gameos/src/game-ir/, pinned commit
  196b305e75decfeaa162d3da479dc125cff1521a. No second or extended GameIR.
  Unknown versions and extra fields fail closed.
- Acceptance criteria belong to GamePlan or a separate AcceptanceRecord referenced
  by it. Never add an acceptance field to GameSpec/GameIR.
- Capability data and validation follow contract 02 revision 2, schema
  gamos/capability@2, complete execution-safety metadata and fail-closed selection.
- Intent vocabulary, project context and GamePlan builder follow contract 05
  revision 2. GamePlan is a Dynamic Workflow script artifact, executed by the
  existing ZCode definition/compiler/runtime and dwf_* journal.
- Availability, artifact and evidence models follow contracts 07 and 08.

## TDD and evidence per vertical slice

1. Add tests first for schema round-trips, invalid versions, extra GameIR fields,
   incomplete capability safety metadata and invalid state transitions.
2. Demonstrate RED before implementation, then minimal GREEN. Add negative tests
   for unknown/incompatible/unavailable capabilities, unapproved substitutions,
   missing prerequisites, provenance failures, permission denials and cancellation.
3. Execute at least one real GamePlan through an existing ZCode launch surface,
   Dynamic Workflow compiler/runtime and dwf_* journal. Demonstrate resume and
   cancellation using existing controls where required.
4. Record model/task/rollout and journal evidence with commit SHA, commands and
   artifact hashes. Use ROADMAP.json's gate IDs and evidence contract.

## Boundaries

- packages/gamos-domain is data, schemas and pure logic. It must not spawn
  processes, open sockets, register a second UI, or create another task/workflow
  runtime.
- Capability selection never uses registry order as fallback. Unknown,
  incompatible or unavailable means explicit fail-closed result.
- Registry alternatives require disclosure and approval when meaningful.
- Machine-local engine discovery is separate from shared project metadata.

## Definition of done

All required schema/registry/availability tests pass; no duplicate GameIR or
workflow runtime exists; a real model-driven GamePlan runs through ZCode Dynamic
Workflow; evidence meets the relevant ROADMAP.json gates; no protected surface is
modified without the repository governance process.
