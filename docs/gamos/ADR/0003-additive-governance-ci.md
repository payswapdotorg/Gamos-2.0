# ADR-0003 — Additive governance CI

- **Status:** Accepted (2026-11-04)
- **Deciders:** Gamos TL
- **Context:** The handoff requires CI that prevents accidental destruction of
  inherited functionality (deleted protected files, replaced shell modules,
  changed runtime semantics, removed composer controls, duplicate
  infrastructure…). Upstream at the pinned baseline ships **no `.github/`
  CI at all** — any CI we add is a new surface and must stay additive.
- **Decision:** add exactly two new surfaces:
  1. `scripts/gamos/governance-check.mjs` — dependency-free Node script that:
     - verifies the pinned baseline SHA is an ancestor of HEAD;
     - verifies the repository is not missing protected files recorded in
       `.gamos-protected-surfaces.json`;
     - computes files **deleted** relative to the baseline and fails for any
       protected-path deletion not covered by an authorization entry;
     - lists modified protected files lacking authorization entries (fail,
       with the exact entry format to add).
  2. `.github/workflows/gamos-governance.yml` — runs the verifier on every push
     and pull_request touching Gamos branches, plus (in a separate job) the
     upstream architecture gate `pnpm run architecture:check` after a pnpm
     install, so upstream's own module rules keep applying.
- **Consequences:** governance runs identically locally and in CI; no upstream
  file is modified to obtain it; heavier semantic gates (composer-control
  presence, permission behavior, marketplace reachability) will be added to the
  same script as the implementation progresses, each with real tests.
