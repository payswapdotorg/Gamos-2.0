# Worker B — Gaming Domain, Capability Registry, Intent & Workflow Integration

- Reports to: Gamos TL · Branch: `gamos/worker-b` (TL-reviewed PRs)
- Authorization: M1 scope activates ONLY after M0 acceptance

## Scope

Deliver `packages/gamos-domain` (new additive package): GameConcept/GameSpec(GameIR)/
GamePlan types + zod schemas (contract 01); the capability registry data + validation
(contract 02); intent classification vocabulary and GamePlan builder (contract 05);
availability evaluation logic (contract 07); artifact/evidence record builders
(contract 08).

## MUST deliver per PR

1. Source changes + commit SHA (additive; new package only).
2. Contract references per change (contracts are hash-protected control files — cite
   clause ids).
3. Tests + actual results: schema round-trips, invalid-version rejection, invalid
   capability fail-closed behavior, plan-level unavailable-state handling
   (a plan step referencing an unavailable capability MUST pause with an explicit state).
4. Real integration evidence: at least one end-to-end GamePlan executed through the
   **existing agent task system** (ordinary conversation + tool calls), with the
   model-io rollout as evidence — no second runtime.
5. Explicit unavailable/conditional states for anything not yet backed by a real
   engine plugin (registry entries may exist only with `unavailable` availability +
   provenance; never fake availability).

## Boundaries

- The domain package is data + schemas + pure logic. It MUST NOT spawn processes,
  open sockets, or register new UI. Dispatch happens through existing tools.
- Registry content changes are TL-reviewed (CODEOWNERS default `*`).

## Definition of done

All schemas versioned and fail-closed; registry + availability + plan builders tested;
one real agent-executed GamePlan evidence bundle; zero protected-surface modifications.
