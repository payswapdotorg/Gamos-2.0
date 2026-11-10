import { describe, expect, it } from "vitest";
import { InMemoryTransport, LATEST_PROTOCOL_VERSION, McpServer } from "@modelcontextprotocol/server";
import { createEngineMcpServer } from "../src/mcp/server.js";

/**
 * M4 WP-8 — the Godot MCP server's tool ANNOTATIONS, verified at the WIRE
 * level (a real MCP `tools/list` round-trip over an in-memory transport):
 * exactly what the ZCode host's tool bridge sees when it lists the plugin's
 * tools, and exactly what drives the host's permission classification
 * (`readOnlyHint` → low risk; `destructiveHint` → high risk + plan-mode
 * hard-deny) — the permission mapping of
 * packages/gamos-domain/src/domain/mcp-permission-mapping.ts made real on
 * the host surface (the two-sided pin discipline).
 *
 * Mapping contract (the domain tests pin the same values from the records):
 *   reads (project_inspect, script_check)             → readOnlyHint
 *   mutations (scene_modify, asset_import, build, run) → destructiveHint
 */

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number;
  method?: string;
  result?: unknown;
  error?: { message?: string };
}

/** A minimal JSON-RPC peer speaking the MCP wire protocol over the transport. */
class TestMcpClient {
  private nextId = 1;
  private readonly pending = new Map<number, (message: JsonRpcMessage) => void>();

  constructor(
    private readonly transport: {
      onmessage?: (message: JsonRpcMessage) => void;
      send: (message: JsonRpcMessage) => Promise<void>;
    },
  ) {
    transport.onmessage = (message) => {
      if (typeof message.id === "number" && this.pending.has(message.id)) {
        const settle = this.pending.get(message.id);
        this.pending.delete(message.id);
        settle?.(message);
      }
    };
  }

  request(method: string, params: unknown): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, (message) => {
        if (message.error) reject(new Error(String(message.error.message)));
        else resolve((message.result ?? {}) as Record<string, unknown>);
      });
      void this.transport.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string): void {
    void this.transport.send({ jsonrpc: "2.0", method });
  }
}

interface ListedTool {
  name: string;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
}

async function listEngineTools(): Promise<Map<string, ListedTool>> {
  const server: McpServer = createEngineMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new TestMcpClient(clientTransport);
  await client.request("initialize", {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "wp8-annotations-test", version: "0.0.0" },
  });
  client.notify("notifications/initialized");
  const result = await client.request("tools/list", {});
  const tools = (result.tools ?? []) as ListedTool[];
  return new Map(tools.map((tool) => [tool.name, tool]));
}

describe("M4 WP-8 — the godot-engine MCP server declares the honest permission annotations at the wire level", () => {
  it("the read-only tools declare readOnlyHint (low risk on the host surface)", async () => {
    const tools = await listEngineTools();
    for (const name of ["project_inspect", "script_check"]) {
      const tool = tools.get(name);
      expect(tool, `${name} must be listed`).toBeDefined();
      expect(tool?.annotations?.readOnlyHint ?? false, `${name} readOnlyHint`).toBe(true);
      expect(tool?.annotations?.destructiveHint ?? false, `${name} must not claim destructive`).toBe(false);
    }
  });

  it("the mutation tools declare destructiveHint (high risk + plan-mode hard-deny on the host surface)", async () => {
    const tools = await listEngineTools();
    for (const name of ["scene_modify", "asset_import", "project_build", "project_run"]) {
      const tool = tools.get(name);
      expect(tool, `${name} must be listed`).toBeDefined();
      expect(tool?.annotations?.destructiveHint ?? false, `${name} destructiveHint`).toBe(true);
      expect(tool?.annotations?.readOnlyHint ?? false, `${name} must not claim read-only`).toBe(false);
    }
  });

  it("the tool set is exactly the six registered capabilities (no undeclared surface)", async () => {
    const tools = await listEngineTools();
    expect([...tools.keys()].sort()).toEqual(
      ["asset_import", "project_build", "project_inspect", "project_run", "scene_modify", "script_check"].sort(),
    );
  });
});
