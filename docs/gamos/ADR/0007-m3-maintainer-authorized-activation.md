# ADR-0007 — M3 activation under a maintainer-authorized dependency waiver

- Status: accepted (2026-11-08)
- Deciders: repository maintainer (payswapdotorg), recorded by the Gamos TL
- Authorization: explicit maintainer session directive (verbatim quote below). No
  `GAMOS-AUTH` ledger entry and no trust-anchor rotation are required by this
  decision: no baseline-tree file and no hash-protected control file is modified
  (all touched files — ROADMAP.json, roadmap-check.mjs, roadmap-self-test.mjs,
  this ADR — are additive Gamos surfaces).
- Supersedes: none. Amends the `phase_policy` dependency rule of
  `docs/gamos/ROADMAP.json` additively via the activation-waiver mechanism
  implemented in `scripts/gamos/roadmap-check.mjs`.

## Context

M2 remains `active` with **M2-G1 honestly blocked**: the Unity licensed-editor
prerequisite is external to the repository (`docs/gamos/UNITY-M2G1-PROVISIONING.md`
§7 — maintainer eligibility attestation, an eligible Unity account with Hub
activation, and a compliant runner; activation is Unity-Hub-sign-in only, so no
credential the repository could hold would satisfy it, and none may be fabricated).
All other M2 closure items A–F are complete and merged (PR #9, `f2edf4cc`), and
`docs/gamos/M3-PREPARED-PLAN.md` records the prepared-but-not-activated M3 plan.

The roadmap's dependency policy (`phase_policy.failure_rule`: "A failed, skipped or
unevidenced required gate blocks completion and dependent phases … a later phase
cannot bypass it") is enforced structurally by `scripts/gamos/roadmap-check.mjs`:
`M3` cannot be `active` while `M2` is not `complete`.

On 2026-11-08 the repository maintainer issued an explicit directive in the
maintainer session (`web-91e004ea-7634-4944-a0e8-37dc13099d1d`, channel zai-web,
trace `1a1b9016c744baf1`):

> "you can proceed with M3"

The maintainer owns this repository's governance (the same authority that issued
the recorded "no paid Unity licenses" directive of `45b7ba12`).

## Decision

1. A milestone may become `active` before its dependencies complete ONLY through a
   complete, recorded `activation_waiver` on that milestone in `ROADMAP.json`,
   carrying exactly: `basis: "maintainer-authorized-waiver"`,
   `authorized_by: "repository maintainer"`, a parseable ISO-8601
   `authorized_at`, the verbatim maintainer `directive`, a `reason`, and a
   `reference` to a committed decision record that must exist on disk.
2. The waiver authorizes **activation only — never completion**. A milestone still
   cannot be `complete` before its dependencies complete, and every
   completion-evidence rule (per-gate passing evidence, hash-verified artifacts,
   successful workflow run bound to the tested commit) applies verbatim. M2 stays
   `active`, M2-G1 stays honestly blocked, and no `evidence/roadmap/M2.json`
   completion bundle exists or is implied.
3. The waiver is scoped per milestone and fails closed: an absent, malformed or
   unreferenced waiver leaves the original `DEPENDENCY` violation in place.
4. `scripts/gamos/roadmap-check.mjs` (an additive Gamos file, not a hash-protected
   control file) implements this rule; `scripts/gamos/roadmap-self-test.mjs` pins
   the behavior with five scenarios (valid waiver passes; unrecognized basis and
   blank required fields produce `WAIVER` + `DEPENDENCY`; completion with a waiver
   still fails with `DEPENDENCY` alone; a waived M3 does not exempt an unwaved M4
   sharing the same incomplete dependency).
5. M3 becomes `active` under this waiver with effect from 2026-11-08. M3's
   Unity-dependent acceptance gate **M3-G1 remains subject to the same
   honest-blocked rule as M2-G1**: if a compliant free Unity Personal runner is
   unavailable, M3-G1 is reported as blocked — never substituted with fixtures,
   unit-only equivalents, or claimed as complete (final-closure handoff §15).

## Consequences

- The TL begins M3.1–M3.5 per `docs/gamos/M3-PREPARED-PLAN.md` under strict TDD
  (RED → GREEN → HARDEN → INTEGRATE → REGRESSION → EVIDENCE).
- M2 completion is unaffected and remains required before M3 (or any dependent
  milestone) may complete. The parallel-active limit (`2`) still applies — M2 and
  M3 are exactly the two active milestones.
- `docs/gamos/M3-PREPARED-PLAN.md` §7 ("M3 is not set to active") is superseded by
  this ADR for the activation step only; every other prepared constraint stands.
- This ADR is the durable record referenced by
  `ROADMAP.json` → `milestones[M3].activation_waiver.reference`.
