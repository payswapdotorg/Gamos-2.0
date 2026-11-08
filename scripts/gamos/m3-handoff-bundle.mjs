#!/usr/bin/env node
/**
 * Gamos M3.4 — the cross-engine handoff-record bundle (Worker C scope).
 *
 * Derives the single hash-bound handoff chain across engines from the
 * COMMITTED §11 journey evidence (the authoritative stage details — the
 * chunked-run summary block may be null; the stage rows are the record),
 * re-verifies the integrity chain (fail-closed), and writes the bundle:
 *
 *   plan → permission-gate → source → export → manifest → integration →
 *   build → runtime-verification (THE ORIGINAL ZCODE BROWSER) →
 *   cancellation → unity-import (honestly-unavailable)
 *
 * Hash-chain rule (handoff §6 / contract 08): the exported artifact digest is
 * the anchor — the manifest's artifact record, the staged Babylon asset and
 * the registry entry must all carry the SAME sha256 (matchesIntegrity class);
 * every deviation breaks the bundle (exit 1, verdict "broken").
 *
 * Honest-evidence rules: the Unity leg is recorded as honestly-unavailable
 * (never fabricated as a verified hop); the reproducibility input may be
 * "reproducible" OR "difference-documented" — both are honest outcomes and
 * the bundle records which.
 *
 * Env:
 *   M3_JOURNEY_EVIDENCE  default evidence/phase-m3/journey/m3-journey-evidence.json
 *   M3_PLAN_EVIDENCE     default evidence/phase-m3/journey/m3-capability-plan.json
 *   M3_REPRO_EVIDENCE    default evidence/phase-m3/reproducibility/m3-repeat-export-reproducibility.json
 *   M3_BUNDLE_OUTPUT     default evidence/phase-m3/handoff/m3-cross-engine-handoff-bundle.json
 */
import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const JOURNEY =
  process.env.M3_JOURNEY_EVIDENCE ?? path.join(ROOT, "evidence/phase-m3/journey/m3-journey-evidence.json");
const PLAN =
  process.env.M3_PLAN_EVIDENCE ?? path.join(ROOT, "evidence/phase-m3/journey/m3-capability-plan.json");
const REPRO =
  process.env.M3_REPRO_EVIDENCE ??
  path.join(ROOT, "evidence/phase-m3/reproducibility/m3-repeat-export-reproducibility.json");
const OUTPUT =
  process.env.M3_BUNDLE_OUTPUT ??
  path.join(ROOT, "evidence/phase-m3/handoff/m3-cross-engine-handoff-bundle.json");

function fail(msg) {
  process.stderr.write(`✗ m3-handoff-bundle: ${msg}\n`);
  process.exit(1);
}

function readJson(file) {
  if (!existsSync(file)) fail(`required evidence file missing: ${path.relative(ROOT, file)}`);
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    fail(`${path.relative(ROOT, file)}: invalid JSON — ${error.message}`);
  }
}

function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

const journey = readJson(JOURNEY);
const plan = readJson(PLAN);
const repro = readJson(REPRO);

/* ---- the authoritative stage rows -------------------------------------- */
const stages = journey.stages ?? {};
const m3j4 = stages.M3J4?.detail;
const m3j5 = stages.M3J5?.detail;
if (!m3j4 || typeof m3j4 !== "object") fail("journey evidence has no M3J4 stage detail (the cross-engine pipeline leg)");
if (!m3j5 || typeof m3j5 !== "object") fail("journey evidence has no M3J5 stage detail (the Unity honest-failure leg)");

const denial = m3j4.denial_leg ?? {};
const exportLeg = m3j4.export_leg ?? {};
const manifestLeg = m3j4.manifest_leg ?? {};
const integrateLeg = m3j4.integrate_leg ?? {};
const buildRunLeg = m3j4.build_run_leg ?? {};
const browser = m3j4.browser_verification ?? {};
const cancellation = m3j4.cancellation ?? {};
const integratedAsset = browser.integrated_asset ?? {};
const assertions = browser.assertions ?? {};
const integrateOut = integrateLeg.integrate_output ?? {};

/* ---- cross-check against the summary block when the run filled it ------ */
const summaryBlock = journey.m3?.cross_engine_journey ?? null;
if (summaryBlock?.interchange_manifest) {
  if (summaryBlock.interchange_manifest.sha256 !== manifestLeg.sha256) {
    fail(
      `the journey summary block and the M3J4 manifest leg disagree on the manifest sha256 ` +
        `(${summaryBlock.interchange_manifest.sha256} vs ${manifestLeg.sha256})`,
    );
  }
}

/* ---- the hops ----------------------------------------------------------- */
const exportArtifact = exportLeg.export_artifact ?? {};
const exportSha = String(exportArtifact.sha256 ?? "");
if (!/^[0-9a-f]{64}$/.test(exportSha)) fail("the M3J4 export leg has no 64-hex artifact digest");

