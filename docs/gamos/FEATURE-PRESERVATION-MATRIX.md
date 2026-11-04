# Gamos — Feature Preservation Matrix

> Binding inventory of every inherited ZCode feature, its required treatment in
> Gamos, and its **verified source anchors** at the pinned baseline
> (`a9fe401e…`, v3.17.2). Source anchors were confirmed by direct inspection of
> the baseline tree (paths exist as listed).
>
> **Acceptance rule:** an inherited feature is *preserved* only when its
> original functionality remains **operational and reachable** — not merely
> because its files still exist. Before modifying any inherited module, inspect
> its actual implementation, callers, tests and service contracts.
>
> Status legend — `baseline`: untouched at fork point (the starting state for
> every row). Statuses will only ever move to `extended`, `preserved` or
> `improved` — never `removed`/`replaced` (that would violate the architecture
> rules).

| # | Feature | Required treatment | Verified source anchors | Status |
|---|---|---|---|---|
| 1 | Agent runtime & execution | Preserve fully; add gaming intent handling + capability use | `packages/services/src/zcode-agent/`, `packages/services/src/zcode-session/`, `apps/zcode-cli/packages/core`, `apps/zcode-cli/packages/bootstrap` | baseline |
| 2 | Model/provider routing | Preserve fully; use user's selected model & configs | `packages/provider/`, `packages/provider-node/`, `packages/services/src/bigmodel/` | baseline |
| 3 | Thinking & collaboration modes | Preserve all modes; add gaming task guidance w/o changing semantics | `packages/ui/src/` (composer controls), `packages/model-option-map/` | baseline |
| 4 | New Task composer | Preserve every control; add optional gaming project/context | `packages/ui/src/App.tsx`, `packages/ui/src/v4/` (composer surfaces), `packages/shared/src/channels.ts` | baseline |
| 5 | Tasks & sessions | Preserve lifecycle, queues, history, cancellation, recovery | `packages/services/src/session/` (incl. `contract.ts`, `taskIndexRepo.ts`, `automationRepo.ts`, `tasksDatabase/`) | baseline |
| 6 | Context & memory | Add gaming-project understanding + relevant persistent memory | `packages/services/src/storage/`, `packages/services/src/task-facts/` | baseline |
| 7 | Attachments & file context | Preserve; improve game-project/asset/design-reference handling | `packages/services/src/file/`, `packages/services/src/fileWatcher/` | baseline |
| 8 | MCP | Preserve; add first-party engine & platform integrations | `packages/services/src/mcp-sync/`, `apps/zcode-cli/packages/contracts` | baseline |
| 9 | Plugin Marketplace | Preserve all capabilities; add Gamos plugin collection | `apps/zcode-cli/packages/plugin-creator-plugin/`, `apps/zcode-cli/packages/` (32 pkgs), `docs/adr/0001…0004` (marketplace ADRs) | baseline |
| 10 | Skills & commands | Preserve; add gaming Skills + repeatable commands | `packages/services/src/skills/`, `skill-sync/`, `apps/zcode-cli/packages/bundled-skills`, `skill-creator-plugin` | baseline |
| 11 | Hooks | Preserve; add engine/project lifecycle hooks w/ explicit trust policies | `packages/services/src/hooks/` | baseline |
| 12 | Interactive UI Plugins | Preserve; add engine inspectors, workbenches, previews | `packages/desktop/src/renderer/plugin-sandbox.html`, `UI_PLUGIN.md` / `UI_PLUGIN.en.md` (root), `apps/zcode-cli/packages/zcode-site-plugin` | baseline |
| 13 | Gen UI | Preserve; add generated gaming interfaces & reports | `packages/services/src/gen-ui/` | baseline |
| 14 | Browser Use | Preserve; add gaming-aware web testing workflows | `apps/zcode-cli/packages/browser-use-plugin/` | baseline |
| 15 | Computer Use | Preserve; use for genuine desktop-only engine capabilities | `packages/zcode-cua/`, `apps/zcode-cli/packages/zcode-cua-plugin/`, `packages/services/src/cua-permission-broker/` | baseline |
| 16 | Terminal & Bash | Preserve; add engine-specific command workflows | `packages/services/src/terminal/` (`terminalService.ts`, node-pty), `packages/ui/src/terminal/` | baseline |
| 17 | Search | Preserve; add game-asset, scene, code indexing | `packages/ui/src/workspace-file-search/` | baseline |
| 18 | Git & Review | Preserve; add semantic game change reviews | `packages/services/src/git/` | baseline |
| 19 | Subagents | Preserve; add gaming specialists on existing infra | `packages/services/src/subagents/` | baseline |
| 20 | Dynamic Workflow | Preserve; use for game-production orchestration | `apps/zcode-cli/packages/dynamic-workflow/`, `dynamic-workflow-runtime/` | baseline |
| 21 | Automations & off-peak tasks | Preserve; add scheduled builds/tests/asset validation | `packages/desktop/src/scheduler/`, `packages/services/src/session/automationRepo.ts`, `offPeakTaskRepo.ts` | baseline |
| 22 | Document/PDF/presentation/spreadsheet plugins | Preserve; add game-production workflows & templates | `documents-plugin/`, `pdf-plugin/`, `presentations-plugin/`, `spreadsheets-plugin/`, `office-runtime/` (all under `apps/zcode-cli/packages/`) | baseline |
| 23 | Image search & visualization | Preserve; add game concept/asset workflows + rights tracking | `image-search-plugin/`, `visualize-plugin/` (under `apps/zcode-cli/packages/`) | baseline |
| 24 | Bots & integrations | Preserve; add gaming project/build event notifications | `packages/services/src/bots/`, `bot-project-runtime/` | baseline |
| 25 | Settings & account infrastructure | Preserve complete functionality; add only necessary gaming settings | `packages/services/src/setting/`, `settings-sync/`, `packages/ui/src/settings/`, `settings-scope/` | baseline |
| 26 | Local & remote workspaces | Preserve; make engine capabilities environment-aware | `packages/services/src/remote-projects/`, `remote-sync/`, `source-server-management/`, `source-server-workspace/` | baseline |
| 27 | RPC & client/server infrastructure | Preserve; add typed gaming service interfaces | `packages/rpc/`, `packages/client/`, `packages/server/`, `packages/shared/src/channels.ts` | baseline |
| 28 | Desktop, Web & CLI/TUI | Preserve; platform-appropriate gaming capability support | `packages/desktop/`, `packages/web/`, `apps/zcode-cli/packages/cli`, `apps/zcode-cli/packages/tui` | baseline |
| 29 | Keyboard shortcuts & commands | Preserve; add gaming shortcuts w/o replacing bindings | `packages/shared/src/shortcutCommands.ts`, `packages/ui/src/shortcuts/` | baseline |
| 30 | Telemetry & debugging | Preserve; add gaming execution & performance metrics | `packages/services/src/telemetry/`, `apps/zcode-cli/packages/telemetry`, `conversation-telemetry/` | baseline |
| 31 | Onboarding | Preserve; add optional gaming/engine setup guidance | `apps/zcode-cli/packages/zcode-guide-plugin/` | baseline |
| 32 | Packaging & release infrastructure | Preserve; produce Gamos artifacts w/o replacing ZCode | `scripts/dev-desktop-env.mjs`, `Dockerfile.desktop-e2e`, root build scripts, `docs/adr/0004-release-packaging-platform-contract.md` | baseline |

---

## Enforcement

1. Any diff touching a row's source anchors must be justified in
   `.gamos-authorized-modifications.json` (file/symbol, reason, affected
   functionality, regression tests, TL approval, evidence).
2. `node scripts/gamos/governance-check.mjs` (CI: `.github/workflows/gamos-governance.yml`)
   fails on: deletion of protected files, absence of the baseline ancestor, or
   modifications to protected surfaces without an authorization entry.
3. Upstream's own gate (`pnpm run architecture:check`, upstream-admission
   semantics) remains in force — upstream-tracked files that are modified must
   be registered through it as well.
