# Gamos — Implementation Status

> Honest, evidence-based status. No green checkmark implies completion when only
> a contract or UI exists. Updated at every integration point.
>
> **Last updated:** 2026-11-04 (M0 Phase A — governance v2 hardening, per architect review)

---

## Overall completion (verified deliverables only)

| Milestone | Verified completion |
|---|---|
| M0 — Fork, baseline & governance | Fork **complete & verified**; governance v2 (Phase A) **complete pending CI execution evidence** (recorded below when the run finishes); inherited-application verification (Phase B) **not started** |
| M1–M7 | 0% (not started; frozen until M0 acceptance) |

## Architect-review phase tracker

| Phase | Scope | Status |
|---|---|---|
| A — Repair governance | Tamper-resistant controls, complete authorization schema, failure-case tests, real Actions run | **Delivered locally (verifier + 13/13 self-tests green); CI run in flight — evidence recorded below on completion** |
| B — M0 application verification | Frozen-lockfile install, build + launch original ZCode, golden paths, screenshots, regression tests | Not started (next work package) |
| C — Freeze Phase-0 architecture contracts | 9 contract areas, using existing ZCode infrastructure only | Not started |
| D — Prepare workers A/B/C | Briefs, evidence requirements, DoD | Not started |

## Requirement ledger

| Requirement | Implementation | Contract | Tests | Execution & results | Limitations | Commit |
|---|---|---|---|---|---|---|
| Fork zai-org/ZCode with full history into payswapdotorg/Gamos-2.0 | **Complete & pushed** — remote refs verified: `main` @ `a9fe401e…` (identical to upstream), `feat/ui-plugin` @ `662c30be…` (identical), tags `v3.14.3`/`v3.15.1`/`v3.17.1`/`v3.17.2` (identical), full 9-commit history | `docs/gamos/UPSTREAM-BASELINE.md` §3, §7 | n/a | `git ls-remote` fork + upstream diff = zero divergence; REST API `default_branch: main` ✓ | — | `8f2d0252` |
| Working branch from pinned baseline | `gamos/development` created at `a9fe401e…`, **pushed** (carries M0 governance commits, additive-only) | handoff §2.1 step 7 | n/a | `git ls-remote` shows `refs/heads/gamos/development` ✓ | — | `8f2d0252` |
| **A1: Tamper-resistant governance controls** | Governance v2: control files hash-protected (`baseline.controls`), workflow trust-anchor pin (`GAMOS_BASELINE_SHA256`), tag cross-check, history-rewrite guard | `.gamos-protected-surfaces.json` v2; `.gamos-architecture-baseline.json` v2; ADR-0004 | `scripts/gamos/governance-self-test.mjs` | Verifier green locally with pin (`trust anchor: verified`, 6 control hashes verified). 13/13 self-test scenarios pass locally. CI run executing; URL + job results recorded in `evidence/phase-a/` on completion | Scheduled daily verification is **dormant** while `main` remains the pristine upstream mirror (GitHub only runs `schedule` from the default branch, which intentionally does not carry Gamos files); push/PR triggers cover all active branches | this commit |
| **A2: Complete authorization schema validation** | `gamos/authorization@2`: requester, rationale, risk, affected/new functionality, regression tests, evidence links, per-file `content_sha256`, structured `tl_approval {approved, approver, date, decision_ref}` bound to `baseline.governance.approvers`. Entries failing any check grant **no** authorization | `.gamos-authorized-modifications.json` v2 (first complete entry `GAMOS-AUTH-0001` documents this hardening) | Self-test scenarios 9, 10, 12 | Truthy-only `tl_approval` rejected (scenario 9) ✓; incomplete record rejected (10) ✓; content drift rejected (12) ✓ | — | this commit |
| **A3: Deliberate failure cases tested** | 13-scenario tamper-rejection suite covering all 8 required cases + 3 additional (forged baseline w/o pin, truthy-only, drift) + 2 control cases (pristine, complete evidence) | ADR-0004 §7 | `scripts/gamos/governance-self-test.mjs` | **13/13 pass locally** — unauthorized modification (2), deletion (3), missing protected file (4), modified baseline SHA (5), weakened verifier (8), modified protected-surface list (7), incomplete authorization (9, 10), authorized change with complete evidence accepted (11), history rewrite (13) | CI execution pending (job `self-test`) | this commit |
| **A4: Real GitHub Actions run** | Workflow v2: `governance` (pinned verifier) + `self-test` (tamper suite) + `architecture` (upstream gate) on push/PR | `.github/workflows/gamos-governance.yml` | the workflow itself | M0 v1 runs already green at `8f2d0252` and `db44fcfa` (v1 workflow, 2 runs); **v2 run for this commit in flight — run URL, SHA, job results and logs to be recorded in `evidence/phase-a/` immediately on completion** | — | this commit |
| **A1: CODEOWNERS + enforced reviews/checks** | `.github/CODEOWNERS` (TL owns governance paths + default); branch rulesets planned immediately after the CI run registers the check contexts | `.github/CODEOWNERS`; ADR-0004 §8 | ruleset API response recorded in `evidence/phase-a/` | Rulesets are created via API right after this push so required status checks reference the real check names; URLs recorded below | — | this commit |
| Feature preservation matrix | `docs/gamos/FEATURE-PRESERVATION-MATRIX.md` (32 features, verified source anchors) | this repo | governance-check passing | source anchors verified by inspection at baseline; verifier passing locally & in CI config | — | `8f2d0252` |
| Architecture docs | `docs/gamos/ARCHITECTURE.md` (verified upstream topology + clearly-marked planned additions) | this repo | n/a | direct source survey at baseline | — | `8f2d0252` |
| ADRs for frozen decisions | `docs/gamos/ADR/0001…0004` | this repo | n/a | authored | — | this commit |
| Fork builds & launches as original ZCode | **not yet verified** (Phase B) | M0 exit criterion | — | — | required: frozen-lockfile install + launch + Journey-A golden-path evidence; next work package | — |
| Current UI screenshots & golden-path evidence | **not yet produced** (Phase B) | M0 deliverable | — | — | depends on the build/launch step above | — |

