import type { CapabilityRecord, PermissionSpec } from "./capability-registry.js";

/**
 * MCP permission mapping (M4 WP-8, delivery plan §3 order 8) — the semantic
 * authority that derives each capability record's HOST-SURFACE permission
 * classification from its DECLARED permission specs (contract 06 mapping
 * table). There is NO Gamos permission broker and no second permission
 * system (contract 06 rev 2): the ZCode host's per-tool-call MCP gate IS the
 * approval surface, and this module tells the plugins' MCP servers what the
 * honest annotations are for the tools that ride it.
 *
 * Consumption contract (the two-sided pin discipline):
 *   - the host's MCP tool bridge (core/src/mcp/index.ts createMcpToolEntry)
 *     reads `annotations.readOnlyHint` / `annotations.destructiveHint` from
 *     the tool descriptor a plugin's MCP server serves over tools/list;
 *   - destructiveHint ⇒ riskLevel "high" (explicit approval; plan mode
 *     hard-DENIES destructive MCP tools outright);
 *   - readOnlyHint ⇒ riskLevel "low" (MCP tools still carry needsApproval in
 *     build/edit/plan — the host surface is conservative for every MCP tool);
 *   - the plugin MCP servers set EXACTLY these annotations (pinned by their
 *     wire-level tools/list tests) and the domain tests pin the same values
 *     from the records — drift on either side fails a test.
 *
 * Classification is fail-closed in the conservative direction: the read-only
 * class is a strict whitelist of reviewed (kind, scope) pairs — a
 * command-execution with ANY other scope, or a network-access to anything
 * other than the verified loopback RC endpoint, classifies as a MUTATION
 * (destructive, high risk), never as a read. A record with no declared
 * permissions at all is refused classification outright.
 */

/** The risk levels the ZCode host's permission surface understands. */
export type McpRiskLevel = "low" | "medium" | "high";

/** The side-effect scopes the ZCode host's permission surface understands. */
export type McpSideEffectScope = "none" | "workspace" | "network" | "system";

export interface McpToolPermissionProfile {
  /** MCP tool annotation: the tool never mutates persistent state. */
  readonly readOnlyHint: boolean;
  /** MCP tool annotation: the tool mutates state (high risk on the host surface). */
  readonly destructiveHint: boolean;
  readonly riskLevel: McpRiskLevel;
  readonly sideEffectScope: McpSideEffectScope;
  /** MCP tools always carry needsApproval on the host surface (conservative). */
  readonly needsApproval: true;
}

export type McpPermissionMapping =
  | { ok: true; capabilityId: string; profile: McpToolPermissionProfile }
  | { ok: false; capabilityId: string; code: "unclassified-permission-shape"; reason: string };

/** The reviewed read-only permission shapes — anything else is a mutation. */
function isReadClassSpec(spec: PermissionSpec): boolean {
  return (
    (spec.kind === "command-execution" && spec.scope === "read-only") ||
    (spec.kind === "network-access" && spec.scope === "loopback-rc-endpoint")
  );
}

/** Mutations with declared file writes land in the declared workspace. */
function isWorkspaceWriteSpec(spec: PermissionSpec): boolean {
  return spec.kind === "filesystem-write";
}

/** Mutations that execute a real engine process (headless) land in the system scope. */
function isEngineExecutionSpec(spec: PermissionSpec): boolean {
  return spec.kind === "engine-headless" || (spec.kind === "command-execution" && spec.scope !== "read-only");
}

/**
 * Resolve a capability record's honest host-surface permission profile.
 * Fail closed: no declared permissions ⇒ unclassified (never a guess).
 */
export function resolveMcpToolPermissionProfile(capability: CapabilityRecord): McpPermissionMapping {
  const declared = capability.permissions;
  if (declared.length === 0) {
    return {
      ok: false,
      capabilityId: capability.id,
      code: "unclassified-permission-shape",
      reason: `${capability.id} declares no permissions — the host-surface classification is refused rather than guessed`,
    };
  }
  const allRead = declared.every((spec) => isReadClassSpec(spec));
  if (allRead) {
    return {
      ok: true,
      capabilityId: capability.id,
      profile: {
        readOnlyHint: true,
        destructiveHint: false,
        riskLevel: "low",
        sideEffectScope: "none",
        needsApproval: true,
      },
    };
  }
  // Mutation class — conservative default. Scope precedence: a declared
  // filesystem write pins the workspace scope; a headless engine/process
  // execution without a declared write pins the system scope; a live-editor
  // (engine-gui) or other network mutation pins the network scope.
  const sideEffectScope: McpSideEffectScope = declared.some((spec) => isWorkspaceWriteSpec(spec))
    ? "workspace"
    : declared.some((spec) => isEngineExecutionSpec(spec))
      ? "system"
      : "network";
  return {
    ok: true,
    capabilityId: capability.id,
    profile: {
      readOnlyHint: false,
      destructiveHint: true,
      riskLevel: "high",
      sideEffectScope,
      needsApproval: true,
    },
  };
}
