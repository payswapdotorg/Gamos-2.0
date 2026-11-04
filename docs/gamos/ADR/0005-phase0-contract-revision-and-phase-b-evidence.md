# ADR-0005 — Phase-0 Contract Revision 1 and the M0 Phase B evidence split

- Status: accepted (2026-11-05)
- Deciders: Gamos TL (payswapdotorg), per architect re-review of commit `80c002dd`
- Authorization: `GAMOS-AUTH-0003` (complete `gamos/authorization@2` entry, content-bound)
- Supersedes: none; amends ADR-0004-protected contract control files via the sanctioned
  re-baselining process (`scripts/gamos/governance-rebaseline.mjs`)

## Context

The architect re-review of the M0 delivery (commit `80c002dd`) accepted Phase A
governance v2, Phase D worker briefs, the fork structure and the nine Phase-0
contracts *as an initial baseline*, and directed:

1. Close the remaining Phase B acceptance gaps — the original ZCode application must
   complete its **actual user journey** (complete app + desktop renderer, real-model
   task submission from the original New Task UI, task execution + tool use + result
   review + session recovery, embedded Browser, interactive Terminal, Review/diff
   approve+reject, Plugin Marketplace, inherited desktop E2E) — "Do not substitute
   CLI tests or screenshots of settings pages for full UI workflows."
2. Revise the Phase-0 contracts (corrections A–E) **through the approved governance
   authorization/re-baselining process**, without weakening governance controls.
3. M0 acceptance only after the real user journey passes and the evidence is committed;
   M1/M2 remain gated.

## Decision

### 1. Contract revisions (corrections A–E)

Six contracts were revised (revision 1), each via the ledger + rebaseline process:

| Contract | Correction | Substance |
|---|---|---|
| 01 | A | Gamos aligns with the existing PlayLiquid/GameIR source contracts (`payswapdotorg/PlayLiquid-2.0` `packages/playliquid-gameos/src/game-ir/`, pinned `196b305e`): `GameSpec` IS a PlayLiquid `GameIRDocument`; upstream semantics/types reused; **no second independent GameIR** |
| 02 | B | Silent registry-order fallback REMOVED; fail-closed selection for unknown/incompatible/unavailable capabilities; explicit disclosure + approval for meaningful substitutions; full execution-safety record (provider identity, prerequisites, compatibility, reversibility, idempotency, timeout, cancellation, verification) |
| 04 | E | Engine-specific version parsers (Unity/Blender/Godot/Unreal grammars; no universal SemVer); machine-local discovery data separated from shared project metadata (`gamos.project.json` stays machine-neutral; discovery lives under the data base dir keyed by workspace) |
| 05 | C | GamePlan = a Dynamic Workflow script executed by the existing ZCode Dynamic Workflow definition/compiler/runtime (`apps/zcode-cli/packages/dynamic-workflow{,-runtime}`, `docs/dynamic-workflow/*`); dependencies/parallelism/progress/journaling/resume/cancellation/failure mapped onto the engine + `dwf_*` journal; DB tables alone are NOT a substitute for the runtime |
| 06 | D | All native engine mutations routed through permission-gated ZCode execution; repository-governance authorization separated from the user's game-release/publishing authorization (PaySwap platform scope) |
| 09 | D | UI plugin sandbox (renderer-side, `packages/desktop/src/preload/pluginSandbox/`) distinguished from MCP server process execution (OS processes spawned by the agent runtime); trust/isolation model for external MCP processes (process isolation only, explicit env exposure, disclosure before install, stricter provenance for process-carrying plugins) |

Contract 03 was aligned for cross-reference consistency (family version grammar,
`gamos/capability@2`, `gamos/provenance@2` surfaces). Contracts 07/08 required no
substantive correction.

Governance was NOT weakened to make revisions easier: the revisions went through the
complete `gamos/authorization@2` entry with per-file `content_sha256`, the trust-anchor
pin rotation via `governance-rebaseline.mjs`, and the full self-test suite
(tamper-rejection scenarios) still applies to the revised controls.

### 2. Phase B evidence model: sandbox floor + CI ceiling

The verification sandbox is resource-constrained (2 vCPU, 3GB RAM, 7GB disk, no
Docker). Honest capability map established in this revision round:

| Verification | Sandbox | Suitable environment |
|---|---|---|
| Frozen-lockfile install | ✓ (54.2s, exit 0) | CI re-verifies |
| Builds: server / agent CLI / desktop process layer / runtime assets | ✓ (all exit 0) | CI re-verifies + production renderer |
| Production web/desktop renderer bundle | ✗ OOM (documented) | **CI runner** (`pnpm build:bootstrap`) |
| Desktop app launch (main + host + window + CDP + dom-ready) | ✓ | CI full journey |
| Desktop renderer module graph (dev server) | ✗ Chromium per-process request budget exhausted (`net::ERR_INSUFFICIENT_RESOURCES`, 4225 requests) — documented | **CI runner** (journey S0) |
| Real-model agent tasks (CLI golden path) | ✓ (2 tasks, exit 0, exact artifacts, Write/Read tool rollouts, sessions persisted) | CI journey re-verifies in-UI |
| Full UI journey (New Task submission, terminal, review/diff approve+reject, browser, marketplace, session recovery) | ✗ (renderer limitation above) | **CI runner** — `scripts/gamos/phase-b-ui-journey.mjs` in `prod` mode with the real OpenRouter key from the `PHASEB_OPENROUTER_API_KEY` repo secret |
| Inherited desktop E2E suite | ✗ (no Docker) | **CI runner** — upstream-sanctioned container path (`Dockerfile.desktop-e2e` + `scripts/test-desktop-e2e-container.sh`, default preset, replay-isolated) |
| `pnpm run architecture:check` | ✓ (OK, 0 violations) | governance CI re-verifies |

The CI workflow `.github/workflows/gamos-phase-b-e2e.yml` implements the two CI jobs
(`desktop-journey`, `inherited-desktop-e2e`) and uploads screenshots, journey-evidence
JSON, sanitized logs and E2E artifacts per run. Sandbox limitations remain documented
in `docs/gamos/IMPLEMENTATION-STATUS.md`; nothing is marked passed that did not pass.

## Consequences

- M0 acceptance now rests on: sandbox floor evidence (above) + green CI runs of the
  two Phase B jobs on a properly resourced runner, recorded with run URLs, commit SHAs
  and job logs.
- The journey script (`scripts/gamos/phase-b-ui-journey.mjs`) is additive evidence
  tooling: no protected sources touched, isolated `PHASEB_HOME`, no repository mutation.
- The OpenRouter key lives only in the encrypted repo secret; it never lands in the
  repository, logs are sanitized (key masked) in evidence artifacts.
- Worker briefs (B/C) were updated to reference the revised contract clauses; worker
  readiness remains M0-gated.
