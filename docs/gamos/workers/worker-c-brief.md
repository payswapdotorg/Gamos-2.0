# Worker C — GameOS, Package/Artifact Contracts, PlayLiquid Alignment

- Reports to: Gamos TL · Branch: `gamos/worker-c` (TL-reviewed PRs)
- Authorization: M1 scope activates ONLY after M0 acceptance

## Scope

Deliver the GameOS packaging layer: game project packaging & artifact contracts
(contract 08 applied to distributable outputs — builds, render bundles, export sets);
`packages/gamos-platform` (planned additive) providing packaging/report tooling as
ordinary agent tools; **PlayLiquid alignment** — mapping Gamos game packaging to the
PlayLiquid delivery conventions from the prior workstream (installer surfaces,
release channels, evidence-style acceptance) **without** reintroducing the retired
PlayLiquid sandbox console or any duplicated runtime.

## MUST deliver per PR

1. Source changes + commit SHA (additive only).
2. Contract references (esp. contract 08 artifact/evidence clauses).
3. Tests + actual results: artifact hashing, reproducibility metadata, packaging
   manifest validation.
4. Real integration evidence: a real packaged output produced through a real engine
   path where available; otherwise an **explicit unavailable/conditional state** with
   reason and remedy. No fake builds.
5. PlayLiquid alignment document updates (naming, channels, acceptance rubric) reviewed
   by the TL; the alignment lives in docs — never as a second build system.

## Boundaries

- Packaging executes through the agent's file/exec tools with the `artifact-publish`
  permission (contract 06); release-scope publishing additionally requires a
  governance authorization record.
- No new installer/electron packaging stack: ZCode's existing packaging scripts
  (electron-builder etc.) remain the only app-packaging path.

## Definition of done

Artifact contract implemented + tested; one real (or explicitly-unavailable) packaged
artifact per target family; PlayLiquid alignment doc approved; zero protected-surface
modifications.
