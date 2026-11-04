# TL Integration Plan (Phase D)

The Tech Lead owns integration, architecture, permissions, shared contracts, and
regression verification (architect's directive, verbatim scope).

## 1. Integration flow

```
worker branches (gamos/worker-a|b|c)
   → PRs into gamos/development
   → required checks: Governance (baseline & protected surfaces),
     Governance self-test (tamper rejection), Upstream architecture gate
   → CODEOWNERS: @payswapdotorg reviews every PR (rulesets 26558836/26558837 active)
   → TL merges; main stays the pristine upstream mirror (no direct pushes — enforced)
```

## 2. TL-owned surfaces

- Governance controls & trust-anchor rotation (rebaseline tool + ledger entries —
  complete `gamos/authorization@2` records only).
- The nine frozen contracts (hash-protected control files under
  `docs/gamos/contracts/`); contract changes = authorization entry + rebaseline +
  reviewed PR.
- Shared type packages boundaries and cross-worker API reviews.
- Regression verification per integration: `pnpm run architecture:check`,
  `node scripts/gamos/governance-check.mjs --pin <anchor>`,
  `node scripts/gamos/governance-self-test.mjs`, plus the Phase B verification set
  (frozen-lockfile install, launch, golden-path smoke via the real app).

## 3. Acceptance gating

M1/M2 implementation is authorized only when M0 is accepted: inherited app builds,
launches, passes the required original-user journeys, and the governance controls
have been exercised in GitHub Actions (all evidenced in
`docs/gamos/IMPLEMENTATION-STATUS.md`, `evidence/phase-a/`, `evidence/phase-b/`).

## 4. Honest-reporting duties

Every integration point updates `IMPLEMENTATION-STATUS.md` with actual evidence;
unavailable/conditional states are recorded explicitly (Phase B convention);
no mocked integrations are ever merged.
