#!/usr/bin/env node
/**
 * Gamos governance verifier — v2 (tamper-resistant).
 *
 * Trust model (ADR-0004):
 *   [1] The workflow (.github/workflows/gamos-governance.yml) pins
 *       sha256(.gamos-architecture-baseline.json) as GAMOS_BASELINE_SHA256.
 *       The workflow itself is guarded by CODEOWNERS + branch rulesets
 *       (CODEOWNERS cannot be recorded in the baseline it anchors — that
 *       would be circular; see ADR-0004 "trust anchor" section).
 *   [2] The baseline records sha256 of every governance control file
 *       (control_files in .gamos-protected-surfaces.json). Any change to a
 *       control file without re-baselining is rejected (CONTROL_HASH).
 *   [3] The authorization ledger (.gamos-authorized-modifications.json) uses
 *       schema gamos/authorization@2: every entry must carry a complete
 *       record (requester, rationale, risk, affected/new functionality,
 *       regression tests, evidence, per-file content hashes, and a
 *       structured tl_approval object). A truthy `tl_approval` value alone
 *       is NOT authorization.
 *   [4] Every authorized change is content-bound: sha256 of the current
 *       file must equal the recorded content_sha256 (AUTH_DRIFT otherwise).
 *   [5] The pinned upstream baseline SHA must match the upstream tag and be
 *       an ancestor of HEAD (no history rewrites).
 *
 * Checks:
 *   A. governance manifests present and parseable            (MISSING_CONTROL / CONTROL_MALFORMED)
 *   B. baseline schema v2 + approvers configured              (BASELINE_SCHEMA)
 *   C. baseline pinned by trust anchor, when --pin is given   (PIN_MISMATCH)
 *   D. control-file integrity (sha256 vs baseline.controls)    (CONTROL_HASH / CONTROL_SCHEMA)
 *   E. pinned SHA matches upstream tag + is ancestor of HEAD  (BASELINE_TAG_MISMATCH / HISTORY_REWRITE)
 *   F. hard_requirements.must_exist present                    (MISSING_REQUIRED)
 *   G. authorization ledger: complete schema for every entry   (AUTH_SCHEMA)
 *   H. authorization content binding (worktree vs recorded)   (AUTH_DRIFT)
 *   I. no unauthorized upstream deletion/modification          (UNAUTHORIZED_DELETE / UNAUTHORIZED_MODIFY)
 *
 * Exit code 0 = compliant; 1 = violations (printed with [CODE] markers).
 * Dependency-free: plain Node (>=18) + git.
 *
 * Usage:
 *   node scripts/gamos/governance-check.mjs [--root DIR] [--pin SHA256]
 *   The pin may also be provided via env GAMOS_BASELINE_PIN (CI does this).
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const SELF_DIR = dirname(fileURLToPath(import.meta.url));

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

const ROOT = resolve(argValue("--root") ?? dirname(dirname(SELF_DIR)));
const PIN = argValue("--pin") ?? process.env.GAMOS_BASELINE_PIN ?? null;

const violations = [];
const notes = [];

function violation(code, msg) {
  violations.push(`[${code}] ${msg}`);
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function git(...args) {
  const r = spawnSync("git", ["-C", ROOT, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error || r.status !== 0) {
    const why = r.error ? r.error.message : (r.stderr || "").trim() || `exit ${r.status}`;
    throw new Error(`git ${args.join(" ")} failed: ${why}`);
  }
  return r.stdout;
}

// ------------------------------------------------------------------ A. manifests
function loadJson(path, label) {
  const full = join(ROOT, path);
  if (!existsSync(full)) {
    violation("MISSING_CONTROL", `required governance manifest missing: ${path}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(full, "utf8"));
  } catch (err) {
    violation("CONTROL_MALFORMED", `${label || path}: invalid JSON — ${err.message}`);
    return null;
  }
}

const baselineManifest = loadJson(".gamos-architecture-baseline.json", "architecture baseline");
const protectedManifest = loadJson(".gamos-protected-surfaces.json", "protected surfaces");
const authManifest = loadJson(".gamos-authorized-modifications.json", "authorization ledger");

// ------------------------------------------------------------------ B. baseline schema
const AUTH_SCHEMA_ID = "gamos/authorization@2";
let approvers = [];
if (baselineManifest) {
  if (baselineManifest.governance_version !== 2) {
    violation(
      "BASELINE_SCHEMA",
      `expected governance_version 2 (tamper-resistant controls), found ${JSON.stringify(
        baselineManifest.governance_version
      )}`
    );
  }
  const gov = baselineManifest.governance ?? {};
  approvers = (gov.approvers ?? []).map((a) => String(a).toLowerCase()).filter(Boolean);
  if (approvers.length === 0) {
    violation("BASELINE_SCHEMA", "baseline.governance.approvers must list at least one TL approver login");
  }
  const pinned = baselineManifest.baseline?.pinned_sha;
  if (!/^[0-9a-f]{40}$/.test(String(pinned ?? ""))) {
    violation("BASELINE_SCHEMA", `baseline.pinned_sha must be a full 40-hex commit SHA (got ${pinned})`);
  }
}

// ------------------------------------------------------------------ C. trust anchor pin
if (baselineManifest && PIN) {
  const actual = sha256File(join(ROOT, ".gamos-architecture-baseline.json"));
  if (actual !== String(PIN).toLowerCase()) {
    violation(
      "PIN_MISMATCH",
      `trust-anchor mismatch: pinned sha256 of .gamos-architecture-baseline.json is ${String(
        PIN
      )}, but the file on disk hashes to ${actual}. The baseline was modified without re-pinning the workflow.`
    );
  }
} else if (baselineManifest) {
  notes.push("pin not provided — trust-anchor verification skipped (local mode; CI always passes --pin)");
}

// ------------------------------------------------------------------ D. control-file integrity
const CONTROL_LABEL = {
  ".gamos-protected-surfaces.json": "protected-surfaces manifest",
  ".gamos-authorized-modifications.json": "authorization ledger",
  "scripts/gamos/governance-check.mjs": "governance verifier",
  "scripts/gamos/governance-self-test.mjs": "tamper self-test",
  "scripts/gamos/governance-rebaseline.mjs": "re-baselining tool",
  ".github/CODEOWNERS": "CODEOWNERS",
};

if (protectedManifest && baselineManifest) {
  const controlFiles = Array.isArray(protectedManifest.control_files)
    ? protectedManifest.control_files
    : [];
  if (controlFiles.length === 0) {
    violation("CONTROL_SCHEMA", ".gamos-protected-surfaces.json control_files must not be empty");
  }
  const controlsMap = baselineManifest.controls ?? {};
  const recorded = new Set(Object.keys(controlsMap));
  const declared = new Set(controlFiles);
  for (const p of declared) {
    if (!recorded.has(p)) {
      violation("CONTROL_SCHEMA", `control file ${p} declared in surfaces but not recorded in baseline.controls`);
    }
  }
  for (const p of recorded) {
    if (!declared.has(p)) {
      violation("CONTROL_SCHEMA", `baseline.controls records ${p} which is not declared in surfaces control_files`);
    }
  }
  for (const [path, expected] of Object.entries(controlsMap)) {
    const full = join(ROOT, path);
    if (!existsSync(full)) {
      violation(
        "CONTROL_HASH",
        `${CONTROL_LABEL[path] ?? path}: control file missing entirely (expected sha256 ${expected})`
      );
      continue;
    }
    if (!/^[0-9a-f]{64}$/.test(String(expected))) {
      violation("CONTROL_SCHEMA", `${path}: baseline.controls value must be a 64-hex sha256 (got ${expected})`);
      continue;
    }
    const actual = sha256File(full);
    if (actual !== String(expected).toLowerCase()) {
      violation(
        "CONTROL_HASH",
        `${CONTROL_LABEL[path] ?? path} (${path}) tampered: expected sha256 ${expected}, found ${actual}. ` +
          `Governance controls may only change via scripts/gamos/governance-rebaseline.mjs with a complete authorization entry and TL review.`
      );
    }
  }
}

// ------------------------------------------------------------------ E. pinned baseline consistency
const BASELINE = baselineManifest?.baseline?.pinned_sha;
let baselineIsAncestor = true;
if (baselineManifest && BASELINE) {
  const tag = baselineManifest.baseline?.upstream_tag;
  if (tag) {
    try {
      const tagSha = git("rev-parse", `${tag}^{commit}`).trim();
      if (tagSha !== BASELINE) {
        violation(
          "BASELINE_TAG_MISMATCH",
          `baseline.pinned_sha ${BASELINE} does not match git tag ${tag} -> ${tagSha}; the pinned baseline was moved without authorization.`
        );
      }
    } catch (err) {
      violation("BASELINE_TAG_MISMATCH", `cannot resolve upstream tag ${tag}: ${err.message}`);
    }
  }
  try {
    git("merge-base", "--is-ancestor", BASELINE, "HEAD");
  } catch {
    baselineIsAncestor = false;
    violation(
      "HISTORY_REWRITE",
      `baseline ${BASELINE} is NOT an ancestor of HEAD — history rewrite or wrong branch.`
    );
  }
}

// ------------------------------------------------------------------ F. hard requirements
if (protectedManifest) {
  for (const f of protectedManifest.hard_requirements?.must_exist ?? []) {
    const full = join(ROOT, f);
    if (!existsSync(full)) {
      violation("MISSING_REQUIRED", `hard requirement missing from the tree: ${f}`);
      continue;
    }
    try {
      const tracked = git("ls-files", "--", f).trim();
      if (!tracked) {
        violation("MISSING_REQUIRED", `hard requirement not tracked by git: ${f}`);
      }
    } catch (err) {
      notes.push(`ls-files failed for ${f}: ${err.message}`);
    }
  }
}

// ------------------------------------------------------------------ G/H. authorization ledger (schema v2 + binding)
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const RISKS = new Set(["low", "medium", "high"]);
const ID_RE = /^GAMOS-AUTH-\d{4,}$/;

const authorization = new Map(); // `${action}:${path}` -> { entryId, content_sha256 }
if (authManifest) {
  if (authManifest.schema !== AUTH_SCHEMA_ID) {
    violation(
      "AUTH_SCHEMA",
      `ledger schema must be ${AUTH_SCHEMA_ID} (found ${JSON.stringify(authManifest.schema)}); ` +
        `the v1 "truthy tl_approval" form is not a complete authorization record.`
    );
  }
  const entries = Array.isArray(authManifest.entries) ? authManifest.entries : [];
  const seenIds = new Set();
  for (const entry of entries) {
    const where = entry?.id ?? "<no id>";
    let entryValid = true;
    const bad = (msg) => {
      entryValid = false;
      violation("AUTH_SCHEMA", `entry ${where}: ${msg}`);
    };
    if (!entry || typeof entry !== "object") {
      bad("entry must be an object");
      continue;
    }
    if (!ID_RE.test(String(entry.id ?? ""))) bad("id must match GAMOS-AUTH-####");
    else if (seenIds.has(entry.id)) bad(`duplicate id ${entry.id}`);
    seenIds.add(entry.id);
    if (!ISO_RE.test(String(entry.date ?? ""))) bad("date must be ISO-8601 UTC (…Z)");
    const requester = entry.requester ?? {};
    if (!requester.login || !requester.role) bad("requester requires { login, role }");
    if (String(entry.rationale ?? "").trim().length < 20)
      bad("rationale must be at least 20 characters (what + why)");
    if (!RISKS.has(entry.risk)) bad("risk must be one of low|medium|high");
    if (!entry.affected_functionality) bad("affected_functionality is required");
    if (!entry.new_functionality) bad("new_functionality is required");
    const tests = entry.regression_tests;
    if (!Array.isArray(tests) || tests.length === 0 || tests.some((t) => !String(t ?? "").trim()))
      bad("regression_tests must be a non-empty array of commands");
    const evidence = entry.evidence ?? {};
    if (!evidence.summary || !Array.isArray(evidence.links) || evidence.links.length === 0)
      bad("evidence requires { summary, links[] }");
    const changes = entry.changes;
    const pending = [];
    if (!Array.isArray(changes) || changes.length === 0) {
      bad("changes[] must list every authorized path with content_sha256");
    } else {
      for (const c of changes) {
        const cWhere = `${where} -> ${c?.path ?? "<no path>"}`;
        if (!c || typeof c !== "object") {
          bad("change entries must be objects");
          continue;
        }
        if (!c.path || String(c.path).startsWith("/") || String(c.path).includes("..")) {
          bad(`${cWhere}: path must be a relative repo path`);
          continue;
        }
        if (![["modify", "delete"]].flat().includes(c.action)) {
          bad(`${cWhere}: action must be "modify" or "delete"`);
          continue;
        }
        if (!/^[0-9a-f]{64}$/.test(String(c.content_sha256 ?? ""))) {
          bad(`${cWhere}: content_sha256 must be the 64-hex sha256 of the approved content`);
          continue;
        }
        const key = `${c.action}:${c.path}`;
        if (authorization.has(key) || pending.some((p) => p.key === key)) {
          bad(`duplicate authorization for ${key}`);
          continue;
        }
        pending.push({ key, entryId: entry.id, content_sha256: c.content_sha256 });
      }
    }

    const approval = entry.tl_approval;
    if (!approval || typeof approval !== "object" || Array.isArray(approval)) {
      bad(
        "tl_approval must be an object { approved, approver, date, decision_ref } — " +
          "a truthy value (e.g. true) alone is NOT sufficient authorization."
      );
    } else {
      if (approval.approved !== true)
        bad("tl_approval.approved must be exactly true");
      if (!approval.approver || !ISO_RE.test(String(approval.date ?? "")) || !approval.decision_ref) {
        bad("tl_approval requires { approver, date (ISO-8601 UTC), decision_ref }");
      } else if (!approvers.includes(String(approval.approver).toLowerCase())) {
        bad(`approver "${approval.approver}" is not a Gamos TL approver (${approvers.join(", ")})`);
      }
    }

    // An entry that fails ANY schema check grants no authorization at all.
    if (entryValid) for (const p of pending) authorization.set(p.key, p);
  }
}

// content binding (working tree is what CI checks out and what gets pushed)
if (authManifest) {
  for (const [key, rec] of authorization) {
    const [action, path] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
    const full = join(ROOT, path);
    if (action === "delete") {
      if (existsSync(full)) {
        violation(
          "AUTH_DRIFT",
          `entry ${rec.entryId}: authorized DELETION of ${path}, but the file is present in the tree`
        );
      }
      continue;
    }
    if (!existsSync(full)) {
      violation("AUTH_DRIFT", `entry ${rec.entryId}: authorized MODIFICATION of ${path}, but the file is missing`);
      continue;
    }
    const actual = sha256File(full);
    if (actual !== rec.content_sha256) {
      violation(
        "AUTH_DRIFT",
        `entry ${rec.entryId}: authorization for ${path} is bound to content sha256 ${rec.content_sha256}, ` +
          `but the current file hashes to ${actual} — the approved evidence does not cover this content.`
      );
    }
  }
}

// ------------------------------------------------------------------ I. upstream diff vs pinned baseline
function diffFiles(filter) {
  if (!BASELINE) return [];
  try {
    return git("diff", "--name-only", "--no-renames", `--diff-filter=${filter}`, `${BASELINE}..HEAD`)
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch (err) {
    notes.push(`could not compute diff vs baseline: ${err.message}`);
    return [];
  }
}

const deleted = diffFiles("D");
const modified = diffFiles("M");
const added = diffFiles("A");

for (const f of deleted) {
  if (!authorization.has(`delete:${f}`)) {
    violation(
      "UNAUTHORIZED_DELETE",
      `PROTECTED FILE DELETED without authorization: ${f} (record a complete entry in ` +
        `.gamos-authorized-modifications.json with action "delete" + structured TL approval, or restore the file)`
    );
  }
}
for (const f of modified) {
  if (!authorization.has(`modify:${f}`)) {
    violation(
      "UNAUTHORIZED_MODIFY",
      `PROTECTED FILE MODIFIED without authorization: ${f} (record a complete entry in ` +
        `.gamos-authorized-modifications.json with action "modify" + structured TL approval, or revert)`
    );
  }
}

// ------------------------------------------------------------------ report
console.log(`Gamos governance check (v2 — tamper-resistant controls)`);
console.log(`  root         : ${ROOT}`);
console.log(`  baseline     : ${BASELINE} (${baselineManifest?.baseline?.upstream_tag})`);
console.log(`  ancestor-ok  : ${baselineIsAncestor}`);
console.log(`  trust anchor : ${PIN ? (violations.some((v) => v.startsWith("[PIN_MISMATCH]")) ? "MISMATCH" : "verified") : "skipped (local mode)"}`);
console.log(`  controls     : ${Object.keys(baselineManifest?.controls ?? {}).length} hash-verified governance files`);
console.log(
  `  ledger       : ${(authManifest?.entries ?? []).length} authorization entries (${authorization.size} authorized paths)`
);
console.log(`  vs baseline  : deleted ${deleted.length}, modified ${modified.length}, added ${added.length} (additive allowed)`);
for (const n of notes) console.log(`  note: ${n}`);

if (violations.length > 0) {
  console.error(`\nGOVERNANCE VIOLATIONS (${violations.length}):`);
  for (const v of violations) console.error(`  ✗ ${v}`);
  process.exit(1);
} else {
  console.log(`\n✓ compliant — governance controls intact; zero unauthorized changes to protected surfaces.`);
}
