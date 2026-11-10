import { describe, expect, it } from "vitest";
import { ENGINE_PLUGIN_CAPABILITIES } from "../src/domain/engine-plugin.js";
import { evaluateDispatchPermission } from "../src/domain/permission-gate.js";
import {
  resolveMcpToolPermissionProfile,
  type McpToolPermissionProfile,
} from "../src/domain/mcp-permission-mapping.js";
import type { CapabilityRecord } from "../src/domain/capability-registry.js";

/**
 * M4 WP-8 — the permission-integration binding tests (delivery plan §3
 * order 8, Worker C + TL lane). Two surfaces, both against the REAL M4
 * capability records (the first time anything exercises the gate or a host
 * mapping against the registered godot/unreal records rather than a
 * synthetic unity fixture):
 *
 * 1. The MCP permission mapping (src/domain/mcp-permission-mapping.ts): the
 *    semantic authority that derives, from each record's DECLARED permission
 *    specs, the honest host-surface classification the ZCode MCP tool bridge
 *    consumes (readOnlyHint / destructiveHint → riskLevel low/high; the
 *    plan-mode hard-deny for destructive tools). The plugin MCP servers set
 *    the SAME annotations (pinned by their own wire-level tests) — this is
 *    the two-sided pin discipline of the manifest-agreement seam, applied to
 *    permissions. Fail closed: a record whose permission shape cannot be
 *    classified honestly is REFUSED, never guessed.
 *
 * 2. The dispatch-gate composition (permission-gate.ts evaluateDispatchPermission
 *    against the real records): the §7 Unreal challenge row "unapproved
 *    mutation (no permission-broker approval → refusal)" executed at the
 *    domain authority layer — an ungranted/denied/wrong-type session refuses
 *    the mutation; engine-headless can NEVER authorize an engine-gui
 *    (live-editor) mutation; a GUI grant without a display server fails
 *    closed (no silent downgrade).
 *
 * There is NO Gamos permission broker and no second permission system
 * (contract 06 rev 2): the HOST's per-tool-call gate is the approval
 * surface; these tests pin that the record-level requirements and the
 * host-level classification agree.
 */

const record = (id: string): CapabilityRecord => {
  const found = ENGINE_PLUGIN_CAPABILITIES.find((c) => c.id === id);
  if (!found) throw new Error(`record ${id} not registered`);
  return found;
};

const READ_PROFILE: McpToolPermissionProfile = {
  readOnlyHint: true,
  destructiveHint: false,
  riskLevel: "low",
  sideEffectScope: "none",
  needsApproval: true,
};
const MUTATION_PROFILE = (sideEffectScope: "workspace" | "system" | "network"): McpToolPermissionProfile => ({
  readOnlyHint: false,
  destructiveHint: true,
  riskLevel: "high",
  sideEffectScope,
  needsApproval: true,
});

describe("M4 WP-8 — the MCP permission mapping derives the honest host classification from the real records", () => {
  it("the godot reads map to the read-only annotation class (low risk, no side effects)", () => {
    for (const id of ["godot/project.inspect", "godot/script.check"]) {
      const outcome = resolveMcpToolPermissionProfile(record(id));
      expect(outcome.ok, id).toBe(true);
      if (outcome.ok) expect(outcome.profile, id).toEqual(READ_PROFILE);
    }
  });

  it("the unreal reads (loopback RC endpoint) map to the read-only annotation class", () => {
    for (const id of ["unreal/connection.inspect", "unreal/object.inspect", "unreal/property.read"]) {
      const outcome = resolveMcpToolPermissionProfile(record(id));
      expect(outcome.ok, id).toBe(true);
      if (outcome.ok) expect(outcome.profile, id).toEqual(READ_PROFILE);
    }
  });

  it("the godot file-writing mutations map to the destructive class with workspace scope", () => {
    for (const id of ["godot/scene.modify", "godot/asset.import", "godot/project.build"]) {
      const outcome = resolveMcpToolPermissionProfile(record(id));
      expect(outcome.ok, id).toBe(true);
      if (outcome.ok) expect(outcome.profile, id).toEqual(MUTATION_PROFILE("workspace"));
    }
  });

  it("godot/project.run (headless engine execution, no declared write) maps to the destructive class with system scope", () => {
    const outcome = resolveMcpToolPermissionProfile(record("godot/project.run"));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.profile).toEqual(MUTATION_PROFILE("system"));
  });

  it("the unreal live-editor mutations map to the destructive class with network scope (the loopback RC channel)", () => {
    for (const id of ["unreal/property.write", "unreal/function.invoke"]) {
      const outcome = resolveMcpToolPermissionProfile(record(id));
      expect(outcome.ok, id).toBe(true);
      if (outcome.ok) expect(outcome.profile, id).toEqual(MUTATION_PROFILE("network"));
    }
  });

  it("fail closed: a record with no declared permissions is refused classification, never guessed", () => {
    const empty = { ...record("godot/project.inspect"), permissions: [] } as unknown as CapabilityRecord;
    const outcome = resolveMcpToolPermissionProfile(empty);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("unclassified-permission-shape");
  });

  it("fail closed: an unreviewed command-execution scope NEVER claims the read-only class (conservative mutation)", () => {
    const alien = {
      ...record("godot/project.inspect"),
      permissions: [{ kind: "command-execution", scope: "sort-of-read-only", rationale: "x" }],
    } as unknown as CapabilityRecord;
    const outcome = resolveMcpToolPermissionProfile(alien);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.profile.readOnlyHint).toBe(false);
      expect(outcome.profile.destructiveHint).toBe(true);
      expect(outcome.profile.riskLevel).toBe("high");
    }
  });
});

