import { describe, expect, it } from "vitest";
import {
  evaluateDispatchPermission,
  resolvePublishingAuthorization,
  resolveRepositoryModificationAuthorization,
} from "../src/domain/permission-gate.js";
import { registerCapability } from "../src/domain/capability-registry.js";
import type { CapabilityRecord } from "../src/domain/capability-registry.js";
import { completeCapabilityRecord } from "./fixtures.js";

/**
 * Permission mapping to the EXISTING ZCode permission system (directive §13 /
 * contract 06 revision 2 — M1.6 TDD RED). Negative tests:
 * unauthorized native mutation, missing permission, wrong permission type
 * (engine-gui vs engine-headless, no silent downgrade), approval denial,
 * and the repository-governance vs publishing-authority boundary.
 *
 * There is NO Gamos permission broker: the gate only evaluates capability
 * permission metadata against the session's existing permission state.
 */

function capabilityWith(permissions: unknown[], engineFamily = "unity"): CapabilityRecord {
  return registerCapability({
    ...completeCapabilityRecord,
    id: "unity/scene.build",
    engineFamily,
    permissions,
  } as never);
}

const granted = (kind: string, at = "2026-11-05T22:00:00Z") => ({ kind, grantedAt: at, via: "user-approval" as const });

describe("Dispatch permission gate — existing-permission mapping (M1.6)", () => {
  it("allows a read-only inspection dispatch (filesystem read through existing permission state)", () => {
    const capability = registerCapability(completeCapabilityRecord); // command-execution/read-only
    const decision = evaluateDispatchPermission({
      capability,
      operation: "exec",
      session: { granted: [granted("command-execution")], displayServerAvailable: false, publishingScopes: [] },
    });
    expect(decision.allowed).toBe(true);
    expect(decision.checked.some((c) => c.kind === "command-execution" && c.satisfied)).toBe(true);
  });

  it("NEGATIVE: unauthorized native mutation — capability without any exec/engine permission kind", () => {
    const capability = capabilityWith([{ kind: "network-access", scope: "cdn-zcode.z.ai", rationale: "asset fetch" }]);
    const decision = evaluateDispatchPermission({
      capability,
      operation: "native-mutation",
      session: { granted: [granted("command-execution")], displayServerAvailable: false, publishingScopes: [] },
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("missing-permission-kind");
    expect(decision.reason).toContain("native");
  });

  it("NEGATIVE: missing permission — capability declares the kind but the session has not granted it", () => {
    const capability = capabilityWith([{ kind: "engine-headless", scope: "unity-batch", rationale: "batch build" }]);
    const decision = evaluateDispatchPermission({
      capability,
      operation: "native-mutation",
      session: { granted: [granted("command-execution")], displayServerAvailable: false, publishingScopes: [] },
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("approval-denied");
  });

  it("NEGATIVE: approval denial — the user rejected the permission prompt", () => {
    const capability = capabilityWith([{ kind: "engine-headless", scope: "unity-batch", rationale: "batch build" }]);
    const decision = evaluateDispatchPermission({
      capability,
      operation: "native-mutation",
      session: {
        granted: [],
        denied: [{ kind: "engine-headless", deniedAt: "2026-11-05T22:00:00Z" }],
        displayServerAvailable: false,
        publishingScopes: [],
      },
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("approval-denied");
    expect(decision.reason).toContain("denied");
  });

  it("NEGATIVE: wrong permission type — engine-gui operation satisfied only by engine-headless (no silent downgrade)", () => {
    const capability = capabilityWith([
      { kind: "engine-headless", scope: "unity-batch", rationale: "batch build" },
      { kind: "engine-gui", scope: "unity-editor", rationale: "editor automation" },
    ]);
    const sessionGranted = [granted("engine-headless")]; // headless granted, GUI NOT granted
    const decision = evaluateDispatchPermission({
      capability,
      operation: "engine-gui",
      session: { granted: sessionGranted, displayServerAvailable: true, publishingScopes: [] },
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("wrong-permission-type");
    expect(decision.reason).toContain("engine-gui");
    expect(decision.reason).toContain("downgrade");
  });

  it("NEGATIVE: engine-gui with no display server resolves to an explicit unavailable state (contract 06 rule 2)", () => {
    const capability = capabilityWith([{ kind: "engine-gui", scope: "unity-editor", rationale: "editor automation" }]);
    const decision = evaluateDispatchPermission({
      capability,
      operation: "engine-gui",
      session: { granted: [granted("engine-gui")], displayServerAvailable: false, publishingScopes: [] },
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("display-server-required");
    expect(decision.reason).toContain("display");
  });

  it("NEGATIVE: a native engine mutation never bypasses the permission-gated path (contract 06 rule 3)", () => {
    const capability = capabilityWith([{ kind: "engine-gui", scope: "unity-editor", rationale: "editor automation" }]);
    const decision = evaluateDispatchPermission({
      capability,
      operation: "native-mutation",
      session: { granted: [granted("engine-gui")], displayServerAvailable: true, publishingScopes: [] },
    });
    expect(decision.allowed).toBe(true); // gated path satisfied: engine permission granted + display available
    expect(decision.viaGatedPath).toBe(true);
  });
});

describe("Authority boundary: repository governance vs publishing (contract 06 §3 — M1.6)", () => {
  it("NEGATIVE: a repository governance decision NEVER grants a publishing entitlement", () => {
    const decision = resolvePublishingAuthorization({
      scope: "release",
      userPublishingScopes: [],
      repositoryGovernanceDecision: "GAMOS-AUTH-0005",
    });
    expect(decision.authorized).toBe(false);
    expect(decision.authority).toBe("none");
    expect(decision.reason).toContain("repository");
    expect(decision.reason.toLowerCase()).toContain("never");
  });
  it("release publishing resolves against the USER's publishing scopes only", () => {
    const decision = resolvePublishingAuthorization({
      scope: "release",
      userPublishingScopes: ["payswap:release:games"],
      repositoryGovernanceDecision: undefined,
    });
    expect(decision.authorized).toBe(true);
    expect(decision.authority).toBe("user-publishing");
  });
  it("workspace publishing is an in-workspace agent action (existing permission semantics)", () => {
    const decision = resolvePublishingAuthorization({
      scope: "workspace",
      userPublishingScopes: [],
    });
    expect(decision.authorized).toBe(true);
    expect(decision.authority).toBe("user-publishing");
  });
  it("NEGATIVE: publishing scopes NEVER authorize repository modifications (the inverse boundary)", () => {
    const decision = resolveRepositoryModificationAuthorization({
      userPublishingScopes: ["payswap:release:games", "payswap:admin:everything"],
      repositoryGovernanceDecision: undefined,
    });
    expect(decision.authorized).toBe(false);
    expect(decision.reason).toContain("governance");
  });
  it("repository modifications resolve only through the governance ledger", () => {
    const decision = resolveRepositoryModificationAuthorization({
      userPublishingScopes: [],
      repositoryGovernanceDecision: "GAMOS-AUTH-0005",
    });
    expect(decision.authorized).toBe(true);
    expect(decision.authority).toBe("repository-governance");
  });
});
