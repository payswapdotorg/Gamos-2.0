# ADR-0008 — M4 activation authorization recorded; activation exercise gated on an available active slot

- Status: accepted (2026-11-09)
- Deciders: repository maintainer (payswapdotorg), recorded by the Gamos TL
- Authorization: explicit maintainer session directive (verbatim quote below). As with
  ADR-0007, no `GAMOS-AUTH` ledger entry and no trust-anchor rotation are required:
  no baseline-tree file and no hash-protected control file is modified by this record
  (the only touched files are additive Gamos doc surfaces).
- Supersedes: none. Records the maintainer authorization for a future M4 activation
  waiver under the ADR-0007 mechanism. It does not amend any policy, does not edit
  `ROADMAP.json`, and does not execute any activation.

## Context

M4 is `planned` / blocked in `docs/gamos/ROADMAP.json`. All permitted pre-activation
preparation is complete and remote: the delivery ledger
(`gamos/m4-delivery-plan` @ `36897b65`, CI `42660856715`), the capability contracts
(`gamos/m4-capability-contracts` @ `eebcf6b7`, CI `42703013035`), and the zero-cost
delivery record (`gamos/m4-zero-cost-delivery` @ `1312f3a9`, CI `42708486246`) —
none merged into `gamos/development`, per the branch policy of each artifact.

M2 remains `active` with **M2-G1 honestly blocked** (the Unity licensed-editor
prerequisite is maintainer-side per `docs/gamos/UNITY-M2G1-PROVISIONING.md` §7–§9);
`evidence/roadmap/M2.json` does not exist. M3 is `active` under ADR-0007.
`parallel_active_milestones_max` is `2` — M2 and M3 occupy both active slots.

The controlling zero-spend mandate (§4) and the delivery plan (§2, order 0) bind four
activation conditions: dependency satisfaction, a committed waiver ADR, **an available
active-milestone slot** (independent — "a waiver does NOT override the active-milestone
limit"), and a passing roadmap validator on the activation commit.

On 2026-11-09 the repository maintainer issued an explicit directive in the maintainer
session (`web-91e004ea-7634-4944-a0e8-37dc13099d1d`, channel zai-web, trace
`1a1c26d6ebf5ae4d`):

> "Active M4"

The TL executed the order-0 activation checkpoint on this directive this session,
including a fail-closed demonstration on a temporary (fully reverted) `ROADMAP.json`
edit: with M4 forcibly set `active` without a waiver, the validator reports BOTH
`[STATUS] active milestone count 3 exceeds configured maximum 2` AND
`[DEPENDENCY] M4 cannot be active before dependencies complete: M2`; with an
ADR-0007-shape waiver applied (referencing this ADR on disk), the `DEPENDENCY`
violation clears and the `[STATUS]` violation alone persists. Concurrency has no
waiver mechanism — by design, per ADR-0007 ("The parallel-active limit (`2`) still
applies") and the delivery plan ("condition 3 is independent — a waiver does not open
one").

## Decision

1. The maintainer's directive is recorded as the explicit authorization for an M4
   activation waiver under the ADR-0007 mechanism. When a legitimate activation
   transition becomes possible, `ROADMAP.json` → `milestones[M4].activation_waiver`
   will carry exactly: `basis: "maintainer-authorized-waiver"`,
   `authorized_by: "repository maintainer"`, a parseable ISO-8601 `authorized_at`
   (`2026-11-09`), the verbatim maintainer `directive` (`"Active M4"`), a `reason`,
   and `reference: "docs/gamos/ADR/0008-m4-activation-authorization-and-slot-gate.md"`
   (this record).
2. The waiver authorizes **activation only — never completion** (ADR-0007 rule 2
   verbatim): every completion-evidence rule applies unchanged; M4 cannot become
   `complete` before M2 completes; M2-G1 stays honestly blocked and is never
   fabricated, weakened, or substituted.
3. **This ADR does not activate M4.** Checkpoint condition 3 is unsatisfied: M2 and
   M3 occupy both active slots under the configured maximum of 2, and a waiver does
   not open a slot. `docs/gamos/ROADMAP.json` is untouched by this record — M4
   remains `planned` in the normative roadmap, and no milestone status changes.
4. The activation exercise waits on exactly one of three compliant paths, none of
   which this ADR takes: (a) **M2 completes** with its full per-gate evidence bundle
   (`evidence/roadmap/M2.json`, green CI on the tested commit) — the intended route,
   freeing the M2 slot so M4 activates alongside M3; (b) an **explicit maintainer
   policy change to demote M3**, with its own ADR and updated validators; (c) an
   **explicit maintainer policy change to raise `parallel_active_milestones_max`**,
   with its own ADR and updated validators. Paths (b)/(c) are forbidden accelerations
   absent their own explicit directives (delivery plan §2, zero-spend mandate §4.3).
5. No M4 production implementation begins under this ADR alone. Implementation begins
   only after the activation commit — a `ROADMAP.json` edit carrying exactly
   `M4 planned → active` plus the waiver of rule 1 and nothing else (delivery plan §2
   step 4), with the full local chain green on that tree and CI green on the pushed
   commit (checkpoint condition 4).

## Consequences

- Activation checkpoint conditions 1 and 2 are now satisfied in their mandated form
  (explicit maintainer authorization + this committed ADR). The **sole remaining
  blocker is condition 3: no free active slot.**
- This ADR is the durable record of the authorization so it survives sandbox resets
  (chat context does not survive; the repository does).
- When path (a) completes M2, the TL executes the delivery plan §2 steps 4–6
  immediately: the activation commit, the full local chain, the push, CI green, then
  order 1 opens.
- The zero-spend mandate remains fully binding on all M4 work after activation.
- Nothing here merges the three preparation artifacts; merging remains a post-
  activation order-0 decision taken together with the activation transition.
- `docs/gamos/ADR/README.md` gains index rows for ADR-0007 and this record (0007 was
  missing from the index — an additive docs fix).
