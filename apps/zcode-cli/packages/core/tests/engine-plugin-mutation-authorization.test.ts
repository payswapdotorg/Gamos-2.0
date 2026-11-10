import type { McpPort, PermissionBrokerPort, PermissionBrokerResult } from "@zcode/contracts";
import { describe, expect, it, vi } from "vitest";
import { createMcpToolEntry } from "../src/mcp/index.js";
import { PermissionService } from "../src/permission/service.js";
import { ToolRegistryImpl } from "../src/tool/registry.js";
import { ToolExecutorImpl } from "../src/tool/executor/impl.js";

/**
 * M4 WP-8 — §7 Unreal row "unapproved mutation (no permission-broker
 * approval → refusal)" EXECUTED at the host layer: the REAL authorization
 * path every MCP tool call takes (createMcpToolEntry → ToolExecutor.execute →
 * resolveToolPermission → broker), driven with the M4 engine-plugin tool
 * shapes and the annotations WP-8 ships on the godot/unreal MCP servers.
 *
 * This is the blender M2J4 discipline (denial → the engine operation never
 * runs) expressed as a hermetic unit row: a rejecting broker on a
 * destructive-annotated engine mutation tool → PermissionDenied with ZERO
 * callTool invocations (zero engine round-trips / zero spawns). Plan mode
 * hard-DENIES destructive MCP tools outright. A read-only-annotated engine
 * tool passes the gate only through an ALLOWING broker (the approval is the
 * gate; nothing bypasses it).
 *
 * The generic gate itself is upstream behavior; what this file pins is that
 * the M4 tool shapes — the destructive annotations of
 * mcp__plugin_unreal-engine_engine__property_write and
 * mcp__plugin_godot-engine_engine__scene_modify, the readOnly annotation of
 * property_read — route through it with exactly these outcomes.
 */

const M4_UNREAL_WRITE = {
  name: "mcp__plugin_unreal-engine_engine__property_write",
  serverName: "plugin:unreal-engine:engine",
  toolName: "property_write",
  inputSchema: { type: "object" },
  annotations: { destructiveHint: true },
};

const M4_GODOT_MODIFY = {
  name: "mcp__plugin_godot-engine_engine__scene_modify",
  serverName: "plugin:godot-engine:engine",
  toolName: "scene_modify",
  inputSchema: { type: "object" },
  annotations: { destructiveHint: true },
};

const M4_UNREAL_READ = {
  name: "mcp__plugin_unreal-engine_engine__property_read",
  serverName: "plugin:unreal-engine:engine",
  toolName: "property_read",
  inputSchema: { type: "object" },
  annotations: { readOnlyHint: true },
};

function makeExecutor(options: {
  broker: PermissionBrokerPort;
  mode?: "build" | "plan";
}) {
  const callTool = vi.fn(async () => ({ content: [{ type: "text" as const, text: "ok" }] }) as never);
  const mcpPort = { callTool } as unknown as McpPort;
  const registry = new ToolRegistryImpl();
  for (const descriptor of [M4_UNREAL_WRITE, M4_GODOT_MODIFY, M4_UNREAL_READ]) {
    registry.register(createMcpToolEntry(descriptor.name, descriptor, mcpPort, false));
  }
  const executor = new ToolExecutorImpl({
    registry,
    permissionService: new PermissionService(),
    permissionBroker: options.broker,
    sessionId: "wp8-fixture" as never,
    emitEvent: async () => {},
    getMode: () => options.mode ?? "build",
  });
  return { executor, callTool };
}

const rejectingBroker: PermissionBrokerPort = {
  requestPermission: async () =>
    ({ decision: "deny", reason: "user rejected the mutation approval prompt" }) as PermissionBrokerResult,
};

const allowingBroker: PermissionBrokerPort = {
  requestPermission: async () => ({ decision: "allow", reason: "user approved once" }) as PermissionBrokerResult,
};

describe("M4 WP-8 — §7 U4 executed: unapproved engine mutations are refused by the existing host gate (zero engine round-trips)", () => {
  it("unreal property_write (destructive annotation): a rejecting broker refuses the call with ZERO callTool invocations", async () => {
    const { executor, callTool } = makeExecutor({ broker: rejectingBroker });
    const result = await executor.execute({ id: "call-1", name: M4_UNREAL_WRITE.name, input: {} });
    expect(result.success).toBe(false);
    expect(result.error?.type).toBe("permission_denied");
    expect(callTool).not.toHaveBeenCalled();
  });

  it("godot scene_modify (destructive annotation): a rejecting broker refuses the call with ZERO callTool invocations (no engine spawn)", async () => {
    const { executor, callTool } = makeExecutor({ broker: rejectingBroker });
    const result = await executor.execute({ id: "call-2", name: M4_GODOT_MODIFY.name, input: {} });
    expect(result.success).toBe(false);
    expect(result.error?.type).toBe("permission_denied");
    expect(callTool).not.toHaveBeenCalled();
  });

  it("plan mode hard-DENIES the destructive engine mutation outright (the broker is never even asked)", async () => {
    const requestPermission = vi.fn(async () => ({ decision: "allow" }) as PermissionBrokerResult);
    const { executor, callTool } = makeExecutor({
      broker: { requestPermission },
      mode: "plan",
    });
    const result = await executor.execute({ id: "call-3", name: M4_UNREAL_WRITE.name, input: {} });
    expect(result.success).toBe(false);
    expect(requestPermission).not.toHaveBeenCalled();
    expect(callTool).not.toHaveBeenCalled();
  });

  it("unreal property_read (readOnly annotation): passes ONLY through an allowing broker — exactly one callTool", async () => {
    const rejecting = makeExecutor({ broker: rejectingBroker });
    const denied = await rejecting.executor.execute({ id: "call-4", name: M4_UNREAL_READ.name, input: {} });
    expect(denied.success).toBe(false);
    expect(denied.error?.type).toBe("permission_denied");
    expect(rejecting.callTool).not.toHaveBeenCalled();

    const allowing = makeExecutor({ broker: allowingBroker });
    const allowed = await allowing.executor.execute({ id: "call-5", name: M4_UNREAL_READ.name, input: {} });
    expect(allowed.success).toBe(true);
    expect(allowing.callTool).toHaveBeenCalledTimes(1);
  });

  it("the destructive annotation classification surfaces as HIGH risk in the broker request (never medium)", async () => {
    const seen: Array<{ riskLevel?: string; sideEffectScope?: string }> = [];
    const observingBroker: PermissionBrokerPort = {
      requestPermission: async (request) => {
        seen.push({ riskLevel: request.riskLevel, sideEffectScope: request.sideEffectScope });
        return ({ decision: "deny", reason: "observed" }) as PermissionBrokerResult;
      },
    };
    const { executor } = makeExecutor({ broker: observingBroker });
    await executor.execute({ id: "call-6", name: M4_UNREAL_WRITE.name, input: {} });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.riskLevel).toBe("high");
    expect(seen[0]?.sideEffectScope).toBe("network");
  });
});
