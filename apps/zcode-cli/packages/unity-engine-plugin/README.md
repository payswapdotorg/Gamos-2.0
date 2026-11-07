# @zcode/unity-engine-plugin

Typed, safety-reviewed Unity engine operations for ZCode, exposed as MCP tools.

The plugin drives a real Unity Editor (2022.3+ / Unity 6) in batch mode
(`Unity -batchmode -nographics -projectPath … -executeMethod …`) and offers
three typed operations — no arbitrary C#, no reflection, no dynamic code is
ever accepted or executed:

| MCP tool (namespaced by the app as `mcp__plugin_unity-engine_engine__*`) | Capability | Semantics |
| --- | --- | --- |
| `project_inspect` | `unity/project.inspect` | read-only, no editor required (real project-marker inspection) |
| `scene_modify` | `unity/scene.modify` | mutating: typed scene operations via a reviewed C# Editor bridge |
| `project_build` | `unity/project.build` | executes a real player build via BuildPipeline |

## Honest licensing reality (M2 directive §8)

Unity Editor licensing (Personal/Pro activation) is an **external,
user-controlled prerequisite**. No Unity Editor is installed in the default
sandbox and license credentials are never fabricated, never committed, and
never invented by this plugin. When a real invocation fails with Unity's
license error output, the engine reports a structured failure:

```json
{
  "ok": false,
  "code": "license-required",
  "reason": "Unity Editor license required — an external, user-controlled prerequisite (provide credentials/license on the runner; never fabricated)"
}
```

This is the honest `unavailable`/`blocked` state of M2 directive §8: "The
absence of a real engine is an honest unavailable or blocked state. It is not a
passing integration gate." The integration tests therefore skip honestly when
no real editor is found, and prove the `license-required` negative path when an
unlicensed editor is found. The invocation layer itself is fully real — it
drives a licensed editor the moment one is provisioned on a runner (set
`UNITY_EDITOR_PATH` to a licensed editor).

## Safety model

- **Typed operations only.** Every operation input is validated with zod
  (`src/typed-ops.ts`) against the frozen capability schemas
  (`project_inspect`, `scene_modify` with `scene.add-cube` /
  `scene.set-active-build-target`, `project_build` with
  `buildTarget: StandaloneLinux64`). Unknown operation names, non-numeric
  vectors, absolute/`..`-traversing scene paths are rejected.
- **Fixed, committed C# bridge.** The engine copies the reviewed Editor
  scripts `src/bridge/GamosMarker.cs` and `src/bridge/GamosBuild.cs` into
  `<projectRoot>/Assets/Editor/Gamos/` (idempotent overwrite) and invokes them
  via `-executeMethod Gamos.Marker.AddCube` / `Gamos.Build.BuildStandalone`.
  The bridges read typed parameters from a JSON file
  (`-gamosParams <path>`), apply them through public Unity APIs
  (`GameObject.CreatePrimitive`, `EditorSceneManager.SaveScene`,
  `BuildPipeline.BuildPlayer`), and write a JSON result file
  (`-gamosResult <path>`). No `eval`-equivalents, no `System.Reflection`, no
  `Process.Start`, no `System.Net`, no `File.Delete`.
- **Fail-closed project detection.** A directory without BOTH
  `ProjectSettings/ProjectVersion.txt` (read + parsed) and an `Assets/`
  directory is rejected as `not-a-unity-project` — never a guess. A malformed
  `ProjectVersion.txt` is a structured failure. A project marker alone is NOT
  editor availability: editor discovery never infers an editor from project
  markers.
- **Workspace path safety.** All inputs must be absolute paths inside the
  workspace root; `..` traversal outside the root and symlink escapes are
  rejected (`resolveWorkspacePath`). Scene paths are additionally required to
  be project-relative `Assets/…` paths with no `..` component.
- **No shell interpolation.** Unity is always spawned with an argument array
  (`shell: false`), detached into its own process group, with bounded timeouts
  (SIGTERM then SIGKILL process-tree kill on expiry), bounded output
  collection, and AbortSignal cancellation support.
- **Verified outcomes.** `scene_modify` requires exit status 0 AND the
  executed method's result JSON AND the saved scene file on disk (sha256
  recorded before/after); `project_build` verifies the build artifact
  directory and records the main artifact's sha256. The exit code alone proves
  nothing.

## Executable discovery

`UNITY_EDITOR_PATH` env override → PATH lookup (`unity-editor`, `unity`) →
common install roots (`/opt/Unity/*/Editor/Unity`,
`/usr/local/bin/unity-editor`, `~/Unity/*/Editor/Unity`,
`~/Applications/Unity/Hub/Editor/*/Unity.app/Contents/MacOS/Unity` on macOS,
`C:\Program Files\Unity\Hub\Editor\*\Editor\Unity.exe` on Windows) and
`UNITY_HOME`-derived paths. The `userConfig.unityEditorPath` option is resolved
app-side and forwarded as `UNITY_EDITOR_PATH`. The version is probed with
Unity's batch-safe `-version` flag and parsed with the Unity grammar
`^(\d{4,})\.(\d+)\.(\d+)([abfcp])(\d+)$`; versions below 2022.3 are rejected
by an explicit version gate. Unparseable version output is reported honestly as
`version-unknown`.

Licensing is NOT probed by discovery (spawning the editor for a license check
is slow); the engine layer reports `license-required` when a real batch
invocation fails with Unity's license error output. "It looks like another
Unity instance is running" is a different, non-license failure.

## Development

```sh
bun install          # or your package manager of choice
bun run test         # unit tests + real-editor integration tests (skipped honestly when no Unity Editor is found)
bun run typecheck    # tsc --noEmit
bun run build        # tsc + esbuild bundle (dist/mcp/server.js) + bridge templates
```

To run the real-editor integration tests, provision a licensed Unity Editor
2022.3+ on the runner and point `UNITY_EDITOR_PATH` at its executable.
