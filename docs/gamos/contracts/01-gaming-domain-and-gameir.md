# Gamos Phase-0 Contract 01 — Gaming Domain & GameIR Alignment

- Status: **FROZEN (Phase 0)** — hash-protected as a governance control file (ADR-0004)
- Owner: Gamos TL
- Change control: any modification requires a complete `gamos/authorization@2` ledger entry + rebaseline + TL-reviewed PR

## 1. Principle

Gamos does not fork ZCode's product concepts. The gaming domain is expressed as
**data flowing through the existing ZCode agent task system** (`packages/services/src/session/zcodeTaskService.ts`,
session store in the agent CLI's SQLite `session`/`message`/`part` tables).
There is **no second task system**.

## 2. Domain model (additive types in `packages/gamos-domain` — planned)

```
GameConcept      — user-level intent: genre, mechanics, references, target engine family
GameSpec (GameIR)— normalized, engine-neutral specification derived from GameConcept:
                   scenes, entities, components, systems, assets, constraints, acceptance checks
GamePlan         — GameSpec + chosen engine binding + ordered capability steps (workflow)
GameArtifact     — concrete outputs (project files, builds, screenshots, reports)
```

Alignment rules (MUST):
1. `GameConcept`/`GameSpec`/`GamePlan` are **plain serializable data** carried in the
   existing conversation/task payloads (message `part` records) — never a parallel runtime.
2. GameIR versions: `gameir@1` schema id embedded in payloads; unknown versions MUST be
   rejected with an explicit error, not coerced.
3. Every GameSpec MUST declare an `acceptance` section (verifiable outcomes) so tasks stay
   evidence-oriented, mirroring ZCode's task outcome model (`session.last_outcome`).
4. The agent's Write/Read/Edit tool vocabulary (verified in evidence/phase-b rollouts)
   is the ONLY file-mutation path for game project files.

## 3. Mapping to ZCode surfaces

| Gamos concept | ZCode infrastructure (existing, verified) |
|---|---|
| New game task | New Task composer + task submission (packages/ui Root; agent CLI `-p`/sessions) |
| GameConcept capture | Conversation messages + attachments (`--attach` verified) |
| GameSpec/GamePlan documents | Workspace files + context (`@` context mentions) |
| Task orchestration | Agent turn loop; workflow tables (`workflow_definition`, `workflow_run`, `workflow_activity`) already present in the CLI store |
| Ordinary (non-gaming) tasks | Unchanged default path — Gamos is additive |

## 4. Non-goals (explicit)

No new agent runtime, no second conversation store, no replacement of the model router,
no changes to `window.zcode`, IPC channels, or RPC contracts (identifier freeze in
`.gamos-protected-surfaces.json`).
