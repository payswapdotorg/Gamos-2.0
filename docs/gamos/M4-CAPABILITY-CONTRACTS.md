# Gamos M4 — Capability-Record Contracts (TL shared-contract lane) — PRE-ACTIVATION DESIGN, NOT REGISTRATION

> **Authority note (binding):** This document is an ISOLATED, NON-IMPLEMENTATION
> preparation artifact on the stacked branch `gamos/m4-capability-contracts`
> (parent: `gamos/m4-delivery-plan` @ `36897b65`). It specifies, at field
> level, the capability records and plugin metas that Worker B will REGISTER
> when M4 is legitimately active (WP-1 for Godot, WP-4 for Unreal), plus the
> WP-1 RED test design. **Nothing in this file is registered, shipped, or
> claimed implemented.** M4 remains `planned` (blocked); the four activation
> conditions (delivery plan §2) are unchanged and unchecked. Subordinate to
> `docs/gamos/ROADMAP.json`, the frozen contracts under `docs/gamos/contracts/`,
> `docs/gamos/M4-READINESS.md` (design baseline) and
> `docs/gamos/M4-DELIVERY-PLAN.md` (execution ledger). This branch must not
> merge into `gamos/development` before legitimate M4 activation.

**Prepared:** 2026-11-09 (evening), by the Gamos TL, as the second permitted
pre-activation artifact (handoff §13: "the TL owns shared contracts"; §7
order 1 is Worker B's Godot capability records — this document is the
contract those records must satisfy).

**Schema references (verified against the baseline `48ce1fd3` tree):**
`packages/gamos-domain/src/domain/capability-registry.ts`
(`gamos/capability@2`: `registerCapability` fail-closed completeness),
`packages/gamos-domain/src/domain/engine-plugin.ts`
(`gamos/engine-plugin@2`: `EnginePluginMeta`, `validateEnginePluginMeta`,
`ENGINE_PLUGIN_CAPABILITIES`, `ENGINE_PLUGIN_METAS`, the shared permission
constants and the `mcpProvider` / `enginePluginProvenance` helpers),
`packages/gamos-domain/src/domain/discovery/engine-versions.ts`
(family grammars: `parseGodotVersion` — `<major>.<minor>.<patch>.<channel>`
with `dev < alpha < beta < rc < stable` ordering; `parseUnrealVersion` —
`<major>.<minor>[.<patch>]-<branch>` with `++UE<n>+Release-` brand forms;
partial two-part predicates are legal targets, e.g. `>=4.2`, `>=5.3`),
`packages/gamos-domain/src/domain/permission-gate.ts` (`engine-gui` is NOT
satisfied by `engine-headless` — no downgrade; native mutations go through
the gated exec/engine path). `godot` and `unreal` are ALREADY members of
`ENGINE_FAMILIES` and already carry `GRAMMAR_PROBES` — the M1 registry
anticipated five engines; M4 adds records, not schema.

---

## 1 — Shared contract rules (all 11 records, all 2 metas)

1. **Append-only ids.** Existing `unity/*`, `blender/*`, `babylon/*`, `core/*`
   records and the three shipped metas are untouched. M4 adds exactly six
   `godot/*` records (WP-1), five `unreal/*` records (WP-4), and the
   `godot-engine` / `unreal-engine` metas. No id changes, no deletions.
2. **Fail-closed resolution.** Every declared capability id must resolve to a
   complete registered `CapabilityRecord` before its plugin meta validates
   (contract 03 rule 1 — the existing validator enforces this; the WP-1 RED
   test proves it for the new family).
3. **Family grammar, never universal SemVer.** `compatibility.engineVersions`
   and meta `engineVersions` use the family's own grammar predicates
   (contract 03 rule 2 / contract 04 §4): `">=4.2"` for Godot, `">=5.3"` for
   Unreal. Unknown or malformed versions fail closed.
