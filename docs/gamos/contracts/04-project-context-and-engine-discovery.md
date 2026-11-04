# Gamos Phase-0 Contract 04 — Project Context & Engine Discovery

- Status: **FROZEN (Phase 0, revision 1)** — hash-protected governance control file
- Owner: Gamos TL
- Revision 1 (GAMOS-AUTH-0003): engine-specific version parsing (no universal SemVer
  assumption — architect re-review correction E) and the separation of machine-local
  discovery data from shared project metadata.

## 1. Principle

"Which engines does this machine/project have?" is answered by a **discovery data set**
attached to the existing workspace/project model (`packages/services/src/project/…`,
project records in the agent store: `project_id`, `directory`, roots). No new project
system.

## 2. Shared project metadata vs machine-local discovery data (revision 1 — MUST)

Two different data classes, two different stores:

1. **Shared project metadata** — `gamos.project.json` in the workspace (committed or
   shareable): GameIR/GameSpec references (`gameirRefs`), declared engine bindings
   (`engineFamily` + version predicate per contract 02 `compatibility`), acceptance
   references. Contains **no machine-local state**.
2. **Machine-local discovery data** — the result of probing THIS machine: installed
   engines, executable paths, headless capability, parsed version details. Stored
   OUTSIDE the workspace-shared file, under the ZCode data base dir, keyed by the
   workspace path (e.g. `<dataBaseDir>/gamos/discovery/<hash-of-workspace-path>.json`,
   data — not code). Rationale: paths, installs and versions differ per machine;
   mixing them into a shareable project file would leak machine state into shared
   metadata and make checkouts non-portable.

MUST rules:
1. `gamos.project.json` MUST remain machine-neutral; writing any machine-local field
   (executable path, `installed` flags) into it is a contract violation.
2. Resolution of a project's effective engine state = shared declarations JOINED with
   machine-local discovery at task time; the join result is transient (conversation
   context), and the machine-local record is refreshed per discovery run (§4).
3. The machine-local record carries `workspacePath` + `discoveredAt` + host fingerprint
   (platform/arch) so stale cross-machine data is detectable and re-probed.

## 3. Records (schemas `gamos/project-context@2` / `gamos/engine-discovery@2`)

```ts
// SHARED — workspace file gamos.project.json
interface GamosProjectMetadata {
  schemaVersion: 2;
  workspacePath: string;            // matches the ZCode project root exactly
  gameirRefs?: string[];            // GameSpec documents in-repo (contract 01)
  engineBindings?: Array<{          // declared intent, not machine state
    engineFamily: EngineFamily;
    versionPredicate?: string;      // engine-family grammar (see §4)
  }>;
}

// MACHINE-LOCAL — <dataBaseDir>/gamos/discovery/<workspace-hash>.json
interface MachineEngineDiscovery {
  schemaVersion: 2;
  workspacePath: string;            // provenance: which project this probes for
  host: { platform: string; arch: string };
  discoveredAt: string;             // ISO-8601 UTC
  discoveryVersion: string;         // discovery contract version
  engines: DiscoveredEngine[];      // result of probes below
}

interface DiscoveredEngine {
  engineFamily: EngineFamily;
  installed: boolean;
  rawVersion?: string;              // EXACT upstream string (never normalized away)
  parsedVersion?: EngineVersion;    // engine-specific parse (see §4)
  executablePath?: string;          // machine-local
  headlessCapable: boolean;
  displayServerRequired: boolean;
  notes?: string;                   // explicit unavailable reason when !installed
}
```

MUST rules:
1. Discovery runs as an **agent tool** (read-only filesystem probes + version queries),
   not a daemon; results land ONLY in the machine-local record (§2).
2. `installed: false` MUST carry an explicit reason in `notes` (mirrors the architect's
   "explicit unavailable/conditional states" rule).
3. Discovery MUST be idempotent and re-runnable via a normal conversation request.
4. Workspace path is the ZCode project root (verified concept: project records carry
   `directory`/`path`); the context never invents its own root resolution.

## 4. Engine-specific version parsing (revision 1 — MUST)

**There is no universal SemVer assumption.** Each engine family declares its own version
grammar and parser; `parsedVersion` is a structured, comparable form produced by the
family parser, and `rawVersion` is always retained:

| Family | Raw examples | Parser notes |
|---|---|---|
| Unity | `2022.3.10f1`, `6000.0.23f1` | `<major>.<minor>.<patch><stream-letter><seq>`; stream in {a=alpha, b=beta, f=final, c=china, p=patch}; `ProjectVersion.txt` carries `m_EditorVersionWithRevision` (may append `(<sha>)`) |
| Blender | `Blender 4.1.1`, `4.2 LTS` | semver-like major.minor.patch + optional LTS tag; `blender --version` first line |
| Babylon | toolchain versions (Node etc.) | uses the underlying runtime's grammar; toolchain markers per probe |
| Godot | `4.2.1.stable.official.<build>` | major.minor.patch + channel in {stable, rc, beta, alpha, dev} (+ mono suffix) |
| Unreal | `5.3.2-<branch>+<commit>`, `++UE5+Release-5.3` | `<major>.<minor>.<patch>-<branch>` with engine-brand prefixes to strip |

MUST rules:
1. A version that fails its family parser is recorded as `rawVersion`-only with a
   diagnostic (compatibility checks then resolve to *incompatible/unknown* — fail
   closed per contract 02 §3, never "treat as compatible").
2. Comparison uses the structured parse (e.g. Unity `2022.3.10f1 < 2022.3.2f1` is FALSE —
   the stream sequence is part of the ordering); predicates in shared metadata
   (`versionPredicate`) use the same family grammar, evaluated by the family parser.
3. Adding a new engine family requires shipping its version parser + tests together
   (Worker A scope; TL-reviewed).

## 5. Engine-specific discovery probes

- **Unity**: `Unity`/Unity Hub executable installs; project `ProjectSettings/ProjectVersion.txt`.
- **Blender**: `blender --version` (batch mode); `*.blend` presence.
- **Babylon**: toolchain presence (Node + babylon tooling), web project markers.
- **Godot**: `godot --version` / `godot4 --version`; project.godot presence.
- Absence of a probe target = explicit `installed: false` + reason; never an error.
