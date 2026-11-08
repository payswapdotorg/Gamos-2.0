# Gamos — Implementation Status

> **Phase-status authority:** docs/gamos/ROADMAP.json is the sole source of truth
> for milestone status, scope, dependencies and acceptance gates. This file is a
> factual evidence/incident ledger only; it must not independently declare a
> milestone complete, activate a phase or supersede the roadmap validator.
>
> Evidence should be appended with exact commits, CI run URLs, commands, outcomes
> and artifact paths. Keep all conditional/unavailable states explicit.

> Honest, evidence-based status. No green checkmark implies completion when only
> a contract or UI exists. Updated at every integration point.
>
> **Last updated:** 2026-11-07T03:30Z (M1 COMPLETE and MERGED — post-merge regression verification on the development head `474fda32` is fully green, including the re-run of the real-model desktop journey after a documented quota-only failure; see "Post-merge verification" below. M1 completion evidence remains bound to run 42302128911 @ `cae5a9a6` with full disclosure in `evidence/roadmap/M1.json`)

---

## Current phase pointer

The canonical phase states and dependencies are maintained only in
docs/gamos/ROADMAP.json and validated by scripts/gamos/roadmap-check.mjs.
This evidence ledger intentionally does not maintain a duplicate milestone
completion table. Consult ROADMAP.json for the live phase state and readiness.

## Architect-review phase tracker

| Phase | Scope | Status |
|---|---|---|
| A — Repair governance | Tamper-resistant controls, complete authorization schema, failure-case tests, real Actions run | **Complete — green CI runs: 41894115266 @ `5ef39f2c`, 41895183232 @ `391e8438` (attempt 3), 41909484947 @ `549fd991`, 41910262508 @ `468e731f` (rotated anchor + 15 controls + 14/14 self-tests); rulesets active; main verified pristine vs upstream at close-out; evidence in `evidence/phase-a/`** |
| B — M0 application verification | Frozen-lockfile install, build + launch original ZCode, golden paths, screenshots, regression tests | **Complete — GREEN CI EVIDENCE (run 42071819027 @ `bef775cd`, attempt 1, all 3 jobs success):** desktop journey S0–S9 ALL PASS (strict verdict: exit 0 only when every mandatory stage records pass — machine-readable `journey-evidence.json` summary; 39 screenshots + DOM dumps + sanitized run log uploaded as artifact). Journey repairs this round (each with run-id evidence): S2 add-model now verifies the free-tier model PERSISTS in provider_config.json (was: prefix-selector hit an existing row / silent page-eval syntax error masked the open dialog); S6 reject verifies the option SELECTION (aria-selected) before Confirm (was: default-selection race could submit Allow/Full-access); S7 navigates before the webview wait, Enter carries text:"\r" (form-submit default action) and reads the guest IN-PAGE via the webview element (getURL + executeJavaScript; CDP /json/list bonus scan). Sandbox floor evidence retained in `evidence/phase-b/` + `evidence/phase-b/r2/` | `42071819027`, closure attempts `42049966765`, `42056174710`, `42061508909`, `42068291128` (root causes documented) |
| C — Freeze Phase-0 architecture contracts | 9 contract areas, using existing ZCode infrastructure only | **Complete — all 9 contracts authored in docs/gamos/contracts/ and FROZEN as hash-protected control files (baseline.controls now 15 files, trust anchor rotated via GAMOS-AUTH-0002); verifier refined to ledger supersession semantics; self-test extended to 14 scenarios (14/14 green locally)** |
| D — Prepare workers A/B/C | Briefs, evidence requirements, DoD | **Complete — worker A (Unity/Blender/Babylon engine plugins), B (gaming domain/capability registry/intent+workflow), C (GameOS/package+artifact/PlayLiquid alignment) briefs + TL integration plan in docs/gamos/workers/; every brief mandates real evidence, explicit unavailable states, and no mocks; B/C briefs updated to reference contract revision 1 (GAMOS-AUTH-0003)** |
| C-rev — Phase-0 contract revision 1 (re-review corrections A–E) | GameIR↔PlayLiquid alignment; registry fail-closed; Dynamic Workflow mapping; plugin sandbox vs MCP processes; engine-specific version parsing | **Complete — 7 contracts revised via GAMOS-AUTH-0003 + governance-rebaseline (trust anchor rotated to 2be1e62b…); ADR-0005 records the decision + the Phase B evidence model; governance NOT weakened (self-test 14/14 after rotation)** |
| B-closure — Architect M0-closure corrections + Phase B test integrity (GAMOS-AUTH-0004) | GameSpec exact-compatibility (correction A); plugin execution security: capability-approval vs OS-process access, MCP process authority inventory, least-privilege regime, disclosure reflects actual privileges (correction B); journey test result integrity (§2.A) + real per-stage verification (§2.B–I) | **Complete — contracts 01/05/06/09 revision 2 + ADR-0006; journey rev 2 repaired (strict verdicts, CDP-only input, exact verifications, on-disk persistence checks, selection-verified permission responses, in-guest browser read) and GREEN on CI run 42071819027** |

## Requirement ledger

