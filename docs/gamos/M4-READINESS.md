# Gamos M4 — Readiness Deliverables (TL) — NOT AN ACTIVATION

> **Authority note (binding):** This document is a READINESS AND TECHNICAL
> PREPARATION record only, subordinate to `docs/gamos/ROADMAP.json` (the sole
> milestone authority), the frozen contracts under `docs/gamos/contracts/`,
> and repository governance. **M4 remains `planned` (blocked).** Nothing in
> this file activates M4, changes any milestone status, weakens the
> two-active-milestone limit (M2 and M3 occupy both slots), or claims any M4
> acceptance gate. No M4 implementation PR may begin before the activation
> condition in §12 holds. This file records what was verified on real
> machines, what is honestly unknown, and the prepared (not executed) plan.

**Prepared:** 2026-11-09, under the maintainer's M4-readiness directive
("prepare M4 readiness — do not activate").
**Method:** direct code survey of the baseline head `a4445332` (docs and
assumptions are not proof of implementation), plus REAL sandbox feasibility
runs in this session (Godot 4.2.2-stable real binary; real Blender 4.1.1
cross-engine hop). Machine context: 5th distinct environment since the M3.4
closure; all governance/domain/plan/runtime gates and the reproducibility
digest `55665e6c…` / handoff digest `7f15af95…` re-verified identical on this
machine before this document was written.

**Amended:** 2026-11-09 (later, same day), under the maintainer's correction
directive "M4 — Readiness Corrections and Implementation Entry Conditions"
(reviewed head `3bc4d250`): the readiness delivery was ACCEPTED with its
investigation preserved; this amendment corrects security assumptions and
the activation entry conditions only — §2.2 Unreal rows (server-side
listener verification, the chosen honest authentication model, documented
transaction semantics, no editor termination, exact API source references),
§3 loopback-binding requirement, §4.1 Godot trust boundary + runs relabeled
REAL FEASIBILITY PROBES, §4.2 rewritten (allowlisted typed mutations only —
no generic function.call; corrected teardown), §5 live-editor permission
mapping (engine-gui semantics), §6 negative tests, §10 worker-preparation
note, §11 relabel, §12 explicit concurrency-slot requirement, §13 correction
record. M4 remains planned (blocked) — this amendment activates nothing.

---

## Deliverable 1 — Architecture and capability inventory (ground truth)

What EXISTS today at head `a4445332`, verified by reading the code (not docs):

**Domain package (`packages/gamos-domain`, pure data + validation):**

| Layer | Unity | Blender | Babylon | Godot | Unreal |
|---|---|---|---|---|---|
| `EngineFamily` vocabulary (`src/engine-family.ts:5`) | ✔ | ✔ | ✔ | ✔ | ✔ |
| Version grammar + comparator (`domain/discovery/engine-versions.ts`) | ✔ | ✔ | ✔ | ✔ `parseGodotVersion` (:131) | ✔ `parseUnrealVersion` (:162) |
| Family-grammar predicate evaluation (`evaluateVersionPredicate`) | ✔ | ✔ | ✔ | ✔ (:299) | ✔ (:304) |
| Project marker probe (`adapters/discovery/project-probes.ts`) | ✔ | ✔ | ✔ | ✔ `project.godot` (:69) | ✔ `*.uproject` (:86) |
| Discovery-record JOIN (4-state, `domain/discovery/discovery-record.ts:103`) | ✔ | ✔ | ✔ | ✔ | ✔ |
| Intent engine words (`domain/intent.ts:58-59`) | ✔ | ✔ | ✔ | ✔ | ✔ |
| GamePlan engine binding / asset-interchange engines | ✔ | ✔ | ✔ | ✔ | ✔ |
| `CapabilityRecord`s (`domain/engine-plugin.ts:232-730`) | 4 | 4 | 4 | **0** | **0** |
| `EnginePluginMeta`s (:753-784) | ✔ | ✔ | ✔ | **none** | **none** |
| Executable/API discovery (plugin package) | ✔ | ✔ | ✔ | **none** | **none** |
| Cross-engine plan target legs (`domain/cross-engine-plan.ts:54`) | ✔ | — | ✔ | **none** | **none** |

Registered capability records today (12 engine + 1 core):
`unity/{project.inspect, scene.modify, project.build, asset.import}`,
`blender/{scene.inspect, scene.modify, scene.render, asset.export}`,
`babylon/{project.inspect, project.build, project.run, asset.integrate}`, and
`core/asset.manifest-validate@1.0.0` (the only unconditional `available`
record). Provenance: `gamos-tl`, commit `c9c397a1…` (M2) / `0795a64c…` (M3).

**Execution packages (`apps/zcode-cli/packages/`):** `unity-engine-plugin`,
`blender-engine-plugin`, `babylon-engine-plugin` exist; **no
`godot-engine-plugin`, no `unreal-engine-plugin`.** The reusable execution
skeleton is identical across the three (spawn with argument array,
`shell:false`, `detached:true`, process-group SIGKILL, bounded output,
AbortSignal, structured `{ok:false,code,reason}` failures) — M4 extends this
skeleton, never invents a second one.

**Availability model (two levels, both fail-closed):** capability level
`available | unavailable | conditional` (`gamos/capability@2`, contract 07);
engine level `EffectiveEngineState = available | unavailable | unknown |
display-required` (`gamos/engine-discovery@2`). Unknown NEVER resolves to
compatible.

