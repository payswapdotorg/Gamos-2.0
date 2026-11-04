# Gamos — Architecture

> This document describes the **actual** upstream ZCode architecture at the pinned
> baseline (`a9fe401e…`, v3.17.2), as verified by direct source inspection, and the
> **additive** Gamos surfaces that are planned on top of it. Everything under
> "Planned Gamos additions" is explicitly marked as *not yet implemented* — this
> document never reports aspirational work as implemented.

---

## 1. Repository topology (verified)

pnpm workspace monorepo (`pnpm-workspace.yaml`), root package `zcode@3.17.2`,
17,237 tracked files.

```
apps/
  dev-docs/                  developer documentation site
  zcode-cli/                 CLI product line
    packages/                32 official plugin/runtime packages (see §5)
    tools/, scripts/, e2e/, tests/
packages/
  desktop/                   Electron 44 desktop application
    src/main/                main process (window lifecycle, tray, updates,
                             deep links zcode://, IPC registration, browser
                             guest management, plugin sandbox host, CUA, ARMS)
    src/host/                utilityProcess per window — runs @zcode/server +
                             @zcode/services (sessions, tasks, terminal pty,
                             credentials, MCP…), MessagePort to renderer
    src/scheduler/           separate process for cron / off-peak tasks
    src/preload/, src/renderer/, src/shared/
  ui/                        the entire workbench UI (desktop & web share Root)
  web/                       web entry (renders the same Root)
  client/                    transport layer (MessagePort/WebSocket), no UI
  server/  services/  rpc/   server runtime, domain services, RPC contracts
  shared/                    shared contracts (IPC channels, shortcut tables)
  provider/ provider-node/   model/provider abstraction + Node implementation
  zcode-cua/                 computer-use agent infrastructure
  android/  web-share/  share-ui/  stream-animate/  e2e-report/
  formal-proof/  model-option-map/  zcode-server-cli/
scripts/
  architecture/              upstream architecture governance (see §6)
  dev-desktop-env.mjs, test-*  dev/test orchestration
docs/                        ~49 subdirectories of engineering docs + docs/adr/
architecture-policy.yaml     module registry + layering rules
.architecture-baseline.json  {"version":1,"violations":[]}
```

## 2. Process architecture (verified)

```
Electron App
├─ MAIN        packages/desktop/src/main/index.ts
│    windows, tray, auto-update, deep links, IPC registration,
│    embedded browser guests, plugin sandbox host, CUA, ARMS telemetry
├─ HOST        packages/desktop/src/host/index.ts  (utilityProcess, 1 per window)
│    runs @zcode/server + @zcode/services: sessions, tasks, terminal (node-pty),
│    credentials (AES-256-GCM file store), MCP…
│    renderer ⇄ host via MessageChannelMain ports
├─ SCHEDULER   packages/desktop/src/scheduler/index.ts  (cron / off-peak)
└─ RENDERER    Vite React (4 entries: index.html, resource-manager.html,
               cua-permission-panel.html, plugin-sandbox.html)
```

Key contract files: `packages/shared/src/channels.ts` (IPC channel constants),
`packages/shared/src/shortcutCommands.ts` (shortcut table).

## 3. Key runtime services (verified, `packages/services/src/`)

`session`, `zcode-session`, `zcode-agent`, `subagents`, `terminal`,
`credential`, `cua-permission-broker`, `git`, `hooks`, `mcp-sync`, `skills`,
`skill-sync`, `setting`, `settings-sync`, `storage`, `telemetry`, `bots`,
`gen-ui`, `file`, `fileWatcher`, `remote-projects`, `remote-sync`,
`commands`, `data-sync`, `cloud-content`, `conversation-share`, and more.

## 4. UI surfaces (verified, `packages/ui/src/`)

