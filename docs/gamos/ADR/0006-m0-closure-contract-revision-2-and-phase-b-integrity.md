# ADR-0006 — Phase-0 Contract Revision 2 (M0-closure corrections) and Phase B test integrity

- Status: accepted (2026-11-05)
- Deciders: Gamos TL (payswapdotorg), per the architect "Phase B Test Integrity and M0
  Closure" re-review of the `gamos/development` work
- Authorization: `GAMOS-AUTH-0004` (complete `gamos/authorization@2` entry, content-bound)
- Supersedes: none; amends ADR-0004-protected contract control files via the sanctioned
  re-baselining process (`scripts/gamos/governance-rebaseline.mjs`)

## Context

The architect re-review accepted the fork/upstream preservation, governance v2 and its
CI runs, the Phase-0 contract revisions A–E **subject to two corrections**, the
sandbox-floor/CI-ceiling strategy, and the decision to verify the original ZCode
application. It then directed (M0 closure):

1. Correct the remaining contract issues: (A) keep `GameSpec` exactly compatible with
   the upstream PlayLiquid `GameIRDocument`, move Gamos-specific acceptance criteria
   into GamePlan or a separate acceptance record, and add no parallel/extended GameIR
   document schema; (B) plugin execution security — distinguish capability-invocation
   approval from actual OS-process access, document the filesystem/network/environment
   authority available to MCP processes, define the least-privilege execution strategy
   for community engine plugins, and make user disclosure/approval reflect the actual
   process privileges.
2. Repair the Phase B journey test (result integrity; original New Task with exact
   artifact verification; real Terminal command + exact output; Review approve AND
   reject; real embedded Browser navigation + loaded URL/content; Marketplace identity
   + install + checksum; session recovery; CDP input simulation; onboarding without
   silent skips).
3. Keep the four passing inherited specs; investigate the excluded upstream-provider
   spec via a legitimate recorded replay fixture or a separate live-provider test;
   keep its status explicitly excluded until actually executed.
4. Run the corrected journey and inherited E2E on GitHub Actions; commit a close-out
   evidence record; update `IMPLEMENTATION-STATUS.md` only after evidence exists.

## Decision

### 1. Contract revisions (revision 2, corrections A/B)

| Contract | Correction | Substance |
|---|---|---|
| 01 | A | **Exact compatibility**: `GameSpec` IS a PlayLiquid `GameIRDocument` and nothing more — the field set is exactly `irVersion`/`identity`/`lifecycle?`/`world?`/`entry`/`nodes`; no `acceptance` field, no Gamos extensions; upstream validation is the only document-level validation |
| 01 | A | Acceptance criteria moved to the GamePlan / separate acceptance record (§3); a GameSpec carrying an `acceptance` section is a schema violation |
| 05 | A | GamePlan carries the acceptance checks / separate acceptance record; explicit prohibition on acceptance structure in the GameSpec |
| 09 | B | §2.5: capability-invocation approval ≠ actual OS-process access (approval governs the agent tool call only and must not be presented as limiting/vouching for process authority) |
| 09 | B | §3.2: explicit authority inventory for MCP processes — filesystem (full user-account reach incl. `~/.zcode`), network (unrestricted outbound + loopback), environment (full spawn env) |
| 09 | B | §3.4: least-privilege execution strategy for community engine plugins (env minimization + working-directory containment MUST; dedicated low-privilege OS context SHOULD, platform-gated; fallback = honest disclosure + explicit approval of FULL authority; no self-widening) |
| 09 | B | §3.5: install-time disclosure names the regime actually in effect and the approval covers THAT regime; "sandboxed" wording prohibited for MCP processes |
| 06 | B | §2.5: approval layers distinguished — an approval authorizes a capability invocation only; never a grant of plugin/MCP OS-process authority (cross-ref 09 §2.5/§3) nor repository-governance authorization |

Governance was NOT weakened: the revisions went through the complete
`gamos/authorization@2` entry (`GAMOS-AUTH-0004`) with per-file `content_sha256`,
trust-anchor pin rotation via `governance-rebaseline.mjs --fill-auto --write-workflow-pin`,
and the full self-test suite (tamper-rejection scenarios) re-run against the revised
controls.

### 2. Phase B journey test integrity (rev 2 of `scripts/gamos/phase-b-ui-journey.mjs`)

- **Result integrity:** all stages S0–S9 are mandatory; exit code 0 only when every
  mandatory stage records `pass`; `partial`/`skipped`/`fail`/missing all yield non-zero
  exits; `journey-evidence.json` carries `summary.verdict` plus machine-readable
  `non_pass_stages`/`missing_stages` lists.
