# Gamos — Historical Milestone Handoff

> **Superseded as a normative source.** The only current source of truth for
> milestone scope, dependencies, phase status, owners, acceptance gates and
> completion evidence is [ROADMAP.json](./ROADMAP.json).
>
> This file is retained for provenance of the original project handoff. Do not
> update it as a second milestone checklist or use it to determine phase readiness.

The original handoff's M0–M7 scope is now represented in ROADMAP.json, expanded
with explicit work packages, test-first requirements, acceptance gate IDs,
dependency transitions and machine-validated evidence rules.

The original end-to-end journeys A–G and visual QA targets are preserved in
ROADMAP.json under journey_acceptance and visual_regression_targets.

All implementation follows [TDD-EXECUTION-PLAYBOOK.md](./TDD-EXECUTION-PLAYBOOK.md).
The TL advances dependency-ready phases autonomously when the canonical gate
evidence passes; no routine user approval is required between phases.