`App.tsx` + the full workbench: settings, shortcuts, side-pane-full-view,
sidebar-activity, terminal, store, workspace-file-tree / file-search /
grouped-tasks / plugin-preview / config-catalog, web-remote-control, v4, etc.
Desktop and Web render the **same Root** (`packages/web` entry).

## 5. Official plugin packages (verified, `apps/zcode-cli/packages/`)

32 packages, including the runtime core (`core`, `cli`, `contracts`,
`bootstrap`, `adapters`, `shared-types`, `i18n`, `telemetry`, `debug`,
`tui`) and first-party plugins:

`android-emulator-plugin`, `browser-use-plugin`, `documents-plugin`,
`dynamic-workflow` + `dynamic-workflow-runtime`, `image-search-plugin`,
`ios-simulator-plugin`, `node-repl-host`, `office-runtime`, `pdf-plugin`,
`plugin-creator-plugin`, `presentations-plugin`,
`restore-legacy-sessions-plugin`, `skill-creator-plugin`,
`spreadsheets-plugin`, `superpowers-plugin`, `swift-bridge`,
`visualize-plugin`, `zcode-cua-plugin`, `zcode-guide-plugin`,
`zcode-site-plugin`, `bundled-skills`.

This is the exact location where Gamos engine plugins will live
(`unity-engine-plugin`, `blender-engine-plugin`, `babylon-engine-plugin`,
`godot-engine-plugin`, `unreal-engine-plugin`) — following the existing
manifest / MCP / Skills / marketplace contracts.

## 6. Upstream governance tooling (verified — Gamos reuses it)

- `architecture-policy.yaml` — module registry (`managed: true|false`) with
  layering rules, public entrypoints.
- `scripts/architecture/architecture-check.mjs` + `.architecture-baseline.json` —
  architecture gate (`pnpm run architecture:check`).
- `scripts/architecture/upstream-admission.mjs` + `upstream-snapshot.json` —
  "原样上游存量可接纳，本地新增仍受管 / 改过的上游文件仍须登记":
  untouched upstream files are admissible; **any modification of an
  upstream-tracked file must be registered**; new files go through module
  admission.
- `pnpm run verify:pre-push` — lint + docs + db schema + architecture +
  engineering tests.
- Upstream has **no `.github/` CI** at baseline; Gamos adds a governance
  workflow (see ADR-0003) as a purely additive file.

## 7. Planned Gamos additions (NOT YET IMPLEMENTED)

| Surface | Location (planned) | Status |
|---|---|---|
| Pure gaming domain layer | `packages/gamos-domain/` | Not started — M1 |
| Capability registry + contracts | inside `packages/gamos-domain/` | Not started — M1 |
| Engine plugins (Unity first, then Blender, Babylon, Godot, Unreal) | `apps/zcode-cli/packages/*-engine-plugin` | Not started — M2/M4 |
| Intent & workflow orchestration | via existing Dynamic Workflow system | Not started — M1/M3 |
| Game asset pipeline | engine adapters + domain contracts | Not started — M3 |
| GameOS / platform / publishing | `packages/gamos-platform/` (subject to approved architecture) | Not started — M6/M7 |
| PaySwap PSP integration | dedicated integration surfaces, reusing PaySwap authority | Not started — M7 |
| Composer gaming-context additions | additive extension points in existing composer | Not started — M1+ |
| Governance CI | `.github/workflows/gamos-governance.yml` + `scripts/gamos/governance-check.mjs` | **Implemented in this repo (M0)** |

## 8. Preservation boundary (binding)

Do **not** mass-rename `@zcode/*` package identifiers, `window.zcode`, ZCode
IPC channels, environment variables, storage keys, RPC contracts, protocol
names or application services — they are implementation infrastructure, not
branding. New Gamos capabilities are additive files/packages. The full
protected-surface list is machine-readable in `.gamos-protected-surfaces.json`;
modifications to protected surfaces require an entry in
`.gamos-authorized-modifications.json` plus TL approval (see ADR-0002).
