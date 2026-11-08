/**
 * Gamos M3 journey orchestration CLI (final-closure handoff §11 items 1–4 + §7/§10 manifest persist).
 *
 * Two modes, both bundling the REAL gamos-domain facilities (same esbuild
 * pattern as scripts/gamos/m2-capability-cli.ts):
 *
 *   plan mode (default):
 *     Resolves the cross-engine pipeline's typed capabilities through the
 *     CENTRAL registry (gamos/capability@2 + the M2/M3 append-only engine
 *     records + the M3.3 core/asset.manifest-validate record), then GENERATES
 *     the engine-aware GamePlan through buildCrossEngineAssetPlan (the M3.3
 *     facility) and re-validates it through parseGamePlan — recording the
 *     steps, dependency edges, resource claims and derived op inputs the
 *     journey's in-app turns then execute. This is §11 items 1–4: project
 *     discovery, registry resolution, engine-aware plan generation, and
 *     dependency/resource-claim validation (the conflict gate runs inside
 *     parseGamePlan).
 *
 *   build-manifest mode:
 *     The pipeline-side manifest persist (§7 step 6 / §10): turns a REAL
 *     blender/asset.export tool result (the authoritative session-store part
 *     output, passed as a JSON file) into a validated status:"exported"
 *     gamos/asset-interchange@1 manifest through buildExportedManifest (the
 *     M3.4 pure facility) and persists it beside the staged artifact. The
 *     caller supplies observed paths/hashes/timestamps; the facility fails
 *     closed on every contract violation. This mirrors the M2 journey's
 *     .blend-bootstrap disclosure class: orchestration-layer preparation
 *     through the REAL committed facility — the in-app turns do the engine
 *     work.
 *
 * Env/args:
 *   GAMOS_M3_WORKSPACE_ROOT  (plan mode) absolute POSIX workspace root — the
 *                             app conversation workspace the journey stages
 *                             projects into. Required.
 *   GAMOS_M3_PLAN_ID         plan identity (default "gamos-m3-cross-engine").
 *   GAMOS_M3_PLAN_NOW        ISO-8601 UTC timestamp baked into the plan
 *                             (default: current time, recorded in output).
 *   build-manifest flags:    --export-result <file> --manifest-output <file>
 *                             --plan-id <id> --blend-file <abs>
 *                             --project-identity <id> --created-at <iso>
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import {
  registerCapability,
  registerEnginePluginCapabilities,
  ENGINE_PLUGIN_METAS,
  M2_ENGINE_PLUGIN_SOURCE_COMMIT,
  resolveCapability,
} from "../../packages/gamos-domain/src/contract.js";
import { CROSS_ENGINE_CORE_CAPABILITIES } from "../../packages/gamos-domain/src/domain/cross-engine-plan.js";
import { buildCrossEngineAssetPlan } from "../../packages/gamos-domain/src/domain/cross-engine-plan.js";
import { buildExportedManifest } from "../../packages/gamos-domain/src/domain/asset-interchange-build.js";
import type { AssetInterchangeManifest } from "../../packages/gamos-domain/src/domain/asset-interchange.js";

const argv = process.argv.slice(2);

function argValue(flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

function sha256Of(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/* ------------------------------------------------------------------ */
/* plan mode — registry resolution + engine-aware GamePlan (§11 1–4)   */
/* ------------------------------------------------------------------ */

