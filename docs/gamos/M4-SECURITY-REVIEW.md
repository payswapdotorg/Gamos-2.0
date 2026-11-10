# M4 Security Review — WP-8 (order 8/9)

- Status: **DELIVERED** (worker branch `gamos/m4-wp8-security-review`; strict TDD: RED `c5c246a6` → GREEN `942988a8` → TL merge into `gamos/development`)
- Scope: delivery plan §3 order 8 — "Independent security review + permission integration (M4.4)", Worker C + TL
- Exit conditions: every §7 challenge-matrix row executed as a real negative test or explicitly N/A'd with cause; TL independent re-review; all blocking findings resolved; permission mapping wired through the existing ZCode permission broker
- Zero-spend mandate: binding (nothing spent; no new external fetches in this slice)

## 1 — The permission mapping (the order-8 wiring)

**Design decision (TL-reviewed).** The frozen architecture (contract 06 rev 2) forbids a second permission system: the ZCode host's per-tool-call MCP gate IS the approval surface. The blender M2 precedent (M2J4: denial-then-approval journey, `evidence/phase-m2/journey/m2-journey-evidence.json`) is the wiring contract: an engine plugin rides the EXISTING path

```
plugin package → .zcode-plugin/plugin.json mcpServers.engine (dist/mcp/server.js)
  → host plugin lifecycle (official definition, default-disabled)
  → MCP tool bridge (core createMcpToolEntry: mcp__plugin_<name>_engine__<tool>)
  → ToolExecutor.execute → resolveToolPermission → permission broker → user
```

by being **registered in the host catalog**. WP-1..WP-5 shipped the packages and their `requiredDevPluginRuntimeBuilds` entries, but the catalog registration was explicitly deferred by GAMOS-AUTH-0014/0015 ("the app-catalog surfaces are NOT touched in this slice") — leaving the broker path unreachable for the M4 tools and every approval claim about them as description text only. WP-8 closes exactly that gap:

