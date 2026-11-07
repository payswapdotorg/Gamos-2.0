/**
 * Shipped engine-plugin package validation — Worker C adversarial surface
 * (M2.5, directive §5): ties an ACTUAL plugin manifest (the
 * `.zcode-plugin/plugin.json` content) to the domain trust contracts.
 *
 * This is the integration-security seam between:
 *   - the real ZCode plugin lifecycle (manifest name/version, mcpServers,
 *     userConfig, package.json version — parsed by the adapters' manifest
 *     interpreter), and
 *   - the gamos-domain contracts (gamos/engine-plugin@2 metadata,
 *     gamos/capability@2 registry records, gamos/provenance@2 provenance,
 *     plugin process-trust declarations — contract 03/09).
 *
 * Fail-closed on every misrepresentation a shipped package could carry, in
 * this order: non-canonical provenance, mcpServers content vs declared
 * surfaces, unresolvable or cross-package capability ids, version drift
 * between manifest and package, invalid inline gamos/engine-plugin@2 fields,
 * and process-trust violations (community reviewRef, least-privilege regime,
 * prohibited "sandboxed" wording, unresolvable provenance → explicit
 * disabled state — contract 09 §3 rule 7).
 */

import type { CapabilityRecord } from "./capability-registry.js";
import { validateEnginePluginMeta, type EnginePluginMeta } from "./engine-plugin.js";
import { validateProvenanceRef, PROVENANCE_SCHEMA_ID } from "./provenance.js";
import type { ProvenanceRef } from "./provenance.js";
import { validatePluginProcessTrust, type PluginTrustResult, type PluginProcessTrust } from "./plugin-trust.js";

/** Validation outcome mirroring PluginTrustResult's shape with package-level codes. */
export type EnginePluginPackageValidation =
  | { ok: true; trust: PluginProcessTrust; meta: EnginePluginMeta }
  | {
      ok: false;
      code:
        | "not-a-manifest"
        | "provenance-invalid"
        | "provenance-surface-uncovered"
        | "surfaces-mismatch"
        | "capability-unresolvable"
        | "version-mismatch"
        | "meta-invalid"
        | "provenance-missing"
        | "provenance-unresolvable"
        | "community-review-missing"
        | "least-privilege-missing"
        | "sandbox-claim"
        | "disclosure-missing-filesystem"
        | "disclosure-missing-network"
        | "disclosure-missing-environment"
        | "credential-env-unreviewed";
      reason: string;
    };