function runPlanMode(): number {
  const workspaceRoot = process.env.GAMOS_M3_WORKSPACE_ROOT ?? "";
  if (!workspaceRoot.startsWith("/")) {
    process.stderr.write("GAMOS_M3_WORKSPACE_ROOT must be an absolute POSIX path (the app conversation workspace)\n");
    return 2;
  }
  const planId = process.env.GAMOS_M3_PLAN_ID ?? "gamos-m3-cross-engine";
  const now = process.env.GAMOS_M3_PLAN_NOW ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  // 1. Registry: engine-plugin records + the M3 cross-engine core record.
  const registry = registerEnginePluginCapabilities();
  const coreRegistered = CROSS_ENGINE_CORE_CAPABILITIES.map((record) => registerCapability(record));
  for (const record of coreRegistered) registry.set(`${record.id}@${record.version}`, record);

  const REQUESTED: { id: string; prerequisites: string[] }[] = [
    // §11 item 1 (source project discovery) + the in-app source-prep op the
    // journey's cross-engine task performs before the export (same typed
    // surface M2 proved; the plan itself starts at the export step).
    { id: "blender/scene.inspect", prerequisites: ["blender-installed"] },
    { id: "blender/scene.modify", prerequisites: ["blender-installed"] },
    // The cross-engine pipeline legs (plan steps, contract 03 §2 records).
    { id: "blender/asset.export", prerequisites: ["blender-installed"] },
    { id: "core/asset.manifest-validate", prerequisites: [] },
    { id: "babylon/asset.integrate", prerequisites: ["babylon-project-root"] },
    { id: "babylon/project.build", prerequisites: ["babylon-project-root", "node-toolchain", "network-for-dependencies"] },
    { id: "babylon/project.run", prerequisites: ["babylon-project-root", "node-toolchain"] },
    // The honest Unity negative leg (§11 item 14): resolves WITHOUT the
    // editor/license prerequisites — the registry reports the honest
    // missing-prerequisite state, exactly what the in-app leg then surfaces.
    { id: "unity/project.inspect", prerequisites: ["unity-project-root"] },
    { id: "unity/asset.import", prerequisites: ["unity-project-root"] },
  ];

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
        prerequisitesSatisfied: request.prerequisites,
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
    return { id: request.id, resolved: false, error: outcome.error };
  });

  // 2. The engine-aware GamePlan through the REAL M3.3 facility (§11 items 3–4).
  //    Project identities are the journey's staged workspace dirs (item 1);
  //    the concept/acceptance refs are deterministic plan-identity references
  //    (recorded below — they are NOT asset hashes).
  const conceptRef = {
    conceptId: "gamos-m3-journey-concept",
    conceptSha256: sha256Of("gamos-m3-cross-engine-journey-concept: Blender GLB asset consumed by a real Babylon project"),
  };
  const acceptanceRecord = {
    recordId: "gamos-m3-journey-acceptance",
    recordSha256: sha256Of("gamos-m3-cross-engine-journey-acceptance: M3-G2 + M3-G5 clauses as quoted in ROADMAP.json"),
  };
  const planRequest = {
    planId,
    conceptRef,
    acceptanceRecord,
    workspaceRoot,
    source: { projectIdentity: "gamos-m3-blender", blendFile: "gamos-m3-blender/scene.blend" },
    target: { engine: "babylon" as const, projectIdentity: "gamos-m3-babylon-app", projectRoot: "gamos-m3-babylon-app" },
    format: "glb" as const,
    assetName: "gamos-asset",
    now,
  };
  let plan: ReturnType<typeof buildCrossEngineAssetPlan>;
  try {
    plan = buildCrossEngineAssetPlan(planRequest);
  } catch (error) {
    process.stderr.write(`plan generation failed closed: ${(error as Error).message}\n`);
    return 1;
  }
  // buildCrossEngineAssetPlan already validates through parseGamePlan before
  // returning; the emitted step/claim surface is recorded as evidence.
  const planJson = JSON.stringify(plan, null, 2);
  const planSha256 = sha256Of(planJson);
  const planStep = (plan as { steps?: unknown[] }).steps ?? [];
  // GamePlanStep: { stepId, capability: { capabilityId, capabilityVersion, input }, dependsOn, resourceClaims: { claims } }
  const stepInputs = (plan as {
    steps?: {
      stepId?: string;
      capability?: { capabilityId?: string; capabilityVersion?: string; input?: Record<string, unknown> };
      dependsOn?: string[];
      resourceClaims?: { claims?: unknown[] };
    }[];
  }).steps ?? [];
  const planClaims = stepInputs.flatMap((s) => s.resourceClaims?.claims ?? []);

  const unresolved = resolved.filter((r) => !r.resolved);
  // unity/asset.import is EXPECTED to resolve as missing-prerequisite without
  // a licensed editor — the honest negative path. Everything else must resolve.
  const unexpectedUnresolved = unresolved.filter((r) => r.id !== "unity/asset.import");

  const output = {
    schema: "gamos/m3-capability-plan@1",
    generatedAt: new Date().toISOString(),
    workspaceRoot,
    registryRecords: registry.size,
    enginePluginSourceCommit: M2_ENGINE_PLUGIN_SOURCE_COMMIT,
    capabilities: resolved,
    shippedPlugins: ENGINE_PLUGIN_METAS.map((meta) => ({
      pluginId: meta.pluginId,
      engineFamily: meta.engineFamily,
      engineVersions: meta.engineVersions,
    })),
    plan: {
      schemaId: "gamos/cross-engine-plan@1",
      planId,
      planSha256,
      request: planRequest,
      stepCount: planStep.length,
      steps: stepInputs.map((s) => ({
        stepId: s.stepId,
        capabilityId: s.capability?.capabilityId,
        capabilityVersion: s.capability?.capabilityVersion,
        dependsOn: s.dependsOn ?? [],
        input: s.capability?.input ?? null,
        resourceClaims: s.resourceClaims?.claims ?? [],
      })),
      resourceClaimCount: planClaims.length,
      resourceClaims: planClaims,
      validatedByParseGamePlan: true,
      conflictGate: "parseGamePlan rejects unordered write/write (and read/write) overlaps on the same canonical claim path — the builder cannot hand out a plan the plan contract would reject",
    },
    verdict: unexpectedUnresolved.length === 0 ? "ok" : "unresolved-capabilities",
    note: "unity/asset.import intentionally resolves as missing-prerequisite without a licensed editor — the honest negative path (contract 07 availability, never fabricated). The generated plan is the orchestration record the journey's in-app turns execute step-by-step.",
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  return unexpectedUnresolved.length > 0 ? 1 : 0;
}

