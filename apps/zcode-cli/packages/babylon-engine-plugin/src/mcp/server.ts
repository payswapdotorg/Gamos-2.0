#!/usr/bin/env node
import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { json, fail } from "../lib/result.js";
import { discoverNode } from "../discovery.js";
import { assetIntegrate, projectBuild, projectInspect, projectRun, stopRuntime } from "../engine.js";
import {
  AssetIntegrateInput,
  ProjectBuildInput,
  ProjectInspectInput,
  ProjectRunInput,
  ProjectStopInput,
} from "../typed-ops.js";

/**
 * Babylon engine MCP server. Tool names carry no family prefix; the app
 * namespaces them as `mcp__plugin_babylon-engine_engine__<tool>`.
 *
 * Every handler validates its input against the frozen typed-operation
 * schemas, discovers a usable Node executable (explicit unavailable JSON
 * error with reason when none is found), and returns structured JSON
 * outcomes. Read-only vs mutating vs long-running semantics are stated
 * honestly per tool description.
 */

const server = new McpServer({
  name: "babylon-engine",
  version: "0.1.0",
});

async function withNode(work: (nodeExecutable: string) => Promise<{ ok: boolean }>): Promise<CallToolResult> {
  try {
    const discovery = discoverNode();
    if (discovery.status !== "available" || discovery.executable === null) {
      return fail({
        ok: false,
        code: "node-unavailable",
        status: discovery.status,
        executable: discovery.executable,
        rawVersion: discovery.rawVersion,
        reason: discovery.reason ?? "Node.js executable not found",
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
    title: "Babylon Project Inspect",
    description:
      "Read-only: inspect a Babylon project's real metadata — probed Node and package-manager versions, @babylonjs/* dependencies, declared scripts, engines, vite config presence. Projects without @babylonjs dependencies fail closed as not-a-babylon-project. Never executes anything.",
    inputSchema: ProjectInspectInput.shape,
  },
  async (args) => withNode((exe) => projectInspect(exe, args, process.cwd())),
);

server.registerTool(
  "project_build",
  {
    title: "Babylon Project Build",
    description:
      "Executes ONLY the package.json-declared `build` script via the detected package manager (bounded 10-minute timeout, process-group kill on expiry), then verifies the vite outDir index.html artifact exists, is non-empty, and records its sha256 plus lockfile hashes before/after. Installs declared dependencies first when node_modules is missing (the only network-touching step). Script names are never inferred from model text.",
    inputSchema: ProjectBuildInput.shape,
  },
  async (args) => withNode((exe) => projectBuild(exe, args, process.cwd())),
);

server.registerTool(
  "project_run",
  {
    title: "Babylon Project Run",
    description:
      "Starts ONLY the package.json-declared `dev` script (or `start` as fallback) as a detached, tracked process on 127.0.0.1 — an explicit port is strictPort (a conflict is a structured error, never a silent retry; a free port is auto-picked when unset) — then health-checks the runtime URL with a real HTTP GET until it serves HTML with a render mount (<canvas> or root div), recording the HTML sha256. The process KEEPS RUNNING after this tool returns; cancel it with project_stop. Headless HTTP verification only — rendered-content verification in the ZCode Browser is a separate journey.",
    inputSchema: ProjectRunInput.shape,
  },
  async (args) => withNode((exe) => projectRun(exe, args, process.cwd())),
);

server.registerTool(
  "project_stop",
  {
    title: "Babylon Project Run Stop",
    description:
      "Cancels a runtime started by project_run: SIGTERM to the whole process group, bounded grace period, then SIGKILL, and finally verifies the port was actually freed. This is the honest cancellation surface for the long-running dev server started by project_run (not a standalone engine capability).",
    inputSchema: ProjectStopInput.shape,
  },
  async (args) => {
    try {
      const parsed = ProjectStopInput.safeParse(args);
      if (!parsed.success) {
        return fail({
          ok: false,
          code: "invalid-input",
          reason: parsed.error.issues
            .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
            .join("; "),
        });
      }
      const outcome = await stopRuntime(parsed.data.pid);
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
  "asset_integrate",
  {
    title: "Babylon Asset Integrate",
    description:
      "Integrates a verified GLB artifact into a Babylon project WITHOUT spawning any engine binary: hashes the artifact (an expectedIntegrity record from the cross-engine manifest is authoritative — a mismatch fails closed), stages a byte-identical, hash-verified copy under the project's public/assets directory, and appends/replaces the entry in the committed asset registry (src/gamos-assets.json, atomic rename). The project's reviewed main.js loader imports exactly the committed registry entries — no dynamic code, no arbitrary URLs. Idempotent: re-integrating the identical artifact is a no-op replace; a different file under the same asset name fails closed with asset-name-collision.",
    inputSchema: AssetIntegrateInput.shape,
  },
  async (args) => {
    try {
      const outcome = await assetIntegrate(args, process.cwd());
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

export async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

if (import.meta.main) {
  await main();
}