**The frozen seams M4 must extend (never duplicate):** ZCode app shell /
model routing / agent runtime / permission broker; Gamos capability registry;
GamePlan + `parseGamePlan`; Dynamic Workflow compiler/runtime; SQLite
`dwf_*` journal (`dwf_run`/`dwf_node`/`dwf_event`/`dwf_actor`); production
dispatch through `AgentRuntimeWorkflowDriver` (the test-only
`GamosEngineDriver` stays test-only — directive §4); PaySwap untouched.

## Deliverable 2 — Dual-engine threat model

### 2.1 Godot (CLI/headless, Worker A surface)

| # | Threat | Vector | Mitigation (prepared) |
|---|---|---|---|
| G-T1 | Arbitrary code execution | GDScript bridge content | Bridge scripts are repo-committed, reviewed, data-driven from a frozen typed-op JSON input (same as Blender `apply_ops.py`); no user text is ever interpolated into GDScript source; `--script` argument is a path, never inline code. |
| G-T2 | Workspace escape | res:// / user:// path handling | `resolveWorkspacePath`-equivalent: absolute-only, `..`/symlink-escape rejection before any op (mirror `typed-ops.ts:40-80`); bridge writes confined to a per-run temp report path. |
| G-T3 | Runaway process | infinite loop in scene/script | process-group spawn (`detached:true`), `killTree()` SIGKILL on timeout/abort; bounded stdout/stderr (8 MiB default, truncated flag). |
| G-T4 | Resource exhaustion | import/export on huge assets | per-op timeouts (import/export 600s class), artifact size assertions, fail-closed on missing/empty artifacts (Blender codes reused: `export-artifact-missing/empty`). |
| G-T5 | Template/binary supply chain | download of editor/templates | hash-pinned recipe (§7): zip sha256 `69eb9881…` verified by two independent downloads this session; same `sha256sum --check --strict` gate as Blender's `ab2ea3fe…`. |
| G-T6 | Stale discovery | wrong binary found on PATH | `GODOT_PATH` env is authoritative and never falls through (mirror `BLENDER_PATH` semantics, `discovery.ts:43-52`); `--version` output parsed by the family grammar, unknown ⇒ fail closed. |
| G-T7 | Hidden display dependency | editor ops that need a display server | `--headless` mandatory in every op; `displayServerRequired:false` in the plugin meta; a non-headless-capable binary discovered ⇒ `unavailable` (honest, not spoofed). |

### 2.2 Unreal (Remote Control API, Worker A surface)

| # | Threat | Vector | Mitigation (prepared) |
|---|---|---|---|
| U-T1 | Network exposure | RC endpoint reachable off-host | TWO layers, both required. (a) Client side: the plugin refuses any non-loopback configured host at construction — fail closed before any request. (b) Server side: a client connecting to 127.0.0.1 proves NOTHING about the editor's actual binding — the plugin must verify the REAL listeners (HTTP bind address, WS bind address, ports, actual listening sockets by inspection on the evidence machine) and resolve to `unavailable` (reason `rc-listener-not-loopback`) unless BOTH listeners bind loopback exclusively; a LAN unreachability negative test (request from a second machine must fail) is mandatory M4-G2 evidence. The "two localhost endpoints" default is the CLIENT library's documented behavior (unreal-rc README:19), not a server-side proof. |
| U-T2 | Authentication assumptions | UE's RC authentication behavior is NOT uniformly documented; the client library itself discloses that "some Unreal versions require the `Passphrase` header for `/remote/batch` even when other HTTP routes appear to work without it" (unreal-rc README:56) — the header may gate some routes only, and the default passphrase is public | CHOSEN MODEL (honest, verifiable): an explicitly documented SAME-USER OPERATING-SYSTEM TRUST BOUNDARY — the security boundary is the OS user that owns both the editor process and the Gamos plugin process, NOT any client-supplied header — PLUS Gamos permission approval for EVERY mutation through the existing permission broker. The Passphrase header is treated as an opaque transport token (sent for route compatibility), NEVER claimed as server-side authentication; a claim of server-side auth would additionally require the live negative test (server rejects a wrong passphrase on EVERY route) and no such claim is made in readiness. Residual risk recorded honestly: any same-user local process can reach a loopback RC endpoint — deployment guidance (dedicated editor user, OS firewall) belongs in the M4.2 provisioning doc. 401/403-style refusals ⇒ `unavailable` with reason `auth-required`, never a retry storm. |
| U-T3 | Irreversible mutation | remote property/function calls | documented API contracts used verbatim: property mutation via access mode `WRITE_TRANSACTION_ACCESS` (unreal-rc `dist/internal/schemas.d.ts:3`, applied at `batch.js:14-19`) and function mutation via `generateTransaction: true` (`schemas.d.ts:8`, `batch.js:9`). These transactions are EDITOR UNDO HISTORY SUPPORT, not a universal rollback guarantee. Every registered mutation carries the full five-part chain: (1) pre-mutation snapshot, (2) typed operation, (3) expected post-mutation state, (4) a verified rollback or compensating operation, (5) post-rollback verification against the snapshot. An operation that cannot be reversed RELIABLY is NOT advertised as reversible — contract 02's reversibility field fail-closes registration either way. |
| U-T4 | Zombie editor session | teardown skipped on failure | the connector ATTACHES to an existing editor it does NOT own. Disconnect is a first-class op that MUST: stop in-flight requests and event subscriptions; close WebSocket and HTTP client resources; roll back ONLY the connector's authorized changes (per the U-T3 chain); clear connection and session state; and surface teardown failures — never swallow them. It must NEVER terminate the maintainer's Unreal Editor process. Process-termination authority exists ONLY for processes explicitly launched and owned by a Gamos process supervisor, under the appropriate user authorization. |
| U-T5 | SSRF/redirect via object paths | `/Game/...` path grammar | strict object-path grammar validation before any request (fail-closed parse, like `parseGodotVersion`); no free-form URL construction anywhere. |
| U-T6 | Long-lived sockets | WebSocket auto-reconnect hiding failures | no auto-reconnect in the plugin layer (the harness owns lifecycle); request timeouts per op; a wedged editor resolves to `timeout`, not a hang. |
| U-T7 | Version drift | UE5 route/auth shape differences across versions | route discovery via `GET /remote/info` (lists actual routes) instead of hardcoded paths where possible; contract tests pin the schema; unknown route shape ⇒ `unknown`, fail closed. |
| U-T8 | Privilege confusion | RC grants editor-level process rights | permission mapping (§5) declares `engine-gui`-class privilege for a live editor; process privileges disclosed separately from tool-invocation approval (roadmap non-negotiable rule 8). |

