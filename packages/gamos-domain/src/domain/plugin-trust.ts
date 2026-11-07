/**
 * Plugin trust and MCP process authority (directive §13 / contract 09 revision 2 — M1.6).
 *
 * The critical distinction this module enforces: a permission prompt approving
 * an MCP TOOL invocation does not sandbox the MCP SERVER PROCESS — the process
 * runs under OS-level authority (the user's account). Every validation here is
 * about representing that truth accurately and failing closed when a plugin
 * declaration misrepresents it:
 *
 * - "sandboxed" wording is prohibited for MCP processes (renderer UI sandbox only)
 * - MCP declarations MUST disclose filesystem / network / environment authority
 * - credential-bearing env vars require an explicit reviewed need
 * - provenance is mandatory; community mcp-carrying plugins require a reviewRef
 * - community MCP processes require the least-privilege regime (env
 *   minimization + working-directory containment) OR an explicit user approval
 *   of full OS-process authority — never silent full-privilege execution
 * - declared surfaces must match shipped content (mcpServers ↔ "mcp" surface)
 */

/** Which execution surfaces a plugin declares (must match shipped content). */
export type PluginSurface = "ui" | "mcp";

// Canonical provenance semantics (contract 09 §4, `gamos/provenance@2`) — the
// SAME schema capability records consume (contract 02). One schema, two consumers.
import { validateProvenanceRef, PROVENANCE_SCHEMA_ID } from "./provenance.js";
import type { ProvenanceRef } from "./provenance.js";

/** The provenance ref for engine-plugin records — canonical `gamos/provenance@2` (contract 09 §4). */
export type PluginProvenance = ProvenanceRef;

/** Optional provenance-resolution hook (pure-domain injection point).
 *  Callers that can actually resolve a provenance reference (marketplace hash
 *  re-verification, repository lookup) inject this; an unresolvable reference
 *  yields an explicit rejected state — contract 09 §3 rule 7 (disable on
 *  unresolvable provenance), never a silent skip. */
export interface ProvenanceResolutionOptions {
  resolveProvenance?: (ref: ProvenanceRef) => { resolved: boolean; detail: string };
}

export interface PluginMcpServerDeclaration {
  readonly name: string;
  readonly entryPoint: string;
  /** Env vars the plugin declares it needs; credential-bearing names require a reviewed need. */
  readonly declaredEnvVars?: readonly string[];
  /** True when a review explicitly covered the credential-bearing env need. */
  readonly credentialEnvNeedsReviewed?: boolean;
}

export interface PluginProcessRegimeDeclaration {
  readonly environmentMinimized: boolean;
  readonly workingDirectoryContained: boolean;
  /** Present when the user explicitly approved FULL OS-process authority (community fallback). */
  readonly fullAuthorityUserApproval?: { approvedAt: string; regime: "community-full" };
  /** The honest disclosure of actual process privileges (all three required for mcp surfaces). */
  readonly disclosures?: {
    readonly filesystem?: string;
    readonly network?: string;
    readonly environment?: string;
  };
}

export interface PluginProcessDeclaration {
  readonly pluginId: string;
  readonly surfaces: readonly PluginSurface[];
  readonly mcpServers?: readonly PluginMcpServerDeclaration[];
  readonly provenance?: PluginProvenance;
  readonly processRegime?: PluginProcessRegimeDeclaration;
}

/** The validated trust record (what downstream disclosure/approval surfaces read). */
export interface PluginProcessTrust {
  readonly pluginId: string;
  readonly surfaces: readonly PluginSurface[];
  readonly provenance: PluginProvenance;
  readonly mcpProcess?: {
    readonly executionRegime: "official-full" | "community-minimized" | "community-full-approved";
    readonly environmentMinimized: boolean;
    readonly workingDirectoryContained: boolean;
    readonly disclosures: { readonly filesystem: string; readonly network: string; readonly environment: string };
    readonly declaredEnvVars: readonly string[];
    /** Contract 09 §2.5: capability-invocation approval does NOT constrain this process. */
    readonly approvalScope: "tool-invocation-only";
  };
}

export type PluginTrustResult =
  | { ok: true; trust: PluginProcessTrust }
  | {
      ok: false;
      code:
        | "provenance-missing"
        | "provenance-invalid"
        | "provenance-surface-uncovered"
        | "provenance-unresolvable"
        | "surfaces-mismatch"
        | "community-review-missing"
        | "sandbox-claim"
        | "disclosure-missing-filesystem"
        | "disclosure-missing-network"
        | "disclosure-missing-environment"
        | "credential-env-unreviewed"
        | "least-privilege-missing";
      readonly reason: string;
    };

/** Env var name patterns that carry credentials/secrets (spawn-env exposure surface). */
const CREDENTIAL_ENV_PATTERN = /(API_?KEY|TOKEN|SECRET|PASSWORD|PASSPHRASE|CREDENTIAL|PRIVATE_KEY|BROKER_TOKEN)/i;

