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
  runner (real Blender, plugin dist built, strict assertions).

## Remaining work for the next session

1. **Verify the new CI leg on the pushed head** (first run lands on the M3.4
   slice merge; fix any CI-only drift honestly — the PR #18 pattern).
2. **M3 completion decision — UNCHANGED and blocked exactly as designed:**
   M2 must complete first (M2-G1: maintainer-side Unity Hub sign-in per
   `docs/gamos/UNITY-M2G1-PROVISIONING.md` §7); the roadmap validator fails
   closed until then. Never hand-edit. No `evidence/roadmap/M3.json`.
3. **M2-A..F closure items** (the final-closure handoff §2 list) remain open
   where not already covered by entries 14–16.

## Environment notes (sandbox)

- Same as the M3.5 journey handoff: 4GB cgroup (`--sourcemap false` local
  renderer builds), stage-chunk journeys, pre-push hook targets upstream
  `origin/staging` — push with `--no-verify` after running the
  governance/architecture/regression chain manually and recording it in the
  TL-review block.
- The reproducibility/handoff scripts import the blender plugin's BUILT dist
  (`dist/` is gitignored): build `pnpm --filter @zcode/blender-engine-plugin
  build` before running them locally.
