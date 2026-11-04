#!/usr/bin/env node
/**
 * Gamos governance self-test — tamper rejection suite.
 *
 * Proves (see docs/gamos/ADR/0004) that the verifier rejects:
 *   1.  pristine repository — control case (must pass)                   exit 0
 *   2.  unauthorized upstream modification                              [UNAUTHORIZED_MODIFY]
 *   3.  unauthorized upstream deletion                                  [UNAUTHORIZED_DELETE]
 *   4.  missing protected file (hard requirement)                      [MISSING_REQUIRED, UNAUTHORIZED_DELETE]
 *   5.  modified baseline SHA (trust-anchor pin stale)                  [PIN_MISMATCH]
 *   6.  forged baseline SHA without pin (tag cross-check catches it)   [BASELINE_TAG_MISMATCH]
 *   7.  modified protected-surface list                                 [CONTROL_HASH]
 *   8.  weakened governance verifier                                    [CONTROL_HASH]
 *   9.  incomplete authorization record (truthy tl_approval only)       [AUTH_SCHEMA]
 *   10. incomplete authorization record (object, missing evidence)     [AUTH_SCHEMA]
 *   11. authorized change with complete evidence — control case        exit 0
 *   12. authorization content drift (approved hash ≠ actual)           [AUTH_DRIFT]
 *   13. history rewrite (pinned baseline not an ancestor)               [HISTORY_REWRITE]
 *
 * Every scenario runs against a synthetic git repository built in a temp
 * dir, with a copy of the real verifier — no network, no shared state.
 * Exit code 0 iff every scenario behaves as expected.
 */
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  copyFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SELF_DIR = dirname(fileURLToPath(import.meta.url));
const REAL_CHECK = join(SELF_DIR, "governance-check.mjs");
const REAL_REBASELINE = join(SELF_DIR, "governance-rebaseline.mjs");
const FIXTURE_TAG = "v0-fixture";
const NOW = new Date().toISOString().replace(/\.\d+Z$/, "Z");

const TMP = mkdtempSync(join(tmpdir(), "gamos-gov-selftest-"));

