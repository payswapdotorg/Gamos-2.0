#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { validateRoadmap } from "./roadmap-check.mjs";

const ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const canonical = JSON.parse(readFileSync(join(ROOT,"docs/gamos/ROADMAP.json"),"utf8"));
let count = 0;
function test(name,fn) { fn(); count++; console.log("ok " + count + " - " + name); }
function clone() { return structuredClone(canonical); }
function codes(result) { return result.errors.map(e => e.slice(1,e.indexOf("]"))); }

test("canonical roadmap passes structural validation",() => {
  const r=validateRoadmap(clone());
  assert.deepEqual(r.errors,[]);
  assert.deepEqual(r.active,["M0"]);
  assert.deepEqual(r.ready,[]);
  assert.deepEqual(r.blocked,["M1","M2","M3","M4","M5","M6","M7"]);
});
test("exact M0-M7 milestone inventory is enforced",() => {
  const x=clone(); x.milestones=x.milestones.filter(m=>m.id!=="M7");
  assert.ok(codes(validateRoadmap(x)).includes("MILESTONES"));
});
test("duplicate milestone ids are rejected",() => {
  const x=clone(); x.milestones[1].id="M0";
  assert.ok(codes(validateRoadmap(x)).includes("MILESTONES"));
});
test("a phase cannot start before its dependencies complete",() => {
  const x=clone(); x.milestones.find(m=>m.id==="M1").status="active";
  assert.ok(codes(validateRoadmap(x)).includes("DEPENDENCY"));
});
test("active phase count cannot exceed configured parallelism",() => {
  const x=clone(); x.phase_policy.parallel_active_milestones_max=1;
  x.milestones.find(m=>m.id==="M1").status="active";
  assert.ok(codes(validateRoadmap(x)).includes("STATUS"));
});
test("a dependent phase cannot be completed before its dependency",() => {
  const x=clone(); x.milestones.find(m=>m.id==="M1").status="complete";
  assert.ok(codes(validateRoadmap(x)).includes("DEPENDENCY"));
});
test("a completed phase without committed evidence is rejected",() => {
  const x=clone(); x.milestones[0].status="complete";
  assert.ok(codes(validateRoadmap(x)).includes("EVIDENCE"));
});
test("a completed phase with a missing required gate is rejected",() => {
  const x=clone();
  const m=x.milestones[0]; m.status="complete";
  m.completion_evidence={
    evidence_file:"evidence/roadmap/M0.json",tested_commit:"a".repeat(40),
    workflow_run_head_sha:"a".repeat(40),workflow_run_conclusion:"success",
    workflow_run_id:12345,workflow_run_url:"https://github.com/payswapdotorg/Gamos-2.0/actions/runs/12345",
    completed_at:"2026-11-05T00:00:00Z",gate_ids:["M0-G1"]
  };
  assert.ok(codes(validateRoadmap(x)).includes("EVIDENCE"));
});
test("all required gates and dependencies expose the next phase as ready",() => {
  const x=clone(); const m=x.milestones.find(p=>p.id==="M0");
  m.status="complete";
  m.completion_evidence={
    evidence_file:"evidence/roadmap/M0.json",tested_commit:"b".repeat(40),
    workflow_run_head_sha:"b".repeat(40),workflow_run_conclusion:"success",
    workflow_run_id:12345,workflow_run_url:"https://github.com/payswapdotorg/Gamos-2.0/actions/runs/12345",
    completed_at:"2026-11-05T00:00:00Z",gate_ids:m.acceptance_gates.map(g=>g.id).sort()
  };
  const r=validateRoadmap(x);
  assert.deepEqual(r.errors,[]);
  assert.deepEqual(r.ready,["M1"]);
});
test("dependency cycles are rejected",() => {
  const x=clone();
  x.milestones.find(m=>m.id==="M0").depends_on=["M1"];
  assert.ok(codes(validateRoadmap(x)).includes("DEPENDENCY"));
});
test("user phase approval cannot be re-enabled accidentally",() => {
  const x=clone(); x.phase_policy.user_confirmation_required=true;
  assert.ok(codes(validateRoadmap(x)).includes("AUTONOMY"));
});
console.log("1.." + count);
console.log("# roadmap self-test: " + count + " passed, 0 failed");