const hops = [
  {
    id: "plan",
    engine: "core",
    record: {
      evidenceFile: path.relative(ROOT, PLAN),
      evidenceSha256: sha256File(PLAN),
      planVerdict: plan.verdict,
      planStepCount: plan.plan?.steps?.length ?? null,
      planResourceClaimCount: plan.plan?.resourceClaimCount ?? null,
      validatedByParseGamePlan: plan.plan?.validatedByParseGamePlan ?? null,
    },
    status: plan.verdict === "ok" ? "verified" : "broken",
    verifiedBy: "the bundled m3-capability-cli plan mode (registry resolution + engine-aware GamePlan; evidence/phase-m3/journey/m3-capability-plan.json)",
  },
  {
    id: "permission-gate",
    engine: "blender",
    record: {
      denial_blocked_mutation: denial.blend_sha256_unchanged === true,
      export_artifact_absent_after_denial: denial.export_artifact_absent === true,
      baseline_blend_sha256: exportLeg.baseline_blend_sha256 ?? null,
    },
    status: denial.blend_sha256_unchanged === true && denial.export_artifact_absent === true ? "verified" : "broken",
    verifiedBy: "the M3J4 denial leg: the source mutation was blocked at the existing permission gate (blend sha256 unchanged, no staging artifact)",
  },
  {
    id: "source",
    engine: "blender",
    record: {
      saved_blend_sha256: exportLeg.saved_blend_sha256 ?? null,
      blend_mutated_by_approved_scene_modify: exportLeg.blend_mutated === true,
    },
    status: /^[0-9a-f]{64}$/.test(String(exportLeg.saved_blend_sha256 ?? "")) ? "verified" : "broken",
    verifiedBy: "the approved real scene_modify (GamosM3Cube) — the saved .blend digest recorded pre-export",
  },
  {
    id: "export",
    engine: "blender",
    record: {
      artifact: {
        path: path.basename(String(exportArtifact.path ?? "")),
        byteLength: exportArtifact.bytes ?? null,
        sha256: exportSha,
        mediaType: "model/gltf-binary",
      },
    },
    status: "verified",
    verifiedBy: "the real asset_export through the app's MCP plugin path (REAL Blender 4.1.1 execution layer)",
  },
  {
    id: "manifest",
    engine: "core",
    record: {
      manifestId: manifestLeg.manifestId ?? null,
      status: manifestLeg.status ?? null,
      manifest_sha256: manifestLeg.sha256 ?? null,
      artifact: manifestLeg.artifact ?? null,
      builtFrom: manifestLeg.builtFrom ?? null,
    },
    status:
      manifestLeg.status === "exported" &&
      manifestLeg.artifact?.sha256 === exportSha &&
      manifestLeg.artifact?.byteLength === exportArtifact.bytes
        ? "verified"
        : "broken",
    verifiedBy: "the M3.4 facility (buildExportedManifest, gamos/asset-interchange@1) from the AUTHORITATIVE session-store tool output; artifact integrity must match the export digest",
  },
  {
    id: "integration",
    engine: "babylon",
    record: {
      manifest_read_through_app_read_tool: integrateLeg.manifest_read_through_app_read_tool === true,
      integrated: integrateOut.integrated === true,
      staged_asset: {
        assetName: integrateOut.assetName ?? null,
        file: integrateOut.registryEntry?.file ?? null,
        byteLength: integrateOut.bytes ?? null,
        sha256: integrateOut.sha256 ?? null,
        matches_export: integrateOut.sha256 === exportSha && integrateOut.bytes === exportArtifact.bytes,
      },
      registry_entry: integrateOut.registryEntry ?? null,
    },
    status:
      integrateLeg.manifest_read_through_app_read_tool === true &&
      integrateOut.integrated === true &&
      integrateOut.sha256 === exportSha &&
      integrateOut.registryEntry?.sha256 === exportSha
        ? "verified"
        : "broken",
    verifiedBy: "the in-app manifest Read + asset_integrate fail-closed expectedIntegrity (staged GLB sha256 === export sha256; the committed registry entry carries the export hash)",
  },
  {
    id: "build",
    engine: "babylon",
    record: {
      dist: {
        file: path.basename(String(buildRunLeg.dist?.path ?? "")),
        sha256: buildRunLeg.dist?.sha256 ?? null,
      },
    },
    status: /^[0-9a-f]{64}$/.test(String(buildRunLeg.dist?.sha256 ?? "")) ? "verified" : "broken",
    verifiedBy: "the real vite build of the Babylon project consuming the integrated asset",
  },
  {
    id: "runtime-verification",
    engine: "babylon",
    record: {
      runtime_url: buildRunLeg.runtime?.url ?? null,
      assertions: {
        url_matches_runtime: assertions.url_matches_runtime === true,
        babylon_ready_flag: assertions.babylon_ready_flag === true,
        integrated_asset_loaded: assertions.integrated_asset_loaded === true,
        integrated_assets_ready: assertions.integrated_assets_ready === true,
        integrated_asset_no_error: assertions.integrated_asset_no_error === true,
      },
      integrated_asset: {
        assetName: integratedAsset.assetName ?? null,
        meshNames: integratedAsset.meshNames ?? null,
        vertices: integratedAsset.vertices ?? null,
      },
    },
    status:
      assertions.integrated_asset_loaded === true &&
      assertions.integrated_assets_ready === true &&
      assertions.integrated_asset_no_error === true
        ? "verified"
        : "broken",
    verifiedBy: "THE ORIGINAL ZCODE BROWSER in-guest reads on the running experience (meshNames + vertices of the INTEGRATED Blender-authored asset)",
  },
  {
    id: "cancellation",
    engine: "babylon",
    record: {
      stop_submitted: cancellation.stop_submitted === true,
      stop_verified: cancellation.stop_verified === true,
    },
    status: cancellation.stop_verified === true ? "verified" : "broken",
    verifiedBy: "project_stop cancellation (the runtime URL verified dead after stop)",
  },
  {
    id: "unity-import",
    engine: "unity",
    record: {
      outcome: m3j5.outcome ?? null,
      honest_unavailable_seen: m3j5.honest_unavailable_seen === true,
    },
    status: m3j5.honest_unavailable_seen === true ? "honestly-unavailable" : "broken",
    verifiedBy: "the structured unity-editor-unavailable state surfaced by the typed asset_import attempt on the REAL cross-engine artifact (M3-G1 stays blocked — never fabricated)",
  },
];

