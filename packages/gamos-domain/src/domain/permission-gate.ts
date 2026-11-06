/**
 * Dispatch permission mapping onto the EXISTING ZCode permission system
 * (directive §13 / contract 06 revision 2 — M1.6).
 *
 * There is NO Gamos permission broker: this module only evaluates capability
 * permission metadata against the session's existing permission state and
 * produces a decision the dispatch layer must honor. Approval UI/audit are the
 * existing permission prompts and records; native engine mutations always ride
 * the permission-gated ZCode execution path (contract 06 rule 3).
 *
 * Authority boundary (contract 06 §3, revision 1): repository-governance
 * authorization and game-release/publishing authorization are kept completely
 * separate — a governance ledger entry NEVER grants a publishing entitlement,
 * and a publishing scope NEVER authorizes a repository modification.
 */

import type { CapabilityRecord, PermissionSpec } from "./capability-registry.js";

export type PermissionKind = PermissionSpec["kind"];

/** The session's EXISTING permission state (granted/denied records + environment facts). */
export interface SessionPermissionState {
  readonly granted: readonly { kind: PermissionKind; grantedAt: string; via: "user-approval" | "session-mode" }[];
  readonly denied?: readonly { kind: PermissionKind; deniedAt: string }[];
  readonly displayServerAvailable: boolean;
  /** The USER's platform publishing scopes (e.g. PaySwap account scopes) — never repository powers. */
  readonly publishingScopes?: readonly string[];
}

/** The operation class a dispatch wants to perform. */
export type DispatchOperation =
  | "fs-write"
  | "exec"
  | "network"
  | "engine-headless"
  | "engine-gui"
  | "artifact-publish"
  | "native-mutation";

export interface DispatchPermissionRequest {
  readonly capability: CapabilityRecord;
  readonly operation: DispatchOperation;
  readonly session: SessionPermissionState;
}

export interface PermissionDecision {
  readonly allowed: boolean;
  readonly code:
    | "ok"
    | "missing-permission-kind"
    | "approval-denied"
    | "wrong-permission-type"
    | "display-server-required"
    | "publishing-authorization-missing";
  readonly reason: string;
  readonly checked: readonly { kind: PermissionKind; satisfied: boolean }[];
  /** True when a native mutation was authorized through the gated exec/engine path (contract 06 rule 3). */
  readonly viaGatedPath?: boolean;
}

/** Permission kinds that gate native engine mutations (contract 06 rule 3). */
const NATIVE_MUTATION_KINDS: readonly PermissionKind[] = ["command-execution", "engine-headless", "engine-gui"];

/** The permission kind an operation requires (engine-gui is NOT satisfied by engine-headless — no downgrade). */
const OPERATION_KIND: Record<Exclude<DispatchOperation, "native-mutation" | "artifact-publish">, PermissionKind> = {
  "fs-write": "filesystem-write",
  exec: "command-execution",
  network: "network-access",
  "engine-headless": "engine-headless",
  "engine-gui": "engine-gui",
};

/**
 * Evaluates a dispatch against the capability's declared permissions and the
 * session's existing permission state. Fail closed: missing kinds, denied
 * approvals, display-server requirements and GUI/headless downgrades all deny
 * with an explicit reason.
 */
export function evaluateDispatchPermission(request: DispatchPermissionRequest): PermissionDecision {
  const { capability, operation, session } = request;
  const declared = capability.permissions;
  const grantedKinds = new Set(session.granted.map((g) => g.kind));
  const deniedKinds = new Set((session.denied ?? []).map((d) => d.kind));

  if (operation === "native-mutation") {
    // Contract 06 rule 3: native engine mutations ride the gated exec/engine path ONLY.
    const gated = declared.filter((p) => NATIVE_MUTATION_KINDS.includes(p.kind));
    if (gated.length === 0) {
      return {
        allowed: false,
        code: "missing-permission-kind",
        reason: `native mutation requires a command-execution/engine-headless/engine-gui permission on the capability (contract 06 rule 3 — the gated ZCode execution path); ${capability.id} declares none`,
        checked: [],
      };
    }
    const satisfied = gated.filter((p) => grantedKinds.has(p.kind));
    const checked = gated.map((p) => ({ kind: p.kind, satisfied: grantedKinds.has(p.kind) }));
    if (satisfied.length === 0) {
      const deniedHere = gated.some((p) => deniedKinds.has(p.kind));
      return {
        allowed: false,
        code: "approval-denied",
        reason: deniedHere
          ? `native mutation denied: the user rejected the permission prompt for ${gated.map((p) => p.kind).join(", ")}`
          : `native mutation not granted: none of ${gated.map((p) => p.kind).join(", ")} is granted in the session permission state`,
        checked,
      };
    }
    // A granted GUI permission still requires a display server (rule 2).
    if (satisfied.some((p) => p.kind === "engine-gui") && !session.displayServerAvailable) {
      return {
        allowed: false,
        code: "display-server-required",
        reason: "engine-gui permission granted but no display server is available — the capability must resolve to unavailable, never silently downgrade to headless (contract 06 rule 2)",
        checked,
      };
    }
    return {
      allowed: true,
      code: "ok",
      reason: `native mutation authorized through the permission-gated path (${satisfied.map((p) => p.kind).join(", ")})`,
      checked,
      viaGatedPath: true,
    };
  }

  if (operation === "artifact-publish") {
    // Publishing scope resolution is contract 06 §3 — see resolvePublishingAuthorization.
    return {
      allowed: true,
      code: "ok",
      reason: "artifact publishing resolves through the publishing authorization boundary (contract 06 §3)",
      checked: [],
    };
  }

  const requiredKind = OPERATION_KIND[operation];
  const declaresIt = declared.some((p) => p.kind === requiredKind);
  if (!declaresIt) {
    // engine-gui operation on a capability that only declares headless: the
    // capability itself lacks the right permission type — no downgrade.
    if (operation === "engine-gui" && declared.some((p) => p.kind === "engine-headless")) {
      return {
        allowed: false,
        code: "wrong-permission-type",
        reason: "engine-gui operation cannot be satisfied by an engine-headless permission — the capability declares no engine-gui kind and downgrading is prohibited (contract 06 rule 2)",
        checked: declared.map((p) => ({ kind: p.kind, satisfied: false })),
      };
    }
    return {
      allowed: false,
      code: "missing-permission-kind",
      reason: `operation ${operation} requires permission kind ${requiredKind}; ${capability.id} declares ${declared.map((p) => p.kind).join(", ") || "none"}`,
      checked: declared.map((p) => ({ kind: p.kind, satisfied: false })),
    };
  }
  const grantedIt = grantedKinds.has(requiredKind);
  const deniedIt = deniedKinds.has(requiredKind);
  const checked = [{ kind: requiredKind, satisfied: grantedIt }];
  if (!grantedIt) {
    if (deniedIt) {
      return {
        allowed: false,
        code: "approval-denied",
        reason: `permission kind ${requiredKind} was denied by the user — dispatch blocked`,
        checked,
      };
    }
    // engine-gui requested with only a headless GRANT in the session: the
    // weaker grant cannot satisfy the GUI operation — explicit no-downgrade.
    if (operation === "engine-gui" && grantedKinds.has("engine-headless")) {
      return {
        allowed: false,
        code: "wrong-permission-type",
        reason: "an engine-headless grant cannot satisfy an engine-gui operation — no silent downgrade to headless (contract 06 rule 2)",
        checked,
      };
    }
    return {
      allowed: false,
      code: "approval-denied",
      reason: `permission kind ${requiredKind} is declared but not granted in the session permission state`,
      checked,
    };
  }
  if (operation === "engine-gui" && !session.displayServerAvailable) {
    return {
      allowed: false,
      code: "display-server-required",
      reason: "engine-gui permission granted but no display server is available — the capability must resolve to unavailable, never silently downgrade to headless (contract 06 rule 2)",
      checked,
    };
  }
  return {
    allowed: true,
    code: "ok",
    reason: `operation ${operation} authorized through permission kind ${requiredKind}`,
    checked,
  };
}