/* ------------------------------------------------------------------ */
/* build-manifest mode — the pipeline-side manifest persist (§7/§10)   */
/* ------------------------------------------------------------------ */

function runBuildManifestMode(): number {
  const exportResultPath = argValue("--export-result");
  const manifestOutputPath = argValue("--manifest-output");
  const planId = argValue("--plan-id") ?? "gamos-m3-cross-engine";
  const blendFile = argValue("--blend-file") ?? "";
  const projectIdentity = argValue("--project-identity") ?? "gamos-m3-blender";
  const createdAt = argValue("--created-at") ?? new Date().toISOString();
  if (!exportResultPath || !manifestOutputPath || !blendFile) {
    process.stderr.write("usage: build-manifest --export-result <file> --manifest-output <file> --plan-id <id> --blend-file <abs> --project-identity <id> --created-at <iso>\n");
    return 2;
  }

  // The REAL asset_export tool result (authoritative session-store part output).
  let exportResult: Record<string, unknown>;
  try {
    exportResult = JSON.parse(readFileSync(exportResultPath, "utf8")) as Record<string, unknown>;
  } catch (error) {
    process.stderr.write(`cannot read the export result ${exportResultPath}: ${(error as Error).message}\n`);
    return 2;
  }
  if (exportResult.ok !== true) {
    process.stderr.write("the export result is not a successful asset_export record (ok !== true) — refusing to build a manifest from a failed export\n");
    return 1;
  }
  const appliedInterchange = (exportResult.appliedInterchange ?? {}) as Record<string, unknown>;
  const dependentFiles = Array.isArray(exportResult.dependentFiles) ? (exportResult.dependentFiles as unknown[]) : [];

  // Map the tool result onto ExportedManifestBuildInput (asset-interchange-build.ts):
  // the additive result fields were designed as the manifest ingredients.
  const manifestInput = {
    manifestId: `${planId}-manifest`,
    source: {
      engine: "blender",
      engineVersion: exportResult.blenderVersion,
      projectIdentity,
      assetPath: blendFile,
      assetSha256: exportResult.sourceSha256,
      operationPlanId: planId,
      exporter: {
        capabilityId: "blender/asset.export",
        capabilityVersion: "1.0.0",
      },
    },
    interchange: {
      ...appliedInterchange,
    },
    artifact: {
      path: exportResult.outputPath,
      mediaType: appliedInterchange.format === "glb" ? "model/gltf-binary" : "application/octet-stream",
      byteLength: exportResult.bytes,
      sha256: exportResult.sha256,
    },
    ...(dependentFiles.length > 0 ? { dependentFiles } : {}),
    createdAt,
  };

  let manifest: AssetInterchangeManifest;
  try {
    manifest = buildExportedManifest(manifestInput);
  } catch (error) {
    process.stderr.write(`manifest build failed closed: ${(error as Error).message}\n`);
    return 1;
  }
  const manifestJson = JSON.stringify(manifest, null, 2);
  writeFileSync(manifestOutputPath, `${manifestJson}\n`);

  const output = {
    schema: "gamos/m3-manifest-build@1",
    builtAt: new Date().toISOString(),
    manifestPath: manifestOutputPath,
    manifestSha256: sha256Of(manifestJson),
    manifestId: manifest.manifestId,
    status: manifest.status,
    artifact: manifest.artifact,
    source: { engine: manifest.source.engine, engineVersion: manifest.source.engineVersion, assetSha256: manifest.source.assetSha256 },
    interchangeFormat: manifest.interchange.format,
    dependencyCount: manifest.dependencies?.length ?? 0,
    validatedByParseAssetInterchangeManifest: true,
    note: "built from the REAL asset_export tool result through the M3.4 pure facility (fail-closed); persisted by the journey's orchestration layer — the in-app turns perform the engine work",
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  return 0;
}

const mode = argv[0] ?? "plan";
if (mode === "build-manifest") {
  process.exit(runBuildManifestMode());
}
if (mode !== "plan") {
  process.stderr.write(`unknown mode ${mode} (expected: plan | build-manifest)\n`);
  process.exit(2);
}
process.exit(runPlanMode());