4. **Honest availability.** Records declare `conditional` availability with
   the real prerequisites; runtime unavailability is reported with the
   honest reasons (`godot-not-installed`,
   `godot-export-templates-missing`, `unreal-editor-not-discovered`,
   `rc-endpoint-not-listening`, `rc-listener-not-loopback`,
   `rc-auth-not-configured` — per readiness §3). No record claims
   `available` unconditionally.
5. **Honest reversibility.** Mutations register `recoverable` (with the
   five-part chain as the upgrade condition) until the real engine journey
   demonstrates snapshot → typed op → expected post-state → verified
   rollback/compensation → post-rollback verification against the snapshot.
   Read-only operations register `reversible` (no mutation). Nothing is
   registered `reversible` on promise alone (readiness §2.2 U-T3 rule,
   applied to both engines).
6. **Permission mapping through the existing broker.** No new permission
   kinds, scopes, or systems. Godot uses the existing
   `command-execution` (read-only scope) and `engine-headless` +
   `filesystem-write` (declared-workspace scope) constants — the same
   pattern as the shipped blender records. Unreal uses `network-access`
   with a loopback-rc-endpoint scope for reads, plus `engine-gui` for
   mutations — live-editor semantics, never described as headless
   execution, and the gated native-mutation path applies.
7. **Provenance and provider shape.** `enginePluginProvenance` (canonical
   `gamos/provenance@2`, surfaces `["mcp"]`) with the M4 source-commit
   constant replacing the M2 one at registration time; `mcpProvider`
   identity `plugin:godot-engine:engine` / `plugin:unreal-engine:engine`.