**Honest research disclosure:** Epic's official documentation
(`dev.epicgames.com`) is unreachable from the preparation sandbox (bot-walled
403; archive.org timed out). The verified facts above (loopback defaults,
ports 30010/30020, Passphrase header scheme, transaction support, op surface
call/getProperty(s)/setProperty/describe/searchAssets/info/event/batch,
object-path grammar) were verified against a working typed client library
(`unreal-rc@0.6.0` on the public npm registry, read this session) plus TL
domain knowledge. Route/auth details that vary per UE version are marked
UNKNOWN and MUST be re-verified against a live editor during M4.2
implementation — the RED test plan (§6) encodes the contract, not incidental
URL shapes.

**Exact source references (re-verified for this amendment against the
`unreal-rc@0.6.0` tarball; registry shasum
`282ba517df83b81d462c86ced3029d6d0b0982af`):**
- `WRITE_TRANSACTION_ACCESS` — AccessModeSchema literals
  `READ_ACCESS | WRITE_ACCESS | WRITE_TRANSACTION_ACCESS`:
  `dist/internal/schemas.d.ts:3`; applied for transactional property writes at
  `dist/internal/batch.js:14-19`; documented at `README.md:150`.
- `generateTransaction` — optional Boolean on the object-call request:
  `dist/internal/schemas.d.ts:8`, applied at `dist/internal/batch.js:9`;
  call route `PUT /remote/object/call` (`batch.js:39`); `README.md:72-78`
  states the transaction flag exists "for undo/redo in the editor".
- Ports — HTTP `30010` (`README.md:23`, `dist/internal/http.js:6`),
  WebSocket `30020` (`README.md:24`, `dist/internal/ws.js:8`).
- Client host default `127.0.0.1` — `dist/internal/http.js:5`,
  `dist/internal/ws.js:7` (CLIENT-side default; NOT evidence of the server's
  bind address — see U-T1).
- Passphrase honesty — `README.md:56` (per-version, per-route
  inconsistency); the default value is the public string
  (`dist/internal/http.js:8`).
- Property route `PUT /remote/object/property`, describe
  `PUT /remote/object/describe`, search `PUT /remote/search/assets`
  (`batch.js:45,49,57,65`).
These are the CLIENT library's encoding of the API contract; the selected
UE version's actual SERVER behavior (binding, per-route auth enforcement)
must be re-verified live at M4.2 — the corrections in this amendment exist
precisely because client-side facts are not server-side proofs.

## Deliverable 3 — Version and availability matrix (prepared)

| Engine | Version gate (predicate) | Discovery source | Availability states possible |
|---|---|---|---|
| Godot | `>=4.2` (family grammar; mono suffix tracked but NOT required) | `GODOT_PATH` → PATH `godot` → common roots incl. `/home/z/engines/godot-*-linux-x64/godot` (CI convention) | available / unavailable / unknown (unparseable `--version`) |
| Unreal | `>=5.3` (brand-prefix grammar `++UE<n>+Release-…` supported) | `UNREAL_EDITOR_PATH` (editor exe) AND RC endpoint probe `GET /remote/info` on 127.0.0.1:30010 AND verified loopback-only listener binding (actual socket inspection of the HTTP and WS listeners on the evidence machine — see U-T1) | available / unavailable (`editor-absent`, `rc-endpoint-absent`, `rc-listener-not-loopback`, `auth-required`, `version-unknown`) / unknown |

Godot `--version` output verified this session:
`4.2.2.stable.official.15073afe3` — matches `parseGodotVersion` exactly
(channel `stable`, build hash in the extra segment). The mono detection
(`/mono/`) exists and is passive.

Availability JOIN: a Godot/Unreal record with `installed:true` but predicate
`unknown` resolves to `unknown` — never compatible (contract 04 §4 rule 1).
`display-required` applies if an operation genuinely needs a display server
(Godot: none in the planned op set — all ops `--headless`; Unreal: the EDITOR
process may run with a display on the maintainer's machine, but the plugin
itself only speaks HTTP/WS — `displayServerRequired` reflects the op, not the
editor).

## Deliverable 4 — Typed-operation proposal

### 4.1 Godot plugin (`godot-engine-plugin`, mirrors blender-engine-plugin)

