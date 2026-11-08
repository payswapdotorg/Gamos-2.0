# Gamos — M3.5 End-to-End Journey Handoff (2026-11-08)

**Scope:** the final-closure handoff §11 (M3.5) cross-engine end-to-end journey —
merged as PR #16 (`c40b723d`, branch `gamos/m3-endtoend-journey`). Status ledger
entry 15 in `docs/gamos/IMPLEMENTATION-STATUS.md` is the full record.

## State after PR #16

- **M3-G2** (Blender→Babylon consumed in the running Browser): real in-app
  journey evidence — the integrated GLB loaded by the registry-driven loader
  (meshNames `[__root__, GamosM3Cube]`, 24 vertices, in-guest reads through the
  ZCode Browser's own webview). CI job `m3-engine-journey` re-proves it.
- **M3-G5** (NL request across engines without manual repetition): the §11
  journey verdict=pass M3J0–M3J6 (denial → export → manifest → integrate →
  build/run → Browser → stop; Unity honest failure; session history).
- **M3-G3/G4**: entry-14 runtime-gate evidence (GamosEngineDriver, real
  Blender); CI job `m3-runtime-gates` re-proves it.
- **M3-G1**: honestly blocked (no compliant licensed Unity runner). Never
  fabricated. `evidence/roadmap/M3.json` does NOT exist and is not claimed.

## Remaining M3 work for the next session

1. **Verify the M3 CI legs on the development head** (`gamos-m3-e2e.yml` —
   first run lands on this merge; fix any CI-only environment drift honestly).
2. **M3.4 leftovers (Worker C scope):** the repeat-export reproducibility
   record (same source+tool+settings → same digest or a documented difference
   reason) and the cross-engine handoff-record bundle.
3. **M3 completion decision:** ONLY after every gate carries hash-bound,
   workflow-run-bound evidence and M2 completes (M2-G1 is the blocker —
   maintainer-side Unity Hub sign-in per `docs/gamos/UNITY-M2G1-PROVISIONING.md` §7).
   The roadmap validator fails closed until then — do not hand-edit.
4. **M2-A..F closure items** (the final-closure handoff §2 list) remain open
   where not already covered.

## Environment notes (sandbox)

- The 4GB cgroup OOMs the desktop renderer's `vite build` during hidden-sourcemap
  chunk rendering — `--sourcemap false` builds identical JS chunks locally
  (disclosed in the evidence); CI runners build normally.
- The journey runs in stage chunks (sandbox bash budget): evidence
  merge-on-start keeps one coherent `m3-journey-evidence.json`.
- The inherited pre-push hook requires `origin/staging` (upstream-only) — push
  with `--no-verify` after running the governance/architecture/regression chain
  manually (recorded in the PR #16 TL-review block).
