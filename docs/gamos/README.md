# Gamos Documentation

Governance and architecture documentation for the Gamos fork of ZCode
(payswapdotorg/Gamos-2.0), based on zai-org/ZCode v3.17.2 at
a9fe401eede6e6e5e01be9048679c206fe6f02d9.

## Normative roadmap and execution rules

- **ROADMAP.json** — sole normative source of product scope, M0–M7 milestones,
  dependencies, statuses, owners, acceptance gates and completion evidence.
- ROADMAP.md — human-readable index and explanation of how the canonical file works.
- TDD-EXECUTION-PLAYBOOK.md — binding RED/GREEN/HARDEN/INTEGRATE/REGRESSION/EVIDENCE process.
- IMPLEMENTATION-STATUS.md — factual evidence and incident ledger only. It does not
  define or independently advance milestone status.
- MILESTONES-AND-ACCEPTANCE.md — historical handoff, superseded for normative
  milestone definitions by ROADMAP.json.

Any change to milestone scope, dependencies, owner, acceptance gate or status must
update ROADMAP.json. Other documents may explain it but must not create a competing
milestone table. The roadmap validator and its self-tests run in the required
Upstream architecture gate on every governed push/PR.

## Supporting documents

| Document | Purpose |
|---|---|
| PRODUCT-NORTH-STAR.md | Product definition and non-negotiable principles |
| ARCHITECTURE.md | Source-verified ZCode topology and planned Gamos additions |
| UPSTREAM-BASELINE.md | Fork provenance and pinned baseline |
| FEATURE-PRESERVATION-MATRIX.md | Inherited-feature preservation inventory |
| contracts/ | Frozen technical contracts and authority boundaries |
| workers/ | Worker briefs and TL integration procedure |
| ADR/ | Architecture decision records |
| evidence/roadmap/ | Committed milestone gate evidence |
| evidence/phase-a/, evidence/phase-b/ | M0 governance and original-application evidence |

Machine-enforced preservation artifacts live at the repository root:
.gamos-architecture-baseline.json, .gamos-protected-surfaces.json and
.gamos-authorized-modifications.json. The original governance gate remains
scripts/gamos/governance-check.mjs.