## Governance v2 control files (hash-bound this commit)

`control_files` (sha256 in `baseline.controls`, verified by CI with the workflow trust anchor):
`.gamos-protected-surfaces.json`, `.gamos-authorized-modifications.json`,
`scripts/gamos/governance-check.mjs`, `scripts/gamos/governance-self-test.mjs`,
`scripts/gamos/governance-rebaseline.mjs`, `.github/CODEOWNERS`.

Authorization `GAMOS-AUTH-0001` (complete v2 record) binds the exact content of these files; the ledger itself is protected by `baseline.controls` (self-recording its own hash would be circular — ADR-0004).

## Resolved incidents (honest report)

1. **Transient GitHub auth outage (resolved, M0 session):** for ~25 minutes both session
   PATs were rejected (`401 Bad credentials` REST / `Invalid username or
   token` git) despite being valid; the account stayed healthy. Auth recovered
   on its own; the full push then completed and was verified
   (`docs/gamos/UPSTREAM-BASELINE.md` §7).
2. **v2 verifier local iteration (this session):** first rebaseline captured a
   content hash for `governance-check.mjs` before a syntax fix landed; the
   AUTH_DRIFT check caught the stale hash exactly as designed, hashes were
   re-filled via `--fill-auto`, and the final state verified clean. This was
   the content-binding control working on its own operator.

## Blocked requirements

(none at present)

## New architecture decisions this period

- ADR-0001: pinned upstream baseline + Gamos-2.0 destination (mirror push fork).
- ADR-0002: preservation boundary & authorized-modification workflow.
- ADR-0003: additive governance CI (baseline ancestry + protected-surface
  verifier), reusing upstream's architecture gate.
- **ADR-0004: governance v2 — tamper-resistant controls** (hash-protected
  control files, workflow trust anchor, authorization schema v2 with content
  binding, sanctioned rebaseline path, tamper-rejection self-tests, CODEOWNERS
  + rulesets, honest threat model).

## Regression results

Baseline untouched: zero modifications to upstream-tracked files (all Gamos
sessions to date only added new files; `git diff a9fe401e..HEAD --diff-filter=M`
= empty). Upstream regression suites not yet executed (requires install/build —
Phase B work package).

## Remaining risks

- GitHub auth edge showed a transient multi-token outage; if it recurs, wait it
  out and retry (verified recovery pattern) before assuming token revocation.
- Upstream moves independently (sync-commit model); baseline pin + governance
  checks protect against silent divergence.
- A fully-consistent forged governance state is only addressable by branch
  rulesets + review, not by in-repo hashing (ADR-0004 threat model).
- Desktop build/E2E inside the dev sandbox has not been exercised yet (Phase B).

## Next work package

1. **Phase B (in order):** `pnpm install --frozen-lockfile`; build + launch the
   original ZCode application; verify the New Task interface and inherited
   controls; exercise the golden paths (onboarding, model/provider
   configuration, New Task + submission, attachments/context, browser,
   terminal, review, plugin marketplace, ordinary non-gaming task, history and
   session recovery); capture screenshots and reproducible evidence; run the
   applicable inherited regression tests; update this document with actual
   evidence.
2. Phase C: freeze Phase-0 architecture contracts (9 areas) as hash-protected
   control files.
3. Phase D: worker A/B/C briefs; only then authorize M1/M2 implementation.
