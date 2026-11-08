#!/usr/bin/env node
/**
 * Gamos M3.4 — repeat-export reproducibility record (Worker C scope).
 *
 * The handoff rule: SAME source + SAME tool + SAME settings → SAME digest,
 * or a documented difference reason. This script runs the REAL Blender
 * exporter (the blender-engine-plugin's REAL execution layer) TWICE against
 * the SAME bootstrapped source scene, builds BOTH interchange manifests
 * through the REAL M3.4 facility (the bundled m3-capability-cli
 * build-manifest mode — the exact facility the §11 journey persists its
 * manifest with), and writes the machine-readable comparison record.
 *
 * Honest-evidence rules:
 *   - The runtime workspace (source .blend, exported artifacts) is TEMP state
 *     and never committed — only the comparison record lands in
 *     evidence/phase-m3/reproducibility/ (the GAMOS-AUTH-0011 directive class:
 *     runtime state is never evidence).
 *   - Blender unavailability is an honest failure (exit 3) — never fabricated.
 *   - A digest difference is recorded with its byte-level analysis, not
 *     hidden: verdict "difference-documented" is an acceptable honest result
 *     ("reproducible" is not forced).
 *
 * Env:
 *   M3_CAPABILITY_CLI   path to the bundled m3-capability-cli.mjs
 *                       (esbuild scripts/gamos/m3-capability-cli.ts
 *                        --bundle --platform=node --format=esm
 *                        --outfile=/tmp/m3-capability-cli.mjs)
 *   M3_REPRO_EVIDENCE_DIR  output dir (default evidence/phase-m3/reproducibility)
 *   BLENDER_PATH        optional explicit blender executable
 *
 * Usage:
 *   node scripts/gamos/m3-reproducibility.mjs
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/* The REAL engine execution layer — the plugin's built dist (JS, resolvable
 * at runtime; the bridge root resolution requires the real dist layout). */
const PLUGIN_DIST_DIR = path.resolve(
  import.meta.dirname,
  "../../apps/zcode-cli/packages/blender-engine-plugin/dist",
);
const { assetExport, bootstrapEmptyScene, sceneModify } = await import(
  `file://${path.join(PLUGIN_DIST_DIR, "engine.js")}`
);
const { discoverBlender } = await import(`file://${path.join(PLUGIN_DIST_DIR, "discovery.js")}`);

const CLI_PATH = process.env.M3_CAPABILITY_CLI ?? "/tmp/m3-capability-cli.mjs";
const EVIDENCE_DIR =
  process.env.M3_REPRO_EVIDENCE_DIR ?? path.resolve(import.meta.dirname, "../../evidence/phase-m3/reproducibility");

/* Fixed, recorded inputs — identical for both runs. (GLTF supports upAxis
 * only: the glTF exporter has no global scale setting — plugin contract.) */
const SOURCE_OBJECT = "GamosM3Cube";
const EXPORT_FORMAT = "GLTF";
const EXPORT_INTERCHANGE = { upAxis: "y" };
const FIXED_CREATED_AT = "2026-11-08T00:00:00Z"; // deterministic manifest timestamp for the comparison
const PLAN_ID = "gamos-m3-reproducibility";

function fail(code, msg) {
  process.stderr.write(`✗ m3-reproducibility: ${msg}\n`);
  process.exit(code);
}

function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/* ---- 1. the REAL Blender (honest failure when unavailable) ---------------- */
const requested = process.env.BLENDER_PATH;
const discovery = requested
  ? { status: "available", executable: requested, rawVersion: "(explicit BLENDER_PATH)" }
  : discoverBlender();
if (discovery.status !== "available" || typeof discovery.executable !== "string") {
  fail(3, `real Blender unavailable (status=${discovery.status}, reason=${discovery.reason ?? "none"}) — the reproducibility record is NOT fabricated`);
}
const exe = discovery.executable;
console.log(`[gamos-repro] real Blender: ${exe} (${discovery.rawVersion})`);

if (!existsSync(CLI_PATH)) {
  fail(2, `M3 capability CLI not found at ${CLI_PATH} — bundle it first (see the header comment)`);
}