describe("M4 WP-8 — §7 U4 executed: unapproved mutations are refused at the domain authority (the REAL unreal records)", () => {
  const granted = (kind: string) => [{ kind, grantedAt: "2026-11-10T00:00:00Z", via: "user-approval" as const }];
  const baseSession = {
    granted: [],
    displayServerAvailable: true,
  };

  it("unreal/property.write: an ungranted session refuses the native mutation (approval-denied)", () => {
    const decision = evaluateDispatchPermission({
      capability: record("unreal/property.write"),
      operation: "native-mutation",
      session: baseSession,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("approval-denied");
    expect(decision.reason).toContain("engine-gui");
  });

  it("unreal/property.write: a user-DENIED engine-gui grant refuses with the rejection reason", () => {
    const decision = evaluateDispatchPermission({
      capability: record("unreal/property.write"),
      operation: "native-mutation",
      session: {
        granted: [],
        denied: [{ kind: "engine-gui", deniedAt: "2026-11-10T00:00:00Z" }],
        displayServerAvailable: true,
      },
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("approval-denied");
    expect(decision.reason).toContain("rejected");
  });

  it("unreal/property.write: an engine-headless grant can NEVER authorize the live-editor mutation (no downgrade)", () => {
    const decision = evaluateDispatchPermission({
      capability: record("unreal/property.write"),
      operation: "native-mutation",
      session: { ...baseSession, granted: granted("engine-headless") },
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("approval-denied");
  });

  it("unreal/property.write: a granted engine-gui with NO display server fails closed (display-server-required)", () => {
    const decision = evaluateDispatchPermission({
      capability: record("unreal/property.write"),
      operation: "native-mutation",
      session: { granted: granted("engine-gui"), displayServerAvailable: false },
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("display-server-required");
  });

  it("unreal/property.write: the fully granted state authorizes through the gated path (viaGatedPath)", () => {
    const decision = evaluateDispatchPermission({
      capability: record("unreal/property.write"),
      operation: "native-mutation",
      session: { granted: granted("engine-gui"), displayServerAvailable: true },
    });
    expect(decision.allowed).toBe(true);
    expect(decision.viaGatedPath).toBe(true);
  });

  it("unreal/function.invoke: the ungranted session refuses the native mutation", () => {
    const decision = evaluateDispatchPermission({
      capability: record("unreal/function.invoke"),
      operation: "native-mutation",
      session: baseSession,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("approval-denied");
  });

  it("unreal/property.write: the loopback network operation is refused ungranted and allowed granted", () => {
    const refused = evaluateDispatchPermission({
      capability: record("unreal/property.write"),
      operation: "network",
      session: baseSession,
    });
    expect(refused.allowed).toBe(false);
    expect(refused.code).toBe("approval-denied");
    const allowed = evaluateDispatchPermission({
      capability: record("unreal/property.write"),
      operation: "network",
      session: { ...baseSession, granted: granted("network-access") },
    });
    expect(allowed.allowed).toBe(true);
  });
});

describe("M4 WP-8 — §7 U4 executed: the godot mutation records refuse the same way (the REAL godot records)", () => {
  const granted = (kind: string) => [{ kind, grantedAt: "2026-11-10T00:00:00Z", via: "user-approval" as const }];

  it("godot/scene.modify: an ungranted session refuses the native mutation; the headless grant authorizes through the gated path", () => {
    const refused = evaluateDispatchPermission({
      capability: record("godot/scene.modify"),
      operation: "native-mutation",
      session: { granted: [], displayServerAvailable: true },
    });
    expect(refused.allowed).toBe(false);
    expect(refused.code).toBe("approval-denied");
    const allowed = evaluateDispatchPermission({
      capability: record("godot/scene.modify"),
      operation: "native-mutation",
      session: { granted: granted("engine-headless"), displayServerAvailable: true },
    });
    expect(allowed.allowed).toBe(true);
    expect(allowed.viaGatedPath).toBe(true);
  });

  it("godot/project.build: the filesystem-write operation is refused ungranted (approval-denied)", () => {
    const decision = evaluateDispatchPermission({
      capability: record("godot/project.build"),
      operation: "fs-write",
      session: { granted: [], displayServerAvailable: true },
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("approval-denied");
  });

  it("godot/project.run: the engine-headless operation is refused ungranted and allowed granted", () => {
    const refused = evaluateDispatchPermission({
      capability: record("godot/project.run"),
      operation: "engine-headless",
      session: { granted: [], displayServerAvailable: true },
    });
    expect(refused.allowed).toBe(false);
    expect(refused.code).toBe("approval-denied");
    const allowed = evaluateDispatchPermission({
      capability: record("godot/project.run"),
      operation: "engine-headless",
      session: { granted: granted("engine-headless"), displayServerAvailable: true },
    });
    expect(allowed.allowed).toBe(true);
  });
});
