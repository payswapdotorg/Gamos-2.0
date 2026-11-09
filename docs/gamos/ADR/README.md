# Gamos — Architecture Decision Records

Decisions that freeze the Gamos architecture boundary. Changing a frozen
decision requires a documented Architecture Change Request (new ADR marked
`supersedes:`) approved by the TL.

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-pinned-baseline-and-fork-destination.md) | Pinned upstream baseline & Gamos-2.0 fork destination | Accepted |
| [0002](0002-preservation-boundary-and-authorized-modifications.md) | Preservation boundary & authorized-modification workflow | Accepted |
| [0003](0003-additive-governance-ci.md) | Additive governance CI (baseline ancestry + protected surfaces) | Accepted |
| [0004](0004-governance-v2-tamper-resistance.md) | Governance v2 — tamper-resistant controls (hash-bound controls, trust anchor, rulesets) | Accepted |
| [0005](0005-phase0-contract-revision-and-phase-b-evidence.md) | Phase-0 contract revision 1 (corrections A–E) & the Phase B sandbox-floor/CI-ceiling evidence model | Accepted |
| [0006](0006-m0-closure-contract-revision-2-and-phase-b-integrity.md) | Phase-0 contract revision 2 (M0-closure corrections A/B) & Phase B journey test integrity | Accepted |
| [0007](0007-m3-maintainer-authorized-activation.md) | M3 activation under a maintainer-authorized dependency waiver (activation only, never completion) | Accepted |
| [0008](0008-m4-activation-authorization-and-slot-gate.md) | M4 activation authorization recorded; exercise gated on an available active slot (waiver does not open one) | Accepted |
| [0009](0009-active-limit-3-policy.md) | Active-milestone limit raised to 3 by explicit maintainer policy (value change only; no dependency/waiver/completion effect) | Accepted |

Planned ADRs (to be authored with the corresponding work packages):
native engine adapters · plugin capability
discovery · MCP & UI Plugin integration · approval/execution boundaries ·
Gamos project & package persistence · asset storage ·
game previews & sandboxing · PSP route orchestration · remote engine support.
(GameIR reuse & semantic authority and Dynamic Workflow reuse are decided at the
contract layer — see contracts 01/05 revision 2 via ADR-0006. The current phase
sequence and acceptance gates are maintained only in docs/gamos/ROADMAP.json.)