/* ---- 2. ONE fixed source scene (the SAME input for both exports) ---------- */
const workspace = await mkdtemp(path.join(tmpdir(), "gamos-m3-repro-"));
const blendFile = path.join(workspace, "scene.blend");
try {
  const boot = await bootstrapEmptyScene(exe, blendFile, { timeoutMs: 180_000 });
  if (!boot.ok) fail(2, `bootstrap failed: ${JSON.stringify(boot).slice(0, 400)}`);
  const modify = await sceneModify(
    exe,
    { blendFile, operations: [{ op: "add-primitive", primitive: "cube", name: SOURCE_OBJECT }], save: true },
    workspace,
    { timeoutMs: 180_000 },
  );
  if (!modify.ok) fail(2, `scene_modify failed: ${JSON.stringify(modify).slice(0, 400)}`);

  const sourceSha256 = sha256File(blendFile);
  const sourceStat = readFileSync(blendFile).length;
  console.log(`[gamos-repro] fixed source: ${blendFile} (${sourceStat} bytes, sha256=${sourceSha256})`);

  /* ---- 3. run the SAME export twice (same settings, SAME output path) ---
   * Both runs target the SAME output path — the identical operation twice.
   * Run 1's artifact is moved aside before run 2 so the byte-level comparison
   * stays possible; the manifest path field is therefore also identical
   * across runs, making BOTH the artifact digest and the manifest hash
   * meaningful determinism probes. */
  const runs = [];
  const keptArtifacts = [];
  const manifestFiles = [];
  const outputPath = path.join(workspace, "staging", "gamos-repro.glb");
  for (const run of [1, 2]) {
    const outcome = await assetExport(
      exe,
      { blendFile, outputPath, format: EXPORT_FORMAT, selection: [SOURCE_OBJECT], interchange: EXPORT_INTERCHANGE },
      workspace,
      { timeoutMs: 180_000 },
    );
    if (!outcome.ok) fail(2, `export run ${run} failed: ${JSON.stringify(outcome).slice(0, 400)}`);
    if (outcome.sourceSha256 !== sourceSha256) {
      fail(2, `export run ${run} reported a different source hash — the source was mutated: ${outcome.sourceSha256}`);
    }
    console.log(
      `[gamos-repro] run ${run}: ${outcome.bytes} bytes, sha256=${outcome.sha256} (blender ${outcome.blenderVersion})`,
    );
    const kept = path.join(workspace, "kept", "run" + run + ".glb");
    mkdirSync(path.dirname(kept), { recursive: true });
    copyFileSync(outputPath, kept);
    keptArtifacts.push(kept);

    /* Manifest through the REAL M3.4 facility (the §11 journey's exact
     * persistence path: buildExportedManifest via the bundled CLI). */
    const exportResultFile = path.join(workspace, `export-result-run${run}.json`);
    const manifestFile = path.join(workspace, `manifest-run${run}.json`);
    writeFileSync(exportResultFile, JSON.stringify(outcome, null, 2));
    const cli = spawnSync(
      process.execPath,
      [
        CLI_PATH, "build-manifest",
        "--export-result", exportResultFile,
        "--manifest-output", manifestFile,
        "--plan-id", PLAN_ID,
        "--blend-file", blendFile,
        "--workspace-root", workspace,
        "--project-identity", "gamos-m3-repro",
        "--created-at", FIXED_CREATED_AT,
      ],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    if (cli.status !== 0) {
      fail(2, `manifest build for run ${run} failed (exit ${cli.status}): ${String(cli.stderr ?? cli.stdout).slice(0, 500)}`);
    }
    const manifest = JSON.parse(cli.stdout);
    runs.push({
      run,
      blenderVersion: outcome.blenderVersion,
      artifact: { byteLength: outcome.bytes, sha256: outcome.sha256, mediaType: "model/gltf-binary" },
      appliedInterchange: outcome.appliedInterchange,
      dependentFileCount: Array.isArray(outcome.dependentFiles) ? outcome.dependentFiles.length : 0,
      manifest: {
        manifestId: manifest.manifestId,
        status: manifest.status,
        artifactSha256: manifest.artifact.sha256,
        manifestSha256: manifest.manifestSha256 ?? null,
      },
      manifestFileSha256: sha256File(manifestFile),
    });
    manifestFiles.push(manifestFile);
  }

  /* ---- 4. the comparison (digests equal, or a documented difference) ----- */
  const [run1, run2] = runs;
  const digestsEqual = run1.artifact.sha256 === run2.artifact.sha256;
  const byteLengthsEqual = run1.artifact.byteLength === run2.artifact.byteLength;
  const manifestsEqual = run1.manifestFileSha256 === run2.manifestFileSha256;

  /* field-level manifest diff when the manifests differ (the documented
   * difference reason — never a hand-waved "they differ") */
  const manifestFieldDiff = [];
  if (!manifestsEqual) {
    const m1 = JSON.parse(readFileSync(manifestFiles[0], "utf8"));
    const m2 = JSON.parse(readFileSync(manifestFiles[1], "utf8"));
    const walk = (a, b, at) => {
      if (JSON.stringify(a) === JSON.stringify(b)) return;
      if (a && b && typeof a === "object" && typeof b === "object") {
        const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
        for (const k of keys) walk(a[k], b[k], at ? `${at}.${k}` : k);
      } else {
        manifestFieldDiff.push({ field: at, run1: a ?? null, run2: b ?? null });
      }
    };
    walk(m1, m2, "");
  }

  let differenceReason = null;
  let firstDiff = null;
  if (!digestsEqual) {
    const a = readFileSync(keptArtifacts[0]);
    const b = readFileSync(keptArtifacts[1]);
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      if (a[i] !== b[i]) { firstDiff = i; break; }
    }
    differenceReason =
      `the two GLB exports of the identical source (sha256 ${sourceSha256}) with identical ` +
      `settings (${EXPORT_FORMAT}, interchange ${JSON.stringify(EXPORT_INTERCHANGE)}) produced different digests: ` +
      `run1 ${run1.artifact.byteLength}B/${run1.artifact.sha256.slice(0, 16)}… vs run2 ` +
      `${run2.artifact.byteLength}B/${run2.artifact.sha256.slice(0, 16)}…` +
      (firstDiff === null ? " (files agree up to the shorter length but differ in length)" : ` (first differing byte at offset ${firstDiff})`) +
      ` — recorded as an honest difference, NOT forced to reproducible`;
  } else if (!manifestsEqual) {
    differenceReason =
      `the artifact digests are identical but the emitted manifests differ in: ` +
      `${manifestFieldDiff.map((d) => d.field).join(", ") || "(no field-level diff found — serialization-level)"} ` +
      `— recorded as an honest difference with the field-level values in manifestFieldDiff`;
  }

  const verdict = digestsEqual && manifestsEqual ? "reproducible" : "difference-documented";
  const record = {
    schema: "gamos/m3-repeat-export-reproducibility@1",
    recordedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    facility: {
      exporter: "blender-engine-plugin asset_export (the REAL Blender execution layer; spawn, no shell)",
      manifestBuilder: "gamos-domain buildExportedManifest (gamos/asset-interchange@1) via the bundled m3-capability-cli build-manifest mode — the §11 journey's exact persistence facility",
      capabilityCliPath: CLI_PATH,
      capabilityCliSha256: sha256File(CLI_PATH),
      blenderExecutable: exe,
      blenderRawVersion: discovery.rawVersion,
      blenderVersion: runs[0]?.blenderVersion ?? null,
    },
    input: {
      sourceAsset: {
        path: "scene.blend",
        byteLength: sourceStat,
        sha256: sourceSha256,
        objectSelection: [SOURCE_OBJECT],
        creation: "bootstrapEmptyScene + sceneModify(add_primitive cube GamosM3Cube) — one fixed source consumed by BOTH runs",
      },
      exportSettings: {
        format: EXPORT_FORMAT,
        interchange: EXPORT_INTERCHANGE,
        note: "identical settings for both runs — the only difference is the output path",
      },
      manifestSettings: { planId: PLAN_ID, projectIdentity: "gamos-m3-repro", createdAt: FIXED_CREATED_AT },
    },
    runs,
    comparison: {
      sameOutputPath: true,
      artifactDigestsEqual: digestsEqual,
      artifactByteLengthsEqual: byteLengthsEqual,
      manifestFilesEqual: manifestsEqual,
      manifestFieldDiff,
      firstDifferingByteOffset: firstDiff,
      differenceReason,
    },
    verdict,
  };

  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const outPath = path.join(EVIDENCE_DIR, "m3-repeat-export-reproducibility.json");
  writeFileSync(outPath, JSON.stringify(record, null, 2) + "\n");
  console.log(`[gamos-repro] verdict: ${verdict}`);
  if (differenceReason) console.log(`[gamos-repro] ${differenceReason}`);
  console.log(`[gamos-repro] record written: ${outPath}`);
  process.exit(0);
} finally {
  await rm(workspace, { recursive: true, force: true });
}