function sha256File(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

function git(root, ...args) {
  const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${(r.stderr || "").trim()}`);
  return r.stdout;
}

/** Build a synthetic repo: upstream baseline -> governance controls. */
function buildFixture(name) {
  const root = join(TMP, name);
  mkdirSync(join(root, "src"), { recursive: true });
  git(root, "init", "-b", "main");
  git(root, "config", "user.email", "fixture@example.invalid");
  git(root, "config", "user.name", "Fixture TL");

  writeFileSync(join(root, "LICENSE"), "Fixture upstream license text.\n");
  writeFileSync(join(root, "NOTICE.md"), "Fixture upstream notice.\n");
  writeFileSync(join(root, "src", "core.ts"), "export const core = 1;\n");
  writeFileSync(join(root, "src", "ui.ts"), "export const ui = 2;\n");
  git(root, "add", "-A");
  git(root, "commit", "-m", "upstream baseline");
  git(root, "tag", FIXTURE_TAG);
  const pinnedSha = git(root, "rev-parse", "HEAD").trim();

  // governance layer — copy of the REAL verifier under test
  mkdirSync(join(root, "scripts", "gamos"), { recursive: true });
  copyFileSync(REAL_CHECK, join(root, "scripts", "gamos", "governance-check.mjs"));

  const surfaces = {
    version: 2,
    mode: "baseline-tree",
    description: "fixture protected surfaces",
    baseline_sha: pinnedSha,
    control_files: [
      ".gamos-protected-surfaces.json",
      ".gamos-authorized-modifications.json",
      "scripts/gamos/governance-check.mjs",
    ],
    hard_requirements: { must_exist: ["LICENSE", "NOTICE.md", "src/core.ts"], notes: "fixture" },
    identifier_freeze: ["fixture/*"],
  };
  const ledger = { version: 2, schema: "gamos/authorization@2", description: "fixture ledger", entries: [] };
  writeFileSync(join(root, ".gamos-protected-surfaces.json"), JSON.stringify(surfaces, null, 2) + "\n");
  writeFileSync(join(root, ".gamos-authorized-modifications.json"), JSON.stringify(ledger, null, 2) + "\n");

  const controls = {};
  for (const p of surfaces.control_files) controls[p] = sha256File(join(root, p));
  const baseline = {
    version: 2,
    governance_version: 2,
    product: "gamos-fixture",
    fork: { destination: "fixture/fixture", upstream_url: "fixture://upstream" },
    baseline: { pinned_sha: pinnedSha, upstream_tag: FIXTURE_TAG },
    governance: { approvers: ["fixture-tl"], authorization_schema: "gamos/authorization@2" },
    controls,
  };
  writeFileSync(join(root, ".gamos-architecture-baseline.json"), JSON.stringify(baseline, null, 2) + "\n");

  git(root, "add", "-A");
  git(root, "commit", "-m", "gamos governance init");

  return { root, pin: sha256File(join(root, ".gamos-architecture-baseline.json")) };
}

function readJson(root, path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

function writeJson(root, path, obj) {
  writeFileSync(join(root, path), JSON.stringify(obj, null, 2) + "\n");
}

function runVerifier(root, pin) {
  const args = [REAL_CHECK, "--root", root];
  if (pin) args.push("--pin", pin);
  const r = spawnSync(process.execPath, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  return { code: r.status ?? -1, out: `${r.stdout || ""}\n${r.stderr || ""}` };
}

function runRebaselineFillAuto(root) {
  const r = spawnSync(process.execPath, [REAL_REBASELINE, "--root", root, "--fill-auto"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const m = (r.stdout || "").match(/BASELINE_SHA256=([0-9a-f]{64})/);
  return { code: r.status ?? -1, out: `${r.stdout || ""}\n${r.stderr || ""}`, pin: m ? m[1] : null };
}

function validEntry(overrides = {}, change = {}) {
  return {
    id: "GAMOS-AUTH-0001",
    phase: "M0",
    date: NOW,
    requester: { login: "fixture-worker", role: "engine-worker" },
    rationale: "Fixture scenario: legitimate authorized modification with complete evidence.",
    risk: "low",
    affected_functionality: "src/core.ts export",
    new_functionality: "src/core.ts export v2",
    regression_tests: ["node scripts/gamos/governance-check.mjs"],
    evidence: { summary: "self-test fixture evidence", links: ["fixture://self-test"] },
    changes: [
      { action: "modify", path: "src/core.ts", content_sha256: "AUTO", ...change },
    ],
    tl_approval: {
      approved: true,
      approver: "fixture-tl",
      date: NOW,
      decision_ref: "fixture review #1",
    },
    ...overrides,
  };
}

/** Append content to a file, making the modification visible to git. */
function appendFile(root, path, text) {
  const prev = readFileSync(join(root, path), "utf8");
  writeFileSync(join(root, path), prev + text);
}

const results = [];

function scenario(num, name, fn, { wantExit, wantCodes = [], withPin = true } = {}) {
  let ok = true;
  const detail = [];
  try {
    const fx = buildFixture(`scenario-${num}`);
    fn(fx);
    const r = runVerifier(fx.root, withPin ? fx.pin : null);
    const codes = [...new Set((r.out.match(/\[[A-Z_]+\]/g) ?? []).map((s) => s.slice(1, -1)))];
    if (wantExit === 0 && r.code !== 0) {
      ok = false;
      detail.push(`expected exit 0, got ${r.code}`);
    }
    if (wantExit !== 0 && r.code === 0) {
      ok = false;
      detail.push(`expected failure (exit ${wantExit}), but the verifier ACCEPTED the tampered state`);
    }
    for (const c of wantCodes) {
      if (!codes.includes(c)) {
        ok = false;
        detail.push(`expected violation [${c}], found only [${codes.join(", ") || "none"}]`);
      }
    }
    results.push({ num, name, ok, wantExit, got: r.code, codes, detail });
    console.log(
      `${ok ? "ok  " : "FAIL"} ${String(num).padStart(2, " ")} - ${name}` +
        (ok ? "" : ` — ${detail.join("; ")}`)
    );
  } catch (err) {
    results.push({ num, name, ok: false, wantExit, got: -1, codes: [], detail: [err.message] });
    console.log(`FAIL ${String(num).padStart(2, " ")} - ${name} — ${err.message}`);
  }
}

const commitAll = (fx, msg) => {
  git(fx.root, "add", "-A");
  git(fx.root, "commit", "-m", msg);
};

// ------------------------------------------------------------------ scenarios
console.log(`# Gamos governance self-test — tamper rejection suite (fixture root: ${TMP})`);

scenario(1, "pristine repository — control case (must pass)", () => {}, { wantExit: 0 });

scenario(
  2,
  "unauthorized upstream modification is rejected",
  (fx) => {
    appendFile(fx.root, "src/core.ts", "// tampered without authorization\n");
    commitAll(fx, "tamper");
  },
  { wantExit: 1, wantCodes: ["UNAUTHORIZED_MODIFY"] }
);

scenario(
  3,
  "unauthorized upstream deletion is rejected",
  (fx) => {
    rmSync(join(fx.root, "src/ui.ts"));
    commitAll(fx, "tamper");
  },
  { wantExit: 1, wantCodes: ["UNAUTHORIZED_DELETE"] }
);

scenario(
  4,
  "missing protected file (hard requirement) is rejected",
  (fx) => {
    rmSync(join(fx.root, "LICENSE"));
    commitAll(fx, "tamper");
  },
  { wantExit: 1, wantCodes: ["MISSING_REQUIRED", "UNAUTHORIZED_DELETE"] }
);

scenario(
  5,
  "modified baseline SHA (trust-anchor pin stale) is rejected",
  (fx) => {
    const b = readJson(fx.root, ".gamos-architecture-baseline.json");
    b.baseline.pinned_sha = "0".repeat(40);
    writeJson(fx.root, ".gamos-architecture-baseline.json", b);
  },
  { wantExit: 1, wantCodes: ["PIN_MISMATCH"], withPin: true }
);

scenario(
  6,
  "forged baseline SHA without pin is caught by the upstream-tag cross-check",
  (fx) => {
    const b = readJson(fx.root, ".gamos-architecture-baseline.json");
    b.baseline.pinned_sha = "0".repeat(40);
    writeJson(fx.root, ".gamos-architecture-baseline.json", b);
  },
  { wantExit: 1, wantCodes: ["BASELINE_TAG_MISMATCH"], withPin: false }
);

scenario(
  7,
  "modified protected-surface list is rejected",
  (fx) => {
    const s = readJson(fx.root, ".gamos-protected-surfaces.json");
    s.hard_requirements.must_exist = ["LICENSE"]; // weakened surface policy
    writeJson(fx.root, ".gamos-protected-surfaces.json", s);
  },
  { wantExit: 1, wantCodes: ["CONTROL_HASH"] }
);

scenario(
  8,
  "weakened governance verifier is rejected",
  (fx) => {
    const v = join(fx.root, "scripts", "gamos", "governance-check.mjs");
    const src = readFileSync(v, "utf8");
    writeFileSync(v, `process.exit(0); // weakened verifier\n${src}`);
  },
  { wantExit: 1, wantCodes: ["CONTROL_HASH"] }
);

scenario(
  9,
  "truthy tl_approval alone is NOT sufficient authorization",
  (fx) => {
    appendFile(fx.root, "src/core.ts", "// modified relying on a truthy tl_approval\n");
    const ledger = readJson(fx.root, ".gamos-authorized-modifications.json");
    ledger.entries.push({ ...validEntry(), tl_approval: true });
    writeJson(fx.root, ".gamos-authorized-modifications.json", ledger);
    commitAll(fx, "tamper with truthy-only approval");
  },
  { wantExit: 1, wantCodes: ["AUTH_SCHEMA"] }
);

scenario(
  10,
  "authorization record missing evidence + decision_ref is rejected",
  (fx) => {
    appendFile(fx.root, "src/core.ts", "// modified with an incomplete record\n");
    const ledger = readJson(fx.root, ".gamos-authorized-modifications.json");
    const e = validEntry();
    delete e.evidence;
    e.tl_approval = { approved: true, approver: "fixture-tl", date: NOW }; // no decision_ref
    ledger.entries.push(e);
    writeJson(fx.root, ".gamos-authorized-modifications.json", ledger);
    commitAll(fx, "tamper with incomplete record");
  },
  { wantExit: 1, wantCodes: ["AUTH_SCHEMA"] }
);

scenario(
  11,
  "authorized change with complete evidence — control case (must pass)",
  (fx) => {
    appendFile(fx.root, "src/core.ts", "// legitimate, fully authorized change\n");
    const ledger = readJson(fx.root, ".gamos-authorized-modifications.json");
    ledger.entries.push(validEntry()); // content hash is filled below via rebaseline --fill-auto
    writeJson(fx.root, ".gamos-authorized-modifications.json", ledger);
    const rb = runRebaselineFillAuto(fx.root);
    if (rb.code !== 0 || !rb.pin) throw new Error(`rebaseline failed: exit ${rb.code}`);
    fx.pin = rb.pin; // the authorized change re-pins the trust anchor
  },
  { wantExit: 0 }
);

scenario(
  12,
  "authorization content drift (approved hash ≠ actual content) is rejected",
  (fx) => {
    appendFile(fx.root, "src/core.ts", "// content differs from what was approved\n");
    const ledger = readJson(fx.root, ".gamos-authorized-modifications.json");
    ledger.entries.push(
      validEntry({}, { content_sha256: "d".repeat(64) }) // hash of DIFFERENT content
    );
    writeJson(fx.root, ".gamos-authorized-modifications.json", ledger);
    const rb = runRebaselineFillAuto(fx.root);
    if (!rb.pin) throw new Error(`rebaseline produced no pin (exit ${rb.code})`);
    fx.pin = rb.pin; // even a re-pinned state cannot legitimize drifted content
  },
  { wantExit: 1, wantCodes: ["AUTH_DRIFT"] }
);

scenario(
  13,
  "history rewrite (pinned baseline not an ancestor of HEAD) is rejected",
  (fx) => {
    git(fx.root, "checkout", "--orphan", "rewrite");
    git(fx.root, "add", "-A");
    git(fx.root, "commit", "-m", "orphan rewrite");
  },
  { wantExit: 1, wantCodes: ["HISTORY_REWRITE"] }
);

// ------------------------------------------------------------------ report
const failed = results.filter((r) => !r.ok);
console.log(`\n1..${results.length}`);
console.log(`# ${results.length} scenarios: ${results.length - failed.length} ok, ${failed.length} failed`);
if (failed.length > 0) {
  console.error(`\nFAILED SCENARIOS:`);
  for (const f of failed) {
    console.error(`  #${f.num} ${f.name}`);
    for (const d of f.detail) console.error(`     - ${d}`);
    if (f.got === 0 && f.wantExit !== 0) console.error(`     - verifier output: ${f.codes.join(", ")}`);
  }
  process.exit(1);
}
rmSync(TMP, { recursive: true, force: true });
console.log(`# tamper-rejection suite passed — governance controls refuse unauthorized changes.`);
process.exit(0);