// ---------------------------------------------------------------------------
// Authority boundary (contract 06 §3)
// ---------------------------------------------------------------------------

export interface PublishingAuthorizationInput {
  readonly scope: "workspace" | "release";
  /** The user's OWN platform publishing scopes (account entitlements). */
  readonly userPublishingScopes: readonly string[];
  /** A repository governance decision reference — NEVER a publishing authority. */
  readonly repositoryGovernanceDecision?: string;
}

export interface PublishingAuthorization {
  readonly authorized: boolean;
  readonly authority: "user-publishing" | "none";
  readonly reason: string;
}

/**
 * Resolves a publishing authorization. Contract 06 §3: `release` publishing
 * resolves against the USER's publishing scopes ONLY — a repository governance
 * decision never grants a publishing entitlement (and is explicitly ignored).
 */
export function resolvePublishingAuthorization(input: PublishingAuthorizationInput): PublishingAuthorization {
  if (input.scope === "workspace") {
    return {
      authorized: true,
      authority: "user-publishing",
      reason: "workspace-scope publishing is an in-workspace agent action under the existing permission semantics (contract 06 §3 rule 2)",
    };
  }
  const hasScope = input.userPublishingScopes.some((s) => /release|publish/i.test(s));
  if (hasScope) {
    return {
      authorized: true,
      authority: "user-publishing",
      reason: "release publishing authorized by the user's platform publishing scope",
    };
  }
  return {
    authorized: false,
    authority: "none",
    reason:
      input.repositoryGovernanceDecision !== undefined
        ? `repository governance decision ${input.repositoryGovernanceDecision} NEVER grants a publishing entitlement — releases resolve against the user's platform publishing scopes only (contract 06 §3 rule 1)`
        : "no user publishing scope covers release publishing — releases resolve against the user's platform publishing scopes only (contract 06 §3 rule 1)",
  };
}

export interface RepositoryModificationAuthorizationInput {
  /** The user's publishing scopes — NEVER a repository-governance authority. */
  readonly userPublishingScopes?: readonly string[];
  /** The governance ledger decision that authorized the modification. */
  readonly repositoryGovernanceDecision?: string;
}

export interface RepositoryModificationAuthorization {
  readonly authorized: boolean;
  readonly authority: "repository-governance" | "none";
  readonly reason: string;
}

/**
 * Resolves a repository-modification authorization (protected surfaces).
 * Publishing scopes are irrelevant here: repository governance authorizes
 * through the governance ledger ONLY (ADR-0002/0004; CODEOWNERS + rulesets).
 */
export function resolveRepositoryModificationAuthorization(
  input: RepositoryModificationAuthorizationInput,
): RepositoryModificationAuthorization {
  if (input.repositoryGovernanceDecision !== undefined && input.repositoryGovernanceDecision.length > 0) {
    return {
      authorized: true,
      authority: "repository-governance",
      reason: `repository modification authorized by governance ledger decision ${input.repositoryGovernanceDecision}`,
    };
  }
  return {
    authorized: false,
    authority: "none",
    reason:
      "repository modifications require a governance ledger decision (complete gamos/authorization@2 entry, CODEOWNERS + rulesets) — publishing scopes and in-app approvals NEVER authorize them (contract 06 §3)",
  };
}