**Execution model:** every op spawns `[godot, "--headless", "--path",
<projectRoot>, "--script", <committed-bridge.gd>, "--", <input.json>,
<report.json>]` — argument array, `shell:false`, `detached:true`, JSON-in /
JSON-out via a fixed report path, `GAMOS_GODOT_REPORT:<path>` stdout marker.
The bridge contract is DATA-ONLY: the input JSON is a frozen typed-op shape
(zod-validated in TS), the bridge script maps it to explicit Godot API calls
(allowlisted op types only — no `eval`-equivalents, no free-form GDScript).

**Trust boundary (explicit, per the correction directive):** launching Godot
against a user project is NOT itself a sandbox. Project scripts, editor
plugins and import behavior are PROJECT-CONTROLLED EXECUTION SURFACES — the
engine process must be treated as executing project-supplied code with the
invoking user's privileges. The plugin's mandatory mitigations (all already
in the design, now stated as requirements): never interpolate user text into
GDScript source; validate typed operations and paths (absolute-only, no `..`,
no symlink escape); confine reads and writes to authorized workspaces; use
bounded process execution with process-group cancellation; verify engine
results by reading the resulting project state back (not exit codes); and
report missing templates, malformed resources and failed imports honestly.

Proposed initial op set (each a capability record, contract 03 rule 1 —
declared ids must resolve):

| op | input (frozen) | verification | capability id |
|---|---|---|---|
| project inspect | projectRoot | re-read `project.godot` + `--version`; report config_version/name/features | `godot/project.inspect` (read-only command permission) |
| scene modify | ops[]: `{nodePath, property, value}` | re-load packed scene + assert applied values (tolerance 1e-5 class) — engine-query verification, NOT exit-code trust | `godot/scene.modify` |
| script check | scriptPath | `--check-only` exit code + parse-error text (verified fail-closed this session) | `godot/script.check` (read-only) |
| asset import | sourcePath (into project) | `--import` then assert `.godot/imported/*.mesh` + `.import` metadata + source sha256 unchanged | `godot/asset.import` |
| project build (export) | preset, outPath (pre-created dir) | `--export-release` exit + ELF/PCK existence + sha256 + size bounds | `godot/project.build` |
| run verify | exported binary path | run `--headless --quit-after N`, assert exit 0 + no crash lines | `godot/project.run` |

**Verified bridge facts from this session's REAL FEASIBILITY PROBES** (all
executed on Godot 4.2.2-stable in the preparation sandbox; these are
feasibility probes, NOT M4-G1 evidence — M4-G1 remains unimplemented and
unpassed until the real plugin completes its acceptance journey):
- `PackedScene.pack()` requires `owner` set on children AFTER `add_child` —
  owner-before-add silently drops the subtree (caught by read-back
  verification, exactly why engine-query verification is mandatory).
- `ObjectDB instances leaked at exit` warning is benign for the
  `_init()`-based SceneTree script pattern; teardown ordering in the bridge
  must still be deterministic (quit(0/1) with the report written first).
- A syntactically broken script ANYWHERE in the project aborts
  `--export-release` (fail-closed — encode as a harden test).
- `--export-release` requires the output directory to pre-exist; a missing
  dir is an honest error, not auto-creation (runbook §7).
- Export templates must sit at
  `~/.local/share/godot/export_templates/<exact-version-string>/` — version
  string mismatch (e.g. `4.2.2.stable` vs `4.2.2`) fails closed.

### 4.2 Unreal plugin (`unreal-engine-plugin`, the RC client) — corrected design

**Execution model:** NO process spawn for ops. The plugin is an HTTP/WS
CLIENT that ATTACHES to an already-running, maintainer-provided Unreal
Editor with the Remote Control plugin enabled — an editor the plugin does
NOT own and must NEVER terminate. The loopback-only connector refuses
non-127.0.0.1 hosts at construction, and the actual server listeners (HTTP
bind, WS bind, ports, sockets) are VERIFIED, not assumed (U-T1).
Authentication follows the chosen same-user OS trust-boundary model with
per-mutation Gamos permission approval (U-T2); the Passphrase header is
transport compatibility, not authentication. Every request: typed
request/response (zod), per-op timeout, structured failure taxonomy
(`{rc-unreachable, rc-auth-required, rc-listener-not-loopback,
rc-route-unknown, rc-schema-mismatch, rc-timeout, rc-transaction-failed}`).

**Operation allowlist (corrected):** unrestricted remote function execution,
remote Python execution and remote console-command execution are DISABLED —
no generic `function.call` capability is exposed to the model. Only
individually reviewed, typed operations are registered; object paths,
property names, function names and request schemas are validated against
the allowlist before any request is built.

Proposed initial op set:

| op | RC surface used | reversibility | capability id |
|---|---|---|---|
| connection info | `GET /remote/info` | read-only | `unreal/connection.inspect` |
| object describe | describe (objectPath) | read-only | `unreal/object.inspect` |
| property read | getProperty(s) (`READ_ACCESS`) | read-only | `unreal/property.read` |
| property write (allowlisted properties only) | setProperty `WRITE_TRANSACTION_ACCESS` + pre-snapshot | U-T3 five-part chain (undo-transaction + snapshot restore + post-rollback verification against the snapshot) | `unreal/property.write` |
| allowlisted typed function invocation | `PUT /remote/object/call` with `generateTransaction: true`; functionName ∈ reviewed allowlist | U-T3 five-part chain | `unreal/function.invoke` (per-function registration — NOT a generic call) |
| disconnect | n/a (plugin lifecycle) | stop requests + subscriptions → close WS/HTTP resources → roll back ONLY connector-authorized changes → clear state → report failures; NEVER terminate the editor | (not a capability; plugin lifecycle) |

