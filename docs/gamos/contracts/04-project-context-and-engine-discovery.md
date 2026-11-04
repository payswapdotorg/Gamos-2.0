# Gamos Phase-0 Contract 04 — Project Context & Engine Discovery

- Status: **FROZEN (Phase 0)** — hash-protected governance control file
- Owner: Gamos TL

## 1. Principle

"Which engines does this machine/project have?" is answered by a **discovery data set**
attached to the existing workspace/project model (`packages/services/src/project/…`,
project records in the agent store: `project_id`, `directory`, roots). No new project
system.

## 2. Project context record (schema `gamos/project-context@1`)

```ts
interface GamosProjectContext {
  workspacePath: string;            // matches the ZCode project root exactly
  gameirRefs?: string[];            // GameSpec documents in-repo (contract 01)
  engines: DiscoveredEngine[];      // result of discovery below
  discoveredAt: string;             // ISO-8601 UTC
  discoveryVersion: string;         // discovery contract version
}

interface DiscoveredEngine {
  engineFamily: EngineFamily;
  installed: boolean;
  version?: string;                 // normalized semver when installed
  executablePath?: string;
  headlessCapable: boolean;
  displayServerRequired: boolean;
  notes?: string;                   // explicit unavailable reason when !installed
}
```

MUST rules:
1. Discovery runs as an **agent tool** (read-only filesystem probes + version queries),
   not a daemon; results are cached in the project context file (`gamos.project.json`
   in the workspace, data — not code).
2. `installed: false` MUST carry an explicit reason in `notes` (mirrors the architect's
   "explicit unavailable/conditional states" rule).
3. Discovery MUST be idempotent and re-runnable via a normal conversation request.
4. Workspace path is the ZCode project root (verified concept: project records carry
   `directory`/`path`); the context never invents its own root resolution.

## 3. Engine-specific discovery probes

- **Unity**: `Unity` executable / Unity Hub installs; project `ProjectSettings/ProjectVersion.txt`.
- **Blender**: `blender --version` (batch mode); `*.blend` presence.
- **Babylon**: toolchain presence (Node + babylon tooling), web project markers.
- Absence of a probe target = explicit `installed: false` + reason; never an error.
