#!/usr/bin/env node
/**
 * Gamos roadmap integrity and dependency gate.
 * No third-party dependencies: this runs before workspace installation.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const ROADMAP_PATH = join(ROOT, "docs/gamos/ROADMAP.json");
const REQUIRED_IDS = ["M0","M1","M2","M3","M4","M5","M6","M7"];
const STATUSES = new Set(["planned","active","complete"]);
const HEX_SHA = /^[a-f0-9]{40}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;
const REQUIRED_TDD_ORDER = ["RED","GREEN","HARDEN","INTEGRATE","REGRESSION","EVIDENCE"];

function parseJson(path, label, errors) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    errors.push("[READ] " + label + ": " + error.message);
    return null;
  }
}
function safeRepoPath(root, relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0 || isAbsolute(relativePath)) return null;
  const full = resolve(root, relativePath);
  return full === root || full.startsWith(root + sep) ? full : null;
}
function sorted(values) { return [...values].sort(); }

export function validateRoadmap(roadmap, options = {}) {
  const errors = [];
  const repoRoot = options.repoRoot ? resolve(options.repoRoot) : null;
  const fail = (code, message) => errors.push("[" + code + "] " + message);
  if (!roadmap || typeof roadmap !== "object" || Array.isArray(roadmap)) {
    return { errors:["[SCHEMA] roadmap must be a JSON object"], active:[], ready:[], blocked:[] };
  }
  if (roadmap.format !== "gamos-roadmap@1") fail("SCHEMA","format must be gamos-roadmap@1");
  if (roadmap.normative !== true) fail("AUTHORITY","ROADMAP.json must be marked normative");
  if (roadmap.repository !== "payswapdotorg/Gamos-2.0") fail("REPOSITORY","repository identity must be payswapdotorg/Gamos-2.0");
  if (!String(roadmap.authority_statement || "").includes("sole normative source")) fail("AUTHORITY","authority_statement must identify the sole normative source");
  if (!HEX_SHA.test(roadmap.source_anchors?.zcode_baseline_sha || "")) fail("ANCHOR","ZCode baseline must be a full 40-character SHA");
  if (!HEX_SHA.test(roadmap.source_anchors?.playliquid_gameir_commit || "")) fail("ANCHOR","PlayLiquid GameIR pin must be a full 40-character SHA");

  const policy = roadmap.phase_policy || {};
  if (policy.user_confirmation_required !== false) fail("AUTONOMY","phase advancement must not require user confirmation");
  if (!Number.isInteger(policy.parallel_active_milestones_max) || policy.parallel_active_milestones_max < 1) {
    fail("POLICY","parallel_active_milestones_max must be a positive integer");
  }
  if (policy.phase_advancement_owner !== "Gamos TL") fail("POLICY","Gamos TL must own phase advancement");

  const tdd = roadmap.tdd_policy || {};
  if (JSON.stringify(tdd.mandatory_order) !== JSON.stringify(REQUIRED_TDD_ORDER)) {
    fail("TDD","mandatory order must be RED → GREEN → HARDEN → INTEGRATE → REGRESSION → EVIDENCE");
  }
  for (const key of ["red","green","harden","integrate","regression","evidence","fixtures"]) {
    if (typeof tdd[key] !== "string" || !tdd[key].trim()) fail("TDD","tdd_policy." + key + " is required");
  }

  const milestones = Array.isArray(roadmap.milestones) ? roadmap.milestones : [];
  if (milestones.length !== REQUIRED_IDS.length) {
    fail("MILESTONES","expected exactly eight milestones M0-M7, found " + milestones.length);
  }
  const byId = new Map();
  const gateIds = new Set();
  for (const m of milestones) {
    if (!m || !REQUIRED_IDS.includes(m.id)) {
      fail("MILESTONES","unknown milestone id: " + (m?.id || "(missing)"));
      continue;
    }
    if (byId.has(m.id)) fail("MILESTONES","duplicate milestone id " + m.id);
    byId.set(m.id,m);
    if (!STATUSES.has(m.status)) fail("STATUS",m.id + ": invalid status " + m.status);
    if (!Array.isArray(m.depends_on) || !Array.isArray(m.acceptance_gates) || m.acceptance_gates.length === 0) {
      fail("GATES",m.id + ": dependencies and non-empty acceptance_gates are required");
    }
    for (const gate of m.acceptance_gates || []) {
      if (!gate.id || gateIds.has(gate.id)) fail("GATES",m.id + ": missing or duplicate gate id " + (gate.id || "(missing)"));
      gateIds.add(gate.id);
      if (gate.required !== true || !gate.name || !gate.verification) {
        fail("GATES",m.id + "/" + gate.id + ": required=true, name and verification are mandatory");
      }
    }
    if (!Array.isArray(m.work_packages) || m.work_packages.length === 0) fail("OWNERSHIP",m.id + ": work_packages are required");
    for (const work of m.work_packages || []) {
      if (!work.id || !work.owner || !work.scope) fail("OWNERSHIP",m.id + ": every work package needs id, owner and scope");
    }
    if (!Array.isArray(m.tdd_focus) || m.tdd_focus.length === 0) fail("TDD",m.id + ": tdd_focus is required");
  }
  for (const id of REQUIRED_IDS) if (!byId.has(id)) fail("MILESTONES","missing milestone " + id);

  for (const [id,m] of byId) {
    for (const dep of m.depends_on || []) {
      if (!byId.has(dep)) fail("DEPENDENCY",id + ": unknown dependency " + dep);
      if (dep === id) fail("DEPENDENCY",id + ": cannot depend on itself");
    }
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) { fail("DEPENDENCY","dependency cycle includes " + id); return; }
    if (visited.has(id) || !byId.has(id)) return;
    visiting.add(id);
    for (const dep of byId.get(id).depends_on || []) visit(dep);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of byId.keys()) visit(id);

  const active = milestones.filter(m => m.status === "active");
  if (active.length > policy.parallel_active_milestones_max) {
    fail("STATUS","active milestone count " + active.length + " exceeds configured maximum " + policy.parallel_active_milestones_max);
  }
  const completeIds = new Set(milestones.filter(m => m.status === "complete").map(m => m.id));
  for (const m of milestones) {
    const missingDependencies = (m.depends_on || []).filter(dep => !completeIds.has(dep));
    if (m.status === "active" && missingDependencies.length) {
      fail("DEPENDENCY",m.id + " is active before dependencies complete: " + missingDependencies.join(", "));
    }
    if (m.status === "complete") {
      const ev = m.completion_evidence;
      if (!ev || !ev.evidence_file || !HEX_SHA.test(ev.tested_commit || "") ||
          !Number.isInteger(ev.workflow_run_id) || ev.workflow_run_id <= 0 ||
          !String(ev.workflow_run_url || "").startsWith("https://github.com/payswapdotorg/Gamos-2.0/actions/runs/") ||
          !Number.isFinite(Date.parse(ev.completed_at || ""))) {
        fail("EVIDENCE",m.id + " cannot be complete without evidence_file, tested_commit, successful workflow run id/url and completed_at");
        continue;
      }
      const required = sorted((m.acceptance_gates || []).filter(g => g.required).map(g => g.id));
      const declaredGateIds = sorted(Array.isArray(ev.gate_ids) ? ev.gate_ids : []);
      if (JSON.stringify(required) !== JSON.stringify(declaredGateIds)) {
        fail("EVIDENCE",m.id + ": completion_evidence.gate_ids must exactly cover every required gate");
      }
      if (repoRoot) {
        const evidencePath = safeRepoPath(repoRoot,ev.evidence_file);
        if (!evidencePath || !existsSync(evidencePath)) {
          fail("EVIDENCE",m.id + ": evidence file missing or path escapes repository: " + ev.evidence_file);
        } else {
          const record = parseJson(evidencePath,m.id + " evidence",errors);
          if (record) {
            if (record.phase_id !== m.id || record.status !== "passed" || record.tested_commit !== ev.tested_commit) {
              fail("EVIDENCE",m.id + ": evidence file identity/status/tested_commit does not match ROADMAP.json");
            }
            if (record.workflow_run_id !== ev.workflow_run_id || record.workflow_run_url !== ev.workflow_run_url ||
                record.completed_at !== ev.completed_at) {
              fail("EVIDENCE",m.id + ": workflow run/timestamp metadata differs between evidence file and ROADMAP.json");
            }
            const results = Array.isArray(record.gate_results) ? record.gate_results : [];
            const resultIds = results.map(r => r.gate_id);
            if (new Set(resultIds).size !== resultIds.length) fail("EVIDENCE",m.id + ": duplicate gate result entries");
            const passingIds = sorted(results.filter(r => r.status === "passed").map(r => r.gate_id));
            if (JSON.stringify(required) !== JSON.stringify(passingIds) || results.length !== required.length) {
              fail("EVIDENCE",m.id + ": evidence file must contain exactly one passed result for every required gate and no extras");
            }
            for (const r of results) {
              if (!r.gate_id || !r.command || !r.result_summary ||
                  !Array.isArray(r.evidence_paths) || r.evidence_paths.length === 0 ||
                  !Array.isArray(r.artifact_sha256)) {
                fail("EVIDENCE",m.id + ": gate " + (r.gate_id || "(missing)") + " lacks command, result, evidence path or artifact_sha256 array");
              }
              for (const p of r.evidence_paths || []) {
                const artifactPath = safeRepoPath(repoRoot,p);
                if (!artifactPath || !existsSync(artifactPath)) fail("EVIDENCE",m.id + ": evidence artifact missing or unsafe path: " + p);
              }
              for (const hash of r.artifact_sha256 || []) if (!SHA256.test(hash)) fail("EVIDENCE",m.id + ": malformed SHA-256 in " + r.gate_id);
            }
          }
        }
      }
    }
  }

  const ready = milestones.filter(m => m.status === "planned" && (m.depends_on || []).every(dep => completeIds.has(dep)));
  const blocked = milestones.filter(m => m.status === "planned" && !(m.depends_on || []).every(dep => completeIds.has(dep)));

  if (repoRoot) {
    const baselinePath = join(repoRoot,".gamos-architecture-baseline.json");
    const baseline = existsSync(baselinePath) ? parseJson(baselinePath,".gamos-architecture-baseline.json",errors) : null;
    if (!baseline) fail("ANCHOR","pinned baseline manifest is missing");
    else if (baseline.baseline?.pinned_sha !== roadmap.source_anchors.zcode_baseline_sha) {
      fail("ANCHOR","ROADMAP.json ZCode pin differs from .gamos-architecture-baseline.json");
    }
    const refs = [
      "docs/gamos/PRODUCT-NORTH-STAR.md","docs/gamos/ARCHITECTURE.md",
      "docs/gamos/IMPLEMENTATION-STATUS.md","docs/gamos/README.md",
      "docs/gamos/contracts/01-gaming-domain-and-gameir.md",
      "docs/gamos/contracts/02-capability-registry.md",
      "docs/gamos/contracts/05-intent-and-workflow-orchestration.md",
      "docs/gamos/contracts/06-permission-and-approval-mapping.md",
      "docs/gamos/contracts/09-plugin-trust-and-provenance.md",
      "docs/gamos/workers/worker-a-brief.md","docs/gamos/workers/worker-b-brief.md",
      "docs/gamos/workers/worker-c-brief.md","docs/gamos/workers/tl-integration-plan.md"
    ];
    for (const p of refs) if (!existsSync(join(repoRoot,p))) fail("SOURCE","required roadmap reference missing: " + p);
    const gameIrPath = join(repoRoot,"docs/gamos/contracts/01-gaming-domain-and-gameir.md");
    if (existsSync(gameIrPath)) {
      const contract = readFileSync(gameIrPath,"utf8");
      if (!contract.includes(roadmap.source_anchors.playliquid_gameir_commit)) {
        fail("ANCHOR","GameIR contract does not contain the pinned PlayLiquid commit from ROADMAP.json");
      }
      if (!contract.includes("no acceptance field")) fail("CONTRACT","GameIR contract must prohibit a Gamos acceptance field");
    }
  }
  return { errors, active:active.map(m=>m.id), ready:ready.map(m=>m.id), blocked:blocked.map(m=>m.id) };
}

function main() {
  const errors = [];
  const roadmap = parseJson(ROADMAP_PATH,"docs/gamos/ROADMAP.json",errors);
  if (!roadmap) { console.error(errors.join("\n")); process.exit(1); }
  const result = validateRoadmap(roadmap,{repoRoot:ROOT});
  console.log("Gamos roadmap gate — ROADMAP.json is normative");
  console.log("  active : " + (result.active.join(", ") || "(none)"));
  console.log("  ready  : " + (result.ready.join(", ") || "(none)"));
  console.log("  blocked: " + (result.blocked.join(", ") || "(none)"));
  if (result.errors.length) {
    console.error("\nROADMAP VIOLATIONS (" + result.errors.length + "):\n" + result.errors.map(e=>"  ✗ "+e).join("\n"));
    process.exit(1);
  }
  console.log("\n✓ roadmap structure, source anchors, dependencies and completion evidence are valid.");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
