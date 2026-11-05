# Gamos Phase-0 Contract 01 — Gaming Domain & GameIR Alignment

- Status: **FROZEN (Phase 0, revision 2)** — hash-protected as a governance control file (ADR-0004)
- Owner: Gamos TL
- Change control: any modification requires a complete `gamos/authorization@2` ledger entry + rebaseline + TL-reviewed PR
- Revision 1 (GAMOS-AUTH-0003): explicit alignment with the existing PlayLiquid/GameIR source
  contracts (architect re-review correction A). No second independent GameIR.
- Revision 2 (GAMOS-AUTH-0004): **exact-compatibility rule** — `GameSpec` is exactly a
  PlayLiquid `GameIRDocument` (no additional fields); Gamos-specific acceptance criteria
  moved out of the GameSpec into the GamePlan / acceptance record (architect M0-closure
  correction A). No parallel or extended GameIR document schema.

## 1. Principle

Gamos does not fork ZCode's product concepts. The gaming domain is expressed as
**data flowing through the existing ZCode agent task system** (`packages/services/src/session/zcodeTaskService.ts`,
session store in the agent CLI's SQLite `session`/`message`/`part` tables).
There is **no second task system**, and there is **no second GameIR** (see §2).

## 2. Alignment with the existing PlayLiquid/GameIR source contracts (MUST)

The authoritative GameIR specification is the **existing** `game-ir` module of the
PlayLiquid GameOS workstream:

- Source of truth: `payswapdotorg/PlayLiquid-2.0` → `packages/playliquid-gameos/src/game-ir/`
  (`contract.ts` public barrel; package `@playliquid/gameos`), pinned at commit
  `196b305e75decfeaa162d3da479dc125cff1521a`.
- The module is the **engine-independent semantic kernel**: `GameIRDocument`
  (`irVersion: "1"`, `identity`, `lifecycle?`, `world?` [ACR-001], `entry: SceneRef`,
  `nodes: readonly GameIRNode[]`), node kinds (`WorldNode`, `SceneNode`, `EntityNode`,
  `RuleNode`, `EventDeclarationNode`, `CapabilityDeclarationNode`, `AvatarBindingNode`),
  value system (`GameIRValue`/`ValueKind`, canonical forms, hashing, determinism
  verification), semantics (`SemanticTick`, `EventTypeId`, `IntentTypeId`,
  `CommandTypeId`, `GameEvent`, `Intent`, `Command`), and diagnostics
  (`Diagnostic`/`ValidationResult`).

Alignment rules (MUST):

1. **Exact compatibility (revision 2).** The Gamos `GameSpec` **IS** a PlayLiquid
   `GameIRDocument` — and nothing more. Its field set is exactly the upstream field set:
   `irVersion` (frozen at `"1"`), `identity`, `lifecycle?`, `world?` (ACR-001), `entry:
   SceneRef`, `nodes: readonly GameIRNode[]`. Gamos MUST NOT add fields to the document —
   in particular **no `acceptance` field, no engine bindings, no build steps, no
   capability references** (those belong to the GamePlan layer, §3, and contracts
   02/03/05). A serialized GameSpec that validates against the upstream
   `GameIRDocument` schema is valid for Gamos; anything requiring additional fields is
   by definition NOT a GameSpec. Serialization, validation and versioning reuse the
   upstream contract; vocabulary changes require the upstream Architecture Change
   Request process.
2. Where Gamos needs gaming vocabulary beyond the kernel (engine bindings, build
   steps, capability references, acceptance criteria), those live in the **GamePlan
   layer** (§3, contract 05) or in capability metadata (contracts 02/03) — never as
   edits to, or extensions of, the GameIR document vocabulary.
3. Validation of a GameSpec MUST reuse the upstream validation semantics
   (`validate.ts`/`selfcheck.ts` equivalents): diagnostics-based, fail-closed on
   errors. Gamos adds no substitutive or additional document-level schema checks;
   Gamos-side acceptance verification is attached at the GamePlan/acceptance-record
   layer (contract 05 §2), never as extra GameIR document structure.
4. Reuse is by **type/semantics conformance**, not necessarily by npm dependency:
   Gamos may vendor the contract types with provenance recorded (contract 09) or
   depend on the package if the workspace allows — either way the upstream module
   remains the named source of truth and drift is a governance defect.
5. PlayLiquid alignment artifacts (delivery conventions, installer surfaces,
   release channels) are owned by contract 08 / Worker C scope — not by this
   contract.

## 3. Domain model (additive types in `packages/gamos-domain` — planned)

```
GameConcept      — user-level intent: genre, mechanics, references, target engine family
GameSpec (GameIR)— a PlayLiquid GameIRDocument (upstream contract, §2) — exactly the
                   upstream field set, no extensions (revision 2)
GamePlan         — GameSpec reference + chosen engine binding + workflow steps +
                   ACCEPTANCE CRITERIA (a Dynamic Workflow script artifact carrying a
                   separate acceptance record — see contract 05 revision 2)
GameArtifact     — concrete outputs (project files, builds, screenshots, reports)
AcceptanceRecord — Gamos-specific verifiable outcomes; referenced FROM the GamePlan,
                   never embedded in the GameSpec (revision 2)
```

Alignment rules (MUST):
1. `GameConcept`/`GameSpec`/`GamePlan` are **plain serializable data** carried in the
   existing conversation/task payloads (message `part` records) — never a parallel runtime.
2. GameSpec documents embed the upstream `irVersion`; unknown versions MUST be
   rejected with an explicit error, not coerced.
3. **Acceptance criteria live in the GamePlan or a separate acceptance record
   (revision 2)** — mirroring ZCode's task outcome model (`session.last_outcome`) at
   the plan layer. A GameSpec MUST NOT declare an `acceptance` section or any other
   Gamos-specific field; the presence of such a field is a schema violation, not a
   tolerated extension.
4. The agent's Write/Read/Edit tool vocabulary (verified in evidence/phase-b rollouts)
   is the ONLY file-mutation path for game project files.

## 4. Mapping to ZCode surfaces

| Gamos concept | ZCode infrastructure (existing, verified) |
|---|---|
| New game task | New Task composer + task submission (packages/ui Root; agent CLI `-p`/sessions) |
| GameConcept capture | Conversation messages + attachments (`--attach` verified) |
| GameSpec/GamePlan documents | Workspace files + context (`@` context mentions) |
| Task orchestration | Agent turn loop; GamePlan execution = existing Dynamic Workflow runtime (contract 05) |
| Ordinary (non-gaming) tasks | Unchanged default path — Gamos is additive |

## 5. Non-goals (explicit)

No new agent runtime, no second conversation store, no replacement of the model router,
no changes to `window.zcode`, IPC channels, or RPC contracts (identifier freeze in
`.gamos-protected-surfaces.json`). **No second, independent GameIR** — the PlayLiquid
`game-ir` kernel is the only GameIR (§2).