/** Resolution options: the provenance resolver hook (contract 09 §3 rule 7). */
export interface EnginePluginPackageOptions {
  resolveProvenance?: (ref: ProvenanceRef) => { resolved: boolean; detail: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Maps a PluginTrustResult failure to the package-level validation failure. */
function fromTrustFailure(result: Extract<PluginTrustResult, { ok: false }>): EnginePluginPackageValidation {
  return { ok: false, code: result.code, reason: result.reason };
}

/**
 * Validates a shipped engine-plugin package: the parsed `.zcode-plugin/plugin.json`
 * manifest plus the package.json content, against the capability registry.
 *
 * The manifest carries BOTH the standard ZCode fields (name, version,
 * mcpServers, userConfig) and the inline gamos/engine-plugin@2 fields
 * (engineFamily, engineVersions, executable, capabilities, headlessSupport,
 * requiresDisplayServer, provenance) — the adapters' manifest interpreter
 * tolerates the inline extension keys, so the manifest is the single shipped
 * source of truth for both surfaces. The manifest `name` maps to the
 * EnginePluginMeta `pluginId`.
 */
export function validateEnginePluginPackage(
  manifest: unknown,
  packageJson: unknown,
  registry: ReadonlyMap<string, CapabilityRecord>,
  options?: EnginePluginPackageOptions,
): EnginePluginPackageValidation {
  if (!isRecord(manifest) || !isRecord(packageJson)) {
    return { ok: false, code: "not-a-manifest", reason: "manifest and package.json must both be parsed JSON objects" };
  }

  const name = typeof manifest.name === "string" && manifest.name.length > 0 ? manifest.name : "<unknown>";
  const mcpServers = manifest.mcpServers;
  const hasMcpContent = isRecord(mcpServers) && Object.keys(mcpServers).length > 0;

  // 1. Canonical provenance FIRST (contract 09 §4 — legacy shapes fail closed
  //    with provenance-invalid before any other provenance-derived judgment).
  const provenance = manifest.provenance;
  if (!isRecord(provenance)) {
    return {
      ok: false,
      code: "provenance-missing",
      reason: `plugin ${name} ships no provenance ref — unprovenanced declarations are rejected at registration (fail closed, contract 09 §4 rule 1)`,
    };
  }
  const canonical = validateProvenanceRef(provenance);
  if (!canonical.ok) {
    return {
      ok: false,
      code: "provenance-invalid",
      reason: `plugin ${name} provenance is not canonical ${PROVENANCE_SCHEMA_ID}: ${canonical.field} — ${canonical.reason} (contract 09 §4; capability and engine-plugin records share this schema)`,
    };
  }
  const canonicalProvenance = canonical.ref;

  // 2. Manifest mcpServers content ⟺ provenance surface coverage: shipped
  //    content must be covered; declared coverage must have content.
  const provenanceSurfaces = canonicalProvenance.surfaces;
  if (provenanceSurfaces !== undefined) {
    const uncovered = hasMcpContent ? ["mcp"].filter((s) => !provenanceSurfaces.includes(s as never)) : [];
    if (uncovered.length > 0) {
      return {
        ok: false,
        code: "provenance-surface-uncovered",
        reason: `plugin ${name} ships mcpServers content on surfaces [${uncovered.join(", ")}] that its provenance does not cover (covers [${provenanceSurfaces.join(", ")}]) — uncovered shipped content fails closed (contract 09 §4 rule 1)`,
      };
    }
    if (!hasMcpContent && provenanceSurfaces.includes("mcp")) {
      return {
        ok: false,
        code: "surfaces-mismatch",
        reason: `plugin ${name} provenance covers an mcp surface but the manifest ships no mcpServers content — declaration mismatch fails closed (contract 09 §2)`,
      };
    }
  } else if (hasMcpContent) {
    return {
      ok: false,
      code: "surfaces-mismatch",
      reason: `plugin ${name} ships mcpServers content without provenance surfaces covering it — declaration mismatch fails closed (contract 09 §2)`,
    };
  }

  // 3. Every declared capability id resolves to a complete registry record OWNED
  //    by this package (contract 03 rule 1 + the append-only single-owner rule:
  //    a blender package declaring unity capabilities is cross-package smuggling).
  const expectedProviderIdentity = `plugin:${name}:engine`;
  const declaredCapabilities = Array.isArray(manifest.capabilities) ? (manifest.capabilities as unknown[]) : [];
  for (const id of declaredCapabilities) {
    if (typeof id !== "string") continue;
    const record = [...registry.values()].find((r) => r.id === id);
    if (!record) {
      return {
        ok: false,
        code: "capability-unresolvable",
        reason: `plugin ${name} declares capability ${JSON.stringify(id)} which does not resolve to a complete registry record — unresolvable declarations fail closed (contract 03 rule 1)`,
      };
    }
    if (record.provider.identity !== expectedProviderIdentity) {
      return {
        ok: false,
        code: "capability-unresolvable",
        reason: `plugin ${name} declares capability ${JSON.stringify(id)} whose registry record belongs to provider ${record.provider.identity}, not ${expectedProviderIdentity} — cross-package capability declarations fail closed (append-only single-owner rule, contract 03 rule 1)`,
      };
    }
  }

  // 4. Version alignment manifest ⟺ package.json (the mechanical bootstrap
  //    invariant, enforced from the domain side too).
  const manifestVersion = manifest.version;
  const packageVersion = packageJson.version;
  if (typeof manifestVersion === "string" && typeof packageVersion === "string" && manifestVersion !== packageVersion) {
    return {
      ok: false,
      code: "version-mismatch",
      reason: `plugin ${name} manifest version ${manifestVersion} != package.json version ${packageVersion} — shipped versions must align (bootstrap invariant)`,
    };
  }

  // 5. The inline gamos/engine-plugin@2 fields must validate (family grammar,
  //    canonical provenance, capability resolution) — the manifest `name` maps
  //    to the meta `pluginId`.
  const metaInput = { ...(manifest as Record<string, unknown>), pluginId: name };
  const metaValidation = validateEnginePluginMeta(metaInput, registry);
  if (!metaValidation.ok) {
    return { ok: false, code: "meta-invalid", reason: metaValidation.reason };
  }

  // 6. Process-trust validation through the SAME canonical declarations:
  //    community reviewRef, disclosures (never "sandboxed"), community
  //    least-privilege regime, unresolvable provenance → explicit rejected
  //    state. Official-class (zcode-official/gamos-tl) plugins without a
  //    manifest-declared regime get the honest official-full baseline with
  //    full §3.2 disclosures (contract 09 §3.2) — community plugins get the
  //    same injection, which then fail-closes at the least-privilege gate
  //    unless they carry their own reviewed regime or explicit approval.
  const trustDeclaration: Record<string, unknown> = {
    pluginId: name,
    surfaces: hasMcpContent ? ["mcp"] : [],
    provenance: canonicalProvenance,
  };
  if (hasMcpContent) {
    trustDeclaration.mcpServers = Object.entries(mcpServers as Record<string, unknown>).map(([serverName, config]) => ({
      name: serverName,
      entryPoint:
        isRecord(config) && Array.isArray((config as { args?: unknown }).args)
          ? String(((config as { args: unknown[] }).args[0] as string) ?? "dist/mcp/server.js")
          : "dist/mcp/server.js",
    }));
    trustDeclaration.processRegime = isRecord(manifest.processRegime)
      ? manifest.processRegime
      : {
          environmentMinimized: false,
          workingDirectoryContained: false,
          disclosures: {
            filesystem: "read/write within the OS user account scope; no path allow-list (OS process, contract 09 §3.2)",
            network: "unrestricted outbound and loopback access (OS process, contract 09 §3.2)",
            environment: "full spawn environment inheritance minus ZCode runtime sanitized secrets (contract 09 §3.2)",
          },
        };
  }

  const trust = validatePluginProcessTrust(trustDeclaration, options);
  if (!trust.ok) {
    return fromTrustFailure(trust);
  }

  return { ok: true, trust: trust.trust, meta: metaValidation.meta };
}
