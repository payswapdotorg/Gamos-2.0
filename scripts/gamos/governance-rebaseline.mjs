#!/usr/bin/env node
/**
 * Gamos governance re-baselining tool (v2).
 *
 * The ONLY sanctioned way to change governance control files:
 *   1. Edit the control file(s) / add authorization entries (complete schema,
 *      content_sha256 may be "AUTO" and will be filled from the working tree).
 *   2. Run this tool: it recomputes baseline.controls (sha256 of every
 *      control_files path in .gamos-protected-surfaces.json), optionally
 *      writes the new trust-anchor pin into .github/workflows/gamos-governance.yml,
 *      then re-runs the verifier to prove the new state is consistent.
 *   3. Open a PR: branch rulesets require code-owner review for control paths
 *      (ADR-0004 — an actor with push access could forge a consistent state;
 *      review + rulesets are the outer control).
 *
 * Always prints a machine-readable line:  BASELINE_SHA256=<sha256 of new baseline>
 * (printed BEFORE verification so callers can capture it even when the
 *  subsequent verification fails).
 *
 * Usage:
 *   node scripts/gamos/governance-rebaseline.mjs [--root DIR] [--fill-auto] [--write-workflow-pin]
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const SELF_DIR = dirname(fileURLToPath(import.meta.url));

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

const ROOT = resolve(argValue("--root") ?? dirname(dirname(SELF_DIR)));
const FILL_AUTO = process.argv.includes("--fill-auto");
const WRITE_PIN = process.argv.includes("--write-workflow-pin");

const WORKFLOW = ".github/workflows/gamos-governance.yml";
const LEDGER = ".gamos-authorized-modifications.json";
const BASELINE = ".gamos-architecture-baseline.json";
const SURFACES = ".gamos-protected-surfaces.json";

function fail(msg) {
  console.error(`✗ rebaseline: ${msg}`);
  process.exit(2);
}

function readJson(path) {
  const full = join(ROOT, path);
  if (!existsSync(full)) fail(`missing required manifest: ${path}`);
  try {
    return JSON.parse(readFileSync(full, "utf8"));
  } catch (err) {
    fail(`${path}: invalid JSON — ${err.message}`);
  }
}

function writeJson(path, obj) {
  writeFileSync(join(ROOT, path), JSON.stringify(obj, null, 2) + "\n");
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(join(ROOT, path))).digest("hex");
}

const surfaces = readJson(SURFACES);
const controlFiles = Array.isArray(surfaces.control_files) ? surfaces.control_files : [];
if (controlFiles.length === 0) fail("surfaces.control_files is empty — nothing to re-baseline");

// ---- fill AUTO content hashes in the ledger
if (FILL_AUTO) {
  const ledger = readJson(LEDGER);
  let filled = 0;
  for (const entry of ledger.entries ?? []) {
    if (!Array.isArray(entry.changes)) continue;
    for (const c of entry.changes) {
      if (c.content_sha256 === "AUTO") {
        if (c.path === LEDGER) {
          fail(
            `entry ${entry.id}: self-referential — the ledger cannot record its own content hash ` +
              `(it is protected by baseline.controls); remove this change entry`
          );
        }
        if (!existsSync(join(ROOT, c.path))) fail(`--fill-auto: ${c.path} does not exist in the working tree`);
        c.content_sha256 = sha256File(c.path);
        filled++;
      }
    }
  }
  writeJson(LEDGER, ledger);
  console.log(`  · filled ${filled} AUTO content hashes in the ledger`);
}

// ---- recompute controls
const controls = {};
for (const path of controlFiles) {
  const full = join(ROOT, path);
  if (!existsSync(full)) fail(`control file missing, refusing to re-baseline: ${path}`);
  controls[path] = sha256File(path);
}

const baseline = readJson(BASELINE);
baseline.governance_version = 2;
baseline.controls = controls;
writeJson(BASELINE, baseline);

const pin = sha256File(BASELINE);
console.log(`  · re-baselined ${Object.keys(controls).length} control hashes`);

// ---- optionally write the trust-anchor pin into the workflow
if (WRITE_PIN) {
  const wfPath = join(ROOT, WORKFLOW);
  if (!existsSync(wfPath)) {
    console.error(`  ! workflow not found (${WORKFLOW}) — pin not written (fixture mode)`);
  } else {
    const before = readFileSync(wfPath, "utf8");
    const after = before.replace(
      /(GAMOS_BASELINE_SHA256:\s*)(["'])[\x21-\x7e]*?\2/,
      `GAMOS_BASELINE_SHA256: "${pin}"`
    );
    if (after === before && !before.includes(`GAMOS_BASELINE_SHA256: "${pin}"`)) {
      fail(`could not update GAMOS_BASELINE_SHA256 in ${WORKFLOW} (env line not found)`);
    }
    writeFileSync(wfPath, after);
    console.log(`  · workflow trust anchor updated to ${pin.slice(0, 16)}…`);
  }
}

console.log(`BASELINE_SHA256=${pin}`);

// ---- prove the new state is internally consistent (unpinned local verification)
const verify = spawnSync(process.execPath, [join(SELF_DIR, "governance-check.mjs"), "--root", ROOT], {
  encoding: "utf8",
});
if (verify.stdout) process.stdout.write(verify.stdout);
if (verify.stderr) process.stderr.write(verify.stderr);
if (verify.status !== 0) {
  console.error(`✗ rebaseline: new state failed self-verification (exit ${verify.status})`);
  process.exit(verify.status ?? 1);
}
console.log(`✓ rebaseline complete — new baseline is consistent; commit it and open a TL-reviewed PR.`);
