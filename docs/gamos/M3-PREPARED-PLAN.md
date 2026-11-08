# Gamos M3 — Prepared Implementation Plan (ACTIVATED 2026-11-08 under ADR-0007)

> **Authority note (binding):** This document is a PREPARED EXECUTION PLAN,
> subordinate to `docs/gamos/ROADMAP.json` (the sole milestone authority), the
> frozen contracts under `docs/gamos/contracts/`, and repository governance.
> **M3 became `active` on 2026-11-08** through the maintainer-authorized
> activation waiver recorded in `ROADMAP.json`
> (`milestones[M3].activation_waiver`) and `docs/gamos/ADR/0007-m3-maintainer-authorized-activation.md`.
> The waiver authorizes activation only — never completion: M2 remains `active`
> with M2-G1 honestly blocked, and every M3 completion rule below applies
> verbatim (an M3 completion bundle still requires M2 complete + all five M3
> gates passing). Every gate listed is quoted from ROADMAP.json, which remains
> normative.

**Prepared:** 2026-11-08 (final-closure directive §3: "While closing M2,
prepare M3's contract and implementation plan, but do not begin M3
implementation PRs or change M3 to active.")
**Activation:** 2026-11-08 — the maintainer's explicit directive ("you can
proceed with M3", recorded verbatim in ADR-0007 and in
`milestones[M3].activation_waiver`) authorized activation before M2 completes.
M2 remains `active` with **M2-G1 blocked** (Unity licensed-editor prerequisite
external — `docs/gamos/UNITY-M2G1-PROVISIONING.md` §7: maintainer eligibility
attestation, eligible Unity account + Hub activation, compliant runner). No
`evidence/roadmap/M2.json` completion bundle exists, and M3 completion still
requires M2 complete plus all five M3 gates passing with hash-bound evidence.

---

## 1. M3 objective (from ROADMAP.json)

**Cross-engine asset and workflow orchestration.** Real multi-engine
workflows with dependencies, parallelism, conflict prevention, cancellation,
resume and reproducible artifact evidence.

## 2. Work packages and owners (from ROADMAP.json)

| Work package | Scope | Owner |
|---|---|---|
| M3.1 | Blender-to-Unity export/import and scene integration | Worker A |
| M3.2 | Blender-to-Babylon export/build/runtime pipeline | Worker A |
| M3.3 | Engine-aware GamePlan generation, dependencies, parallelism, resume and cancellation | Worker B |
| M3.4 | Cross-engine artifact manifests, hashes, reproducibility and handoff records | Worker C |
| M3.5 | Parallel-write safety, integration and real end-to-end evidence | TL |

## 3. The five acceptance gates (quoted from ROADMAP.json — binding)

- **M3-G1:** A real Blender asset is exported, validated, imported into Unity, built and verified with hashed source/output evidence.
- **M3-G2:** A real Blender asset is consumed by a real Babylon project and verified in the actual running Browser experience.
- **M3-G3:** Independent work runs concurrently, dependent work waits, conflicting writes are prevented and outputs integrate deterministically.
- **M3-G4:** Workflow interruption is resumed from the existing journal; cancellation is observable and cancelled steps are never reported successful.
- **M3-G5:** A natural-language request completes across Blender and a target engine without manual repetition, collecting actual build, runtime and artifact evidence.

No M3 gate may be replaced by a unit-test-only or fixture-only equivalent. If
a Unity-dependent M3 gate cannot execute because a compliant free Personal
runner is unavailable, it is reported as blocked — no fixtures, no claimed
completion.

## 4. Architecture constraints (prepared decisions, TL-owned)

1. **Extend, never duplicate:** the existing `game-plan.ts` /
   `plan-workflow.ts` domain model, the `@zcode/dynamic-workflow` compiler and
   analyzer, `@zcode/dynamic-workflow-runtime`, the production workflow driver
   and the durable `dwf_*` journal are THE orchestration authorities. No second
   scheduler, task store, compiler, journal, runtime or concurrency governor.
2. **Additive resource-claim contract (M3-G3 prerequisite):** a versioned,
   additive contract distinguishing read / write / project-wide / asset-path /
   generated-output / staging claims, with canonicalized workspace-confined
   paths, symlink/traversal fail-closed, and write-scope enforcement on the
   capability execution path (not merely recorded in the plan). Frozen-contract
   changes require explicit TL coordination; the GamePlan wire format is not
   casually modified.
3. **Cross-engine asset interchange manifest (Worker B + C, TL-reviewed):**
   additive and versioned; captures provenance/identity, file integrity
   (SHA-256 + dependencies), interchange semantics (coordinates, axes, units,
   color space, UVs, materials, animation metadata), and target verification;
   rejects unknown schema versions, missing mandatory metadata, corrupted
   hashes, unsafe paths. Status model: exported → export-validated →
   import-pending → imported → import-validated → built → runtime-verified →
   failed → cancelled. Not a second asset database; not a GameIR replacement.
4. **Format choices verified, not assumed:** FBX is the first candidate for
   Unity's native importer and GLB/glTF for Babylon's loader, but real engine
   compatibility tests decide; no model-authored Python/C#/shell/JS import
   shortcuts — reviewed, typed, bounded operations only.
5. **Large artifacts stay out of Git** (CI artifacts carry them); committed
   evidence carries manifests, command records, hashes and references.
6. **Authority boundaries preserved:** ZCode owns the app, model selection,
   tasks/sessions/permissions/agent execution, plugin lifecycle and MCP
   dispatch, Dynamic Workflow, Browser/Terminal/Review. GameSpec remains the
   pinned PlayLiquid GameIRDocument (no M3 fields). PaySwap remains the
   financial authority — no M3 payments/settlement/monetization.

## 5. Worker coordination (prepared)

Isolated branches `gamos/worker-a` (M3.1 + M3.2, separate focused PRs per
pipeline), `gamos/worker-b` (M3.3), `gamos/worker-c` (M3.4); TL integrates on
`gamos/development`, owns M3.5, shared contracts, resource-conflict
enforcement, runtime integration, security/permissions, CI/regression, real
app journeys and evidence integrity. Shared-contract changes require TL
coordination; no worker independently modifies another worker's production
surface.

## 6. Execution procedure when activated

Strict TDD per slice: RED → GREEN → HARDEN → INTEGRATE → REGRESSION →
EVIDENCE (`docs/gamos/TDD-EXECUTION-PLAYBOOK.md`; the final-closure handoff
§12 requirements, including real-engine INTEGRATE authority and hash-bound
EVIDENCE, apply verbatim). Required checks include the governance/roadmap/
architecture suites, the domain and focused engine-plugin suites, the Dynamic
Workflow compiler/runtime tests, inherited ZCode build/plugin/permission/
session/Browser journeys, the real engine-backed pipelines, and the real
end-to-end M3 journey. The canonical completion file is
`evidence/roadmap/M3.json` (repo template, hash-verifiable, workflow-run-bound
to the tested commit).

## 7. Activation record (supersedes the original §7 restriction)

- M3 was set to `active` in ROADMAP.json on 2026-11-08 under the maintainer's
  explicit directive ("you can proceed with M3", recorded verbatim in ADR-0007
  and in `milestones[M3].activation_waiver`). The original activation rule
  (only after M2 completion + validator dependency-ready) remains the default
  path for every OTHER milestone; the waiver is scoped to M3, fails closed in
  the validator, and never authorizes completion.
- Implementation proceeds per this plan: M3.1–M3.5, strict TDD, honest-blocked
  reporting for any Unity-dependent gate while no compliant licensed runner
  exists.