8. **Verification spec is part of the contract.** Every record's
   `verification.spec` names the engine-side read-back or artifact check
   that proves the operation happened — an exit code alone is never the
   spec (handoff §6: "a successful process exit code alone does not prove
   that a requested mutation occurred").

## 2 — Godot capability records (six; Worker B registers in WP-1)

All records: `engineFamily: "godot"`, `version: "1.0.0"`,
`compatibility: { engineVersions: ">=4.2", runtime: "Godot 4.2 stable channel or newer (family grammar; dev/alpha/beta/rc ordered below stable)", notes: "verified recipe: Godot 4.2.2.stable.official.15073afe3, binary sha256 69eb9881… (readiness §7)" }`,
`provider: mcpProvider("godot-engine")`, `provenance: enginePluginProvenance("apps/zcode-cli/packages/godot-engine-plugin")`,
`cancellation: { supported: true, semantics: "cooperative (SIGTERM to the engine process group; children reaped via process-group kill)" }` unless noted.

### 2.1 `godot/project.inspect` — read-only

| Field | Contract value |
|---|---|
| input | `{ projectRoot: string }` (required) |
| output | `{ godotVersion, configVersion, projectName, configFeatures[], hasScripts[], mainScene? }` (godotVersion required) |
| permissions | `command-execution` / `read-only` (shared constant) |
| availability | `conditional` — "requires a discovered Godot executable (>=4.2) and an existing project.godot"; prerequisites `["godot-installed"]` |
| prerequisites | `{ id: "godot-installed", description: "a real Godot executable discovered via contract 04 machine-local discovery (version verified in the family grammar)" }` |
| reversibility | `reversible` — "read-only inspection — no mutation" |
| idempotency | `{ repeatable: true }` |
| timeout | 60000 / 300000 |
| verification | `engine-query` — "the reported config MUST be re-parsed from the real project.godot by the real engine run (`--version` + config read-back), not from a cached file" |

### 2.2 `godot/scene.modify` — typed mutation through the data-only bridge

| Field | Contract value |
|---|---|
| input | `{ projectRoot, scenePath, operations: [{ nodePath, property, value }] }` — operations are TYPED and allowlisted (node-path grammar, property-name allowlist, JSON-safe values); NO user text is ever interpolated into GDScript (the committed data-only bridge takes validated JSON inputs only) |
| output | `{ applied: [{ nodePath, property, verifiedValue }], failures: [] }` |
| permissions | `engine-headless` / `declared-workspace` + `filesystem-write` / `declared-workspace` (the two shared constants, exactly like `blender/scene.modify`) |
| availability | `conditional` — same as inspect, plus an existing scene file |
| prerequisites | `godot-installed` (+ scene file existence checked at dispatch) |
| reversibility | `recoverable` — "pre-mutation scene snapshot staged in workspace temp + typed inverse ops; upgrade to `reversible` ONLY after the real journey demonstrates snapshot restore + engine read-back of restored state (rule 5)" |
| idempotency | `{ repeatable: true, dedupeKey: "projectRoot+scenePath+operations-hash" }` |
| timeout | 120000 / 600000 |
| verification | `engine-query` — "the modified scene MUST be re-loaded in a fresh engine process and the applied values asserted (tolerance 1e-5 class); an exit code alone does not prove the mutation" |

### 2.3 `godot/script.check` — read-only syntax/parse check

| Field | Contract value |
|---|---|
| input | `{ projectRoot, scriptPath }` |
| output | `{ ok: boolean, parseErrors: [{ line, column, message }], engineVersion }` |
| permissions | `command-execution` / `read-only` |
| availability | `conditional` — executable + existing script |
| reversibility | `reversible` — "read-only check — no mutation" |
| idempotency | `{ repeatable: true }` |
| timeout | 60000 / 300000 |
| verification | `output-schema` — "`--check-only` exit code AND the engine-reported parse-error text (verified fail-closed this session — readiness §4.1)" |

### 2.4 `godot/asset.import` — import a real asset into the project

| Field | Contract value |
|---|---|
| input | `{ projectRoot, sourcePath, targetAssetPath }` |
| output | `{ importedFiles[], importMetadataPath, sourceSha256 }` |
| permissions | `engine-headless` + `filesystem-write` (declared-workspace) |
| availability | `conditional` — executable + existing readable source + workspace confinement |
| prerequisites | `godot-installed` |
| reversibility | `recoverable` — "idempotent re-import; removal compensation = deleting the imported files + .import metadata; verified by filesystem probe" |
| idempotency | `{ repeatable: true, dedupeKey: "projectRoot+sourcePath+targetAssetPath" }` |
| timeout | 600000 / 3600000 |
| verification | `filesystem-probe` — "`.godot/imported/*` artifacts + `.import` metadata exist AND the source sha256 is unchanged (a staged file alone does not prove import — mirror of the blender `asset.export`/import discipline)" |

### 2.5 `godot/project.build` — headless export

| Field | Contract value |
|---|---|
| input | `{ projectRoot, preset: string (allowlisted export preset name), outPath: string (pre-created directory) }` |
| output | `{ artifactPath, artifactSha256, artifactBytes, templatesVersion }` |
| permissions | `engine-headless` + `filesystem-write` (declared-workspace) |
| availability | `conditional` — executable + preset + export templates installed for the EXACT engine version |
| prerequisites | `godot-installed`, `godot-export-templates-installed` (`{ id: "godot-export-templates-installed", description: "export templates present in ~/.local/share/godot/export_templates/<exact-version-string>/ — mismatched or missing templates fail closed with the honest reason (G3)" }`) |
| reversibility | `recoverable` — "artifact-producing, not scene-mutating; compensation = artifact deletion; output verified by hash" |
| idempotency | `{ repeatable: true, dedupeKey: "projectRoot+preset+outPath" }` |
| timeout | 600000 / 3600000 |
| verification | `artifact-hash` — "exported PCK + platform binary existence, sha256 and size bounds (readiness §4.1 verification column is the binding spec)" |

### 2.6 `godot/project.run` — headless run verification

| Field | Contract value |
|---|---|
| input | `{ projectRoot, scene?, quitAfterFrames }` |
| output | `{ exitCode, stdoutTail, stderrTail, crashLines: [] }` |
| permissions | `engine-headless` / `declared-workspace` |
| availability | `conditional` — executable + project |
| prerequisites | `godot-installed` |
| reversibility | `reversible` — "execution only — no project mutation asserted; any files written land in workspace temp" — note: honest reading of run side effects; kind `reversible` is only for no-mutation ops, so the record registers `recoverable` with notes "run side effects (user logs, caches) confined to workspace temp and the .godot dir; compensation = cache cleanup". |
| idempotency | `{ repeatable: true }` |
| timeout | 300000 / 1800000 |
| verification | `output-schema` — "exit 0 AND zero crash lines in output (both required; neither alone suffices)" |

## 3 — Unreal capability records (five; Worker B registers in WP-4)

All records: `engineFamily: "unreal"`, `version: "1.0.0"`,
`compatibility: { engineVersions: ">=5.3", runtime: "Unreal Editor 5.3+ with Remote Control plugin enabled (family grammar; ++UE5+Release-5.3 brand forms accepted)", notes: "connector attaches to a RUNNING editor — no executable is spawned by the plugin (readiness §4.2)" }`,
`provider: mcpProvider("unreal-engine")`, `provenance: enginePluginProvenance("apps/zcode-cli/packages/unreal-engine-plugin")`,
`availability: { state: "conditional", reason: "requires a discovered running Unreal Editor with Remote Control enabled on a VERIFIED loopback-only listener (HTTP 30010 / WS 30020) and the same-user OS trust boundary acknowledged", prerequisites: ["unreal-editor-discovered", "rc-listener-verified-loopback"] }`,
`cancellation: { supported: true, semantics: "in-flight requests and event subscriptions stopped, WebSocket and HTTP clients closed — NEVER the editor itself (readiness §2.2 U-T4)" }`.

Prerequisites records (shared by all five):
`{ id: "unreal-editor-discovered", description: "a running Unreal Editor (>=5.3) discovered via contract 04 machine-local discovery with an available Remote Control endpoint" }`,
`{ id: "rc-listener-verified-loopback", description: "actual HTTP and WebSocket listening addresses, ports and sockets INSPECTED and confirmed loopback-only; LAN unreachability negative-tested (a client connecting to 127.0.0.1 proves nothing about server binding — readiness §2.2 U-T1)" }`.

### 3.1 `unreal/connection.inspect` — read-only endpoint probe

| Field | Contract value |
|---|---|
| input | `{ endpoint?: string (defaults to the discovered loopback endpoint) }` |
| output | `{ editorVersion, remoteControlVersion, routes[], listenerBinding }` |
| permissions | `network-access` / `loopback-rc-endpoint` — `{ kind: "network-access", scope: "loopback-rc-endpoint", rationale: "read-only GET /remote/info against the verified loopback Remote Control listener; the Passphrase header is a transport-compatibility token only, never claimed as server-side authentication (readiness §2.2 U-T2)" }` |
| reversibility | `reversible` — "read-only probe — no mutation" |
| idempotency | `{ repeatable: true }` |
| timeout | 10000 / 30000 |
| verification | `output-schema` — "the response MUST come from the real RC `/remote/info` route of the discovered editor; the output carries the INSPECTED listener binding, not the requested client address" |

### 3.2 `unreal/object.inspect` — read-only typed describe

| Field | Contract value |
|---|---|
| input | `{ objectPath }` (path grammar validated BEFORE any request is built) |
| output | `{ class, properties[], outerPath }` |
| permissions | `network-access` / `loopback-rc-endpoint` (same spec as 3.1) |
| reversibility | `reversible` — "read-only" |
| idempotency | `{ repeatable: true }` |
| timeout | 30000 / 120000 |
| verification | `output-schema` — "describe response from the real editor for the exact validated object path; invalid paths fail closed client-side (G3 invalid-object-path challenge)" |

### 3.3 `unreal/property.read` — read-only typed property read

| Field | Contract value |
|---|---|
| input | `{ objectPath, propertyNames[] (allowlisted) }` |
| output | `{ values: Record<propertyName, value> }` |
| permissions | `network-access` / `loopback-rc-endpoint` |
| reversibility | `reversible` — "read-only" |
| idempotency | `{ repeatable: true }` |
| timeout | 30000 / 120000 |
| verification | `output-schema` — "getProperty (`READ_ACCESS`) responses from the real editor for validated paths/property names" |

### 3.4 `unreal/property.write` — allowlisted live-editor mutation

| Field | Contract value |
|---|---|
| input | `{ objectPath, property (allowlisted), value (schema-validated), expectPreState?, expectPostState }` |
| output | `{ applied: boolean, preSnapshot, postState, transactionId? }` |
| permissions | `network-access` / `loopback-rc-endpoint` + `engine-gui` / `declared-workspace` — `{ kind: "engine-gui", scope: "declared-workspace", rationale: "LIVE-EDITOR mutation through the running editor's Remote Control — never described as headless execution; engine-gui is NOT satisfied by engine-headless (no downgrade); dispatch goes through the gated native-mutation path with per-mutation permission-broker approval" }` |
| availability | `conditional` (shared spec above) |
| reversibility | `recoverable` — "setProperty with WRITE_TRANSACTION_ACCESS (editor Undo History support, NOT universal rollback); the five-part chain is MANDATORY: pre-mutation snapshot, typed operation, expected post-state, verified rollback (undo transaction or snapshot restore), post-rollback verification against the snapshot; upgrade to `reversible` ONLY after the real UE journey demonstrates the full chain — never on promise (readiness §2.2 U-T3)" |
| idempotency | `{ repeatable: true, dedupeKey: "endpoint+objectPath+property+value-hash" }` |
| timeout | 60000 / 300000 |
| verification | `engine-query` — "post-mutation state re-read from the editor (`unreal/property.read`) and compared against expectPostState; rollback verified by re-read against the pre-snapshot" |
| notes | mutation approval REQUIRED for every write — the existing ZCode permission broker, no exceptions (handoff §6) |

### 3.5 `unreal/function.invoke` — individually allowlisted typed invocation

| Field | Contract value |
|---|---|
| input | `{ objectPath, functionName (member of the REVIEWED allowlist), arguments (schema-validated against that function's registered argument schema) }` |
| output | `{ returnValue?, transactionId? }` |
| permissions | identical to 3.4 (`network-access`/loopback-rc-endpoint + `engine-gui`/declared-workspace) |
| availability | `conditional` (shared spec) |
| registration rule | **PER-FUNCTION allowlist entries** — the record is registered per reviewed function (e.g. `unreal/function.invoke` version bumped per added function, or per-function records `unreal/function.invoke:<fn>` if the id grammar requires it — WP-4 decides the exact encoding; a GENERIC unrestricted `function.call` capability is FORBIDDEN by design (readiness §4.2)) |
| reversibility | `recoverable` — "PUT /remote/object/call with generateTransaction: true (Undo History support, NOT universal rollback); same five-part chain as property.write" |
| idempotency | `{ repeatable: false }` unless the function is individually proven idempotent |
| timeout | 60000 / 300000 |
| verification | `engine-query` — "post-invocation state re-read; rollback verified against the pre-snapshot" |
| notes | unrestricted remote Python execution, remote console-command execution and arbitrary function execution are DISABLED — object paths, function names and request schemas are validated against the allowlist BEFORE any request is built (readiness §4.2)" |

## 4 — Plugin metas (registration gated on records)

### 4.1 `godot-engine` (WP-1, registers with the six §2 records)

```jsonc
{
  "pluginId": "godot-engine",
  "engineFamily": "godot",
  "engineVersions": ">=4.2",
  "executable": { "kind": "cli", "command": "godot", "args": ["--headless"] },
  "capabilities": ["godot/project.inspect", "godot/scene.modify", "godot/script.check",
                    "godot/asset.import", "godot/project.build", "godot/project.run"],
  "headlessSupport": "full",
  "requiresDisplayServer": false,
  "provenance": enginePluginProvenance("apps/zcode-cli/packages/godot-engine-plugin")
}
```

Mirrors the shipped `blender-engine` meta shape exactly (cli kind, full
headless support, no display server). The `executable` block resolves via
contract 04 machine-local discovery (the verified 4.2.2 recipe is the CI
reference installation).

### 4.2 `unreal-engine` (WP-4, registers with the five §3 records)

```jsonc
{
  "pluginId": "unreal-engine",
  "engineFamily": "unreal",
  "engineVersions": ">=5.3",
  "executable": undefined,           // the connector ATTACHES to a running editor —
                                     // it spawns nothing; kind "server" is wrong here,
                                     // and omitting executable is legal (optional field)
  "capabilities": ["unreal/connection.inspect", "unreal/object.inspect",
                    "unreal/property.read", "unreal/property.write",
                    "unreal/function.invoke"],
  "headlessSupport": "none",         // live-editor mutations are NEVER described as
                                     // headless execution (handoff §6 / readiness §5)
  "requiresDisplayServer": true,     // the externally owned editor is a GUI application;
                                     // display availability is an honest G3 prerequisite
  "provenance": enginePluginProvenance("apps/zcode-cli/packages/unreal-engine-plugin")
}
```

## 5 — WP-1 RED test design (the exact first failing test)

**File:** `packages/gamos-domain/test/engine-plugin.test.ts` (append two new
`describe` blocks; existing blocks unchanged).

**RED criterion (handoff §9):** the tests fail because the required behavior
is MISSING (no `godot/*` records, no `godot-engine` meta exist) — not because
of syntax, import or runner failure. Verified locally this session by
temporarily placing the tests and capturing the vitest output (§6).

```ts
describe("Canonical M4 Godot engine capability records (M4 WP-1, Worker B)", () => {
  it("ships records for all six godot capabilities with append-only ids", () => {
    const ids = ENGINE_PLUGIN_CAPABILITIES
      .filter((r) => r.engineFamily === "godot")
      .map((r) => r.id).sort();
    expect(ids).toEqual([
      "godot/asset.import", "godot/project.build", "godot/project.inspect",
      "godot/project.run", "godot/scene.modify", "godot/script.check",
    ]);
  });

  it("registers every godot record without error (complete execution-safety metadata)", () => {
    for (const record of ENGINE_PLUGIN_CAPABILITIES.filter((r) => r.engineFamily === "godot")) {
      expect(() => registerCapability(record)).not.toThrow();
    }
  });

  it("read-only godot operations declare read-only permissions; mutations declare engine-headless + filesystem-write", () => {
    const byId = new Map(ENGINE_PLUGIN_CAPABILITIES.map((r) => [r.id, r]));
    for (const id of ["godot/project.inspect", "godot/script.check"]) {
      const kinds = byId.get(id)!.permissions.map((p) => p.kind);
      expect(kinds).toEqual(["command-execution"]);      // read-only scope
    }
    for (const id of ["godot/scene.modify", "godot/asset.import", "godot/project.build"]) {
      const kinds = byId.get(id)!.permissions.map((p) => p.kind).sort();
      expect(kinds).toEqual(["engine-headless", "filesystem-write"]);
    }
  });

  it("mutations register recoverable (never reversible-on-promise); reads register reversible", () => {
    // … assert reversibility.kind per §2 table — the honesty rule 5
  });

  it("godot compatibility uses the family grammar (>=4.2), never universal SemVer", () => {
    // … validateEngineVersionsPredicate("godot", r.compatibility.engineVersions!) === true
  });

  it("conditional records fail closed when prerequisites are NOT satisfied", () => {
    // … resolveCapability with unsatisfied godot-installed → unavailable/missing-prerequisite
  });

  it("every godot record carries a verification spec (engine read-back / probe / hash — never exit-code-only)", () => {
    // … verification.method + spec non-empty per §2 table
  });
});

describe("M4 Godot engine-plugin meta (gamos/engine-plugin@2)", () => {
  it("ships the godot-engine meta whose every declared capability resolves", () => {
    const meta = ENGINE_PLUGIN_METAS.find((m) => m.pluginId === "godot-engine");
    expect(meta).toBeDefined();                          // RED: undefined today
    const registry = registerEnginePluginCapabilities();
    expect(validateEnginePluginMeta(meta!, registry).ok).toBe(true);
  });

  it("declares full headless support, no display server, and the family-grammar predicate >=4.2", () => {
    const meta = ENGINE_PLUGIN_METAS.find((m) => m.pluginId === "godot-engine")!;
    expect(meta.headlessSupport).toBe("full");
    expect(meta.requiresDisplayServer).toBe(false);
    expect(meta.engineVersions).toBe(">=4.2");
  });
});
```

**GREEN definition (WP-1 exit):** register the six records per §2 + the meta
per §4.1 in `engine-plugin.ts` — nothing else changes; every existing test
stays green (append-only); the new tests go green.
**HARDEN:** the negative rows from delivery plan §7 (Godot column) land with
the plugin slices (WP-2), not with the records.
**Registration-order proof:** the RED state itself demonstrates contract 03
rule 1 fail-closed — declaring `godot-engine` before the records exist is
structurally rejected.

## 6 — RED verification performed this session (design-level, honest scope)

The §5 test design was placed temporarily into the test tree on the restored
baseline (`48ce1fd3` + delivery plan) and run with
`vitest run --project gamos-domain test/engine-plugin.test.ts`:
**32 tests — 6 failed | 26 passed** (24 pre-existing tests all still green —
the append-only contract holds across the RED state). Every failure carries
the MISSING-BEHAVIOR signature, zero import/syntax/runner failures:

- `expected [] to deeply equal [ 'godot/asset.import', …(5) ]` — zero godot records exist;
- `expected +0 to be 6` — the record count is missing;
- `Cannot read properties of undefined (reading 'permissions')` and
  `(reading 'reversibility')` — godot lookups return undefined (records
  absent, imports intact);
- `expected undefined to be defined` — the `godot-engine` meta does not exist.

Honest note on the two vacuous passes: the family-grammar and
verification-spec tests iterate the (currently empty) godot filter, so they
are trivially green in the RED state; they become real guards only in GREEN,
where they pin the family grammar (no universal SemVer) and the
never-exit-code-only verification rule at registration time. Captured output:
`gamos-readiness/m4-wp1-red-output.txt`.
**This proves the tests are correctly RED — it is NOT a gate result and NOT
implementation progress.** M4-G1/G2/G3/G4 remain unpassed and unclaimed.

## 7 — Registration sequence when active (binding)

1. WP-1 (order 1): Worker B registers the six §2 records + §4.1 meta in ONE
   slice with the §5 tests going RED→GREEN; registry count grows
   383→(domain suite grows accordingly); no blender/unity/babylon/core record
   or meta is touched.
2. WP-4 (order 4): Worker B registers the five §3 records + §4.2 meta with
   the mirror-image tests (unreal family), INCLUDING the honest-availability
   tests (unavailable reasons fail closed) — after TL contract sign-off.
3. The M4-G3 engine-selection tests consume these records' availability and
   compatibility fields — no test may silently substitute one engine family
   for another (handoff §4/§8).

## 8 — What this document is NOT

Not an activation. Not a registration. Not a gate claim. Not an
implementation. It contains zero production code changes — the branch adds
exactly this one file under the unprotected `docs/gamos/` surface. The
sandbox contains no Unreal Editor and no M4-G2 claim is made. M4 stays
`planned` (blocked) until ALL FOUR activation conditions hold (delivery plan
§2). The capability ids, permission mappings, availability states,
reversibility rules and verification specs above become BINDING on Worker B's
WP-1/WP-4 implementations once M4 activates — deviations require TL review
before registration, exactly like any shared-contract change.
