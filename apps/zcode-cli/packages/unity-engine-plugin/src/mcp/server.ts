#!/usr/bin/env node
import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { json, fail } from "../lib/result.js";
import { discoverUnityEditor } from "../discovery.js";
import { projectBuild, projectInspect, sceneModify } from "../engine.js";
import {
  ProjectBuildInput,
  ProjectInspectInput,
  SceneModifyInput,
} from "../typed-ops.js";

/**
 * Unity engine MCP server. Tool names carry no family prefix; the app
 * namespaces them as `mcp__plugin_unity-engine_engine__<tool>`.
 *
 * Every handler validates its input against the frozen typed-operation
 * schemas and returns structured JSON outcomes. `project_inspect` works
 * WITHOUT an editor (pure project-marker inspection); `scene_modify` and
 * `project_build` require a discovered Unity Editor and fail with an
 * explicit unavailable JSON error (status + reason) when none is found —
 * an honest miss is never a silent success, and a license failure is
 * reported as the structured `license-required` external-prerequisite state.
 */

const server = new McpServer({
  name: "unity-engine",
  version: "0.1.0",
});

async function withUnity(
  work: (executable: string) => Promise<{ ok: boolean }>,
): Promise<CallToolResult> {
  try {
    const discovery = discoverUnityEditor();
    if (discovery.status !== "available" || discovery.executable === null) {
      return fail({
        ok: false,
        code: "unity-editor-unavailable",
        status: discovery.status,
        executable: discovery.executable,
        rawVersion: discovery.rawVersion,
        reason: discovery.reason ?? "Unity Editor executable not found",
        note: "an honest unavailable state per M2 directive §8 — not a passing integration gate; set UNITY_EDITOR_PATH to a real Unity Editor 2022.3+ to enable this tool",
      });
    }
    const outcome = await work(discovery.executable);
    return outcome.ok ? json(outcome) : fail(outcome);
  } catch (error) {
    return fail({
      ok: false,
      code: "unexpected-error",
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

server.registerTool(
  "project_inspect",
  {
    title: "Unity Project Inspect",
    description:
      "Read-only, no editor required: inspect a Unity project's REAL markers — ProjectSettings/ProjectVersion.txt (parsed Unity version + revision hash), Assets/ presence, and the Assets/**/*.unity scene list (bounded at 50, project-relative). Directories without BOTH markers fail closed as not-a-unity-project. A project marker is NOT editor availability: scene_modify/project_build additionally require a discovered Unity Editor.",
    inputSchema: ProjectInspectInput.shape,
  },
  async (args) => {
    try {
      const outcome = await projectInspect(args, process.cwd());
      return outcome.ok ? json(outcome) : fail(outcome);
    } catch (error) {
      return fail({
        ok: false,
        code: "unexpected-error",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  },
);

server.registerTool(
  "scene_modify",
  {
    title: "Unity Scene Modify",
    description:
      "Mutating: apply ONE typed scene operation (scene.add-cube, scene.set-active-build-target) inside the real Unity Editor in batch mode. The engine copies the fixed, reviewed C# bridge into Assets/Editor/Gamos/, passes typed parameters via a JSON file (-gamosParams), invokes the reviewed -executeMethod entry point, and verifies the executed method's result JSON, exit status 0, and the saved scene file (sha256 before/after). Requires a discovered Unity Editor; an unlicensed editor returns the structured license-required failure (an external, user-controlled prerequisite — never fabricated). No arbitrary C# is ever accepted or executed.",
    inputSchema: SceneModifyInput.shape,
  },
  async (args) => withUnity((exe) => sceneModify(exe, args, process.cwd())),
);

server.registerTool(
  "project_build",
  {
    title: "Unity Project Build",
    description:
      "Executes a real StandaloneLinux64 player build through BuildPipeline.BuildPlayer inside the Unity Editor in batch mode (reviewed C# bridge, JSON params/result protocol), then verifies the Builds/<target>/ artifact directory and records the main artifact's sha256. Requires a discovered Unity Editor; an unlicensed editor returns the structured license-required failure (an external, user-controlled prerequisite — never fabricated).",
    inputSchema: ProjectBuildInput.shape,
  },
  async (args) => withUnity((exe) => projectBuild(exe, args, process.cwd())),
);

export async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

if (import.meta.main) {
  await main();
}
