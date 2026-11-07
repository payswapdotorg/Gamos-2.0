# @zcode/babylon-engine-plugin

Typed, safety-reviewed Babylon.js project operations for ZCode, exposed as MCP tools.

The plugin drives the real Node/Vite toolchain of a Babylon web project and offers
three typed project operations plus one cancellation surface — no arbitrary
scripts are ever accepted or executed:

| MCP tool (namespaced by the app as `mcp__plugin_babylon-engine_engine__*`) | Capability | Semantics |
| --- | --- | --- |
| `project_inspect` | `babylon/project.inspect` | read-only |
| `project_build` | `babylon/project.build` | executes the declared `build` script, writes a `dist/` artifact |
| `project_run` | `babylon/project.run` | starts the declared `dev`/`start` script as a detached tracked process |
| `project_stop` | cancellation surface for `project_run` | stops a tracked runtime and frees its port |

## Safety model

- **Typed operations only.** Every operation input is validated with zod
  (`src/typed-ops.ts`) against the frozen capability schemas. Only scripts
  DECLARED in the project's `package.json` AND allowlisted are ever executed:
  the build tool runs only `build`, the run tool only `dev`/`start`
  (`src/project.ts` `validateScriptName`). Script names are never inferred
  from model text, and tool input can never name a different script.
- **Fail-closed project detection.** A project without `@babylonjs/*`
  dependencies in `dependencies`/`devDependencies` is rejected as
  `not-a-babylon-project`. Malformed or missing `package.json` is a structured
  failure, never a guess.
- **Workspace path safety.** All inputs must be absolute paths inside the
  workspace root; `..` traversal outside the root and symlink escapes are
  rejected (`resolveWorkspacePath`).
- **No shell interpolation.** The package manager is spawned with an argument
  array (`shell: false`) through the discovered, version-gated node
  executable; a detached process group plus `kill(-pid)` guarantees bounded
  timeouts actually reap the whole tree (npm → sh → vite), which killing the
  npm pid alone demonstrably does not.
- **Verified outcomes.** `project_build` verifies `dist/index.html` exists,
  is non-empty, and records its sha256 plus lockfile hashes before/after
  (reproducibility evidence; the install step is the only network-touching
  step). `project_run` health-checks the runtime URL with a real HTTP GET and
  requires a render mount (`<canvas>` or root div) in the served HTML before
  reporting success; port conflicts are structured errors (strictPort — no
  silent retry). Rendered-content verification in the ZCode Browser is owned
  by the TL journey, not this plugin.

## Executable discovery

`BABYLON_NODE_PATH` env override → PATH lookup (`node`) → common install roots
(`/usr/bin/node`, `/usr/local/bin/node`). The env name is deliberately NOT
`NODE_PATH` to avoid colliding with Node's module-resolution semantics. The
`userConfig.nodePath` option is resolved app-side and forwarded as
`BABYLON_NODE_PATH`. Node below 18.0.0 is rejected by an explicit version gate.

## Build & run notes

- The package manager is detected from the committed lockfile
  (`pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, else npm) and resolved to an
  absolute real path; npm/pnpm JS entries are executed via the gated node.
- When `node_modules` is missing, `<pm> install` runs first (bounded, recorded
  via lockfile hash) — this is the declared dependency-fetch permission path.
- The vite outDir for artifact verification is read from the committed vite
  config when it is a simple string; anything dynamic or escaping the project
  root falls back to vite's default `dist`.
- `project_run` picks a free loopback port when none is given (listen-0 probe)
  and passes `--port <port> --strictPort` to the vite dev server; the runtime
  URL, pid and HTML sha256 are reported, and `project_stop` reaps the process
  group and verifies the port was freed.