1. **Host registration** (GAMOS-AUTH-0016, the AUTH-0006 precedent class): `OFFICIAL_PLUGIN_DEFINITIONS` + `officialSeaPlugins` entries for `godot-engine` / `unreal-engine` (version-aligned 0.1.0, heavy-engine default-disabled class — zero behavior change unless the user enables them).
2. **MCP tool annotations** (the permission-class mapping made real): reads `readOnlyHint` → host riskLevel low; mutations `destructiveHint` → high + plan-mode hard-deny. Pinned at the wire level (real `tools/list` round-trips) by `mcp-annotations.test.ts` in both plugins.
3. **The domain mapping module** (`packages/gamos-domain/src/domain/mcp-permission-mapping.ts`): the semantic authority deriving the host profile from each record's declared permissions — read-class is a strict whitelist of `(kind, scope)` pairs; everything else classifies as a destructive mutation (conservative direction); empty permissions refused classification. The two-sided pin discipline (domain tests + plugin wire tests assert the same values) is the manifest-agreement pattern applied to permissions.
4. **The host-gate execution of §7 U4** (`core/tests/engine-plugin-mutation-authorization.test.ts`): a rejecting broker refuses `property_write`/`scene_modify` with ZERO `callTool` invocations (zero engine round-trips); plan mode hard-denies destructive engine mutations without asking the broker; reads pass only through an allowing broker; the destructive classification surfaces as `riskLevel: "high"` in the broker request.
5. **Language honesty**: the unreal `property_write` tool description now states the real semantics (the tool call passes the host's permission-broker gate at dispatch; the destructiveHint annotation carries that classification) instead of the previously unimplemented "requiring permission-broker approval at dispatch" phrasing.

**The four-way distinction stands** (contract 06 rev 2 / delivery plan §5.2): capability-invocation approval (the tool-call gate — now real and tested); mutation authorization (the reviewed allowlists — EMPTY at 0.1.0, every mutation additionally fails closed client-side); the OS privileges of the externally owned editor process; process ownership (the connector spawns and terminates nothing — structural pin).

## 2 — The §7 challenge matrix: row → executed evidence

Every row of delivery plan §7 resolves to executed evidence (test file + row) or a reasoned N/A. "**[W#]**" marks the slice where the row's HARDEN-stage evidence landed.

### Godot

| §7 row | Evidence (executed) |
|---|---|
| Relative-path and traversal attacks | `typed-ops.test.ts` "relative paths are rejected" / "traversal that escapes the root is rejected"; `engine-harden.test.ts` "a relative project root is a path-safety failure (never a spawn)" / "a scene path outside the project root" (res:// confinement) [WP-2] |
| Symlink escapes | `typed-ops.test.ts` "symlink escapes are rejected" — a REAL symlink pointing out of the workspace → PathSafetyError [WP-2] |
| Non-allowlisted operations | `typed-ops.test.ts` "rejects non-allowlisted properties — the GDScript-injection surface", "the property allowlist is exactly the reviewed set", "BRIDGE_SCRIPTS is the complete committed set", "every committed bridge is data-only… no eval-equivalents" [WP-2] |
| Oversized or malformed input | malformed: `engine-harden.test.ts` "malformed input is invalid-input"; oversized: `wp8-challenge.test.ts` — AbsolutePath > 4096, preset > 64, quitAfterFrames > 100_000, nodePath > 256, queries > 128 [**W8**]; bounded output: "a flooding executable is collected up to maxOutputBytes and flagged truncated" [**W8**] |
| Malformed or missing bridge reports | `engine-harden.test.ts` "bridge report protocol fails closed" (missing/unparseable/non-object/lying report) + "a mismatching bridge versionInfo fails closed" [WP-2] |
| Runaway processes (bounded time + process-group kill) | Real-engine legs: `engine-real-godot.integration.test.ts` "runaway process: bounded time kills the whole process group and leaves NO orphan" + abort-signal row (run on CI `gamos-m4-godot-e2e` and wherever Godot ≥ 4.2 is provisioned) [WP-2]; engine-independent legs: `wp8-challenge.test.ts` "a never-quitting fake executable is killed with its whole process group within the bound" (the sh + sleep child both reaped; `kill(-pid,0)` proof) + "an abort signal kills the process tree" [**W8**] |
| Incorrect scene ownership and persistence (read-back verification) | Model: `typed-ops.test.ts` "read-back verification model" (4 negatives) [WP-2]; end-to-end: `engine-real-godot.integration.test.ts` "scene_modify: … re-loaded in a FRESH process and verified" + "fails ATOMICALLY on an unknown node — the scene file is left byte-identical" [WP-2]; hop chain: `cross-engine-hop.integration.test.ts` (runtime-verified status chain) [WP-3] |
| Missing or mismatched export templates | Root: `engine-harden.test.ts` "missing export templates fail closed with the expected directory named" [WP-2]; version-dir mismatch + missing `linux_release` + unparseable version + preset-without-export_path: `wp8-challenge.test.ts` §7 G8 block (fake `--version` executable + real template tree) [**W8**] |

### Unreal

| §7 row | Evidence (executed) |
|---|---|
| Non-loopback listener binding | `connector.test.ts` "construction — loopback-only client config" (localhost refused too — a resolvable name proves nothing) + "resolves unavailable (rc-listener-not-loopback) when the server reports a non-loopback binding" (server-REPORTED binding is the authority) [WP-5] |
| LAN access to the RC endpoint (negative reachability from a second machine) | **N/A (reasoned)**: requires the real UE5 Editor environment + a second machine. Per delivery plan §10 the present sandbox is not a valid Unreal Editor acceptance environment; WP-6 (the real-editor leg) stays blocked on the maintainer-provided environment; M4-G2 is not claimed. The mock-provable approximation (server-reported listener verification) IS executed — see the row above. |
| Passphrase bypass and inconsistent route authentication | `wp8-challenge.test.ts` "a wrong-token client attaches successfully (ungated /remote/info) while the gated routes refuse — attach is NOT authentication" (one lifecycle; exactly one request per refused op — no retry storm; no authentication-success wording; the connection is not poisoned) [**W8**]; "a header-unsafe passphrase is refused at CONSTRUCTION (UnsafePassphraseError)" [**W8**]; 401 ⇒ `rc-auth-required` exactly-once row `engine-harden.test.ts` [WP-5] |
| Unapproved mutation (no permission-broker approval → refusal) | **Three executed layers [W8]**: (1) host gate — `core/tests/engine-plugin-mutation-authorization.test.ts`: rejecting broker ⇒ `permission_denied` with ZERO `callTool` invocations, plan mode hard-deny, high-risk classification in the broker request; (2) domain authority — `m4-permission-integration.test.ts`: `evaluateDispatchPermission` against the REAL unreal records (ungranted ⇒ approval-denied; a headless grant can NEVER authorize the live-editor mutation; a GUI grant without a display server fails closed); (3) defense-in-depth — the EMPTY reviewed allowlists: `connector.test.ts` "the SHIPPED allowlist is EMPTY at 0.1.0 — every functionName fails closed client-side (zero call requests)" + the property-write twin [WP-5] |
| Unallowlisted function execution | `connector.test.ts` empty-function-allowlist + injected-different-function refusal (zero `/remote/object/call`); `engine-harden.test.ts` grammar-invalid functionName refused at the schema [WP-5] |
| Invalid object paths | `engine-harden.test.ts` "object-path grammar (U-T5)" (5 rows: traversal/query-smuggling/whitespace/oversize/sub-object shapes) + "an invalid object path is refused with zero network round-trips"; domain planning-floor mirror `cross-engine-plan-m4.test.ts` [WP-5/WP-7] |
| Transaction and rollback failure (verified against the pre-snapshot) | Write-not-taken: `engine-harden.test.ts` "a write the editor silently refuses is DETECTED by the post-state re-read and fails closed with the rollback chain" + `wp8-challenge.test.ts` "…carries details.rollbackRestored === true" [**W8**]; negative rollback: `wp8-challenge.test.ts` "a rollback whose restore is SILENTLY REFUSED fails closed — rc-rollback-not-verified, never ok:true" — the GREEN hardening of `rollbackToSnapshot` [**W8**] |
| Socket teardown failure | `engine-harden.test.ts` "disconnect stops in-flight requests, reports the aborts, and leaves the externally owned editor alive" + "no auto-reconnect anywhere" [WP-5]; close-handshake timeout: `wp8-challenge.test.ts` "a wedged close handshake surfaces wsClosed:false + the close-handshake failure while the editor stays LISTENING" (the mock's `wedgeWsCloseHandshake`) [**W8**] |
| Accidental termination of the externally owned editor | `engine-harden.test.ts` "the connector has NO editor-termination path at all (structural pin)" (no child_process/.kill/spawn/process.exit in connector/engine sources) + "the externally owned editor survives MANY connector lifecycles" [WP-5]. The REAL-editor demonstration stays WP-6 (§10). |

## 3 — Findings and resolutions (the independent review)

1. **[BLOCKING → resolved] The broker path was unreachable for the M4 plugins.** The godot/unreal plugins were absent from `OFFICIAL_PLUGIN_DEFINITIONS`/`officialSeaPlugins` (explicitly deferred by AUTH-0014/0015), so their MCP tools could never enter the host ToolRegistry — every approval claim was description text only. Resolved by the AUTH-0016 registration + the pin rotation; the gate is now proven reachable and refusing (§2 U4 row, layer 1).
2. **[BLOCKING → resolved] Claims-vs-reality mismatch on unreal mutation approval.** The records/tool text claimed per-mutation broker approval that nothing implemented or tested. Resolved honestly: the wiring (registration + annotations) makes the tool-call-dispatch approval REAL; the tool description states the true semantics; the domain + host tests pin it; the record's `engineGuiPermission` rationale now describes the genuinely-wired gated path.
3. **[BLOCKING → resolved] The gamos-domain permission layer had no runtime consumer.** `evaluateDispatchPermission` and the records' permission arrays were dead data. Resolved by the mapping module (the semantic authority) + the two-sided pin (domain ↔ wire annotations) + the composition tests against the REAL records — no new permission system, exactly contract 06 rev 2.
4. **[FIXED] rollbackToSnapshot reported `ok:true` for an unverified rollback.** A silently-refused restore surfaced `verifiedAgainstSnapshot:false` inside a success envelope — a caller checking only `ok` would wrongly conclude success. Hardened fail-closed: `rc-rollback-not-verified` with the detected live state (§2 U7 row).
5. **[FIXED] WS close-handshake timeout was untested (untestable).** The mock always completed the close handshake, so the connector's bounded-close failure path had no executed evidence. Resolved with the mock's `wedgeWsCloseHandshake` (§2 U8 row).
6. **[N/A, honest] The UE5/second-machine rows.** LAN negative reachability and the real-editor teardown demonstration stay N/A with cause (§10: no valid UE5 acceptance environment in-sandbox; WP-6 blocked; M4-G2 unclaimed). A mock can never pass M4-G2 — the mock-provable approximations are executed and labeled as such.
7. **[NOTED] Read-only MCP tools still ask for approval in build/edit/plan.** The host sets `needsApproval: true` for ALL MCP tools (upstream behavior, unchanged by this slice — conservative). The annotations classify risk honestly (low for reads); relaxing the read-prompt is an upstream UX decision outside M4's scope.

## 4 — Regression evidence (the GREEN tree 942988a8)

- gamos-domain 474/474 (457 + 17 WP-8) | godot plugin 63 passed + 12 honest real-engine skips (60/60 + 15 where Godot is provisioned; CI `gamos-m4-godot-e2e`) | unreal plugin 48/48 (40 + 8 WP-8)
- bootstrap `plugins.test.ts` 54/54 (alignment/seed/UI loops over the new entries) + `m4-engine-plugin-catalog.test.ts` 7/7
- core `engine-plugin-mutation-authorization.test.ts` 5/5 | typechecks clean (godot, unreal, bootstrap) | architecture 0 violations
- governance: self-test 14/14; pin rotated `1c08f24a…` → `bbed7371…` (16 entries, 26 authorized paths); compliant on the new pin
- m2 capability CLI journey-exact: exit 0, verdict ok, registryRecords 23, FIVE shipped manifests with `provenanceCommitIsSourceOfRecord=true`, unresolved exactly the `unity/scene.modify` honest negative path
- stdio smoke of the BUILT dist entries: both servers answer `initialize` + `tools/list` with exactly the six tools and the honest annotations

## 5 — Standing state

M4-G1/G2/G3/G4 unpassed and unclaimed (the gates close at WP-9 with full evidence). WP-6 remains blocked on the maintainer-provided UE5 environment (§10) — its §7 rows stay N/A with cause until then. NEXT: WP-9 (five-engine regression + final evidence) once WP-6 resolves or per the TL's sequencing decision.