`unreal/property.write` and the per-function `unreal/function.invoke`
registrations are the ONLY native-mutation ops; both carry the full
reversibility contract (contract 02 registration fail-closes without it) and
the M4-G2 acceptance exercises one complete
write→verify→rollback→verify-against-snapshot cycle plus a teardown proof
that leaves the editor process alive.

## Deliverable 5 — Permission and process-privilege mapping

| op class | PermissionSpec kind(s) | DispatchOperation | Process privilege disclosure |
|---|---|---|---|
| godot/project.inspect, script.check | `command-execution` (read-only scope) | `exec` (gated) | spawns `godot --headless`; no network; filesystem read-only |
| godot/scene.modify, asset.import, project.build, project.run | `engine-headless` + `filesystem-write` | `engine-headless` (native-mutation gated path) | spawns `godot --headless`; writes confined to projectRoot + run temp; template dir read |
| unreal/connection.inspect, object.inspect, property.read | `command-execution`? NO — network op | `network` (loopback-scoped) | plugin itself spawns nothing; talks HTTP/WS to verified-loopback 127.0.0.1:30010/30020 |
| unreal/property.write, function.invoke (per-function) | `network-access` (scope: loopback-rc-endpoint) + `engine-gui` (semantic class: LIVE-EDITOR mutation — never described as headless execution) | `native-mutation` via gated path | the record distinguishes ALL FOUR: (a) permission to invoke the capability; (b) permission to mutate the editor (the gated native-mutation approval); (c) the OS privileges of the process hosting the editor (the maintainer's user — disclosed, not assumed); (d) the editor process is EXTERNALLY OWNED (not spawned or supervised by Gamos) |

Rules preserved verbatim from contract 06: no GUI→headless downgrade; native
mutations require one of the NATIVE_MUTATION_KINDS declared AND granted;
`display-server-required` denies when a display server is absent. Live
Unreal Editor mutations map to the EXISTING `engine-gui` semantics plus the
loopback-scoped network permission — they are never described as headless
execution. The M4.4 review must bless the recorded four-fold distinction
above (invoke permission / mutation permission / host-process OS privileges
/ external ownership). NO new permission system is introduced — the
existing broker, kinds and scopes carry the load. Teardown authority is the
plugin's obligation (rollback of its own authorized changes only), never
the user's, and never extends to the editor process itself.

## Deliverable 6 — G1–G4 RED test plans (TDD entry points; NOT yet written)

Every gate follows RED → GREEN → HARDEN → INTEGRATE → REGRESSION → EVIDENCE.
A unit test can never substitute for an engine gate (roadmap
`journey_acceptance`; directive: 单元测试 ≠ 引擎集成).

**M4-G1 (Godot real integration) — RED plan:**
0. STATUS: the Godot 4.2.2-stable runs recorded in §4.1/§7/§11 are REAL
   FEASIBILITY PROBES, not gate evidence — M4-G1 is unimplemented and
   unpassed until the real `godot-engine-plugin` completes its full
   acceptance journey on a shipped plugin.
1. RED: `godot-engine-plugin` discovery — no binary, `GODOT_PATH` unset ⇒
   `{status:"unavailable", reason:"no godot executable found"}`; env pointing
   at a non-Godot binary ⇒ `version-unknown` (fail closed, never
   available-by-guess).
2. RED: every typed-op rejects `relative path`, `..` escape, symlink escape
   (path-safety parity with blender typed-ops).
3. RED: bridge protocol — missing report file, unparseable report,
   `report.ok:false` ⇒ structured failure codes; timeout ⇒ process-group
   kill proven by no-orphan-subprocess assertion (Blender G3 pattern).
4. RED: scene.modify WITHOUT owner-set ⇒ read-back verification FAILS (the
   trap from this session's probe, encoded forever).
5. GREEN→EVIDENCE: real Godot 4.2.2 (CI recipe §7): discovery → scene modify
   (read-back verified) → asset import (Blender-exported OBJ, sha-pinned) →
   `--check-only` negative + positive → `--export-release` → run-exported-
   binary headless → evidence bundle with per-stage artifacts + digests.

**M4-G2 (Unreal authenticated RC) — RED plan (corrected):**
1. RED: connector refuses non-loopback CONFIGURED host AT CONSTRUCTION
   (throw, not warn); refuses ws:// to non-127.0.0.1; refuses credential
   embedded in object paths.
2. RED (server-side isolation — U-T1): listener verification — actual
   socket inspection proves the HTTP AND WS listeners bind loopback
   exclusively; any non-loopback binding ⇒ `unavailable` with reason
   `rc-listener-not-loopback` (fail closed). Plus the LAN negative test: a
   request from a second machine MUST fail — evidence-machine item.
3. RED (authentication — U-T2): no-credential and wrong-passphrase requests
   must NOT bypass the Gamos permission layer — EVERY mutation requires
   broker approval regardless of transport; the plugin never presents the
   Passphrase header as authentication. A claim of server-side enforcement
   would additionally require the live negative test (server rejects a
   wrong passphrase on EVERY route) — not made in readiness.
4. RED (allowlist — §4.2): non-allowlisted function name / property /
   object path / request shape ⇒ refused BEFORE any request is built;
   remote Python and console-command surfaces absent by construction.
5. RED: unknown route shape / schema mismatch ⇒ `rc-unknown` (fail closed).
6. RED (transactions — U-T3): write op without pre-snapshot record ⇒
   refused before request; rollback verification compares post-rollback
   state against the snapshot (not just an API ack).
7. RED (ownership — U-T4): disconnect stops requests and subscriptions,
   closes WS/HTTP resources, clears state, reports failures — and the
   editor process is STILL ALIVE after teardown (negative test: no
   editor-termination path exists in the connector at all).
8. GREEN→EVIDENCE (requires maintainer-provided licensed UE5 machine with
   RC enabled — honest-unavailable pattern like Unity M2-G1): full
   write→verify→rollback→verify-against-snapshot cycle + listener-binding
   and LAN-unreachability evidence + teardown proof (no live socket, no
   residual transaction, editor alive) + evidence bundle. In-sandbox:
   contract tests with a pinned local mock RC server ONLY for protocol
   shape — explicitly labeled non-gate (a mock can never satisfy M4-G2).

**M4-G3 (engine selection and honest unavailability) — RED plan:**
1. RED: required-Godot-unavailable + Blender installed ⇒ `substitution-proposed`
   APPROVAL issue (never silent switch — intent.ts:286-299 parity for godot).
2. RED: `godot` record with unparseable version ⇒ JOIN yields `unknown`, and
   plan compilation throws the fail-closed guard (plan-workflow.ts:201-214).
3. RED: Unreal RC endpoint absent ⇒ `engine-unavailable` blocking issue with
   honest reason; no capability fabrication in model-context
   (intent.ts:461-471 parity).
4. RED: EnginePluginMeta for godot/unreal declaring an unregistered
   capability id ⇒ validation failure (contract 03 rule 1).

**M4-G4 (five-engine regression) — RED plan:**
1. RED (exists, must stay green): the 3-shipped-plugin meta set test
   (`engine-plugin.test.ts:262-265`) EXTENDS to 5 — the assertion itself is
   the regression tripwire.
2. The full existing matrix re-run definition: self-test 14/14, roadmap
   validator, architecture 0, gamos-domain (grows beyond 383), plan
   acceptance 8/8→N, dynamic-workflow-runtime 119+1→N with real Blender,
   m1/m2/m3 e2e journeys, Unity honest-unavailable gate-status unchanged.
3. ZCode inherited regression: `pnpm run verify:pre-push` scope (lint, docs
   stale-phrase, db schema, architecture, engineering affected) + the
   inherited-test determinism suite (20/20 provider-stop/auto-driver).
4. Unity remains an EXTERNAL dependency: M4-G4 cannot be passed by silently
   treating the unavailable Unity integration as a successful engine test —
   the honest-unavailable gate-status stands unless the maintainer's
   licensed runner exists.

## Deliverable 7 — Installation verification runbook (Godot — VERIFIED this session)

CI recipe (mirrors the Blender `ab2ea3fe…` pattern):

```bash
GODOT_VERSION="4.2.2-stable"
GODOT_ZIP_SHA256="69eb9881e1b82ab93924c83106a7c031497f252bc0c08e199e4da6380072d6ef"  # verified twice this session
curl -sSL --retry 3 -o godot.zip \
  "https://github.com/godotengine/godot/releases/download/${GODOT_VERSION}/Godot_v4.2.2-stable_linux.x86_64.zip"
echo "${GODOT_ZIP_SHA256}  godot.zip" | sha256sum --check --strict -
unzip -o -q godot.zip -d /home/z/engines/
ln -sfn /home/z/engines/Godot_v4.2.2-stable_linux.x86_64 /home/z/engines/godot-4.2.2-stable-linux-x64
/home/z/engines/godot-4.2.2-stable-linux-x64/Godot_v4.2.2-stable_linux.x86_64 --version
# expect exactly: 4.2.2.stable.official.15073afe3

# Export templates (selective extraction; full tpz is 894,856,756 B):
curl -sSL --retry 3 -o templates.tpz \
  "https://github.com/godotengine/godot/releases/download/${GODOT_VERSION}/Godot_v4.2.2-stable_export_templates.tpz"
unzip -o -q templates.tpz "templates/linux_release.x86_64" "templates/linux_debug.x86_64" -d tmpl/
mkdir -p ~/.local/share/godot/export_templates/4.2.2.stable
cp tmpl/templates/linux_* ~/.local/share/godot/export_templates/4.2.2.stable/
```

Verified resource footprint (this sandbox, 2 vCPU / 3.9 GB RAM): zip 45,333,918 B;
binary ~90 MB; headless script runs complete in <2 s wall; `--import` < 8 s;
`--export-release` of a probe project ~4 s; exported ELF 62,214,272 B
(sha256 `cee76c5a…` for the probe, embedded PCK). Export templates (linux
only) 124 MB — the selective unzip keeps the recipe inside a 2 GB-class disk
budget; extracting ALL platform templates does not. Godot runs WITHOUT X
libraries in `--headless` (no display server required — verified).

Unreal runbook (CANNOT be verified in this sandbox — honest): a licensed UE
5.3+ editor with the Remote Control plugin enabled, running on a
maintainer-provided machine (GPU/display per the editor's own requirements;
the Gamos plugin only needs loopback HTTP/WS reachability + a non-default
credential). Provisioning doc to be authored at M4.2 start, modeled on
`docs/gamos/UNITY-M2G1-PROVISIONING.md` §7–§9.

## Deliverable 8 — Dependency impact analysis

| Change | Touches | Risk | Blast radius |
|---|---|---|---|
| 2 new plugin packages | `apps/zcode-cli/packages/{godot,unreal}-engine-plugin` (new) | none to existing packages (purely additive) | pnpm workspace adds 2 nodes; `dependency-graph.mmd` regenerates |
| ~10 new capability records + 2 metas | `packages/gamos-domain/src/domain/engine-plugin.ts` (append-only section) | registry is append-only by contract; existing 13 records byte-identical | gamos-domain tests grow; `ENGINE_PLUGIN_METAS` assertion (test:262) MUST be updated in the same PR as the metas (intentional tripwire) |
| Cross-engine target legs for godot/unreal | `domain/cross-engine-plan.ts` (extends the `CrossEngineTarget` union + builder legs) | the fail-closed error message ("ships exactly these two target legs") must be reworded to stay honest; no existing leg logic changes | cross-engine plan tests + plan-mode smoke assertions (M3 CLI `resourceClaimCount == 9` stays until M4 changes the shipped template — a deliberate, reviewed change) |
| Version grammar | none — `parseGodotVersion`/`parseUnrealVersion` already shipped and tested | zero | zero |
| Discovery | new `src/discovery.ts` per plugin (mirror of blender's) | none shared | per-package |
| CI | new jobs/steps in a new `gamos-m4-e2e.yml` (mirrors m3-e2e) | existing workflows untouched | required-status ruleset addition is a maintainer-side API call (rulesets 26558836/7 precedent) |
| Runtime/journal/scheduler | ZERO changes by design | the M3-G4 durable-resume machinery is reused as-is for godot legs | none |

Upstream-sync risk: the two new packages and the append-only records are
additive (the default Gamos integration path per protected-surfaces mode);
`pnpm-lock.yaml` grows by the two workspace nodes only; no new third-party
runtime deps are required (Godot ops are process spawns; Unreal ops are
`fetch`/`WebSocket` against Node builtins — the SAME dependency posture as
the existing plugins: zod + MCP SDK only).

## Deliverable 9 — ZCode regression plan (Worker C)

1. **Inherited unit/engineering:** full `verify:pre-push` chain (lint, docs
   stale phrases, db schema check, architecture check + changed, engineering
   affected) on every M4 PR — same as M2/M3 discipline.
2. **Determinism suite:** provider-stop + e2e auto-driver 20/20 consecutive
   green on the M4 branch head (the AUTH-0012/0013 race class must never
   reappear under new engine legs).
3. **Runtime package suite:** dynamic-workflow-runtime full suite
   (119→N passed, 1 skipped baseline) with real Blender on every M4 PR that
   touches anything the runtime imports; `--no-file-parallelism` on
   constrained runners.
4. **Journey regression:** m1-e2e + m2-e2e + m3-e2e workflows re-run on the
   M4 merge head; the m3 plan-mode smoke assertions updated in lockstep with
   the cross-engine template change (Deliverable 8) — never silently
   re-baselined.
5. **Independent challenge A/B (Worker C mandate):** one adversarial review
   of the Godot bridge input contract (attempt: relative paths, oversized
   inputs, non-allowlisted op types, owner-order mutation, template version
   mismatch) and one of the Unreal connector (attempt: non-loopback host,
   credential in URL, missing auth, wedged socket, teardown skip) — findings
   folded into HARDEN tests before EVIDENCE.
6. **Five-engine final matrix (M4-G4):** every gate from every milestone,
   one head, one CI run set — Unity honestly-unavailable unless the
   maintainer's licensed runner exists (M2-G1 dependency unchanged).

## Deliverable 10 — Implementation ordering and worker attribution

| Order | Item | Owner | Why this order |
|---|---|---|---|
| 0 | Activation precondition check (§12) | TL | no implementation PRs before it holds |
| 1 | M4.3-a domain records: godot capability records + meta + registry tests | Worker B | contract 03 rule 1: plugin metas need resolvable ids FIRST |
| 2 | M4.1-a godot-engine-plugin: typed-ops + discovery + engine (RED set 6.1.1-6.1.3) | Worker A | pure package, no dependents |
| 3 | M4.1-b real-Blender→Godot integration + build/export evidence (G1 legs) | Worker A | reuses the CI recipe from §7 |
| 4 | M4.3-b unreal capability records + metas + honest-unavailable plumbing | Worker B | G3 tests land before the client |
| 5 | M4.2-a unreal RC connector + contract tests (mock loopback server, NON-gate) | Worker A | protocol shape proven without UE |
| 6 | M4.2-b real-UE evidence leg on maintainer machine (G2) — blocked-on-external, tracked honestly | Worker A + maintainer | same pattern as M2-G1 |
| 7 | M4.3-c cross-engine target legs (godot/unreal) + plan-mode smoke update | Worker B | after plugins exist (plan legs reference real capabilities) |
| 8 | M4.4 privilege/network/permission review + five-engine regression (G4) | TL + Worker C | closing authority |
| 9 | M4-G3 engine-selection regression suite | Worker B + TL | spans domain + plugins |

While M4 remains planned, workers MAY prepare isolated, non-implementation
design and test artifacts (RED tests that fail against absent packages,
contract fixtures, provisioning drafts) — but NO M4 production
implementation PR may merge before the formal activation condition (§12)
holds.

## 11 — Sandbox feasibility assessment (this machine, honestly)

- **Godot: FEASIBLE — real feasibility probes executed.** The §4.1/§7 runs
  (real Godot 4.2.2-stable binary: bridge pattern, import, check-only,
  export, run-verify) prove the RECIPES and surface the traps; they are NOT
  M4-G1 gate legs and do not make M4-G1 passed — that requires the shipped
  plugin's full acceptance journey. Fits 2 vCPU / 3.9 GB RAM / 2.2 GB free
  disk with the selective-template recipe.
- **Unreal editor: INFEASIBLE here — honestly recorded.** UE5 editor
  requires GPU/display, multi-GB RAM, and tens of GB of disk; this sandbox
  has none of those. M4-G2's real leg therefore follows the Unity M2-G1
  honest-unavailable pattern: contract-first, real evidence deferred to a
  maintainer-provided machine. No fixture, mock, or claimed completion may
  substitute (roadmap non-negotiable rules 6-7).
- **Research access honesty:** Epic docs unreachable (bot-wall 403; archive
  timeouts). RC API facts verified against `unreal-rc@0.6.0` (public npm) —
  a working typed client — plus TL knowledge; version-variable details are
  marked UNKNOWN in §2.2 and MUST be re-verified live at implementation.

## 12 — Activation condition (corrected per the maintainer's directive; binding)

Formal M4 activation requires ALL FOUR conditions:

1. **Dependency:** M2 is complete (M2-G1 executed maintainer-side per
   `docs/gamos/UNITY-M2G1-PROVISIONING.md` §7–§9), OR an explicit, valid
   maintainer-authorized activation waiver is recorded for M4.
2. **Waiver ADR (if a waiver is used):** a valid committed ADR documents
   that waiver (ADR-0007 precedent).
3. **An available active-milestone slot.** Current state: M2 active, M3
   active — BOTH configured active slots are occupied; M4 is planned. A
   waiver does NOT override the concurrency limit: the configured maximum
   must not be changed, no active milestone may be demoted, and M2/M3
   requirements must not be weakened to force M4 activation. A slot opens
   only through a legitimate dependency transition (an active milestone
   completing on its own gates).
4. **A successful roadmap validator run** on the activation commit.

Until ALL FOUR hold, this document is preparation only: M4 stays `planned`
(blocked), M2/M3 stay `active`, the two-active limit stands, and no M4
acceptance is claimed anywhere. No M4 production implementation PR may
merge before activation (worker preparation artifacts per §10 are
permitted).

## 13 — Correction record (2026-11-09 amendment)

Amended under the maintainer's directive "M4 — Readiness Corrections and
Implementation Entry Conditions" (reviewed head `3bc4d250`). The original
readiness delivery was ACCEPTED with its investigation preserved; this
amendment corrects security assumptions and entry conditions only:

| Area | Correction |
|---|---|
| §12 | Activation requires ALL FOUR conditions incl. an available active-milestone slot; a waiver explicitly does NOT override the two-active concurrency limit; the configured maximum, M2/M3 statuses and requirements are untouchable. |
| §2.2 U-T1 | Client loopback refusal necessary but insufficient — server-side listener verification (bind addresses, ports, actual sockets, LAN negative test) mandatory; a client connecting to 127.0.0.1 proves nothing about server binding. |
| §2.2 U-T2 | Authentication model REPLACED with the chosen honest model: same-user OS trust boundary + per-mutation Gamos permission approval; the Passphrase header is transport compatibility, never claimed as server-side authentication (the client library itself documents per-route inconsistency, README:56). |
| §2.2 U-T3 | Transaction semantics corrected to the documented contracts — `WRITE_TRANSACTION_ACCESS` (property) / `generateTransaction: true` (function) — treated as editor Undo History support, NOT universal rollback; the five-part reversibility chain is mandatory; unreliable reversal is not advertised as reversible. |
| §2.2 U-T4 | Teardown corrected: the connector never terminates the maintainer's editor; process-termination authority exists only for Gamos-supervisor-owned processes. |
| §2.2 sources | Exact file:line references for the Unreal API contract re-verified against the `unreal-rc@0.6.0` tarball (registry shasum `282ba517…`). |
| §3 | Unreal availability gains `rc-listener-not-loopback` and a verified-binding requirement. |
| §4.1 | Explicit Godot trust boundary (engine launch is not a sandbox; project-controlled execution surfaces); runs relabeled REAL FEASIBILITY PROBES — M4-G1 unimplemented and unpassed. |
| §4.2 | Generic `function.call` REMOVED — allowlisted per-function typed invocations only; remote Python / console-command / unrestricted remote function execution disabled; disconnect lifecycle fully specified (never terminates the editor). |
| §5 | Live-editor mutations mapped to existing `engine-gui` semantics + loopback network permission — never described as headless; the four-fold permission/privilege/ownership distinction recorded; no new permission system. |
| §6 | G1 status note added; G2 RED plan extended with the negative tests (listener binding, LAN unreachability, auth non-bypass, allowlist refusal, rollback-against-snapshot, editor-alive-after-teardown); G4 gains the explicit Unity-external-dependency rule. |
| §10 | Worker preparation of isolated non-implementation artifacts permitted while planned; no production implementation PRs before activation. |
| §11 | Godot relabeled from "FEASIBLE, PROVEN" to feasibility-probes status with the explicit not-gate-evidence distinction. |

Not changed: the accepted investigation results (§1 inventory, Godot 4.2.2
findings, Unreal research disclosure, worker allocation and ordering, the
honest Unreal-infeasible statement), the M2/M3 roadmap statuses, ADR-0007,
the G1–G4 gate definitions (§6 remains binding — no fixtures, mocks,
API-shape simulations or unit-only results may satisfy them), and repository
governance. M4 remains `planned` (blocked); nothing in this amendment
activates M4 or claims any acceptance.
