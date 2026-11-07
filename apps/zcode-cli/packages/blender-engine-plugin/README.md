# @zcode/blender-engine-plugin

Typed, safety-reviewed Blender engine operations for ZCode, exposed as MCP tools.

The plugin drives a real Blender 4.1+ executable in headless mode (`blender -b`) and
offers four typed operations — no arbitrary Python is ever accepted or executed:

| MCP tool (namespaced by the app as `mcp__plugin_blender-engine_engine__*`) | Capability | Semantics |
| --- | --- | --- |
| `scene_inspect` | `blender/scene.inspect` | read-only |
| `scene_modify` | `blender/scene.modify` | mutating |
| `scene_render` | `blender/scene.render` | executes a render, writes a PNG artifact |
| `asset_export` | `blender/asset.export` | writes an OBJ/GLTF(GLB)/FBX artifact |

## Safety model

- **Typed operations only.** Every operation is a closed enum validated with zod
  (`src/typed-ops.ts`). The Python bridge (`src/bridge/apply_ops.py`) is a fixed,
  committed template that maps each typed operation to explicit `bpy` calls; unknown
  operation names are errors. There is no `eval`, no `exec`, and no code path that
  turns tool input into executable Python.
- **Workspace path safety.** All inputs must be absolute paths inside the workspace
  root; `..` traversal outside the root and symlink escapes are rejected
  (`resolveWorkspacePath`).
- **No shell interpolation.** Blender is always spawned with an argument array
  (`shell: false`), bounded timeouts (process-tree kill on expiry), bounded output
  collection, and AbortSignal cancellation support.
- **Verified outcomes.** `scene_modify` re-opens the saved blend headlessly and
  asserts the expected object state (engine-query verification). `scene_render` and
  `asset_export` verify the artifact exists, is non-empty, and record its sha256.

## Executable discovery

`BLENDER_PATH` env override → PATH lookup → common install roots
(`/usr/bin/blender`, `/usr/local/bin/blender`, `/opt/blender*/blender`,
`~/blender*/blender`, `/home/z/engines/blender-*-linux-x64/blender`). The
`userConfig.blenderPath` option is resolved app-side and forwarded as `BLENDER_PATH`.
Versions below 4.1 are rejected by an explicit version gate.

## Render notes

Cycles on CPU works fully headless. EEVEE requires a GL/EGL context and will fail
on display-less hosts (reported as a structured failure, never a silent success).
If a scene has no camera, `scene_render` provisions a default camera so the render
can proceed; this is disclosed in the tool output (`cameraProvisioned`).

## Development

```sh
bun install          # or your package manager of choice
bun run test         # unit tests + real-Blender integration tests (skipped honestly when no Blender is found)
bun run typecheck    # tsc --noEmit
bun run build        # tsc + esbuild bundle (dist/mcp/server.js) + bridge templates
```
