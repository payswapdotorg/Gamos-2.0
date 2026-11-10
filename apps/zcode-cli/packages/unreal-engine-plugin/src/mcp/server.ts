#!/usr/bin/env node
import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { json, fail } from "../lib/result.js";
import {
  connectionInspect,
  functionInvoke,
  objectInspect,
  propertyRead,
  propertyWrite,
  rollbackToSnapshot,
  type UnrealPluginConfig,
} from "../engine.js";
import {
  ConnectionInspectInput,
  FunctionInvokeInput,
  ObjectInspectInput,
  PropertyReadInput,
  PropertyWriteInput,
  RollbackToSnapshotInput,
} from "../typed-ops.js";

/**
 * Unreal engine MCP server (M4 WP-5). Tool names carry no family prefix; the
 * app namespaces them as `mcp__plugin_unreal-engine_engine__<tool>`.
 *
 * The connector ATTACHES to an already-running, externally owned Unreal
 * Editor over VERIFIED loopback Remote Control — it spawns nothing and never
 * terminates the editor (readiness §4.2 / §2.2 U-T4). Every tool call runs a
 * complete attach → typed operation → teardown lifecycle, exactly as every
 * godot tool call runs a fresh engine process. The Passphrase header is a
 * transport-compatibility token only — never described as authentication
 * (U-T2). Mutations are gated by the reviewed allowlists (EMPTY at 0.1.0:
 * every property write and every functionName fails closed client-side until
 * a reviewed entry lands with its own schema and a version bump — no generic
 * function.call exists, readiness §4.2).
 *
 * WP-8: the read/mutation semantics are ALSO carried as MCP tool
 * annotations — the readOnlyHint/destructiveHint pair drives the ZCode
 * host's permission classification (low/high risk; plan mode hard-denies
 * destructive tools; every mutation tool call passes the host's
 * permission-broker gate before any engine code runs) — the permission
 * mapping of gamos-domain's mcp-permission-mapping.ts made real on the host
 * surface.
 *
 * Honest scope: these tools speak the pinned Remote Control wire contract;
 * the REAL-editor acceptance leg (M4-G2) runs on the maintainer-provided UE5
 * environment (delivery plan §10, WP-6) — a mock can never pass it.
 *
 * The registrations live in an exported factory (createEngineMcpServer) so
 * the wire-level tests can drive a real tools/list round-trip without
 * spawning stdio; the entry guard connects only when this module runs as
 * the plugin process entry.
 */

export function createEngineMcpServer(config: UnrealPluginConfig = {}): McpServer {
  const server = new McpServer({
    name: "unreal-engine",
    version: "0.1.0",
  });

  async function runOp(work: () => Promise<{ ok: boolean }>): Promise<CallToolResult> {
    try {
      const outcome = await work();
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
    "connection_inspect",
    {
      title: "Unreal Remote Control Connection Inspect",
      description:
        "Read-only: probe the discovered loopback Remote Control endpoint of a RUNNING Unreal Editor (GET /remote/info) — editor version, RC version, routes, and the INSPECTED listener binding (the server-reported actual binding, never the requested client address). A non-loopback reported binding fails closed. The editor is never spawned and never terminated by this tool.",
      inputSchema: ConnectionInspectInput.shape,
      annotations: { readOnlyHint: true },
    },
    async (args) => runOp(() => connectionInspect(config, args)),
  );

  server.registerTool(
    "object_inspect",
    {
      title: "Unreal Object Inspect",
      description:
        "Read-only: typed describe of a live-editor object through the running editor's Remote Control. The object path is validated against the strict grammar BEFORE any request is built; the describe response (class, properties, outer path) comes from the real editor for the exact validated path.",
      inputSchema: ObjectInspectInput.shape,
      annotations: { readOnlyHint: true },
    },
    async (args) => runOp(() => objectInspect(config, args)),
  );

  server.registerTool(
    "property_read",
    {
      title: "Unreal Property Read",
      description:
        "Read-only: typed property reads (READ_ACCESS) for an allowlisted name set on a validated object path — values come from the live editor, never from a cached mirror.",
      inputSchema: PropertyReadInput.shape,
      annotations: { readOnlyHint: true },
    },
    async (args) => runOp(() => propertyRead(config, args)),
  );

  server.registerTool(
    "property_write",
    {
      title: "Unreal Property Write (allowlisted live-editor mutation)",
      description:
        "Typed live-editor mutation through the running editor's Remote Control with the MANDATORY five-part chain: pre-mutation snapshot, setProperty with WRITE_TRANSACTION_ACCESS + generateTransaction, expected post-state verified by engine re-read, verified rollback, post-rollback verification against the snapshot. A write whose post-state does not match fails closed with the rollback chain run. The reviewed property allowlist is EMPTY at 0.1.0 — every property fails closed client-side until a reviewed entry lands (no engine-headless semantics: this is a LIVE-EDITOR mutation; the tool call passes the host's permission-broker gate at dispatch — the destructiveHint annotation carries that classification).",
      inputSchema: PropertyWriteInput.shape,
      annotations: { destructiveHint: true },
    },
    async (args) => runOp(() => propertyWrite(config, args)),
  );

  server.registerTool(
    "function_invoke",
    {
      title: "Unreal Function Invoke (individually allowlisted)",
      description:
        "Individually allowlisted typed invocation (PUT /remote/object/call with generateTransaction: true). The reviewed per-function allowlist is EMPTY at 0.1.0 — every functionName fails closed client-side BEFORE any request (no generic function.call; remote Python and console-command execution are disabled by design).",
      inputSchema: FunctionInvokeInput.shape,
      annotations: { destructiveHint: true },
    },
    async (args) => runOp(() => functionInvoke(config, args)),
  );

  server.registerTool(
    "rollback_to_snapshot",
    {
      title: "Unreal Rollback To Snapshot",
      description:
        "The five-part chain's rollback legs: restore a previously snapshotted property value and verify the post-rollback state against the snapshot (engine re-read, never an API ack alone). Governed by the same reviewed property allowlist as writes — a restore whose post-rollback state does not match the snapshot fails closed (rc-rollback-not-verified).",
      inputSchema: RollbackToSnapshotInput.shape,
      annotations: { destructiveHint: true },
    },
    async (args) => runOp(() => rollbackToSnapshot(config, args)),
  );

  return server;
}

// Entry guard: connect stdio only when this module IS the plugin process
// entry (never when imported by tests). The env-derived endpoint/passphrase
// is resolved HERE so tests can construct servers with explicit configs.
const isProcessEntry = (() => {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isProcessEntry) {
  const httpPort = Number(process.env.UNREAL_RC_HTTP_PORT ?? "");
  const wsPort = Number(process.env.UNREAL_RC_WS_PORT ?? "");
  const config: UnrealPluginConfig = {
    endpoint:
      Number.isInteger(httpPort) && httpPort > 0 && Number.isInteger(wsPort) && wsPort > 0
        ? { host: "127.0.0.1", httpPort, wsPort }
        : undefined, // discovery defaults: the documented loopback 30010/30020
    passphrase: process.env.UNREAL_RC_PASSPHRASE,
  };
  const server = createEngineMcpServer(config);
  await server.connect(new StdioServerTransport());
}