/** "Sandboxed"-style claims are prohibited for MCP processes (contract 09 §2.5/§3). */
const SANDBOX_CLAIM_PATTERN = /sandbox(ed)?/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates a plugin's process-trust declaration. Fail closed on every
 * misrepresentation: missing or non-canonical provenance, surface/content
 * mismatch, prohibited sandbox wording, missing disclosures, unreviewed
 * credential env exposure, missing community least-privilege controls
 * (without explicit full-authority approval). Returns the trust record
 * downstream disclosure surfaces must use.
 *
 * `options.resolveProvenance`, when provided, is invoked with the validated
 * canonical ref; an unresolvable reference yields the explicit
 * `provenance-unresolvable` rejected state (contract 09 §3 rule 7).
 */
export function validatePluginProcessTrust(
  declaration: unknown,
  options?: ProvenanceResolutionOptions,
): PluginTrustResult {
  if (!isRecord(declaration)) {
    return { ok: false, code: "provenance-missing", reason: "plugin declaration must be a non-null object" };
  }
  const pluginId = typeof declaration.pluginId === "string" ? declaration.pluginId : "<unknown>";
  const surfaces = Array.isArray(declaration.surfaces) ? (declaration.surfaces as PluginSurface[]) : [];
  const mcpServers = Array.isArray(declaration.mcpServers) ? (declaration.mcpServers as PluginMcpServerDeclaration[]) : [];
  const provenance = declaration.provenance as PluginProvenance | undefined;

  // 1. Provenance is mandatory (contract 09 §4 rule 1 — unprovenanced declarations fail closed).
  if (!isRecord(provenance)) {
    return {
      ok: false,
      code: "provenance-missing",
      reason: `plugin ${pluginId} has no provenance ref — unprovenanced declarations are rejected at registration (fail closed, contract 09 §4 rule 1)`,
    };
  }

  // 1a. Provenance must be canonical `gamos/provenance@2` (contract 09 §4) —
  //     the same schema capability records consume. Legacy publisher values
  //     ("official"/"local") and loose-string sources fail closed here.
  const canonical = validateProvenanceRef(provenance);
  if (!canonical.ok) {
    return {
      ok: false,
      code: "provenance-invalid",
      reason: `plugin ${pluginId} provenance is not canonical ${PROVENANCE_SCHEMA_ID}: ${canonical.field} — ${canonical.reason} (contract 09 §4; capability and engine-plugin records share this schema)`,
    };
  }
  const canonicalProvenance = canonical.ref;

  // 2. Surfaces declaration must match content (contract 09 §2 consequences).
  const hasMcpContent = mcpServers.length > 0;
  const declaresMcpSurface = surfaces.includes("mcp");
  if (hasMcpContent !== declaresMcpSurface) {
    return {
      ok: false,
      code: "surfaces-mismatch",
      reason: `plugin ${pluginId} surfaces ${JSON.stringify(surfaces)} do not match shipped content (${mcpServers.length} mcpServers) — declaration mismatch fails closed (contract 09 §2)`,
    };
  }

  // 3. Community mcp-carrying plugins require a reviewRef (contract 09 §4 rule 3).
  const isCommunity = canonicalProvenance.publisher === "community";
  if (isCommunity && declaresMcpSurface && (typeof canonicalProvenance.reviewRef !== "string" || canonicalProvenance.reviewRef.length === 0)) {
    return {
      ok: false,
      code: "community-review-missing",
      reason: `community plugin ${pluginId} declares mcpServers and MUST carry a reviewRef identifying the review that covered the server entry points (contract 09 §4 rule 3 / §3 rule 6)`,
    };
  }

  // 3a. When the provenance declares which surfaces it covers, every surface
  //     the plugin actually ships must be covered — uncovered content is
  //     unprovenanced content (contract 09 §4 rule 1, fail closed).
  if (canonicalProvenance.surfaces !== undefined) {
    const covered = new Set<string>(canonicalProvenance.surfaces);
    const uncovered = surfaces.filter((s) => !covered.has(s));
    if (uncovered.length > 0) {
      return {
        ok: false,
        code: "provenance-surface-uncovered",
        reason: `plugin ${pluginId} ships content on surfaces [${uncovered.join(", ")}] that its provenance does not cover (provenance covers [${[...covered].join(", ")}]) — uncovered engine-plugin content fails closed (contract 09 §4 rule 1)`,
      };
    }
  }

  // 3b. An unresolvable provenance reference produces an explicit rejected/
  //     disabled state — never a silent skip (contract 09 §3 rule 7).
  if (options?.resolveProvenance) {
    const resolution = options.resolveProvenance(canonicalProvenance);
    if (!resolution.resolved) {
      return {
        ok: false,
        code: "provenance-unresolvable",
        reason: `plugin ${pluginId} provenance could not be resolved: ${resolution.detail} — the plugin MUST be disabled with an explicit state, not silently skipped (contract 09 §3 rule 7)`,
      };
    }
  }

  const base = { pluginId, surfaces, provenance: canonicalProvenance };

  // UI-only plugins carry no MCP process authority to validate.
  if (!declaresMcpSurface) {
    return { ok: true, trust: { ...base } };
  }

  const regime = (isRecord(declaration.processRegime) ? declaration.processRegime : {}) as unknown as PluginProcessRegimeDeclaration;
  const disclosures = (isRecord(regime.disclosures) ? regime.disclosures : {}) as NonNullable<PluginProcessRegimeDeclaration["disclosures"]>;

  // 4. Prohibited "sandboxed" wording for MCP processes (contract 09 §2.5 / §3 rule 1).
  for (const [key, value] of Object.entries(disclosures)) {
    if (typeof value === "string" && SANDBOX_CLAIM_PATTERN.test(value)) {
      return {
        ok: false,
        code: "sandbox-claim",
        reason: `plugin ${pluginId} MCP disclosure "${key}" claims "${value}" — "sandboxed" wording is prohibited for MCP processes: a permission prompt approving a tool invocation does not sandbox the server process; process isolation is OS-level only (contract 09 §2.5/§3)`,
      };
    }
  }

  // 5. Full disclosure of actual process authority (contract 09 §3 rule 5 / §3.2 inventory).
  if (typeof disclosures.filesystem !== "string" || disclosures.filesystem.length === 0) {
    return {
      ok: false,
      code: "disclosure-missing-filesystem",
      reason: `plugin ${pluginId} declares mcpServers without a filesystem disclosure — the MCP process's actual filesystem reach must be disclosed before install (contract 09 §3 rule 5)`,
    };
  }
  if (typeof disclosures.network !== "string" || disclosures.network.length === 0) {
    return {
      ok: false,
      code: "disclosure-missing-network",
      reason: `plugin ${pluginId} declares mcpServers without a network disclosure — the MCP process's actual network reach must be disclosed before install (contract 09 §3 rule 5)`,
    };
  }
  if (typeof disclosures.environment !== "string" || disclosures.environment.length === 0) {
    return {
      ok: false,
      code: "disclosure-missing-environment",
      reason: `plugin ${pluginId} declares mcpServers without an environment disclosure — the spawn-env inheritance must be disclosed before install (contract 09 §3 rule 5)`,
    };
  }

  // 6. Credential-bearing env vars require an explicit reviewed need (contract 09 §3 rule 3/§3.4).
  const declaredEnvVars: string[] = [];
  for (const server of mcpServers) {
    for (const envVar of server.declaredEnvVars ?? []) {
      declaredEnvVars.push(envVar);
      if (CREDENTIAL_ENV_PATTERN.test(envVar) && server.credentialEnvNeedsReviewed !== true) {
        return {
          ok: false,
          code: "credential-env-unreviewed",
          reason: `plugin ${pluginId} MCP server ${server.name} declares credential-bearing env var ${envVar} without an explicit reviewed need — the spawn env carries broker tokens/endpoint credentials and plugin review must cover any credential exposure (contract 09 §3 rule 3 / §3.4 env minimization)`,
        };
      }
    }
  }

  // 7. Community MCP processes require the least-privilege regime OR explicit
  //    full-authority approval — never silent full-privilege execution (contract 09 §3.4).
  if (isCommunity) {
    const minimized = regime.environmentMinimized === true;
    const contained = regime.workingDirectoryContained === true;
    const fullApproval = regime.fullAuthorityUserApproval !== undefined;
    if ((!minimized || !contained) && !fullApproval) {
      const missing: string[] = [];
      if (!minimized) missing.push("environment minimization");
      if (!contained) missing.push("working-directory containment");
      return {
        ok: false,
        code: "least-privilege-missing",
        reason: `community plugin ${pluginId} MCP process lacks ${missing.join(" and ")} and no explicit user approval of full OS-process authority is recorded — community mcpServers fail closed without the least-privilege regime (contract 09 §3 rule 4)`,
      };
    }
    if (fullApproval && (!minimized || !contained)) {
      return {
        ok: true,
        trust: {
          ...base,
          mcpProcess: {
            executionRegime: "community-full-approved",
            environmentMinimized: minimized,
            workingDirectoryContained: contained,
            disclosures: { filesystem: disclosures.filesystem, network: disclosures.network, environment: disclosures.environment },
            declaredEnvVars,
            approvalScope: "tool-invocation-only",
          },
        },
      };
    }
    return {
      ok: true,
      trust: {
        ...base,
        mcpProcess: {
          executionRegime: "community-minimized",
          environmentMinimized: true,
          workingDirectoryContained: true,
          disclosures: { filesystem: disclosures.filesystem, network: disclosures.network, environment: disclosures.environment },
          declaredEnvVars,
          approvalScope: "tool-invocation-only",
        },
      },
    };
  }

  // Official/TL plugins: the honest full-privilege baseline WITH disclosures (contract 09 §3.1/§3.2).
  return {
    ok: true,
    trust: {
      ...base,
      mcpProcess: {
        executionRegime: "official-full",
        environmentMinimized: regime.environmentMinimized === true,
        workingDirectoryContained: regime.workingDirectoryContained === true,
        disclosures: { filesystem: disclosures.filesystem, network: disclosures.network, environment: disclosures.environment },
        declaredEnvVars,
        approvalScope: "tool-invocation-only",
      },
    },
  };
}
