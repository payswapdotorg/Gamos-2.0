# Gamos M4 — Delivery Plan (TL) — PRE-ACTIVATION PREPARATION ARTIFACT

> **Authority note (binding):** This document is an ISOLATED, NON-IMPLEMENTATION
> preparation artifact produced under the maintainer's final delivery handoff
> ("Gamos M4 — Final Delivery Handoff", received 2026-11-09 against the accepted
> baseline `48ce1fd3`). It lives on the isolated branch
> `gamos/m4-delivery-plan` and contains zero production implementation. It is
> subordinate to `docs/gamos/ROADMAP.json` (the sole milestone authority), the
> frozen contracts under `docs/gamos/contracts/`, the corrected
> `docs/gamos/M4-READINESS.md` (the implementation design baseline), and
> repository governance. **M4 remains `planned` (blocked).** Nothing in this
> file activates M4, changes any milestone status, weakens the two-active
> limit (M2 and M3 occupy both slots), or claims any M4 acceptance gate. This
> branch must not be merged into `gamos/development` before the activation
> condition in §2 legitimately holds.

**Prepared:** 2026-11-09 (late), by the Gamos TL, as the first act of taking
ownership of M4 delivery per handoff §13 ("Begin only the permitted
preparation work while the activation condition is blocked").

**Purpose:** translate the accepted execution contract (the handoff) into a
tracked, verifiable delivery ledger: the activation checkpoint procedure, the
work-package sequence with entry/exit conditions, the TDD slice discipline,
the binding security requirements, the capability-record design, the
independent challenge matrices, the exact regression commands, and the
evidence/completion checklist. When M4 is legitimately activated, this ledger
becomes the execution order of record; until then it is a plan only.

---

## 1 — Verified baseline and references

| Item | Value | Verification |
|---|---|---|
| Baseline commit | `48ce1fd3f1fae2aee56956f7d8e62c97607debeb` | local HEAD = `origin/gamos/development` (clean, in sync), 2026-11-09 |
| Readiness correction | ACCEPTED by the maintainer | handoff §2; correction record = readiness §13 |
| CI on baseline | run `42653780731` (`gamos-governance` #223, push, 2026-11-09T16:20:40Z) | all three jobs `success` (Governance baseline & protected surfaces; Governance self-test tamper rejection; Upstream architecture gate) — verified via authenticated API 2026-11-09 |
| Design baseline | `docs/gamos/M4-READINESS.md` (552 lines, corrected) | §2.2 Unreal corrections, §4.1 Godot trust boundary, §12 four-condition activation |
| Execution contract | the final delivery handoff (this plan's source) | §13 final instruction |
| Normative roadmap | `docs/gamos/ROADMAP.json` | M0/M1 complete; M2 active (M2-G1 blocked); M3 active under ADR-0007; M4–M7 planned; `parallel_active_milestones_max: 2` — both slots occupied |
| Governance pin | `631f3383f78dc922de241fce264ae0aec874abb7ec39b8070e4b5388a0972446` | unchanged |

## 2 — Activation checkpoint (order 0; owner TL)

M4 production implementation must not begin until the roadmap validator
accepts a legitimate activation transition. ALL FOUR conditions are required
(readiness §12, binding; handoff §3, verbatim in force):

1. **Dependency:** M2 is complete, OR a valid maintainer-authorized waiver
   for M4 exists.
2. **Waiver ADR:** any waiver has its committed ADR decision record
   (ADR-0007 precedent: a waiver authorizes activation only — never
   completion).
3. **An available active-milestone slot.** A waiver does NOT override the
   active-milestone limit. The configured maximum must not be changed, no
   active milestone may be demoted, and M2/M3 requirements must not be
   weakened to force M4 activation.
4. **A passing roadmap validator run** on the activation commit.

**Intended route (roadmap-derived):** complete M2 → release the M2 active
slot → activate M4 → deliver M4 alongside M3.

**Activation procedure (TL checklist, executed only when the dependency
condition is real):**

1. Verify M2 completion evidence honestly: `evidence/roadmap/M2.json` with
   exactly one passing result for every required M2 gate, bound to its tested
   commit and green CI, and the validator green on that commit. M2-G1
   requires the real licensed Unity Editor integration maintained
   maintainer-side per `docs/gamos/UNITY-M2G1-PROVISIONING.md` §7–§9. It
   must never be fabricated, weakened, substituted with another engine, or
   claimed passed without the required evidence.
2. Confirm the slot arithmetic: fewer than two active milestones after the M2
   `complete` transition.
3. If the waiver path is used instead, require the maintainer's explicit
   authorization plus its committed ADR, then still re-confirm a free slot
   (condition 3 is independent — a waiver does not open one).
4. Edit `docs/gamos/ROADMAP.json`: M4 `planned → active` on the activation
   commit. Nothing else changes in that commit.
5. Run the full local chain on the activation commit (§8 commands; all legs
   green, including `node scripts/gamos/roadmap-check.mjs` reporting the
   milestones valid with M4 active and the active count at the limit).
6. Push; require CI green on the activation commit; then open order 1.

**Forbidden accelerations (all fail-closed):** changing
`parallel_active_milestones_max`; demoting or completing M2/M3 without their
own gates' evidence; weakening any M2/M3 requirement; any M4 production
implementation PR merged before the transition above; claiming M4 `active`
or any gate `passed` anywhere before its real evidence exists.

## 3 — Work-package ledger (orders 1–9 after activation)

Owners and scope per handoff §4/§7 and roadmap work packages M4.1–M4.4.
Entry conditions are hard: a work package does not start while its entry
condition is unmet.

| Order | Work package | Owner | Entry conditions | Exit conditions |
|---|---|---|---|---|
| 1 | WP-1 Godot capability records, plugin meta, registry tests (M4.3) | Worker B | activation checkpoint green (§2) | every declared `godot/*` capability resolves to a complete registered `CapabilityRecord`; plugin-meta registration validation green; registry tests green |
| 2 | WP-2 Godot discovery + typed plugin operations (M4.1) | Worker A | WP-1 records registered | executable discovery + version verification real; `project.godot` project discovery real; typed scene inspect/modify, script check, asset import, headless run, headless export, output inspection, timeouts/cancellation/process-tree cleanup, structured failures, honest availability — all through the committed data-only GDScript bridge; no user text interpolated into GDScript |
| 3 | WP-3 Real Blender→Godot asset/project integration (M4.1) | Worker A | WP-2 typed ops green | a real cross-engine hop Blender→Godot with engine read-back verification (readiness §4.1 verification column is the contract) |
| 4 | WP-4 Unreal capability records + honest availability (M4.3) | Worker B | WP-1..3 merged or parallel-safe; TL contract sign-off | every declared `unreal/*` capability resolves to a complete registered record with honest `unavailable` states where the editor is absent |
| 5 | WP-5 Unreal connector + protocol contract tests (M4.2) | Worker A | WP-4 records registered | HTTP/WS lifecycle, loopback-only client config, actual server-listener verification, typed object inspection, typed property read/write, individually allowlisted function invocation, snapshot rollback + post-op verification, teardown/failure handling — contract-tested against a mock RC server (protocol contracts ONLY; a mock can never pass M4-G2) |
| 6 | WP-6 Real Unreal Editor integration + evidence (M4.2) | Worker A + maintainer | maintainer-provided UE5 Editor with Remote Control enabled (§10) | real authenticated-or-documented same-user trust-boundary connection, server-side listener verification, typed reversible operation with mutation approval, before/after + rollback verification, safe teardown with the editor still alive |
| 7 | WP-7 Godot/Unreal cross-engine planning legs (M4.3) | Worker B | the referenced capabilities are actually registered (never planned against unregistered capabilities) | cross-engine plan recognition of both engines as explicit targets; engine-family version grammar checks; fail-closed unknown/missing outcomes; no silent engine substitution |
| 8 | WP-8 Independent security review + permission integration (M4.4) | Worker C + TL | WP-2..WP-6 implementation slices present | every challenge-matrix row (§7) executed as a real negative test or explicitly N/A'd with cause; TL independent re-review of findings; all blocking security issues resolved; permission mapping wired through the existing ZCode permission broker |
| 9 | WP-9 Five-engine regression + final evidence (M4.4) | TL + all workers | WP-1..WP-8 done | full §8 matrix green on the M4 merge head; `evidence/roadmap/M4.json` complete per §9; roadmap completion evidence recorded; validator green on the completion commit |

Worker preparation during the blocked state is limited to §11. Isolated
worker branches are the norm for all implementation slices; the TL owns
shared contracts and integration points.

## 4 — TDD slice discipline and PR evidence bundle (binding for every slice)

Every implementation slice follows **RED → GREEN → HARDEN → INTEGRATE →
REGRESSION → EVIDENCE**:

- **RED:** the test fails because the required behavior is missing — not
  because of syntax, import or test-runner failure.
- **GREEN:** the minimal honest implementation.
- **HARDEN:** the negative tests (§7 rows relevant to the slice) land here.
- **INTEGRATE:** real application services and real engine execution (the
  gates' non-negotiable). Fixtures and mock servers may isolate deterministic
  unit boundaries; they cannot satisfy real engine gates.
- **REGRESSION:** the §8 rows relevant to the slice.
- **EVIDENCE:** the PR bundle.

Every PR carries: milestone and work-package IDs; contract clauses; files,
callers and execution paths; the RED test and its commit; the GREEN
implementation commit; hardening/negative tests; real integration evidence or
honest unavailability; regression results; artifact paths with SHA-256
values; the tested commit; the CI workflow URL. The final evidence file
follows `evidence/roadmap/PHASE-EVIDENCE-TEMPLATE.json` (exactly one result
per required gate; `workflow_run_head_sha` must equal `tested_commit`).

## 5 — Mandatory security requirements (binding summary)

### 5.1 Godot (every operation)

- Uses a real discovered Godot executable through the permission-gated ZCode
  execution path.
- Typed, validated operation inputs; the committed data-only GDScript
  bridge; user text is never interpolated into GDScript.
- Filesystem access confined to authorized workspaces; bounded output and
  execution time; cancellation and process-group termination supported.
- Resulting project state verified through engine read-back.
- **A successful process exit code alone does not prove a requested mutation
  occurred.**
- Launching Godot is NOT a sandbox: project scripts, editor plugins and
  import behavior are executable project-controlled code. Workspace
  boundaries and process privileges are disclosed and enforced (readiness
  §4.1 trust boundary).
- The verified Godot 4.2.2 runs so far are feasibility probes, not M4-G1
  acceptance.

### 5.2 Unreal (the connector)

- Enforces the same-user OS trust model: the boundary is the OS user owning
  the editor and Gamos processes, with Gamos permission-broker approval
  required for EVERY mutation. The Unreal Passphrase header is a
  transport-compatibility token only — never described as proof of
  server-side authentication.
- The client connecting to `127.0.0.1` proves nothing about server-side
  isolation. Before M4-G2 acceptance, verify: actual HTTP and WebSocket
  listening addresses; actual listening ports and sockets; loopback-only
  server binding; LAN unreachability from a second machine; mutation
  approval through the existing Gamos permission broker; rejection of
  operations outside the typed allowlist.
- No generic unrestricted `function.call`. Individually allowlisted typed
  function invocations only; unrestricted remote Python, remote
  console-command execution and arbitrary function execution are disabled.
- Transaction semantics per the documented contracts: property writes use
  `WRITE_TRANSACTION_ACCESS`; function calls use `generateTransaction: true`.
  Editor Undo History support is not a universal rollback guarantee. Every
  advertised reversible mutation carries the five-part chain: (1)
  pre-mutation snapshot; (2) typed operation; (3) expected post-mutation
  state; (4) verified rollback or compensating operation; (5) post-rollback
  verification against the snapshot. If reliable reversal cannot be
  demonstrated, the operation is not registered as reversible.
- The connector attaches to an editor it does not own: disconnecting must
  NEVER terminate the maintainer's Unreal Editor. Process-termination
  authority exists only for Gamos-supervisor-owned processes.
- Permission mapping: live-editor mutations map to the existing
  `engine-gui` permission semantics plus a loopback network permission —
  never described as headless execution (`engine-gui` is not satisfied by
  `engine-headless`; no downgrade). The record distinguishes all four:
  capability-invocation approval; mutation authorization; the OS privileges
  of the externally owned editor process; process ownership. No new
  permission system is created.

## 6 — Capability record design (Worker B, WP-1/WP-4; NOT registered here)

Every declared capability must resolve to a complete registered
`CapabilityRecord` in `packages/gamos-domain/src/domain/engine-plugin.ts`
schema (id, version, title, description, engineFamily, input, output,
permissions, availability, provenance, provider, prerequisites,
compatibility, reversibility, idempotency, timeout, cancellation,
verification) BEFORE the corresponding plugin metas are registered. Engine
compatibility uses the engine-family version grammar
(`packages/gamos-domain/src/domain/discovery/engine-versions.ts`), never a
universal SemVer assumption. Unknown versions, missing executables,
unavailable endpoints and missing authentication fail closed. The planner
never silently substitutes one engine for another.

| Capability | Class | Permission mapping (per readiness §5 table) | Reversibility registration rule |
|---|---|---|---|
| `godot/project.inspect` | read | `command-execution` (read-only scope) | read-only — no mutation |
| `godot/scene.modify` | mutation | `engine-headless` + `filesystem-write` (native-mutation gated) | reversible only with engine read-back verification of restored state |
| `godot/script.check` | read | `command-execution` (read-only) | read-only |
| `godot/asset.import` | mutation | `engine-headless` + `filesystem-write` | idempotent re-import; verified via imported-asset assertions |
| `godot/project.build` | mutation (artifact-producing) | `engine-headless` + `filesystem-write` | output artifacts verified by existence + sha256 + size bounds |
| `godot/project.run` | execution | `engine-headless` | headless run verification: exit 0 + no crash lines |
| `unreal/connection.inspect` | read | `network` (loopback-scoped) | read-only |
| `unreal/object.inspect` | read | `network` (loopback-scoped) | read-only |
| `unreal/property.read` | read | `network` (loopback-scoped) | read-only |
| `unreal/property.write` | mutation | `network-access` (loopback-rc-endpoint scope) + `engine-gui` (live-editor semantics) | reversible ONLY with the demonstrated five-part chain (§5.2); otherwise not registered reversible |
| `unreal/function.invoke` | mutation (per-function) | same as property.write; per-function registration, never a generic call | same five-part rule, per allowlisted function |

Registration of these records is production implementation (WP-1/WP-4) and
waits for activation. This table is the design contract only.

## 7 — Independent challenge matrices (Worker C, WP-8)

"Do not accept documentation-only answers where a negative test can establish
the behavior." Each row becomes a HARDEN-stage test in the owning slice or a
WP-8 challenge test; every row resolves to executed-evidence or a reasoned
N/A in the final evidence.

**Godot:** relative-path and traversal attacks; symlink escapes;
non-allowlisted operations; oversized or malformed input; malformed or
missing bridge reports; runaway processes (bounded time + process-group
kill); incorrect scene ownership and persistence (read-back verification);
missing or mismatched export templates (honest failure, no silent success).

**Unreal:** non-loopback listener binding; LAN access to the Remote Control
endpoint (negative reachability test from a second machine); passphrase
bypass and inconsistent route authentication; unapproved mutation (no
permission-broker approval → refusal); unallowlisted function execution;
invalid object paths; transaction and rollback failure (rollback verified
against the pre-snapshot, not assumed); socket teardown failure; accidental
termination of the externally owned editor (must be impossible).

## 8 — Regression matrix (exact commands; run on the M4 merge head)

| Handoff §10 row | Exact command(s) | Current green baseline (`48ce1fd3`) |
|---|---|---|
| Baseline-pinned governance check | `node scripts/gamos/governance-check.mjs --pin 631f3383f78dc922de241fce264ae0aec874abb7ec39b8070e4b5388a0972446` | compliant |
| Governance self-test | `node scripts/gamos/governance-self-test.mjs` | 14 scenarios: 14 ok, 0 failed |
| Roadmap self-test | `node scripts/gamos/roadmap-self-test.mjs` | 17 passed, 0 failed |
| Roadmap validator | `node scripts/gamos/roadmap-check.mjs` | milestones valid; M4 blocked (planned) |
| Stale phrases | `pnpm run docs:stale-phrases:check` | no stale doc phrases |
| Architecture checks | `pnpm run architecture:check` | violations: 0 |
| Gamos domain suite (incl. version grammar, registry/plugin-meta validation, engine-selection/unavailable tests) | `pnpm exec vitest run --project gamos-domain` | 383 passed (grows with WP-1/WP-4 records) |
| Cross-engine plan acceptance | `pnpm --filter @zcode/dynamic-workflow exec vitest run tests/gamos-plan-acceptance.test.ts` | 8 passed (grows with WP-7 legs) |
| Dynamic Workflow runtime suite, production journal/service, resume/cancel/failure recovery, real Blender regression | `BLENDER_PATH=/home/z/engines/blender-4.1.1-linux-x64/blender pnpm --filter @zcode/dynamic-workflow-runtime exec vitest run tests --no-file-parallelism` | 119 passed + 1 skipped (real Blender) |
| Application journeys (original ZCode parity, M1, M2, M3; then Godot + Unreal real journeys) | existing journey suites (m3-e2e CI pattern); Godot/Unreal journeys added by WP-2/WP-5/WP-6 | green at `48ce1fd3` per CI |
| Determinism tests | retained as-is in the suites above | retained |

The final M4 evidence is bound to the exact tested commit and successful CI
run; the roadmap validator recomputes committed artifact hashes.

## 9 — Evidence and completion checklist

Per-gate evidence plans (all four gates are required; no fixture, mock,
API-shape simulation or unit-only result satisfies any of them):

- **M4-G1 Godot real integration:** a real Godot project completes discovery,
  modification, headless execution, build/export, test/verification and
  evidence collection. Evidence includes the real Godot version, project
  identity, operations, outputs and hashes.
- **M4-G2 Unreal real integration:** authenticated or explicitly documented
  same-user trust-boundary connection; server-side listener verification; a
  typed reversible operation; mutation approval; before/after verification;
  rollback verification; safe teardown with the editor still alive. A mock
  Remote Control server can test protocol contracts but cannot pass this
  gate.
- **M4-G3 engine selection and availability:** honest conditional/unavailable
  outcomes for missing engine versions, unknown version formats, missing
  executables, missing project roots, missing authentication, missing Remote
  Control endpoints, invalid listener binding, display requirements and
  permission denial. No silent engine substitution.
- **M4-G4 five-engine regression:** all five engine suites and inherited
  ZCode journeys operational. Unity is never silently counted as successful
  if its real licensed integration is unavailable.

Completion is exactly the handoff §12 ten-condition list: G1–G4 passed with
real evidence; inherited ZCode regressions pass; artifacts and hashes
committed; CI green on the tested commit; `evidence/roadmap/M4.json` contains
exactly one passing result for every required gate; `ROADMAP.json` records
the matching completion evidence; the validator passes on the completion
commit. M4 cannot complete before M2 completes. M2, M3, ADR-0007 and the
active-milestone limit are never altered to accelerate M4 completion. The TL
does not create the completion record until all four gates have passed.

## 10 — External engine environments and honest availability

- **Godot:** the verified 4.2.2 installation recipe (readiness §7 runbook;
  binary sha256 `69eb9881e1b82ab93924c83106a7c031497f252bc0c08e199e4da6380072d6ef`,
  exact version string `4.2.2.stable.official.15073afe3`, selective export
  template extraction) is the starting point. The binary checksum and version
  are re-verified in CI on every use.
- **Unreal:** requires a maintainer-provided suitable UE5 Editor environment
  with Remote Control enabled. The present sandbox is not a valid Unreal
  Editor acceptance environment. Until a real Unreal Editor is available:
  protocol and contract development (WP-5) continues after activation; the
  real-engine acceptance leg (WP-6) stays blocked; M4-G2 is not claimed; the
  real editor is never replaced with a fixture.
- **Unity (M2 dependency context):** external licensed dependency; G4 never
  silently counts an unavailable Unity as a successful engine test.

## 11 — Pre-activation work permissions (current state)

Permitted while M4 is `planned` (blocked): isolated designs and
non-implementation test artifacts on isolated branches — this delivery plan;
contract/test-spec designs; environment recipes and verification runbooks;
evidence scaffolding specifications; honest status records.

Forbidden until §2 holds: any M4 production implementation PR merged (or
targeted at) `gamos/development`; registration of the §6 capability records
in production code; roadmap status changes; touching M2/M3, ADR-0007 or the
active-milestone configuration; any `active`/`complete`/gate-passed claim
for M4.

## 12 — Branch and merge policy for this artifact

This artifact lives only on `gamos/m4-delivery-plan` (isolated worker-branch
pattern). The governance workflow runs on every `gamos/**` push, so the
branch is CI-gated like any other. Merge into `gamos/development` is a
TL decision made only AFTER the §2 activation checkpoint legitimately holds
(e.g., as the order-0 bookkeeping commit or alongside WP-1), so the plan and
the activation it describes can never coexist dishonestly in history. If the
plan is superseded before activation, the superseding handoff wins and this
branch is abandoned or rewritten — never silently merged.
