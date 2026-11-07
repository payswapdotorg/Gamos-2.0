#!/usr/bin/env node
import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { json, fail } from "../lib/result.js";
import { discoverBlender } from "../discovery.js";
import { assetExport, sceneInspect, sceneModify, sceneRender } from "../engine.js";
import {
  AssetExportInput,
  SceneInspectInput,
  SceneModifyInput,
  SceneRenderInput,
} from "../typed-ops.js";

/**
 * Blender engine MCP server. Tool names carry no family prefix; the app
 * namespaces them as `mcp__plugin_blender-engine_engine__<tool>`.
 *
 * Every handler validates its input against the frozen typed-operation
 * schemas, discovers a usable Blender executable (explicit unavailable JSON
 * error with reason when none is found), and returns structured JSON outcomes.
 * Mutating vs read-only semantics are stated honestly per tool description.
 */

const server = new McpServer({
  name: "blender-engine",
  version: "0.1.0",
});

async function withBlender(
  work: (executable: string) => Promise<{ ok: boolean }>,
): Promise<CallToolResult> {
  try {
    const discovery = discoverBlender();
    if (discovery.status !== "available" || discovery.executable === null) {
      return fail({
        ok: false,
        code: "blender-unavailable",
        status: discovery.status,
        executable: discovery.executable,
        rawVersion: discovery.rawVersion,
        reason: discovery.reason ?? "Blender executable not found",
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
  "scene_inspect",
  {
    title: "Blender Scene Inspect",
    description:
      "Read-only: open a .blend headlessly and report the Blender version, scenes, and objects (name, type, location, rotation, scale, material base color). Never modifies or writes any file.",
    inputSchema: SceneInspectInput.shape,
  },
  async (args) => withBlender((exe) => sceneInspect(exe, args, process.cwd())),
);

server.registerTool(
  "scene_modify",
  {
    title: "Blender Scene Modify",
    description:
      "Mutating: apply typed operations (add-primitive, set-transform, rename, delete, set-material-color) to a .blend file. With save=true the file is rewritten atomically and the result is VERIFIED by re-opening the scene and asserting the expected object state. Only the fixed typed operation set is accepted — no arbitrary Python.",
    inputSchema: SceneModifyInput.shape,
  },
  async (args) => withBlender((exe) => sceneModify(exe, args, process.cwd())),
);

server.registerTool(
  "scene_render",
  {
    title: "Blender Scene Render",
    description:
      "Executes a headless still render writing a PNG artifact, then verifies the artifact exists and records its sha256. Cycles on CPU is the default engine; BLENDER_EEVEE needs a display/GL context and fails on display-less hosts (reported as a structured failure). If the scene has no camera a default camera is provisioned (disclosed in the output).",
    inputSchema: SceneRenderInput.shape,
  },
  async (args) => withBlender((exe) => sceneRender(exe, args, process.cwd())),
);

server.registerTool(
  "asset_export",
  {
    title: "Blender Asset Export",
    description:
      "Writes an OBJ, GLTF (binary .glb), or FBX export artifact for the whole scene or a named selection, then verifies the artifact exists and records its sha256.",
    inputSchema: AssetExportInput.shape,
  },
  async (args) => withBlender((exe) => assetExport(exe, args, process.cwd())),
);

export async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

if (import.meta.main) {
  await main();
}
