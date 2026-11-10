#!/usr/bin/env node
import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { json, fail } from "../lib/result.js";
import { discoverGodot } from "../discovery.js";
import {
  assetImport,
  projectBuild,
  projectInspect,
  projectRun,
  sceneModify,
  scriptCheck,
} from "../engine.js";
import {
  AssetImportInput,
  ProjectBuildInput,
  ProjectInspectInput,
  ProjectRunInput,
  SceneModifyInput,
  ScriptCheckInput,
} from "../typed-ops.js";

/**
 * Godot engine MCP server (M4 WP-2). Tool names carry no family prefix; the
 * app namespaces them as `mcp__plugin_godot-engine_engine__<tool>`.
 *
 * Every handler validates its input against the frozen typed-operation
 * schemas, discovers a usable Godot executable (explicit unavailable JSON
 * error with reason when none is found), and returns structured JSON
 * outcomes. Mutating vs read-only semantics are stated honestly per tool
 * description. All engine work goes through the committed data-only
 * GDScript bridge — user text is never interpolated into GDScript.
 */

const server = new McpServer({
  name: "godot-engine",
  version: "0.1.0",
});

async function withGodot(
  work: (executable: string) => Promise<{ ok: boolean }>,
): Promise<CallToolResult> {
  try {
    const discovery = discoverGodot();
    if (discovery.status !== "available" || discovery.executable === null) {
      return fail({
        ok: false,
        code: "godot-unavailable",
        status: discovery.status,
        executable: discovery.executable,
        rawVersion: discovery.rawVersion,
        reason: discovery.reason ?? "no Godot executable found",
      });
    }
    const outcome = await work(discovery.executable);
    return outcome.ok ? json(outcome) : fail(outcome);
  } catch (error) {
    return fail({
      ok: false,
      code: "unexpected-error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

server.registerTool(
  "project_inspect",
  {
    title: "Godot Project Inspect",
    description:
      "Read-only: inspect a real Godot project — the engine-reported version and the project.godot config (config_version, application name/features, scripts, main scene) re-parsed by a real headless engine run. Never modifies or writes any file.",
    inputSchema: ProjectInspectInput.shape,
  },
  async (args) => withGodot((exe) => projectInspect(exe, args, process.cwd())),
);

server.registerTool(
  "scene_modify",
  {
    title: "Godot Scene Modify",
    description:
      "Typed mutation: apply allowlisted property operations ({nodePath, property, value}) to a .tscn scene through the committed data-only GDScript bridge. A pre-mutation snapshot is staged and the saved scene is re-loaded in a FRESH engine process to verify every applied value — an exit code alone never proves the mutation. No user text is ever interpolated into GDScript.",
    inputSchema: SceneModifyInput.shape,
  },
  async (args) => withGodot((exe) => sceneModify(exe, args, process.cwd())),
);

server.registerTool(
  "script_check",
  {
    title: "Godot Script Check",
    description:
      "Read-only: parse-check a project .gd script with the real engine (--check-only). The verdict requires BOTH a clean exit and zero engine-reported parse errors — neither alone suffices.",
    inputSchema: ScriptCheckInput.shape,
  },
  async (args) => withGodot((exe) => scriptCheck(exe, args, process.cwd())),
);

server.registerTool(
  "asset_import",
  {
    title: "Godot Asset Import",
    description:
      "Import a real asset into the project (staged into the project tree, then a real headless --import pass). Verified by filesystem probe: .godot/imported artifacts + .import metadata exist AND the source sha256 is unchanged.",
    inputSchema: AssetImportInput.shape,
  },
  async (args) => withGodot((exe) => assetImport(exe, args, process.cwd())),
);

server.registerTool(
  "project_build",
  {
    title: "Godot Project Build",
    description:
      "Headless export: --export-release an allowlisted export preset into a pre-created output directory. Requires export templates installed for the EXACT engine version (honest failure otherwise). The artifact is verified by existence, sha256 and size bounds — never by exit code alone.",
    inputSchema: ProjectBuildInput.shape,
  },
  async (args) => withGodot((exe) => projectBuild(exe, args, process.cwd())),
);

server.registerTool(
  "project_run",
  {
    title: "Godot Project Run",
    description:
      "Headless run verification: run the project (optionally a specific scene) with --quit-after frames. The verdict requires BOTH exit 0 AND zero crash lines in the engine output — neither alone suffices.",
    inputSchema: ProjectRunInput.shape,
  },
  async (args) => withGodot((exe) => projectRun(exe, args, process.cwd())),
);

await server.connect(new StdioServerTransport());
