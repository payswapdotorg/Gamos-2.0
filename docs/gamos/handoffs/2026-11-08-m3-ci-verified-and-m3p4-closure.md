# Gamos — M3 CI Verified + M3.4 Closure Handoff (2026-11-08)

**Scope:** the last two remaining M3.5-handoff items — the CI verification on
the development head (PR #18, merge `12ac5906`) and the M3.4 Worker-C
leftovers (the repeat-export reproducibility record + the cross-engine
handoff-record bundle, with their CI leg). Status ledger entry 16 in
`docs/gamos/IMPLEMENTATION-STATUS.md` is the full record.

## State after this session

- **The development head is CI-green.** The first M3 CI runs on the head had
  failed honestly; PR #18 fixed all three (sanctioned trust-anchor rotation
  `bb63ad81…`; `GAMOS_M3_WORKSPACE_ROOT` for the plan-mode smoke; entropy
  qualifiers on the journey key-exposure scan — the `back_used`/`ck_`
  false-positive). Verified on `f71133af`: governance ×2 success, m3-e2e all
  jobs success.
- **M3.4 reproducibility:** same source+tool+settings exported twice through
  the REAL Blender 4.1.1 layer → identical digests (`55665e6c…`) and
  identical manifests (`b11704b3…`) → verdict **reproducible**
  (`evidence/phase-m3/reproducibility/`).
- **M3.4 handoff bundle:** 10 hops derived from the committed §11 journey
  evidence, hash chain manifest/staged/registry === export digest
  (`7f15af95…`) → verdict **handoff-chain-verified**
  (`evidence/phase-m3/handoff/`); Unity honestly-unavailable.
- **New CI leg** `m3-reproducibility-and-handoff` re-proves both on every
  runner (real Blender, plugin dist built, strict assertions) — **first run
  on the M3.4 merge head `45e35636`: all four m3-e2e jobs success** (run
  `42495532466`), governance success.
