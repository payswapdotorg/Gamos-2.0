#!/usr/bin/env node
/**
 * Gamos governance verifier.
 *
 * Enforces the preservation boundary frozen in:
 *   - .gamos-architecture-baseline.json  (pinned upstream baseline)
 *   - .gamos-protected-surfaces.json     (protected-surface policy)
 *   - .gamos-authorized-modifications.json (sanctioned modifications)
 *
 * Checks (all against the pinned baseline SHA):
 *   1. The pinned baseline is an ancestor of HEAD (no history rewrite).
 *   2. Files listed under hard_requirements.must_exist are present.
 *   3. No protected file is deleted, unless an authorization entry
 *      { file, action: "delete", tl_approval } exists.
 *   4. No protected file is modified, unless an authorization entry
 *      { file, action: "modify", tl_approval } exists.
 *
 * Exit code 0 = compliant. Exit code 1 = violations (printed).
 * Dependency-free: plain Node (>=18) + git.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url)))); // repo root (scripts/gamos/<this>)

function git(...args) {
  return execFileSync("git", ["-C", ROOT, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function readJson(path) {
  const full = join(ROOT, path);
  if (!existsSync(full)) {
    throw new Error(`missing required manifest: ${path}`);
  }
  return JSON.parse(readFileSync(full, "utf8"));
}

const baselineManifest = readJson(".gamos-architecture-baseline.json");
const protectedManifest = readJson(".gamos-protected-surfaces.json");
const authManifest = readJson(".gamos-authorized-modifications.json");

const BASELINE = baselineManifest.baseline.pinned_sha;
const violations = [];
const notes = [];

// ---------------------------------------------------------------- check 1
let baselineIsAncestor = true;
try {
  git("merge-base", "--is-ancestor", BASELINE, "HEAD");
} catch {
  baselineIsAncestor = false;
  violations.push(
    `baseline ${BASELINE} is NOT an ancestor of HEAD — history rewrite or wrong branch.`
  );
}

// ---------------------------------------------------------------- check 2
for (const f of protectedManifest.hard_requirements?.must_exist ?? []) {
  const tracked = git("ls-files", "--", f).trim();
  if (!tracked) {
    violations.push(`hard requirement missing from the tree: ${f}`);
  }
}

// ---------------------------------------------------------------- checks 3/4
const authorized = new Map();
for (const entry of authManifest.entries ?? []) {
  if (!entry.file || !entry.action) {
    notes.push(`authorization entry skipped (missing file/action): ${JSON.stringify(entry)}`);
    continue;
  }
  if (!entry.tl_approval) {
    violations.push(
      `authorization entry for ${entry.file} has NO tl_approval — unauthorized by definition.`
    );
    continue;
  }
  authorized.set(`${entry.action}:${entry.file}`, entry);
}

function diffFiles(filter) {
  try {
    return git(
      "diff",
      "--name-only",
      "--no-renames",
      `--diff-filter=${filter}`,
      `${BASELINE}..HEAD`
    )
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

for (const f of deleted) {
  if (!authorized.has(`delete:${f}`)) {
    violations.push(
      `PROTECTED FILE DELETED without authorization: ${f} (add an entry to .gamos-authorized-modifications.json with action "delete" + TL approval, or restore the file)`
    );
  }
}
for (const f of modified) {
  if (!authorized.has(`modify:${f}`)) {
    violations.push(
      `PROTECTED FILE MODIFIED without authorization: ${f} (add an entry to .gamos-authorized-modifications.json with action "modify" + TL approval, or revert)`
    );
  }
}

// ---------------------------------------------------------------- report
const added = diffFiles("A");
console.log(`Gamos governance check`);
console.log(`  baseline   : ${BASELINE} (${baselineManifest.baseline.upstream_tag})`);
console.log(`  ancestor-ok: ${baselineIsAncestor}`);
console.log(`  deleted    : ${deleted.length} (authorized: ${[...authorized.keys()].filter((k) => k.startsWith("delete:")).length})`);
console.log(`  modified   : ${modified.length} (authorized: ${[...authorized.keys()].filter((k) => k.startsWith("modify:")).length})`);
console.log(`  added      : ${added.length} (additive files are allowed by default)`);
for (const n of notes) console.log(`  note: ${n}`);

if (violations.length > 0) {
  console.error(`\nGOVERNANCE VIOLATIONS (${violations.length}):`);
  for (const v of violations) console.error(`  ✗ ${v}`);
  process.exit(1);
} else {
  console.log(`\n✓ compliant — zero unauthorized changes to protected surfaces.`);
}
