# ADR-0001 — Pinned upstream baseline and Gamos-2.0 fork destination

- **Status:** Accepted (2026-11-04)
- **Deciders:** Gamos TL
- **Context:** The handoff requires forking the actual `zai-org/ZCode` upstream
  (verified ZCode v3.17.2 baseline `a9fe401eede6e6e5e01be9048679c206fe6f02d9`)
  while preserving any previous Gamos attempt, and the repo owner instructed the
  destination to be `payswapdotorg/gamos-2.0`.
- **Verification performed:** live `git ls-remote` on 2026-11-04 confirmed
  upstream `main` still points at the pinned baseline; upstream also carries
  branch `feat/ui-plugin` and tags `v3.14.3`/`v3.15.1`/`v3.17.1`/`v3.17.2`.
  `payswapdotorg/Gamos-2.0` existed, was public and completely empty
  (no refs, size 0) — a clean destination with nothing to preserve or destroy.
- **Decision:** transfer the **entire** upstream repository (all branches, all
  tags, full history) into `payswapdotorg/Gamos-2.0` using
  `git clone --mirror` → `git push --mirror` (GitHub's fork API cannot rename a
  fork). Keep `origin` = Gamos-2.0 and `upstream` = zai-org/ZCode. Create the
  initial working branch `gamos/development` from the pinned baseline. Preserve
  upstream's default branch (`main`) as the fork's default branch, kept
  fast-forward-only relative to the baseline.
- **Consequences:** byte-identical history retention (tree
  `e4e4c38936b992469ddade0defc28ff6ba636622`); the fork is provably equivalent
  to upstream at the pin; upstream can be re-fetched and compared at any time.
  The mirror push is prepared and automated; completion is pending a valid
  credential (recorded transparently in `IMPLEMENTATION-STATUS.md`).
