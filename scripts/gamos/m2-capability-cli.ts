/**
 * Gamos M2 journey capability-resolution CLI (directive §9 items 3–4).
 *
 * Resolves the requested typed engine capabilities for the three engine
 * journeys through the CENTRAL registry (gamos/capability@2 + the M2.4
 * append-only engine records): every capability id the journey's model will
 * invoke must resolve to a complete record with canonical provenance, an
 * explicit availability state and permission metadata. The output is the
 * provenance-backed context the journey embeds in the New Task composer
 * submission and commits as evidence.
 *
 * The journey job bundles this file with esbuild (same pattern as
 * scripts/gamos/m1-context-cli.ts) and runs the bundle with node.
 */

import { readFileSync, existsSync } from "node:fs";
import {
  registerEnginePluginCapabilities,
  ENGINE_PLUGIN_CAPABILITIES,
  ENGINE_PLUGIN_METAS,
  M2_ENGINE_PLUGIN_SOURCE_COMMIT,
  M4_ENGINE_PLUGIN_SOURCE_COMMIT,
  resolveCapability,
} from "../../packages/gamos-domain/src/contract.js";

/**
 * Per-family source-of-record pin (mirrors the domain security test's
 * expectedSourceCommit): the M2 0.1.0 line (unity/blender/babylon) names the
 * PR #5 integration merge; the M4 godot 1.0.0 line names the capability-
 * contracts commit where its field-level records were authored. A shipped
 * manifest carrying its OWN line's commit is the source-of-record truth.
 */
const expectedSourceCommit = (engineFamily: string): string =>
  engineFamily === "godot" ? M4_ENGINE_PLUGIN_SOURCE_COMMIT : M2_ENGINE_PLUGIN_SOURCE_COMMIT;

const REQUESTED = [
  // Blender leg (§9 + M2-G2): typed modify + render through the real engine.
  // Prerequisite ids match the records' declared prerequisites exactly; the
  // ones satisfied on the journey machine are passed as satisfied.
  { id: "blender/scene.inspect", prerequisites: ["blender-installed"] },
  { id: "blender/scene.modify", prerequisites: ["blender-installed"] },
  { id: "blender/scene.render", prerequisites: ["blender-installed"] },
  // Babylon leg (§9 + M2-G3): typed build + run through the real toolchain
  // (network-for-dependencies is declared and SATISFIED on the journey runner —
  // dependency fetches use the declared network permission with recorded hashes).
  { id: "babylon/project.inspect", prerequisites: ["babylon-project-root"] },
  { id: "babylon/project.build", prerequisites: ["babylon-project-root", "node-toolchain", "network-for-dependencies"] },
  { id: "babylon/project.run", prerequisites: ["babylon-project-root", "node-toolchain"] },
  // Unity leg (§9 negative path): marker-only inspect resolves (the project
  // fixture root is staged); scene.modify is resolved WITHOUT the editor/license
  // prerequisites — the registry reports the honest missing-prerequisite state
  // (exactly the negative path the journey then exercises live through the plugin).
  { id: "unity/project.inspect", prerequisites: ["unity-project-root"] },
  { id: "unity/scene.modify", prerequisites: ["unity-project-root"] },
];

const registry = registerEnginePluginCapabilities();

const resolved = REQUESTED.map((request) => {
  const outcome = resolveCapability(registry, request);
  if (outcome.ok) {
    const record = outcome.record;
    return {
      id: request.id,
      resolved: true,
      version: record.version,
      engineFamily: record.engineFamily,
      providerIdentity: record.provider.identity,
      permissions: record.permissions.map((p) => `${p.kind}:${p.scope}`),
      availability: record.availability.state,
      provenance: {
        publisher: record.provenance.publisher,
        source: record.provenance.source,
        reviewedBy: record.provenance.reviewedBy ?? null,
        reviewRef: record.provenance.reviewRef ?? null,
      },
      verification: record.verification.method,
      timeoutMs: record.timeout.defaultMs,
      cancellation: record.cancellation.supported,
    };
  }
  return {
    id: request.id,
    resolved: false,
    error: outcome.error,
  };
});

// The shipped plugin metas + manifests must agree (the INTEGRATE seam).
// M4 sequencing note (delivery plan §3): records+meta landed in WP-1 (order 1)
// BEFORE the package existed — the existsSync read then reported godot-engine
// honestly as package-not-yet-shipped. As of M4 WP-2 (order 2) the
// godot-engine-plugin package IS shipped with its .zcode-plugin/plugin.json,
// so the manifest-agreement read engages for all four shipped plugins (the
// existsSync self-heal closed; a shipped package can never dodge the
// agreement record). provenanceCommitIsSourceOfRecord is the PER-FAMILY pin:
// godot's line names the M4 capability-contracts commit, not the M2 merge.
const pluginsRoot = "apps/zcode-cli/packages/";
const shipped = ENGINE_PLUGIN_METAS.map((meta) => {
  const manifestPath = `${pluginsRoot}${meta.pluginId}-plugin/.zcode-plugin/plugin.json`;
  if (!existsSync(manifestPath)) {
    return {
      pluginId: meta.pluginId,
      engineFamily: meta.engineFamily,
      engineVersions: meta.engineVersions,
      manifestName: null,
      manifestVersion: null,
      declaredCapabilities: [...meta.capabilities],
      provenanceCommit: null,
      provenanceCommitIsSourceOfRecord: null,
      mcpServerEntry: null,
      packageNotYetShipped: true,
      note: "domain records + meta registered before the plugin package ships (delivery plan §3 order sequencing); the manifest-agreement record engages automatically once the package directory exists",
    };
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const lineCommit = expectedSourceCommit(meta.engineFamily);
  return {
    pluginId: meta.pluginId,
    engineFamily: meta.engineFamily,
    engineVersions: meta.engineVersions,
    manifestName: manifest.name,
    manifestVersion: manifest.version,
    declaredCapabilities: manifest.capabilities,
    provenanceCommit: manifest.provenance?.source?.commitSha ?? null,
    provenanceCommitIsSourceOfRecord: manifest.provenance?.source?.commitSha === lineCommit,
    mcpServerEntry: manifest.mcpServers?.engine ? `${manifest.mcpServers.engine.command} ${manifest.mcpServers.engine.args.join(" ")}` : null,
  };
});

const unresolved = resolved.filter((r) => !r.resolved);
// unity/scene.modify is EXPECTED to fail resolution without its license/editor
// prerequisites — the honest negative path. Everything else must resolve.
const unexpectedUnresolved = unresolved.filter((r) => r.id !== "unity/scene.modify");

const output = {
  schema: "gamos/m2-capability-resolution@1",
  resolvedAt: new Date().toISOString(),
  registryRecords: ENGINE_PLUGIN_CAPABILITIES.length,
  sourceCommit: M2_ENGINE_PLUGIN_SOURCE_COMMIT,
  capabilities: resolved,
  shippedPlugins: shipped,
  verdict: unexpectedUnresolved.length === 0 ? "ok" : "unresolved-capabilities",
  note: "unity/scene.modify intentionally resolves as missing-prerequisite without a licensed editor — the honest negative path (contract 07 availability, never fabricated)",
};

console.log(JSON.stringify(output, null, 2));
if (unexpectedUnresolved.length > 0) {
  process.exitCode = 1;
}