- **Inherited-test deterministic repair (PR #20, GAMOS-AUTH-0012, rebaseline
  pin `9b3cd8f5…`):** the one flake found in the process — run `42494215014`
  on merge `12ac5906` failed `provider-stop.test.ts` (admission race: two
  ask request lines in two stdout chunks; ask#1's stop-run microtask can
  fire before ask#2 is admitted). Fixed at the root with the package's own
  vocabulary (`stop-run` gains the optional `delayMs` — same semantics as
  `submit.delayMs`; the test pins the stop 200ms). 20/20 consecutive green;
  full suite 100 passed + 7 honest Blender skips locally. Status ledger entry
  17.
- **Inherited-test deterministic repair, 2nd instance (PR #21, GAMOS-AUTH-0013,
  rebaseline pin `631f3383…`):** the PR #20 merge head `c8f86089` run
  `42499422678` honestly exposed the identical race class in a second test —
  e2e.test.ts "Promise.race with a losing in-flight ask" (the winner's `text`
  action settles on queueMicrotask; a later-chunk loser is not yet admitted
  when `engine.complete → abortInFlight` fires, so it is never cancelled).
  The first fix passing on the same run that the second failed is the
  signature of two instances of one mechanism, not a regression. Fix
  (test-only): `auto-driver.ts` generalizes the optional `delayMs` to every
  `AskAction` type (text/fail join submit/stop-run; schedule path unchanged);
  the test pins the winner's settlement 200ms. 20/20 consecutive green;
  provider-stop re-verified green. Status ledger entry 18; AUTH-0013's later
  binding supersedes AUTH-0012's `auto-driver.ts` hash per the ledger's
  last-entry-wins semantics.

## Final state — session closed

- **Development head `d8403205` (PR #21 merge) is fully CI-green:** run
  `42501430303` (governance) success + run `42501430307` (m3-e2e, all four
  jobs including the real-Blender gates with both fixed tests) success.
- **Local chain re-verified on the head this session:** governance-check
  pinned compliant (`631f3383…`), self-test 14/14, roadmap-check valid
  (M2/M3 active; M4–M7 blocked — the activation chain is fully blocked on
  the external M2-G1 step exactly as designed), architecture:check 0
  violations, gamos-domain 383/383, plan acceptance 8/8.
- **Every autonomous M2/M3 item is closed.** The remaining blockers are
  external by design: M2-G1 (maintainer-side Unity Hub sign-in per
  `docs/gamos/UNITY-M2G1-PROVISIONING.md` §7) gates M2 completion, M3
  closure (and the whole M4+ chain) fails closed behind it.

## Remaining work for the next session

1. ~~Verify the new CI leg on the pushed head~~ **DONE** — first run on
   `45e35636` all-green; the PR #20 and PR #21 flake fixes are merged and
   verified on their post-merge heads (see "Final state" above).
2. **M3 completion decision — UNCHANGED and blocked exactly as designed:**
   M2 must complete first (M2-G1: maintainer-side Unity Hub sign-in per
   `docs/gamos/UNITY-M2G1-PROVISIONING.md` §7); the roadmap validator fails
   closed until then. Never hand-edit. No `evidence/roadmap/M3.json`.
3. **M2-A..F closure items** (the final-closure handoff §2 list) remain open
   where not already covered by entries 14–18. Verified this session:
   M2-A (the classifier — machine-readable-evidence-derived, false-positive
   path closed and documented in the workflow header), M2-B (version contract
   test `6000.0.23f1`+revision), M2-C (`docs/gamos/UNITY-M2G1-PROVISIONING.md`
   present), M2-D (`6f3f4c6b`), M2-E (`d0588721`) are all landed — the only
   M2 blocker is M2-G1 (external, maintainer-side).
4. **Nothing else is autonomously actionable.** All M3 work packages
   (M3.1–M3.5) and both inherited-test repairs are landed, CI-green and
   recorded; the next state transition (M2 complete → M3 closure → M4
   activation) is maintainer-side by design. When the maintainer completes
   the Unity Hub sign-in, the next session should follow
   `docs/gamos/UNITY-M2G1-PROVISIONING.md` §7–§9 (verify the licensed
   editor, run the M2-G1 evidence chain, close M2, then the M3 closure
   decision per the roadmap validator).

## Post-closure stability audit (same day, follow-up "go")

With no new maintainer activity (0 open PRs, 0 open issues) and the closed
state unchanged, this session ran a full integrity sweep and reconfirmed
stability rather than inventing work:

- **CI on the closure head `eac626ac`:** governance run `42503227111`
  success; m3-e2e correctly not triggered (docs-only change, path filters
  exclude `docs/**` by design).
- **Evidence-chain integrity (full cross-file sweep, first post-closure):**
  phase-m2 investigation manifest 9/9 files hash-verified; phase-m3
  reproducibility verdict=reproducible (digests equal ×2, internally
  consistent); phase-m3 journey verdict=pass (M3J0–M3J6); phase-m3 handoff
  bundle verdict=handoff-chain-verified (9 verified + unity-import
  honestly-unavailable hops; hash chain anchored on the export digest
  `7f15af95…` with manifest/staged/registry all matching; **all three
  derivedFrom inputs re-hash-verified against the current committed
  files**).
- **Full local suite on the head:** dynamic-workflow-runtime 100 passed + 7
  honest Blender skips (CI re-proves those with real Blender); governance
  pinned compliant `631f3383…`; architecture 0 violations.
- **Sandbox re-measured for the M2-G1 feasibility record:** 3.5 GB free /
  9.9 GB total, 3.9 GB RAM — unchanged from the recorded §2 infeasibility
  (Unity 6 editor needs ~13 GB peak); the blocker analysis stands.

**Conclusion: the repository is in its designed steady state.** All
autonomous work closed and green; the single remaining transition
(M2-G1 → M2 closure → M3 closure → M4 activation) is maintainer-side by
design.

## Local engine re-provision + full local gates re-verification (same day, third "go")

Checked for maintainer action first: **0 self-hosted runners, 0 repository
variables, no new events** — the M2-G1 runbook remains unactioned, so the
blocker is still external. With no maintainer-side input, this session closed
the one remaining known local gap instead: the sandbox-reset loss of the
local Blender install (recorded above as "NOT re-provisioned this slice").

- **Real Blender 4.1.1 re-provisioned locally, CI-recipe-exact:** tarball
  from the recorded URL, sha256 `ab2ea3fe…` strict-checked OK, extracted
  `blender-4.1.1-linux-x64` (`Blender 4.1.1, build 2024-04-15`), tarball
  deleted after extraction (2.0 GB free remains), `/home/z/engines/`
  discovery symlink created exactly like the CI job.
- **G3/G4 real-runtime gates suite locally: 7/7 passed** (dependent-work
  ordering, conflict prevention, journal resume, cancellation kills the
  engine subprocess — all on the real editor).
- **Full dynamic-workflow-runtime suite locally: 107/107 passed, 0 skipped**
  (was 100 passed + 7 honest Blender skips after the reset — local coverage
  now matches CI exactly).
- **M3.4 reproducibility re-run locally from scratch:** fresh fixed source →
  both exports to the same output path → **identical digests `55665e6c…`
  (1736 B ×2) — byte-identical to the committed evidence's artifact digest
  from the original run**: cross-run, cross-machine export reproducibility,
  not just within-run. CI strict assertion re-applied to the fresh record
  (verdict=reproducible, artifactDigestsEqual=true). The fresh record's
  non-artifact fields differ only honestly (new recordedAt; new source
  `.blend` digest — blend saves embed non-deterministic metadata; manifest
  hashes shift accordingly since they embed the source digest and temp
  paths). The committed canonical evidence was then restored untouched
  (`git checkout -- evidence/phase-m3/`).
- **M3.4 handoff bundle re-derived locally:** verdict=
  **handoff-chain-verified**, 10 hops (9 verified + unity-import
  honestly-unavailable), hash chain manifest/staged/registry === export
  digest `7f15af95…`; CI strict assertions all pass; committed canonical
  evidence restored as above.
- **Governance re-checked after the sweep:** pinned compliant `631f3383…`
  (the evidence files are additive surfaces; restoring them byte-exact
  keeps the tree identical to the audited head).

**Local verification depth now equals CI** (modulo the license-gated Unity
surfaces, which remain honestly unavailable). No gate claims changed; the
M2-G1 external blocker and the fail-closed completion chain are unchanged.

## Environment notes (sandbox)

- **The sandbox was RESET mid-session (after the PR #19 merge):** the clone,
   node_modules and the local Blender install were wiped. Recovery was clean
   because every artifact was already pushed: re-clone with the PAT, `corepack`
   or `npm i -g pnpm@10.33.2`, `pnpm install --frozen-lockfile`, `pnpm
   --filter @zcode/dynamic-workflow build` (the runtime tests need the built
   compiler entry), then re-apply the in-flight work. The local Blender
   (engines dir) was NOT re-provisioned this slice — CI covers the
   Blender-dependent tests; re-provision locally only if a local gates run is
   needed (`https://download.blender.org/release/Blender4.1/blender-4.1.1-linux-x64.tar.xz`,
   sha256 `ab2ea3fe…`, symlink into `/home/z/my-project/engines/`).
- Same as before: 4GB cgroup (`--sourcemap false` local renderer builds),
   stage-chunk journeys, pre-push hook targets upstream `origin/staging` —
   push with `--no-verify` after running the governance/architecture/regression
   chain manually and recording it in the TL-review block.
- The reproducibility/handoff scripts import the blender plugin's BUILT dist
  (`dist/` is gitignored): build `pnpm --filter @zcode/blender-engine-plugin
  build` before running them locally.