| Requirement | Implementation | Contract | Tests | Execution & results | Limitations | Commit |
|---|---|---|---|---|---|---|
| Fork zai-org/ZCode with full history into payswapdotorg/Gamos-2.0 | **Complete & pushed** — remote refs verified: `main` @ `a9fe401e…` (identical to upstream), `feat/ui-plugin` @ `662c30be…` (identical), tags `v3.14.3`/`v3.15.1`/`v3.17.1`/`v3.17.2` (identical), full 9-commit history | `docs/gamos/UPSTREAM-BASELINE.md` §3, §7 | n/a | `git ls-remote` fork + upstream diff = zero divergence; REST API `default_branch: main` ✓ | — | `8f2d0252` |
| Working branch from pinned baseline | `gamos/development` created at `a9fe401e…`, **pushed** (carries M0 governance commits, additive-only) | handoff §2.1 step 7 | n/a | `git ls-remote` shows `refs/heads/gamos/development` ✓ | — | `8f2d0252` |
| **A1: Tamper-resistant governance controls** | Governance v2: control files hash-protected (`baseline.controls`), workflow trust-anchor pin (`GAMOS_BASELINE_SHA256`), tag cross-check, history-rewrite guard | `.gamos-protected-surfaces.json` v2; `.gamos-architecture-baseline.json` v2; ADR-0004 | `scripts/gamos/governance-self-test.mjs` | Verifier green locally with pin and in CI (`trust anchor: verified`, 6 control hashes verified; run 41894115266). 13/13 self-test scenarios pass locally and in CI | Scheduled daily verification is **dormant** while `main` remains the pristine upstream mirror (GitHub only runs `schedule` from the default branch, which intentionally does not carry Gamos files); push/PR triggers cover all active branches | `5ef39f2c` |
| **A2: Complete authorization schema validation** | `gamos/authorization@2`: requester, rationale, risk, affected/new functionality, regression tests, evidence links, per-file `content_sha256`, structured `tl_approval {approved, approver, date, decision_ref}` bound to `baseline.governance.approvers`. Entries failing any check grant **no** authorization | `.gamos-authorized-modifications.json` v2 (first complete entry `GAMOS-AUTH-0001` documents this hardening) | Self-test scenarios 9, 10, 12 | Truthy-only `tl_approval` rejected (scenario 9) ✓; incomplete record rejected (10) ✓; content drift rejected (12) ✓ | — | `effc04d5` |
| **A3: Deliberate failure cases tested** | 13-scenario tamper-rejection suite covering all 8 required cases + 3 additional (forged baseline w/o pin, truthy-only, drift) + 2 control cases (pristine, complete evidence) | ADR-0004 §7 | `scripts/gamos/governance-self-test.mjs` | **13/13 pass locally AND in CI** (job `Governance self-test (tamper rejection)`, run 41894115266) — unauthorized modification (2), deletion (3), missing protected file (4), modified baseline SHA (5), weakened verifier (8), modified protected-surface list (7), incomplete authorization (9, 10), authorized change with complete evidence accepted (11), history rewrite (13) | — | `5ef39f2c` |
| **A4: Real GitHub Actions run** | Workflow v2: `governance` (pinned verifier) + `self-test` (tamper suite) + `architecture` (upstream gate) on push/PR | `.github/workflows/gamos-governance.yml` | the workflow itself | **Run 41894115266 @ `5ef39f2c` — SUCCESS, 3/3 jobs:** `Governance (baseline & protected surfaces)` ✓ (trust anchor verified, 6 control hashes), `Governance self-test (tamper rejection)` ✓ (13/13), `Upstream architecture gate` ✓ (`pnpm install --frozen-lockfile` + `architecture:check`). URL: https://github.com/payswapdotorg/Gamos-2.0/actions/runs/41894115266 — full job logs captured in `evidence/phase-a/logs/` | First v2 push (`effc04d5`, run 41893874648) failed at workflow-parse time due to a doubled quote in the pin line (regex bug, fixed in `5ef39f2c`; run retained as an honest incident record) | `5ef39f2c` |
| **A1: CODEOWNERS + enforced reviews/checks** | `.github/CODEOWNERS` (TL owns governance paths + default); branch rulesets **created and active** | `.github/CODEOWNERS`; ADR-0004 §8 | ruleset API responses in `evidence/phase-a/governance-v2-ci-evidence.json` | **Ruleset 26558836 `gamos-main-lockdown`** (main: no direct push/force-push/deletion; PRs need code-owner review + all 3 checks; no bypass) and **Ruleset 26558837 `gamos-development-governance`** (gamos/**: same rules; audited TL bypass actor for authorized re-baseline automation) — both `enforcement: active` | — | `5ef39f2c` |
| Feature preservation matrix | `docs/gamos/FEATURE-PRESERVATION-MATRIX.md` (32 features, verified source anchors) | this repo | governance-check passing | source anchors verified by inspection at baseline; verifier passing locally & in CI config | — | `8f2d0252` |
| Architecture docs | `docs/gamos/ARCHITECTURE.md` (verified upstream topology + clearly-marked planned additions) | this repo | n/a | direct source survey at baseline | — | `8f2d0252` |
| ADRs for frozen decisions | `docs/gamos/ADR/0001…0004` | this repo | n/a | authored | — | `effc04d5` |
| Fork builds & launches as original ZCode | **Verified with real evidence** — install (frozen lockfile, 58.8s local + CI), build (server 5.42MB ESM + remote bundle; agent CLI 29.1MB zcode.cjs; desktop main/preload/host/scheduler via tsup), launch (web dev:3030/5173; Electron desktop under Xvfb with host+agent warmup; Agent CLI headless). Full evidence: `evidence/phase-b/verification-evidence.json` | M0 exit criterion | architecture:check OK + CLI doctor exit 0 + real task artifacts | 3 conditional states recorded (web production bundle OOM at 3.1GB RSS in 4GB sandbox; desktop dev-renderer crash under memory ceiling; web-only dev-mode task submission blocked by remote-host routing — desktop/CLI full-chain paths verified instead) | Phase B commit |
| Golden-path journeys (onboarding → history) | **Verified:** onboarding 3-step wizard; model/provider configuration (OpenRouter provider added via UI, 'Ready', default model bound); New Task + task submission (real agent tasks ×2 with a real model — file created with exact content + read-back, exit 0); attachments (`--attach` file echoed exactly); browser (Browser Use settings + headless backend options); terminal (agent Write/Read tool usage in model-io rollout); review ('Ask before changes' control on composer); plugin marketplace (catalog + real install of jupyter-notebook@official 0.2.0 from cdn-zcode.z.ai with sha256); ordinary non-gaming task (task 1); history & session recovery (4 sessions persisted in CLI SQLite + rollout JSONL across restarts; app settings persisted) | architect review Phase B.4 | real model API exchanges in transcripts | 17 screenshots: `evidence/phase-b/screenshots/` | interactive embedded-browser/terminal/review panels require the desktop renderer (conditional states) | Phase B commit |

## Governance v2 control files (hash-bound `effc04d5`)

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
2. **Workflow trust-anchor pin YAML bug (this session, fixed):** the first v2 push (`effc04d5`) produced failed run 41893874648 — the pin-rewrite regex in `governance-rebaseline.mjs` duplicated the closing quote, producing invalid YAML (`"<sha>""`), so the workflow failed at parse time with 0 jobs. Fixed in `5ef39f2c` (regex replaces the full quoted token); the failing run is retained in the evidence bundle as an honest record.
3. **Ruleset API schema iteration (this session):** initial `POST /rulesets` payloads were rejected ("data matches no possible input") — the current schema mandates the full parameter sets for `pull_request` (all five fields) and `required_status_checks` (`strict_required_status_checks_policy` required), and `enforcement: evaluate` is Enterprise-only. Validated against GitHub's OpenAPI description; final rulesets created active (26558836, 26558837).
4. **pnpm hoisted-linker race (upstream toolchain, worked around):** run 41895183232 attempts 1-2 failed `pnpm install --frozen-lockfile` with `ERR_PNPM_ENOENT rename node_modules/react-scan/node_modules/_tmp_* -> …/esbuild` (node-linker=hoisted, pnpm 10.33.2). Nondeterministic; attempt 3 succeeded via `rerun-failed-jobs`; install step now retries once with a `::warning` annotation. pnpm stays pinned to the upstream lockfile's 10.33.2. Governance/self-test jobs were unaffected in every attempt.

## Phase B conditional states (explicit, honest)

1. **Web production bundle OOM:** `packages/web` `vite build` (rolldown native bundler, 8303 modules) peaks >3.1GB RSS and is OOM-killed in the 4GB-class sandbox; upstream's Docker E2E gate runs the identical build on GitHub runners. **Round 2 routing:** the production build now runs on the CI runner (`pnpm build:bootstrap` in gamos-phase-b-e2e.yml → desktop-journey job).
2. **Desktop dev-renderer module-graph exhaustion (round 2 diagnosis):** Electron main + zcode-host + primary window + CDP verified live under Xvfb; the dev renderer loads (title "ZCode", dom-ready) but its ~2000+-module graph exhausts Chromium's per-process request budget while vite dev transforms on 2 vCPU — `net::ERR_INSUFFICIENT_RESOURCES` on 4225 requests, DOM stays empty (bodyLen 0). Page-reload retries against the warm vite cache did not recover. Diagnostics: evidence/phase-b/journey/ (journey-evidence.json, trimmed journey-run.log, dom-dumps/S0-failure.json, screenshots/S0-failure.png). **Round 2 routing:** the complete renderer journey (S0–S9, production renderer + real model) runs on the CI runner via `scripts/gamos/phase-b-ui-journey.mjs` in `PHASEB_MODE=prod`.
3. **Web-only dev-mode task submission:** `project.remote-project-required` — web dev mode routes projects through remote-host policy (no desktop host); upstream README documents `ZCODE_SERVER_WORKSPACE` for web source development. Full-chain task flows (desktop host / Agent CLI) were verified instead, with the CLI delivering complete real-task evidence (round 2 re-verified fresh: 2 tasks, exit 0, exact artifacts, Write/Read tool rollouts, sessions persisted).
4. **No Docker in the sandbox:** the inherited desktop E2E container suite cannot run locally. **Round 2 routing:** runs on the CI runner (workflow job `inherited-desktop-e2e` via the upstream-sanctioned `scripts/test-desktop-e2e-container.sh`, default preset, replay-isolated).
5. **Model backend credits/geo:** the supplied OpenRouter key holds ~10 token credits and Anthropic-backed models are geo-restricted from this sandbox egress region; worked around by binding the free-tier `nvidia/nemotron-3-ultra-550b-a55b:free` (openai-chat-completions) — real generations, real tool calls. On CI the same free-tier model is used via the encrypted `PHASEB_OPENROUTER_API_KEY` repo secret (never in the repo; logs sanitized).
6. **No status-console substitution:** explicitly none — all evidence is from the original ZCode application.

## Blocked requirements

(none blocking Phase C; the conditional states above are environment ceilings, recorded with evidence)

## New architecture decisions this period

- ADR-0001: pinned upstream baseline + Gamos-2.0 destination (mirror push fork).
- ADR-0002: preservation boundary & authorized-modification workflow.
- ADR-0003: additive governance CI (baseline ancestry + protected-surface
  verifier), reusing upstream's architecture gate.
- **ADR-0004: governance v2 — tamper-resistant controls** (hash-protected
  control files, workflow trust anchor, authorization schema v2 with content
  binding, sanctioned rebaseline path, tamper-rejection self-tests, CODEOWNERS
  + rulesets, honest threat model).
- **ADR-0005: Phase-0 contract revision 1 + Phase B evidence model** (corrections
  A–E applied via GAMOS-AUTH-0003 + rebaseline; sandbox-floor/CI-ceiling split for
  application verification; M0 acceptance keyed on the CI-run original-app journey).

## Regression results

Baseline untouched at the last verified comparison: zero modifications to
upstream-tracked files. Current branch changes are additive Gamos docs, scripts,
CI and evidence. The required current-commit M0 UI and inherited regression
results are pending the full CI workflow; use ROADMAP.json gate state rather
than this paragraph to determine phase completion.

## Remaining risks

- GitHub auth edge showed a transient multi-token outage; if it recurs, wait it
  out and retry (verified recovery pattern) before assuming token revocation.
- Upstream moves independently (sync-commit model); baseline pin + governance
  checks protect against silent divergence.
- A fully-consistent forged governance state is only addressable by branch
  rulesets + review, not by in-repo hashing (ADR-0004 threat model).
- Desktop build/E2E inside the dev sandbox has not been exercised yet (Phase B).

## Phase B closure — CI evidence (M0-closure directive §4, honest record)

**Authoritative run:** https://github.com/payswapdotorg/Gamos-2.0/actions/runs/42071819027
(commit `bef775cd`, attempt 1, conclusion **success**, all 3 jobs green). Machine-readable
close-out record with the full per-stage digest, the closure-attempt history and the
explicit exclusions: `evidence/phase-b/m0-closure-ci-evidence.json`. Journey artifact
(39 screenshots + DOM dumps + sanitized run log + journey-evidence.json):
run artifacts → `phase-b-journey-bef775cd…`.

- **Desktop journey (real model, production renderer): S0–S9 ALL PASS, verdict=pass,
  exit 0** — strict integrity model (any partial/skipped/fail/missing stage fails the run);
  OpenRouter key never present in any artifact (CI scan step + local re-scan both clean).
- **Inherited desktop E2E (container, 4 verified specs): success.**
- **Upstream-provider spec via the in-repo recorded replay fixture: success.**

Closure-attempt root causes (each repaired with run-id evidence): `42049966765`
add-model prefix-selector hit an existing row; `42056174710` silent page-eval syntax
error masked the open dialog + Enter lacked the form-submit default action;
`42061508909` real-task workspace starts the side pane collapsed; `42068291128`
permission Confirm submitted the default selection + webview guests not surfaced by
CDP /json/list (page was loaded — in-guest read is now authoritative).

## M0 acceptance — six canonical gates (autonomous closure procedure)

Per ROADMAP.json, M0 acceptance is keyed on **six canonical gates**, not the
historical nine-condition ledger. The TL owns phase advancement; no architect
acceptance checkpoint remains. Mapping of the nine-condition ledger:

| Canonical gate | Covers (historical 9-condition items) | Status per committed evidence |
|---|---|---|
| M0-G1 Pinned upstream integrity | fork/baseline integrity, pristine `main` | main identical to upstream `a9fe401e…`; baseline ancestry enforced by governance verifier every run |
| M0-G2 Governance and self-test CI | (1) governance passes | run 42071819091 @ `bef775cd`: architecture gate + 14/14 self-test + baseline/surfaces |
| M0-G3 Original application build and launch | (2) builds and launches as original ZCode | S0 pass (production renderer, `pnpm build:bootstrap`, window over CDP) |
| M0-G4 Strict original-app UI journey | (3) all mandatory stages, (4) review approve+reject, (5) terminal+browser, (6) marketplace install, (7) session recovery | S0–S9 ALL PASS, verdict=pass, exit 0; S6 approve+reject both verified; S5/S7 exact interaction evidence; S8 identity+sha256; S9 killed+relaunched recovery |
| M0-G5 Inherited regression suite | (8) inherited E2E + honest exclusions | 4 verified container specs pass; upstream-provider spec passes via upstream-documented recorded replay fixture; live-provider run NOT executed (404 evidence documented) — not an M0 requirement |
| M0-G6 Feature preservation and architecture | feature matrix + architecture:check | 32-feature matrix reconciled at baseline; `architecture:check` zero violations on every run |

Closure procedure (directive "Autonomous M0 Closure and M1 Implementation" §5):
independently inspect the run-42071819027 evidence quality (S2 provider/model
validity attribution, S8 install-vs-try-now proof, S6 rejected-modification
absence, S7 in-guest browser read, credential scan coverage of uploaded
artifacts), then create `evidence/roadmap/M0.json`, set M0 `complete` in
ROADMAP.json with exact run metadata, run the roadmap validator + self-tests,
and run required CI on the completion commit. Only after that commit passes is
M1 activated. `IMPLEMENTATION-STATUS.md` records evidence and decisions only;
it never independently controls phase status.

## M0 completion decision (autonomous closure, 2026-11-05T20:05Z)

The TL inspected the committed close-out evidence (`evidence/phase-b/m0-closure-ci-evidence.json`,
run 42071819027 @ `bef775cd4cba2532b6e08b4c03b01f9bf7725655`, attempt 1, conclusion success,
3/3 jobs green) rather than treating summaries as proof. Evidence-quality findings:

1. **S2 model validity/attribution — verified.** The free-tier model
   `nvidia/nemotron-3-ultra-550b-a55b:free` is persisted through the real
   `addPersonalModel` path (`packages/provider/src/config-service.ts`):
   `providers.openrouter.personalModelIds` + the per-provider models map with
   `enabled: true`. The close-out's `provider_model_rules`/`manual_provider_model_rules`
   false readings probe the *personal-config-rule* override layers, which a plainly
   added model does not use — the raw id string lands in the provider record itself.
   S3 records the real OpenRouter generation, session id, exact artifact content and
   tool use attributable to that model, so the successful real-model task is
   attributable to the intended model.
2. **S8 install-vs-try-now — install proven.** Upstream
   `packages/ui/src/settings/PluginStoreDetailView.tsx` renders
   `item.installed ? (item menu + try-now) : (install button)`. The recorded UI
   state (`install_button_present: false`, `try_now_present: true`) is exactly the
   upstream `installed === true` rendering; "Try now" is the affordance shown for
   installed regular plugins (prefills a prompt to use it), not try-without-install.
   The `uninstall_entry_present: false` reading reflects the closed item-menu
   dropdown (the uninstall entry lives inside `PluginStoreItemMenu`). The on-disk
   `installed_plugins.json` record with `installPath`, the independent archive
   checksum match (manifest sha256 == separately downloaded archive sha256) and the
   installed-tree hash prove real installation.
3. **S6 rejected modification — verified absent.** The journey asserts
   `!file.includes(REJECTED-LINE)` after the reject (with a 2×3s grace re-check for
   late writes) plus `approved_line_still_present`; all subsequent permission prompts
   during the rejected turn are also rejected so a model retry cannot smuggle the
   change in.
4. **S7 in-guest browser read — verified.** URL/title/body are read through the
   webview element (`getURL` + `executeJavaScript` inside the guest WebContents);
   the browser-level CDP `/json/list` scan is a non-gating bonus. No unsupported
   browser-level CDP target requirement is imposed.
5. **Credential scan coverage — verified.** The CI scan step greps the exact
   `evidence/phase-b/journey-ci/` directory that `actions/upload-artifact` uploads
   (screenshots, DOM dumps, sanitized run log, journey-evidence.json), and the
   close-out additionally documents a local re-scan of the downloaded artifact:
   zero hits for the OpenRouter key.

Six-gate disposition: M0-G1..M0-G6 all `passed`; per-gate commands, results,
committed evidence paths and SHA-256 hashes are recorded in
`evidence/roadmap/M0.json` and enforced by `scripts/gamos/roadmap-check.mjs`.
ROADMAP.json now marks M0 `complete` with completion evidence bound to the tested
commit `bef775cd…` and run 42071819027. Explicit exclusions: live-provider
execution (documented 404; not an M0 requirement) and any claim of the complete
upstream E2E suite passing. M1 activation proceeds only after required CI validates
this completion commit.


## M1 acceptance — six canonical gates (autonomous closure, 2026-11-06T22:18Z)

Authoritative run: https://github.com/payswapdotorg/Gamos-2.0/actions/runs/42302128911 @ `cae5a9a6` — job "M1 acceptance journey
(deterministic local model endpoint, production renderer)", conclusion success,
`verdict=pass` with all mandatory stages MJ0–MJ9 green (machine-readable
`m1-journey-evidence.json`, screenshots, DOM dumps and the full model-request
transcript in the run artifact).

**Model endpoint (maintainer directive, disclosed):** OpenRouter's free tier
provides 50 free-model requests/day. Run 42235226375 proved the journey cannot
fit that budget (MJ0–MJ3 green; every MJ4+ model turn 429
`free-models-per-day`, `x-ratelimit-limit: 50`, `remaining: 0`) — an agentic
journey needs main turns + tool loops + workflow subagents. The maintainer
cannot add the 10 credits that would unlock 1000/day, so the directive removed
the paid external dependency: the journey now runs against a deterministic
local Anthropic-Messages endpoint (`scripts/gamos/m1-local-model-server.mjs`)
configured through the app's **real custom-provider settings surface** (the
same UI path the repository's own upstream E2E replay suite drives). Everything
the application does is real — provider settings, session turns, SSE streaming
parse, tool round-trips, the dynamic-workflows skill gate, the CreateWorkflow
approval gate (real PermissionDialog allowOnce), the Dynamic Workflow
compiler/runtime/journal, /dwf resume, persistence across restart. Only the
model intelligence behind the endpoint is scripted. **No real-LLM authorship is
claimed**; the endpoint writes a full request transcript
(`m1-local-model-transcript.jsonl`, 11 requests) into every
artifact. The real-model path is preserved unchanged
(`PHASEB_LOCAL_MODEL` unset → OpenRouter + `OPENROUTER_API_KEY`) for any future
funded run.

Journey evidence highlights (per-stage records in the artifact and in
`evidence/phase-b/m1-closure-ci-evidence.json`):
- MJ2 — custom provider persisted on disk (base URL `http://127.0.0.1:4371`,
  api.type `anthropic-messages`, marker key) via the real settings surface.
- MJ3 — real Unity-marker workspace; real probes (Unity 6000.0.23f1 from
  ProjectVersion.txt); honest engine states; read-only GamePlan script artifact
  from the gamos-domain contract chain.
- MJ4 — Skill(dynamic-workflows) → CreateWorkflow (read-only inspection
  GamePlan) → real permission approval → backgrounded run.
- MJ5/MJ6 — terminal status `completed`; dwf_* journal: runs=1(+1 later),
  nodes=2, events=13, actors=1.
- MJ7/MJ8 — second GamePlan (review) launched; stop-control stage observed
  honestly (journal evidence; the stop button is not visible after a completed
  turn — recorded, not gamed); `/dwf resume` produced an observable run
  reaction with the turn completed.
- MJ9 — session id identical across the app kill+relaunch; conversation history
  and both dwf run ids survived in the journal.

Seven prior failed runs are recorded honestly in the closure evidence with
per-run root causes (four OpenRouter quota deaths; three journey-layer defects
found and fixed by their own runs: healthz `req.end()`, journal-based run-id
capture, and the earlier stage-id/virtualization fixes).

Six-gate disposition: M1-G1..M1-G6 all `passed`; per-gate commands, results,
committed evidence paths and SHA-256 hashes are recorded in
`evidence/roadmap/M1.json` and enforced by `scripts/gamos/roadmap-check.mjs`.
ROADMAP.json now marks M1 `complete` with completion evidence bound to the
tested commit `cae5a9a6` and run 42302128911. Explicit exclusion: real-LLM
authorship of the GamePlan content (deterministic endpoint per the maintainer
directive; app-side integration chain fully real). PR #2 merge follows required
CI validation of this completion commit.

## Post-merge verification on the development head (2026-11-07T03:17Z)

PR #2 merged `gamos/roadmap-integration` (`00d68d4d`, the M1 completion commit)
into `gamos/development` as merge commit `474fda32` at 2026-11-06T22:23:59Z.
The three Gamos workflows then ran on that head with the following outcomes:

1. **gamos-governance** (run `42304415690`) — SUCCESS. Governance verifier
   (trust-anchor pinned `da3fbbd9…`), tamper-rejection self-tests (14
   scenarios), upstream architecture gate, roadmap validator self-tests and
   the canonical roadmap integrity/dependency gate all green on the merged
   tree (M0+M1 complete, M2 ready, M3–M7 blocked).
2. **gamos-m1-e2e** (run `42304415823`) — SUCCESS. The M1 acceptance journey
   re-passed on the merged development head (deterministic local model
   endpoint; no OpenRouter dependency).
3. **gamos-phase-b-e2e** (run `42304415769`) — attempt 1 FAILURE, attempt 2
   SUCCESS (2026-11-07T03:09:28Z → 03:16:59Z). Attempt 1's inherited
   desktop-E2E (4 verified specs) and upstream-provider replay jobs passed;
   only the desktop journey job failed (S3/S6/S9). Root cause, from the job
   log: `APICallError … Rate limit exceeded: free-models-per-day`,
   `statusCode: 429`, `x-ratelimit-limit: 50`, `x-ratelimit-remaining: 0`,
   `x-ratelimit-reset: 1794009600000` (= 2026-11-07T00:00:00Z). This is the
   same documented free-tier daily quota that killed the M1 journey attempts
   on Nov 6 (run `42235226375` evidence): the quota had been exhausted that
   day and had not yet reset when the push-triggered run executed at
   22:24Z. It is environmental, not a code regression — no M1 merge commit
   touches any application surface the desktop journey exercises. After the
   documented 00:00Z quota reset, the re-run (attempt 2, same run id, same
   commit `474fda32`) passed all three jobs: desktop journey verdict=pass
   with S0–S9 ALL PASS (real free-tier model
   `nvidia/nemotron-3-ultra-550b-a55b:free`, fresh session
   `sess_d227fdf2-5230-4cab-89ad-ea0d82d8f323`, `non_pass=[]`, `missing=[]`),
   inherited desktop E2E 4 specs, upstream-provider replay fixture.

Additional post-merge re-verification performed locally on the merged tree:
`node scripts/gamos/roadmap-check.mjs` — valid; focused Gamos domain suite
(vitest 4.1.7, 15 test files) — **183/183 tests passed**.

Conclusion: the M1 merge introduced no regression in the original
application. All original journeys (New Task with real model, Terminal,
Browser, Review permission flows, marketplace plugin install, session
recovery) remain operational on the development head, per run `42304415769`
attempt 2. This addendum is documentation-only; it changes no evidence
record, and the M1 completion evidence remains bound to run `42302128911` @
`cae5a9a6` as recorded in `evidence/roadmap/M1.json`.

## Final-CI completeness audit (2026-11-07, directive §20 follow-through)

A clause-by-clause audit of the M0-closure/M1 directive against the merged
repository state surfaced one soft spot in the §20 "required final CI" list:
item 6 ("all focused Gamos tests") had passed at the M1.6 GREEN commit
(`38f5777c`, 183/183, recorded in the gate commands of
`evidence/roadmap/M1.json`) and in local re-verification on the merged tree,
but was never codified as a CI step — no workflow executed the vitest
`gamos-domain` project. Two facts close the audit:

1. **Tree identity:** the PR #2 merge commit `474fda32` has the *identical*
   git tree as the M1 completion commit `00d68d4d` (both `605dd118…`). The
   post-merge runs on `474fda32` — governance (`42304415690`), the M1
   journey (`42304415823`) and the inherited regression workflows
   (`42304415769` attempt 2) — therefore exercised exactly the completion
   commit's content, closing §20 items 7 (inherited regression suites) and
   8 (M1 journey) on the completion state in CI.
2. **Focused tests codified in CI:** the governance workflow's architecture
   job now runs `pnpm exec vitest run --project gamos-domain` (the project
   is registered in the root `vitest.config.ts`) on every push, PR, daily
   schedule and dispatch — §20 item 6 is a machine-enforced check from this
   commit forward, not a recorded local result.

No evidence record, gate result, tested-commit binding or roadmap state was
altered by this audit; the change is CI hardening plus this ledger entry.

## M2 directive §4 provenance preflight — finding and remediation (2026-11-07)

**Finding (material M1 conformance defect, honestly recorded):** the M1 domain
implementation carried a NON-canonical provenance shape:
`packages/gamos-domain/src/domain/capability-registry.ts` exported
`ProvenanceRef { publisher: "official"|"community"|"local"; source: string;
commitSha?; verifiedAt? }` and `plugin-trust.ts` exported
`PluginProvenance { publisher: "official"|"gamos-tl"|"community"; source:
string; commitSha?; reviewRef? }` — while frozen contract 09 §4 defines
`gamos/provenance@2` as `publisher: "zcode-official"|"gamos-tl"|"community"`
with a STRUCTURED source (`{ type: "marketplace"; marketplaceId; version;
sha256 }` or `{ type: "repository"; repo; commitSha; path }`), optional
`surfaces`, `reviewedBy` and `reviewRef`. The two implementations also
diverged from each other. No M1 gate or evidence record claimed canonical
provenance conformance — the M1 gates exercised fail-closed registration and
the provenance field's presence — but the M1 journey's capability snapshot
(`evidence/phase-b/m1-closure-ci-evidence.json`) truthfully records the
legacy-shape provenance that ran at the time. **M1 history and evidence are
left intact.**

**Remediation (TDD, this change):** a canonical shared module
`packages/gamos-domain/src/domain/provenance.ts` implements
`gamos/provenance@2` exactly per contract 09 §4; BOTH capability records
(contract 02) and engine-plugin records (contract 03) now validate against
the same canonical semantics (one schema, two consumers). Legacy shapes fail
closed with structured reasons. Contract 09 was NOT modified (hash-protected;
the implementation was corrected to the contract, not vice versa). New
capability: `provenance-unresolvable` (contract 09 §3 rule 7 — explicit
disabled/rejected state when a provenance reference cannot be resolved,
injected as a pure resolver hook) and `provenance-surface-uncovered`
(uncovered shipped content fails closed). RED commit `b0bb1df7` (suite fails
on the missing canonical module; 183/183 existing tests unaffected) → GREEN
commit `6bbe16d5` (205/205 domain tests, 22 new canonical-conformance tests
covering all eight required preflight behaviors). The M1 journey CLI
(`scripts/gamos/m1-context-cli.ts`) now registers its capability with
canonical repository provenance carrying the exact CI commit
(`GAMOS_SOURCE_COMMIT`), so every future m1-e2e run exercises the canonical
chain.

## M2 progress record (2026-11-07, directive: docs/gamos/handoffs/2026-11-07-m2-engine-integrations.md)

**M2 status: `active` (correctly NOT complete — honest gate accounting below).**

Landed on `gamos/development` (PR #3 `c4c71e81`, PR #5 `c9c397a1`; M2 activated
at `9a5f17f7` after preflight verification of HEAD `a8da3bf4`, governance
compliant, roadmap validator green, `main` pristine):

1. **§4 provenance preflight (blocking prerequisite) — DONE.** Finding: the M1
   domain types diverged from frozen contract 09 §4 `gamos/provenance@2`
   (legacy publisher values, loose-string sources; capability and plugin shapes
   also differed from each other). Remediation via TDD (RED `b0bb1df7` → GREEN
   `6bbe16d5`): canonical shared provenance module consumed identically by
   capability records (contract 02) and engine-plugin records (contract 03);
   legacy shapes fail closed; `provenance-unresolvable` implements contract 09
   §3.7 (explicit disable). M1 history/evidence left intact; the finding +
   remediation are recorded above in this ledger. Contract 09 unmodified.
2. **M2.4 canonical capability records — DONE.** `gamos/engine-plugin@2`
   metadata validator (family-grammar predicates — never universal SemVer) +
   10 append-only capability records (unity×3, blender×4, babylon×3) with
   complete execution-safety metadata + canonical provenance + 3 shipped
   plugin metas (RED `fc8294b9` → GREEN `bf04b655`).
3. **M2.1/M2.2/M2.3 engine plugins — implemented (Worker A, RED→GREEN).**
   `apps/zcode-cli/packages/{unity,blender,babylon}-engine-plugin` following
   the exact upstream android-emulator conventions: typed zod operation
   schemas, real discovery with version gates, bounded argument-array process
   execution with tree-kill timeouts, reviewed bridge code only (Blender bpy
   bridges / Unity C# Editor methods — never arbitrary model-authored code),
   MCP stdio servers, honest unavailable states. Package tests: unity 54/54
   (real-editor integration honestly skipped — no licensed editor available),
   blender 26/26 (6 real-Blender-4.1.1 integration tests), babylon 35/35
   (6 real-Node/Vite integration tests).
4. **M2.5 Worker C adversarial suite — DONE.** RED `4b61b5f2` → GREEN
   `06319965`: `validateEnginePluginPackage` ties the three SHIPPED manifests
   to the domain trust contracts; adversarial matrix: cross-package capability
   smuggling (provider-identity ownership), legacy provenance, community
   reviewRef/least-privilege fail-closed, sandbox-wording prohibition,
   unresolvable-provenance explicit disable, unpermissioned-mutation rejection.
   Domain suite: **251/251**.
5. **Lifecycle registration — DONE (GAMOS-AUTH-0006).** The three plugins are
   first-class official plugins: official-plugin-definitions (default-off),
   SEA asset manifests (dist/mcp/server.js runtime paths), agent-CLI-chain
   required runtime builds, root pnpm-lock.yaml regenerated. Authorized via
   the sanctioned governance-rebaseline rotation (trust-anchor pin rotated to
   `0643288c…`, M1 precedent). Bootstrap/SEA alignment invariants verified.
6. **M2 CI — DONE and green.** `gamos-m2-e2e`: domain+contract job; REQUIRED
   Blender real-engine job (run `42356172068` @ `7757cc44`: real Blender 4.1.1
   provisioned with recorded tarball sha256 `ab2ea3fe…`, typed modify +
   engine-query verify, Cycles CPU render, OBJ/GLB/FBX exports, timeout
   tree-kill — **M2-G2 engine layer proven on CI**); REQUIRED Babylon
   real-toolchain job (reproducible npm ci, vite build + sha, dev-server +
   HTTP health + stop, strictPort fail-closed); honest Unity gate-status job
   (records `M2-G1: unavailable-license` — never fabricated; a licensed
   self-hosted runner with `UNITY_EDITOR_PATH` flips it to editor-verified).
   Governance green on the merged head; m1-e2e regression green on `f3e12f94`
   (the app builds and the M1 journey passes with the engine plugins in the
   agent CLI chain).

**M2 handoff audit (§12 "audit every clause … close any remaining soft
spots") — closed 2026-11-07, branch gamos/roadmap-m2-journeys:**

1. **Shipped provenance exactness (contract 09 §4):** the three plugin
   manifests + the domain records carried a synthetic `"9a5f17f7".repeat(5)`
   commitSha (40-hex format-valid, NOT a real commit object; the in-code
   "replaced at integration time" replacement never happened). RED
   `bc830b2f` → GREEN `e1d06c77`: all shipped surfaces now carry the REAL
   source-of-record commit `c9c397a1` (PR #5 integration merge, CI run
   42356695328), exported as `M2_ENGINE_PLUGIN_SOURCE_COMMIT`; 3 new
   realness tests (254/254 domain); the m2-e2e domain job additionally
   verifies object-realness with `git cat-file` on a full-history checkout.
2. **Desktop packaging chain (directive §5 M2.5 "prove the three plugins are
   handled by the existing plugin lifecycle"):** the packaged-app staging
   list (`packages/desktop/scripts/prepare-agent-node-bundle.mjs`
   officialPluginPackages) omitted the engine plugins — a packaged desktop
   app could never seed them (the exact restore-legacy-sessions defect
   class that file documents). Three additive android-emulator-pattern
   entries, authorized via GAMOS-AUTH-0007 + sanctioned rebaseline rotation.
3. **§9 in-app journeys — BUILT and passing (local run17, verdict=pass, all
   M2J0–M2J7; CI job `m2-engine-journey` reruns them):**
   `scripts/gamos/m2-ui-journey.mjs` + `m2-local-model-server.mjs` +
   `m2-capability-cli.ts`. The journeys drive the ORIGINAL app: the three
   engine plugins enabled through the REAL Settings→Plugins toggles
   (on-disk `plugins.enabledPlugins` verified; app restarted so the session
   agent resolves the engine MCP servers — engine tools offered: 11);
   Blender leg = permission DENIAL blocks the mutation (hash unchanged, no
   artifact) then the approved turn runs the REAL modify+render through the
   app's MCP plugin path (scene.blend mutated + PNG magic/sha256); Babylon
   leg = REAL vite build (dist sha256) + REAL dev-server run + THE ORIGINAL
   ZCODE BROWSER verifying the running experience (in-guest reads: URL +
   canvas + `__GAMOS_BABYLON_READY__` + live render loop at ~60fps with a
   live scene graph) + project_stop cancellation (port verified freed);
   Unity leg = the honest negative path (real marker inspection; structured
   `unity-editor-unavailable` from the mutation — never fabricated); the
   session store records all three engines' tool invocations + results.
   Model endpoint: deterministic local Anthropic-Messages endpoint
   (disclosed in every evidence artifact; engine tool calls are matched
   against the tool list the app ACTUALLY offers — the transcript records
   it; no fabricated tool names).
4. **GAMOS-AUTH-0008:** three additive `.gitignore` entries for the journey
   runtime dirs (sanctioned rebaseline rotation).

**M2 handoff re-audit + evidence closure (2026-11-07, second pass on the merged
head `9c775ad8`):**

Every clause of the directive was re-verified against the merged repository
state, and the three remaining soft spots found were closed:

1. **The `m2-engine-journey` CI evidence leg is now COMPLETE:** run
   `42379468980` on the merged development head `9c775ad8` (PR #6) passed all
   five `gamos-m2-e2e` jobs — domain+contracts, real-Blender (M2-G2), real
   Babylon toolchain (M2-G3 engine layer), honest Unity gate status, and the
   §9 in-app journeys (verdict `pass`, M2J0–M2J7; journey artifact verified:
   Blender denial-then-approved mutation with saved `.blend` + rendered PNG
   sha256s, Babylon real build/dev-server + ORIGINAL ZCode Browser
   verification with live render-loop reads, Unity honest-negative). The
   sibling workflows on the same head are green (governance `42379469020`,
   m1-e2e `42379469001`). With this run, **M2-G2 and M2-G3 have both evidence
   layers CI-proven** (engine layer + §9 in-app journey).
2. **Evidence-fidelity fix (blender gate status):** the M2-G2 gate-status JSON
   carried the literal `${BLENDER_TARBALL_SHA256}` placeholder because the
   quoted heredoc blocked shell expansion (the tarball hash was genuinely
   verified in-run via `sha256sum --check --strict`; only the recorded JSON was
   wrong). Fixed to the Actions template form `${{ env.BLENDER_TARBALL_SHA256 }}`
   so the machine-readable record now carries the real hash.
3. **Evidence-retention fix (journey gate statuses):** the three journey-leg
   gate-status records were written above the artifact upload root and existed
   only in job logs; they are now written into `evidence/phase-m2/journey-ci/`
   and retained in the `m2-journey-*` artifact.

Local re-verification on the audited tree: roadmap-check green; roadmap
self-test 12/12; governance compliant with the rotated trust-anchor pin
(`7bb6e0bc…`, GAMOS-AUTH-0006/0007/0008/0009 rebaseline chain — the M1-era
`da3fbbd9…` pin is superseded history); gamos-domain 254/254; unity plugin
51 passed + 3 honest real-editor skips; architecture check 0 violations;
shipped provenance exactness re-verified (all three manifests carry the real
commit `c9c397a1…`, resolves via `git cat-file`).

**Remaining before M2 can be declared complete (exact gates):**

- **M2-G1 (Unity real integration) — the sole remaining gate:** requires a
  runner with a licensed Unity Editor — an external, user-controlled
  prerequisite (Unity Personal/Pro activation credentials). The invocation
  layer is fully implemented and scratch-verified against conforming editor
  emulations (license-required negative path, full add-cube verification,
  build artifact, timeouts), the CI job honestly records the
  `unavailable-license` state, and the §9 journey proves the honest negative
  path end-to-end through the app. Provision `UNITY_EDITOR_PATH` on a
  licensed runner to close the gate (the `unity-engine-status` job then runs
  the real integration and records `editor-verified`).
- **evidence/roadmap/M2.json + ROADMAP.json promotion:** correctly blocked
  until M2-G1 passes (roadmap validator enforces one passed result for every
  required gate with committed, hash-recomputable evidence paths; no
  completion is claimed now). M2-G2/M2-G3/M2-G4/M2-G5 evidence legs are
  complete and CI-recorded per above.

**M2-G1 Unity Personal licensing investigation (2026-11-07, maintainer
directive: no paid Unity licenses — investigate Unity Personal; full report:
`docs/gamos/UNITY-M2G1-PROVISIONING.md`, evidence:
`evidence/phase-m2/unity-personal-investigation/`):**

1. **Eligibility (task 1):** verified against the official `unity.com/pricing`
   terms — Unity Personal is $0 for small businesses/individuals whose
   aggregate gross revenue **and** funding are **< $200K USD** (trailing 12
   months; service-provider client test applies). Gamos is a games/entertainment
   application (Industry plan inapplicable). **Eligibility is NOT assumed —
   the org's revenue/funding figures are a maintainer attestation item.**
2. **Least-expensive compliant provisioning (task 2):** $0 — Unity 6
   6000.0.23f1 Linux Editor (free official download; revision hash bound to the
   committed fixture's `ProjectVersion.txt`) + Unity Personal activation via
   Unity Hub (the only officially documented Personal activation path; CLI/serial
   activation is Pro-only; manual `.ulf` activation is Enterprise/Industry-only
   — all quotes committed as evidence).
3. **CI/build-machine licensing (task 3):** the retrievable official text
   (ToS "Authorized Users", node-locked-per-user machines, named-user/serial/
   floating models, build-server rate-limit acknowledgment) does NOT contain
   the decisive clause; `unity.com/legal/software-terms` is bot/geo-blocked
   from the sandbox network — **the Personal machine-count / build-machine
   clause is an explicit verification gap the maintainer must read from a
   normal browser** before any CI license activation is relied upon. The
   GameCI community mechanism is recorded as third-party reference, not terms.
4. **Existing-machine preference (tasks 4–5):** the dev sandbox cannot host
   the editor (3.7 GB free disk vs ~13 GB peak need; 3.9 GB RAM; recorded with
   command output as evidence). GitHub-hosted runners can host the editor
   binary (Blender precedent) but cannot host the license (no credentials; and
   the terms position is unverified). The compliant free path is a
   maintainer-provisioned **self-hosted runner** where the eligible account
   activates Personal through Unity Hub; credentials/license material stay
   outside Git and CI artifacts per the directive (runbook §6 of the report).
5. **Execution (task 6):** no compliant activated runner is currently
   provisionable in this environment (no Unity account credentials exist, and
   none may be fabricated). The real integration tests therefore did NOT run
   against a licensed editor. **M2-G1 stays BLOCKED** (task 7) — exactly what
   is missing is recorded in the report §7: maintainer eligibility attestation,
   Software-Terms verification, Unity account + activation, and a licensed
   runner.
6. **Honest-evidence hardening shipped alongside:** the `unity-engine-status`
   CI job previously wrote `editor-verified` whenever `UNITY_EDITOR_PATH`
   merely pointed at an executable — a present-but-**unactivated** editor
   would have produced a fabricated pass-record. The job now derives the gate
   status from the integration suite's own machine evidence
   (`editorLicensed=true/false` markers; suite log retained in the artifact)
   with honest states for every outcome (`editor-verified`,
   `editor-present-unlicensed`, `editor-present-unverified`,
   `unavailable-license`, `suite-failed-no-gate-evidence`), and the
   self-hosted-runner path is plumbed via the `UNITY_RUNNER_LABEL` repository
   variable (default `ubuntu-latest` — zero behavior change until the
   maintainer sets it). Roadmap, contracts, plugin code and all Blender/Babylon
   work untouched.

## M2 final-closure audit execution (2026-11-08, directive: docs/gamos/handoffs/2026-11-07-m2-final-closure-and-m3-handoff.md)

Directive received against audited starting commit `0cf1afc7`; executed with
strict TDD where behavior changed. All commits on `gamos/development`
(TL-integrated); `main` untouched; M2 remains **active** — no completion
bundle exists and none is fabricated.

1. **Handoff persisted** (`2ba31dda`): the full final-closure directive under
   `docs/gamos/handoffs/2026-11-07-m2-final-closure-and-m3-handoff.md` with the
   standard binding authority note (subordinate to ROADMAP.json).
2. **M2-A (P0) — Unity gate-status classifier false positive CLOSED**
   (RED `fec6dd31` → GREEN `919d3ea7` → INTEGRATE `4cb9a7c3`): the preflight
   console marker `editorLicensed=true` was printed BEFORE the real
   integration tests ran, so a licensed editor could pass preflight and then
   fail scene modification or the player build while the `always()` status
   step still wrote `editor-verified`. The unity CI job now runs the suite
   with dual reporters (default + JSON per-test results), captures the suite
   exit code via `PIPESTATUS[0]` (independent of tee/pipefail), and a
   test-covered classifier (`packages/gamos-domain/src/domain/unity-gate-status.ts`
   + `scripts/gamos/m2-unity-gate-status.ts`, 25 unit tests incl. the exact
   defect case, contradictory markers, malformed/missing evidence, skipped
   required tests, unverified artifacts) derives the status from
   machine-readable evidence ONLY. `editor-verified` requires: real editor +
   exact version + exit 0 + every required real-editor test passed with none
   skipped + verified mutation and build artifacts. Verified end-to-end on
   this machine: the no-editor state records `unavailable-license`; a
   simulated licensed-preflight-then-failure records
   `licensed-editor-integration-failed`.
3. **M2-B (P1) — exact Unity version contract** (RED `f6726b3a` → GREEN
   `dccf32e1`): the fixture pins `6000.0.23f1` (revision
   `ab2b18a5f80dcba39fd8f5ee57b07edc7c0f600f`); the old 2022.3+ floor would
   silently accept any newer-or-older editor. `parseProjectVersionFile`,
   revision extraction and `checkUnityVersionContract` implement the EXACT
   contract (older AND newer editors are incompatible; revision checked where
   the editor's `-version` output exposes it; missing/malformed metadata
   fails closed). The integration suite enforces it and the classifier
   records `editor-present-version-incompatible` — never licensed/verified.
4. **M2-C (P0) — Software-Terms verification gap CLOSED** (`66589fe4`): the
   Unity Editor Software Terms was retrieved from its LIVE canonical URL
   (`https://unity.com/legal/editor-terms-of-service/software`, discovered via
   the official Legal Information index; the legacy `/legal/software-terms`
   URL serves a bot-blocked 404 shell) and committed verbatim
   (`evidence/phase-m2/unity-personal-investigation/software-terms-excerpt.txt`,
   §1.1/§2.1/§2.4/§2.5/§2.8 + honest reading notes; manifest hash-bound).
   Recorded conclusions: NO general grant permits an unattended build/CI
   machine to use a Personal license (§2.4 Build License is paid/Pro-only;
   §2.5 Build Server explicitly excludes Personal); §2.8 grants
   primary+secondary computers for a single person, one instance per seat,
   and its cloud-execution clause does not clearly permit third-party hosted
   cloud VMs — the self-hosted-runner runbook (Hub activation on the eligible
   user's existing machine) remains the documented compliant free path.
   **M2-G1 REMAINS BLOCKED** (attestation, account+activation, runner).
5. **M2-D (P1) — complete applicable plugin lifecycle PROVEN** (`6f3f4c6b`):
   new suites through the REAL facade (`bootstrap/tests/engine-plugin-lifecycle.test.ts`
   5/5, `cli/tests/plugin-host-refusal.test.ts` 2/2): catalog seeding,
   enable/disable/re-enable with exactly-once MCP registration for all three
   engine plugins, uninstall→suppression→restorableBuiltins→install-routes-to-restore→re-enable,
   version-changing marketplace update with runtime-root swap (no stale
   resolution), missing/corrupted runtime assets failing closed at the real
   host boundary. Already-covered requirements cited by exact test (version
   alignment, provenance/hashes, permission denial, cancellation, privilege
   disclosure).
6. **M2-E (P1) — honest cross-plugin regression evidence** (`d0588721`):
   `evidence/phase-m2/regression/m2-regression-evidence.json` records every
   suite on the exact tested commit: domain 279/279; unity 65 passed | 3
   SKIPPED (the required real-editor tests count NON-PASSING — no licensed
   editor; honest state `unavailable-license` per the classifier); REAL
   Blender 4.1.1 integration 6/6 (modify+hash, Cycles render, OBJ/GLB exports)
   on a sha256-verified tarball provisioned locally; REAL Babylon integration
   6/6 (npm ci, vite build, dev-server run/stop, strictPort fail-closed,
   timeout tree-kill); unit suites 20/20 + 29/29; bootstrap suites 71/71
   (after building the dist artifacts its requiredSeedPaths assertions depend
   on, and repairing the stale inherited official-marketplace pluginCount
   15→18 — a drift M2's additive engine-plugin registration introduced
   outside its CI path); cli host fail-closed 2/2; architecture 0 violations;
   roadmap-check valid; governance compliant (pin `7bb6e0bc…`).
7. **M2-F — gate verification + M3 prepared, NOT activated:** M2-G1 blocked;
   G2/G3 engine layers green locally (CI journey legs run on the integration-
   candidate head); G4 lifecycle proof strengthened; G5 regression recorded
   with the Unity suite non-passing. `ROADMAP.json` unchanged (M2 `active`,
   M3+ blocked by dependency — `roadmap-check.mjs` validates). No
   `evidence/roadmap/M2.json`. `docs/gamos/M3-PREPARED-PLAN.md` records the
   prepared (not started) M3 plan: work packages, the five quoted gates,
   architecture constraints (extend Dynamic Workflow only; additive
   resource-claim + asset-manifest contracts; FBX/GLB candidates to be
   verified by real compatibility tests) and the activation rule (only when
   M2 completes and the validator reports M3 ready).

8. **M3 activation (maintainer-authorized waiver, 2026-11-08):** The repository
   maintainer explicitly directed "you can proceed with M3"
   (`docs/gamos/ADR/0007-m3-maintainer-authorized-activation.md`, recorded
   verbatim in `ROADMAP.json` → `milestones[M3].activation_waiver`). The
   roadmap validator (`scripts/gamos/roadmap-check.mjs`) gained a fail-closed
   activation-waiver mechanism — TDD: RED `6af0f542` (self-test scenario 13
   assertion failure `[DEPENDENCY] M3 cannot be active before dependencies
   complete: M2` vs `[]`) → GREEN this commit (self-test 17/17). The waiver
   authorizes activation ONLY, never completion: M2 stays `active`, M2-G1 stays
   honestly blocked, no `evidence/roadmap/M2.json` exists, and an M3 completion
   bundle still requires M2 complete plus all five M3 gates passing. No
   baseline-tree or control file was modified (no pin rotation required).
   M3 implementation begins per `docs/gamos/M3-PREPARED-PLAN.md` §1–§6.

9. **M3 implementation opened — the two TL-owned foundational contracts are
   real and green (strict TDD), before any production pipeline per the
   final-closure handoff §6 ("define an additive, versioned cross-engine asset
   manifest before the production pipelines are implemented"):**
   - **M3.3 resource-claim contract `gamos/resource-claims@1`** (RED
     `5d438313` → GREEN `5596a105`): canonical workspace-confined
     claim paths (traversal/backslash/control/Windows-unsafe/non-ASCII/reserved
     devices fail closed), claim-set validation (exact schema version, enums,
     read-over-generated-output rejected, duplicates rejected), overlap
     semantics (equality, case-fold aliasing, segment-wise containment) and
     `findClaimConflicts` implementing handoff §5.3 rules 1–4 (unordered
     reads compatible; unordered read/write + write/write flagged; explicit or
     transitive `dependsOn` ordering is THE remediation — reasons say so, no
     silent serialization; case-aliased claims fail closed as
     ambiguous-alias). Integrated additively into the GamePlan wire format
     (`steps[].resourceClaims`, optional — unchanged plans hash
     byte-identically; claims are plan identity) with a parse-time conflict
     gate in `parseGamePlan`. 31/31 contract+integration tests.
   - **M3.4 asset-interchange manifest `gamos/asset-interchange@1`** (RED `a7f09532` →
     GREEN `39517fbd`): handoff §6 minimums — identity/provenance (five real
     engine families, exact versions, canonical paths, exporter capability),
     file integrity (path/mediaType/byteLength/64-hex sha256 for artifact and
     dependent textures), interchange semantics (format, handedness, upAxis,
     units, scaleFactor, uvChannels, materials, animation, unsupported
     warnings), target verification (importer, importedPath/importedSha256,
     validation, buildArtifact, evidence), exact field sets everywhere, status
     coupling (import-pending+ ⇒ target; imported+ ⇒ imported identity+hash;
     built+ ⇒ buildArtifact; runtime-verified ⇒ validation passed + evidence —
     a file on disk does not prove import), single-step forward transitions
     with failed/cancelled terminal, `matchesIntegrity` helper, canonical
     serialize + deterministic hash. 18/18 tests.
   - **Inherited-test repair:** `dynamic-workflow/tests/gamos-plan-acceptance.test.ts`
     was RED (3/3) from stale fixture drift — pre-revision-2 provenance
     vocabulary (`publisher: "official"`, loose string source) vs the
     canonical `gamos/provenance@2` structured shape (M2.4). Repaired to the
     canonical vocabulary with a real repository commit reference (same
     authorized inherited-test-repair class as the M2-F trust-anchor
     rotation); 3/3 green — the GamePlan→real-compiler acceptance also
     re-proves that the resource-claims integration still generates
     compiler-clean scripts.
   - **Module-cycle fix caught by `pnpm run architecture:check`:** the
     checker (correctly) counts type-only imports, so resource-claims.ts now
     declares a structural `ClaimableStep` view instead of importing
     `GamePlanStep` — dependency direction is game-plan → resource-claims
     only; architecture 0 violations (full check).
   - Regression on this head: gamos-domain 328/328 (22 files; +49 tests vs
     the M2-E record's 279), acceptance 3/3, governance compliant (pin
     `46c14c90…`, unchanged — no control files touched), governance
     self-test 14/14, roadmap self-test 17/17, roadmap-check valid (M2+M3
     active), architecture 0 violations, stale-phrases clean.
   - **No gate claim:** no M3-G1..G5 result is recorded — the pipelines
     (M3.1/M3.2 plugin operations, M3.3 generator/runtime integration, M3.5
     end-to-end journey + CI) are the next slices; M3-G1 stays honestly
     blocked while no compliant Unity licensed runner exists.

10. **M3.4/M3.1-source slice — the manifest-emitting Blender export (strict
    TDD, branch `gamos/m3-blender-manifest-export`):** the first production
    pipeline slice after the two foundational contracts, per the handoff §6/§7
    ordering ("define an additive, versioned cross-engine asset manifest
    before the production pipelines"). The real `blender/asset.export`
    operation now produces every manifest ingredient, and the domain gained
    the pipeline-side builder that turns a real export record into a
    validated manifest:
    - **Contract extension** (`asset-interchange.ts`): the optional top-level
      `dependencies` integrity array (handoff §6 file-integrity minimum —
      "dependent texture/material files and their hashes"; OBJ `.mtl`
      sidecars are material libraries, not textures). Additive: manifests
      without dependencies parse unchanged; every dependent file is validated
      exactly like the artifact (canonical path, 64-hex sha256, positive
      byteLength).
    - **Builder** (`asset-interchange-build.ts`, exported through
      `contract.ts`): `buildExportedManifest` constructs a
      `status:"exported"` manifest from a real export record and validates it
      through `parseAssetInterchangeManifest` — `source.assetSha256`
      REQUIRED (tight provenance), only the reviewed real-exporter formats
      (fbx/glb/gltf/obj), image/* dependents additionally populate
      `interchange.textures`, canonical key-order-independent hash. RED
      `38263157` ("unknown field \"dependencies\"" + Cannot-find-module, 0
      tests run) → GREEN `576c0e5d` (28/28; domain 338/338).
    - **Export operation** (blender-engine-plugin): optional
      `interchange {upAxis y|z, globalScale?}` input plumbed to the REAL
      exporter kwargs (verified against the Blender 4.1.1 operator surface by
      direct probe — FBX `axis_up`/`axis_forward`/`global_scale`, OBJ
      `up_axis`/`forward_axis`/`global_scale`, glTF `export_yup`; GLTF has no
      global scale → the combination fails closed at the typed boundary AND
      bridge-side); the bridge echoes the applied settings (observed, never
      assumed), reports `bpy.app.version_string`, scene unit scale, deduped
      material names, and discovers dependent files via a bounded
      before/after directory snapshot diff with per-file sha256; the engine
      re-verifies every dependent record (missing/empty/hash-or-size
      mismatch → structured failure — a lying bridge cannot fabricate
      integrity) and mandates the Blender version (source provenance). Result
      gains `blenderVersion`, `sourceSha256` (the .blend hashed as exported),
      `unitScale`, `appliedInterchange` (format/handedness/upAxis/forwardAxis/
      units/scaleFactor/appliedTransforms/materials), `dependentFiles` with
      media types. The capability record in `engine-plugin.ts` gained the
      additive input/output schemas + interchange-inclusive dedupeKey. RED
      `11aaffd3` (5 unit + 3 integration assertion failures, 6 pre-existing
      green) → GREEN `7420967a` → HARDEN `c0655b6f`
      (`verifyExportDependentFileRecords` extracted + 7 adversarial
      failure-path tests).
    - **Real-engine INTEGRATE evidence (Blender 4.1.1,
      `BLENDER_PATH=/home/z/engines/blender-4.1.1-linux-x64/blender`,
      tarball sha256 `ab2ea3fe…` identical to the CI pin):**
      `engine-real-blender.integration.test.ts` 9/9 — the FBX
      manifest-ingredient test exports with declared `{upAxis y, globalScale
      2}`, asserts `blenderVersion=4.1.1`, `sourceSha256` equal to an
      independent re-hash of the .blend, `appliedInterchange`
      `{fbx,right,y,-z,meter,scaleFactor 2}`, builds the manifest through the
      real domain builder (imported cross-package in the test, same precedent
      as the dynamic-workflow acceptance suite) and verifies
      `matchesIntegrity(artifact)` against an independent re-hash
      (manifestHash `222d338a…`); the OBJ test proves the `.mtl` sidecar
      (254 bytes) is discovered, hashed and re-verified; the GLB test proves
      embedded materials (zero dependents) and the `glTF` magic bytes.
    - Regression on this head: gamos-domain 23 files 338/338; blender plugin
      5 files 42/42 (real engine) + `tsc --noEmit` + `pnpm run build` (tsc +
      esbuild MCP bundle) clean; unity/babylon plugin typechecks clean;
      dynamic-workflow 2037/2037 (after `node scripts/generate-libs.mjs` +
      `pnpm run build` — the codegen/dist prerequisites are environment
      steps, not source changes), acceptance 3/3; architecture:check 0
      violations; governance-check compliant (pin `46c14c90…` unchanged —
      additive surfaces only, no ledger entry required);
      governance-self-test 14/14; roadmap-self-test 17/17; roadmap-check
      valid (M2+M3 active).
    - **No gate claim:** this is the source leg of M3-G1/M3-G2 only — no
      gate result is recorded. The target legs (Unity typed import, Babylon
      typed integration), the M3.3 generator/runtime integration, the M3.5
      journey and the M3 CI remain open; M3-G1 stays honestly blocked while
      no compliant Unity licensed runner exists.