- **Input simulation:** all UI interactions go through the CDP Input domain
  (`Input.dispatchMouseEvent`, `Input.insertText`, `Input.dispatchKeyEvent`). Page-side
  JS only locates elements (scrollIntoView + rect). No synthetic DOM MouseEvents.
- **New Task (S3):** real task through the original composer with the real model;
  turn-completion detection follows the upstream contract (pane sessionId ≠ draft, no
  stop button, rows present, 6s idle); exact artifact path AND exact content match
  required for pass.
- **Terminal (S5):** the real xterm surface (`terminal-toggle` → `[data-testid=terminal]
  .xterm-rows`), real shell prompt, a unique harmless command typed via CDP into the
  focused xterm, and exact output verified from the rendered rows.
- **Review (S6):** "Ask before changes" enabled through the real mode selector; prompts
  asserted to be the real permission surface (`role=listbox` aria-label
  "Permission required" with `data-permission-option-kind` options and a Confirm
  button); approve verified by the exact file modification; reject verified by the
  modification NOT being applied while the earlier approved change survives.
- **Browser (S7):** the real `<webview>` guest; navigation via the real address bar;
  the guest's actual loaded URL and page content verified over CDP by attaching to the
  guest target (plus webview getURL/src as corroborating evidence).
- **Marketplace (S8):** the real store view; a specific plugin identity
  (`data-plugin-id="github@zcode-plugins-official"`); real install; installed state
  verified in the UI and on disk (`installed_plugins.json` record + install path);
  package checksum verified against the official marketplace manifest (declared sha256
  vs independently downloaded archive; the installer itself enforces the same digest).
- **Session recovery (S9):** the exact session id created in S3 is reopened from the
  task list after a full app restart; conversation history and the artifact must both
  survive.
- **Onboarding (S1):** the wizard is walked step-by-step (occupation card → Coding mode
  → preferences → Get started) with each step recorded; no Skip/Back is used; a fresh
  `PHASEB_HOME` is required so the first-run wizard is actually exercised.
- **Isolation:** HOME/USERPROFILE/`ZCODE_DATA_BASE_DIR`/`ZCODE_DESKTOP_HOME_DIR` all
  point at `PHASEB_HOME` (the upstream E2E isolation pattern), so provider config and
  workspace state are fully isolated and verifiable on disk.

### 3. Inherited desktop E2E and the excluded upstream-provider spec

The four verified specs continue to run (container path). The excluded
`upstream-provider.test.ts` is investigated:

- The upstream suite supports a **capture mode** (`E2E_NETWORK_MODE=capture` +
  `E2E_PROVIDER_PRESET=env` + real `E2E_PROVIDER_API_KEY`/`E2E_PROVIDER_BASE_URL`)
  which runs the spec against a LIVE provider through a capture proxy and records a
  header-redacted capture artifact — a legitimate recorded-replay fixture can later be
  produced from it, or the same run itself stands as the separate live-provider test.
- A dedicated CI job (`upstream-provider-live`) runs exactly this: the spec, in
  capture mode, with the real OpenRouter key from the repo secret. Its status remains
  **excluded** from the default preset until a run actually passes; the evidence
  record then cites the passing run (or honestly records the failure).
- No claim is made that the complete upstream suite passes based on any subset.

### 4. CI and evidence

`gamos-phase-b-e2e.yml` gains the corrected journey (strict verdict gates the job) and
the live upstream-provider job. The close-out evidence record
(`docs/gamos/MILESTONE-CLOSEOUT-EVIDENCE.md` or the evidence tree) cites the workflow
run URL/ID, commit SHA, job results and attempts, per-stage S0–S9 results, sanitized
logs, real application screenshots, artifact verification results, and explicit
exclusions/limitations — committed only after the runs complete.
`IMPLEMENTATION-STATUS.md` is updated only from that verified evidence.

## Consequences

- M0 acceptance now rests on: governance checks green; the original desktop app
  building and launching on CI; the strict-verdict journey passing all ten mandatory
  stages on the production renderer; approve AND reject verified; Terminal and Browser
  interactions verified; Marketplace install + checksum verified; session recovery
  verified; the inherited E2E results and exclusions honestly recorded (including the
  live upstream-provider run); all evidence committed and linked to the actual run.
- Workers A/B/C remain prepared but gated on M0 acceptance (no broad engine
  implementation begins before it).
- The journey script remains additive evidence tooling: no protected sources touched,
  isolated `PHASEB_HOME`, no repository mutation; the OpenRouter key lives only in the
  encrypted repo secret and is never written to evidence artifacts.
