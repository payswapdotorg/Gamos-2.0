# ADR-0009 — Active-milestone limit raised to 3 by explicit maintainer policy

- Status: accepted (2026-11-09)
- Deciders: repository maintainer (payswapdotorg), recorded by the Gamos TL
- Authorization: explicit maintainer session directive (verbatim quote below). As with
  ADR-0007/0008, no `GAMOS-AUTH` ledger entry and no trust-anchor rotation are
  required: the touched files (`ROADMAP.json` `phase_policy`, this ADR, the ADR index)
  are additive Gamos surfaces; no baseline-tree file and no hash-protected control
  file is modified.
- Supersedes: the numeric value of `phase_policy.parallel_active_milestones_max` only
  (2 → 3). Supersedes no other rule. In particular this does NOT supersede any part of
  ADR-0007/0008 (activation-only-never-completion), the dependency gating, or the
  completion-evidence rules.

## Context

`docs/gamos/ROADMAP.json` `phase_policy.parallel_active_milestones_max` has been `2`
since the fork baseline. M2 and M3 occupy both active slots. On 2026-11-09 the
maintainer directed M4 activation ("Active M4"); ADR-0008 recorded that authorization
and identified the active-slot condition as the sole remaining activation blocker,
naming exactly three compliant unblock paths — (a) complete M2, (b) an explicit policy
change to demote M3, (c) an explicit policy change to raise the limit — and stating
that paths (b)/(c) are forbidden accelerations absent their own explicit directives.

On 2026-11-09 the repository maintainer issued that explicit directive in the
maintainer session (`web-91e004ea-7634-4944-a0e8-37dc13099d1d`, channel zai-web, trace
`1a1c27c047509219`):

> "raise the active limit to 3"

The roadmap validator (`scripts/gamos/roadmap-check.mjs`) enforces the configured
value dynamically (`active.length > policy.parallel_active_milestones_max` → STATUS
violation) and validates it as a positive integer; it contains no hardcoded limit. The
roadmap self-test scenarios use self-contained fixtures (one sets its own
`parallel_active_milestones_max = 1`) and do not pin the live value. Raising the
configured value therefore requires no validator code change; the validator continues
to fail closed on any count above the configured maximum.

## Decision

1. `docs/gamos/ROADMAP.json` `phase_policy.parallel_active_milestones_max` changes
   `2 → 3` on this policy commit. Nothing else in `ROADMAP.json` changes on this
   commit — no milestone status, dependency, gate, or evidence field is touched here.
2. The third active slot is available to any roadmap-legal activation. In practice the
   next activation is M4 under the authorization recorded in ADR-0008 (its waiver
   carries the verbatim "Active M4" directive and references that committed ADR).
3. This policy change does NOT waive any dependency rule: M4 still requires its
   ADR-0008 activation waiver to become active before M2 completes, and nothing may
   complete before its dependencies complete with full evidence. It does not demote,
   weaken, or otherwise affect M2 or M3. It authorizes no completion.
4. The delivery plan §2 "forbidden accelerations" list (changing
   `parallel_active_milestones_max`) guards against UNAUTHORIZED change; this change
   is the authorized path executed in its mandated form (explicit directive + this
   committed ADR + the policy edit itself).
5. The M4 activation transition — if taken — is a SEPARATE commit per the delivery
   plan §2 step 4 and ADR-0008 decision 5: `ROADMAP.json` carrying exactly
   `M4 planned → active` plus the ADR-0008 waiver and nothing else, with the full
   local chain green on that tree and CI green on the pushed commit.

## Consequences

- The active-slot activation condition (checkpoint condition 3) becomes satisfiable:
  with M2 and M3 active, one slot remains under the new maximum of 3.
- Two-active statements in earlier documents (readiness §12, delivery plan §2,
  ADR-0008 context) describe the policy at their authoring time; for the numeric
  limit alone they are superseded by this ADR. Every other statement in those
  documents stands unchanged.
- The zero-spend mandate remains fully binding on all M4 work.
- The three preparation artifacts remain unmerged; merging remains a post-activation
  order-0 decision taken together with the activation transition.
- `docs/gamos/ADR/README.md` gains the index row for this record.
