# ADR-0004: Governance v2 — tamper-resistant controls

- Status: Accepted (2026-11-04)
- Deciders: Gamos Tech Lead (payswapdotorg), per architect review directive "Phase A — Repair governance"
- Context: M0 governance gate (ADR-0003) accepted a truthy `tl_approval` field as authorization and did not protect the governance control files themselves. An actor with push access could weaken the verifier, shrink the protected-surface list, or forge approvals without detection.

## Decision

Upgrade the governance gate to **v2** with a layered, content-addressed trust chain:

1. **Control files are hash-protected.** `.gamos-protected-surfaces.json` `control_files` lists every governance control file; `.gamos-architecture-baseline.json` `controls` records each one's sha256. The verifier recomputes and compares on every run — any change to a control file without re-baselining is rejected (`CONTROL_HASH`).
2. **Trust anchor.** The workflow (`.github/workflows/gamos-governance.yml`) pins `GAMOS_BASELINE_SHA256 = sha256(.gamos-architecture-baseline.json)` and passes it to the verifier (`PIN_MISMATCH` otherwise). The workflow cannot record its own hash inside the baseline it anchors — that is circular; instead the workflow is owned by CODEOWNERS and branch rulesets.
3. **Authorization schema v2** (`gamos/authorization@2`). A record is COMPLETE only with: id, phase, ISO-8601 dates, requester `{login, role}`, rationale, risk, affected/new functionality, regression tests, evidence `{summary, links}`, per-file `changes[] {action, path, content_sha256}`, and a structured `tl_approval {approved: true, approver, date, decision_ref}` whose approver is listed in `baseline.governance.approvers`. A truthy `tl_approval` value alone is rejected (`AUTH_SCHEMA`); an entry failing ANY check grants no authorization at all.
4. **Content binding.** Every authorized change is bound to the sha256 of the approved content (`AUTH_DRIFT` if the tree diverges). An authorization cannot be reused for different content.
5. **Baseline immobility.** `baseline.pinned_sha` must resolve to the recorded upstream tag (`BASELINE_TAG_MISMATCH`) and be an ancestor of HEAD (`HISTORY_REWRITE`).
6. **Sanctioned change path.** `scripts/gamos/governance-rebaseline.mjs` is the only supported way to rotate control hashes and the trust-anchor pin; it refuses self-referential ledger entries and self-verifies the new state. Legitimate rotation = complete authorization entry + rebaseline + TL-reviewed PR.
7. **Tamper-rejection self-tests.** `scripts/gamos/governance-self-test.mjs` builds synthetic repositories and proves the verifier rejects: unauthorized upstream modification; unauthorized deletion; missing protected file; modified baseline SHA; forged baseline without pin; weakened verifier; modified protected-surface list; truthy-only approval; incomplete records; content drift; history rewrite — and accepts pristine state and a fully-evidenced authorized change. Runs in CI on every push/PR and daily (`schedule`).
8. **CODEOWNERS + branch rulesets.** `.github/CODEOWNERS` assigns governance paths to `@payswapdotorg`. Rulesets enforce required code-owner reviews, required status checks (all three workflow jobs), and block force-pushes/deletions on `main` and `gamos/**`. The TL automation identity holds bypass on `gamos/**` only; `main` has no bypass and remains the pristine upstream mirror.

## Honest threat model

- In-repo hashing defeats **single-point and stale-authority tampering**: editing the verifier, surfaces, ledger, CODEOWNERS, or baseline without a fully consistent re-baseline is always rejected.
- An actor able to produce a *fully consistent* forged state (re-baseline + re-pin together) is not detectable from repository content alone. That class is addressed by **branch rulesets** (no direct pushes except the audited TL bypass identity; required reviews; required checks) and the **daily scheduled verification**. This is the standard content-addressing + review layering; we state it explicitly rather than overclaim.
- The `pnpm run architecture:check` job keeps upstream's own module/layering governance applying unchanged.

## Consequences

- Every legitimate governance change now touches control files in one atomic, reviewed change set and rotates the pin — slightly heavier process, by design.
- Workers obtain authorization only through complete ledger entries; they cannot self-serve (approver must be a baseline-listed TL approver).
- All future contract freeze documents (Phase C) will be added as hash-protected control files via the same path.