/* ---- the hash chain ------------------------------------------------------ */
const chain = {
  anchor: "the exported artifact digest (blender/asset.export)",
  exportArtifactSha256: exportSha,
  manifestArtifactSha256MatchesExport: manifestLeg.artifact?.sha256 === exportSha,
  stagedAssetSha256MatchesExport: integrateOut.sha256 === exportSha,
  registryEntrySha256MatchesExport: integrateOut.registryEntry?.sha256 === exportSha,
  integratedAssetConsumedInRunningBrowser:
    assertions.integrated_asset_loaded === true && assertions.integrated_assets_ready === true,
};
const chainIntact =
  chain.manifestArtifactSha256MatchesExport &&
  chain.stagedAssetSha256MatchesExport &&
  chain.registryEntrySha256MatchesExport &&
  chain.integratedAssetConsumedInRunningBrowser;

const broken = hops.filter((hop) => hop.status === "broken");
const journeyVerdict = journey.summary?.verdict ?? null;
const reproVerdict = repro.verdict ?? null;

const verdict =
  journeyVerdict === "pass" && chainIntact && broken.length === 0 && (reproVerdict === "reproducible" || reproVerdict === "difference-documented")
    ? "handoff-chain-verified"
    : "broken";

const bundle = {
  schema: "gamos/m3-cross-engine-handoff-bundle@1",
  recordedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  derivedFrom: [
    { path: path.relative(ROOT, JOURNEY), sha256: sha256File(JOURNEY) },
    { path: path.relative(ROOT, PLAN), sha256: sha256File(PLAN) },
    { path: path.relative(ROOT, REPRO), sha256: sha256File(REPRO) },
  ],
  journeyVerdict,
  hops,
  hashChain: chain,
  reproducibility: {
    path: path.relative(ROOT, REPRO),
    sha256: sha256File(REPRO),
    verdict: reproVerdict,
    sameSourceToolSettings: repro.comparison?.artifactDigestsEqual === true,
    differenceReason: repro.comparison?.differenceReason ?? null,
  },
  verdict,
};

mkdirSync(path.dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, JSON.stringify(bundle, null, 2) + "\n");

/* machine-readable CI lines */
console.log(`[gamos-bundle] journey verdict: ${journeyVerdict}`);
console.log(
  `[gamos-bundle] hash chain: export=${exportSha.slice(0, 16)}… manifest-match=${chain.manifestArtifactSha256MatchesExport} staged-match=${chain.stagedAssetSha256MatchesExport} registry-match=${chain.registryEntrySha256MatchesExport}`,
);
console.log(`[gamos-bundle] hops: ${hops.map((h) => `${h.id}=${h.status}`).join(" ")}`);
console.log(`[gamos-bundle] reproducibility: ${reproVerdict}`);
console.log(`[gamos-bundle] verdict: ${verdict}`);
console.log(`[gamos-bundle] bundle written: ${path.relative(ROOT, OUTPUT)}`);

if (verdict !== "handoff-chain-verified") {
  if (broken.length > 0) fail(`broken hops: ${broken.map((h) => h.id).join(", ")}`);
  if (journeyVerdict !== "pass") fail(`journey verdict is ${journeyVerdict}`);
  if (!chainIntact) fail("the artifact integrity chain is broken (manifest/staged/registry digests disagree)");
  if (reproVerdict !== "reproducible" && reproVerdict !== "difference-documented") {
    fail(`the reproducibility record verdict is ${reproVerdict}`);
  }
  fail("bundle is broken");
}
process.exit(0);
