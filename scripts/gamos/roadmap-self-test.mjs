#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { validateRoadmap } from "./roadmap-check.mjs";

const ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const canonical = JSON.parse(readFileSync(join(ROOT,"docs/gamos/ROADMAP.json"),"utf8"));
let count = 0;
function test(name,fn) { fn(); count++; console.log("ok " + count + " - " + name); }
function clone() { return structuredClone(canonical); }
function codes(result) { return result.errors.map(e => e.slice(1,e.indexOf("]"))); }
// Reset the first milestone to an unfinished state so dependency/evidence tests
// stay valid across real phase transitions of the canonical roadmap (once M0 is
// genuinely complete in ROADMAP.json, tests that assume an incomplete dependency
// must derive that state explicitly instead of relying on the canonical snapshot).
function unfinished() {
  const x=clone(); const m0=x.milestones.find(m=>m.id==="M0");
  m0.status="active"; m0.completion_evidence=null;
  return x;
}

test("canonical roadmap passes structural validation and its completion evidence verifies against the repository",() => {
  const r=validateRoadmap(clone(),{repoRoot:ROOT});
  assert.deepEqual(r.errors,[]);
  // State partition invariants hold regardless of which milestones are complete.
  const ids=canonical.milestones.map(m=>m.id);
  const complete=canonical.milestones.filter(m=>m.status==="complete").map(m=>m.id);
  const covered=new Set([...r.active,...r.ready,...r.blocked,...complete]);
  for(const id of ids) assert.ok(covered.has(id),id+" must be classified active/ready/blocked/complete");
  assert.equal(r.active.length+r.ready.length+r.blocked.length+complete.length,ids.length);
  for(const id of r.ready) {
    const m=canonical.milestones.find(x=>x.id===id);
    for(const dep of m.depends_on||[]) {
      assert.equal(canonical.milestones.find(x=>x.id===dep).status,"complete",id+" ready but dependency "+dep+" not complete");
    }
  }
  // Canonical truth: every milestone marked complete must carry valid on-disk evidence
  // that the full validator (including artifact hashing) accepts on the real repo tree.
  for(const m of canonical.milestones.filter(x=>x.status==="complete")) {
    assert.ok(m.completion_evidence&&m.completion_evidence.evidence_file,m.id+" complete without evidence pointer");
  }
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
  const x=unfinished(); x.milestones.find(m=>m.id==="M1").status="active";
  assert.ok(codes(validateRoadmap(x)).includes("DEPENDENCY"));
});
test("active phase count cannot exceed configured parallelism",() => {
  const x=unfinished(); x.phase_policy.parallel_active_milestones_max=1;
  x.milestones.find(m=>m.id==="M1").status="active";
  assert.ok(codes(validateRoadmap(x)).includes("STATUS"));
});
test("a dependent phase cannot be completed before its dependency",() => {
  const x=unfinished(); x.milestones.find(m=>m.id==="M1").status="complete";
  assert.ok(codes(validateRoadmap(x)).includes("DEPENDENCY"));
});
test("a completed phase without committed evidence is rejected",() => {
  const x=unfinished(); x.milestones[0].status="complete";
  assert.ok(codes(validateRoadmap(x)).includes("EVIDENCE"));
});
test("a completed phase with a missing required gate is rejected",() => {
  const x=unfinished();
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
  // Reset EVERY milestone except M0 to an unfinished state (the same derivation
  // discipline as unfinished()) so the scenario stays valid across real phase
  // transitions of the canonical roadmap: once M0 AND M1 are genuinely complete
  // in ROADMAP.json, the next ready milestone is M2 and a hardcoded ["M1"]
  // expectation would fail. Deriving the state keeps the scenario's meaning
  // ("completing a dependency exposes its dependent as ready") intact forever.
  const x=unfinished();
  for(const p of x.milestones) { if(p.id!=="M0") { p.status="planned"; p.completion_evidence=null; delete p.activation_waiver; } }
  const m=x.milestones.find(p=>p.id==="M0");
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
test("completed milestone requires matching on-disk evidence and real gate artifacts",() => {
  const tempRoot=mkdtempSync(join(tmpdir(),"gamos-roadmap-evidence-"));
  const put=(relative,content) => {
    const target=join(tempRoot,relative);
    mkdirSync(dirname(target),{recursive:true});
    writeFileSync(target,content);
  };
  try {
    put(".gamos-architecture-baseline.json",JSON.stringify({baseline:{pinned_sha:canonical.source_anchors.zcode_baseline_sha}}));
    const requiredRefs=[
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
    for(const ref of requiredRefs) put(ref,"fixture reference");
    put("docs/gamos/contracts/01-gaming-domain-and-gameir.md",
      "pinned " + canonical.source_anchors.playliquid_gameir_commit + "\nno " +
      String.fromCharCode(96) + "acceptance" + String.fromCharCode(96) + " field");
    const x=clone();
    const m=x.milestones.find(item=>item.id==="M0");
    m.status="complete";
    // Same derivation discipline as unfinished(): with M1 (and, later, further
    // milestones) genuinely complete in the canonical snapshot, the temp tree
    // below only carries M0's fixture evidence — every other milestone must be
    // reset to planned so this temp-tree validation stays about M0 alone
    // (otherwise M1's on-disk evidence is demanded from the temp root). The
    // canonical M3 activation_waiver is likewise milestone state and must be
    // cleared with the reset (its committed ADR reference does not exist in a
    // synthetic temp root).
    for(const p of x.milestones) { if(p.id!=="M0") { p.status="planned"; p.completion_evidence=null; delete p.activation_waiver; } }
    const testedCommit="c".repeat(40);
    const runId=98765;
    const runUrl="https://github.com/payswapdotorg/Gamos-2.0/actions/runs/" + runId;
    const completedAt="2026-11-05T00:00:00Z";
    const gateResults=m.acceptance_gates.map(gate=>{
      const evidencePath="evidence/roadmap/" + gate.id + ".log";
      const evidenceContent="real test output fixture for " + gate.id;
      put(evidencePath,evidenceContent);
      return {
        gate_id:gate.id,status:"passed",command:"node test-command",
        result_summary:"passed on test fixture repository",
        evidence_paths:[evidencePath],
        artifact_sha256:[createHash("sha256").update(evidenceContent).digest("hex")]
      };
    });
    const record={
      phase_id:"M0",status:"passed",tested_commit:testedCommit,
      workflow_run_head_sha:testedCommit,workflow_run_conclusion:"success",
      workflow_run_id:runId,workflow_run_url:runUrl,completed_at:completedAt,
      environment:{runner:"self-test",os:"test",runtime:"node"},
      gate_results:gateResults
    };
    const evidenceFile="evidence/roadmap/M0.json";
    put(evidenceFile,JSON.stringify(record,null,2));
    m.completion_evidence={
      evidence_file:evidenceFile,tested_commit:testedCommit,
      workflow_run_head_sha:testedCommit,workflow_run_conclusion:"success",
      workflow_run_id:runId,workflow_run_url:runUrl,completed_at:completedAt,
      gate_ids:m.acceptance_gates.map(gate=>gate.id).sort()
    };
    const valid=validateRoadmap(x,{repoRoot:tempRoot});
    assert.deepEqual(valid.errors,[]);
    assert.deepEqual(valid.ready,["M1"]);
    record.gate_results[0].status="failed";
    put(evidenceFile,JSON.stringify(record,null,2));
    assert.ok(codes(validateRoadmap(x,{repoRoot:tempRoot})).includes("EVIDENCE"));
    record.gate_results[0].status="passed";
    put(record.gate_results[0].evidence_paths[0],"tampered evidence content");
    put(evidenceFile,JSON.stringify(record,null,2));
    assert.ok(codes(validateRoadmap(x,{repoRoot:tempRoot})).includes("EVIDENCE"));
  } finally {
    rmSync(tempRoot,{recursive:true,force:true});
  }
});
// --- activation-waiver mechanism (ADR-0007): maintainer-authorized activation ---
// A milestone may become active before its dependencies complete ONLY through a
// complete, recorded activation_waiver. The waiver authorizes activation ONLY —
// never completion — and fails closed when absent, malformed or unreferenced.
function withM3Waiver(x, override) {
  const m3 = x.milestones.find(m => m.id === "M3");
  m3.status = "active";
  m3.activation_waiver = Object.assign({
    basis: "maintainer-authorized-waiver",
    authorized_by: "repository maintainer",
    authorized_at: "2026-11-08T02:39:28Z",
    directive: "you can proceed with M3",
    reason: "M2-G1 remains honestly blocked on an external prerequisite; the maintainer authorized beginning M3 while M2 completion stays pending.",
    reference: "docs/gamos/ADR/0007-m3-maintainer-authorized-activation.md"
  }, override);
  return x;
}
test("a maintainer-authorized activation waiver permits active despite an incomplete dependency",() => {
  const x = withM3Waiver(clone());
  const r = validateRoadmap(x);
  assert.deepEqual(r.errors,[]);
  assert.deepEqual(r.active,["M2","M3"]);
});
test("an activation waiver with an unrecognized basis fails closed",() => {
  const x = withM3Waiver(clone(),{basis:"tl-discretion"});
  const c = codes(validateRoadmap(x));
  assert.ok(c.includes("WAIVER"));
  assert.ok(c.includes("DEPENDENCY"));
});
test("an activation waiver with missing required fields fails closed",() => {
  const x = withM3Waiver(clone(),{directive:"   "});
  const c = codes(validateRoadmap(x));
  assert.ok(c.includes("WAIVER"));
  assert.ok(c.includes("DEPENDENCY"));
});
test("an activation waiver never permits completion before dependencies complete",() => {
  const x = withM3Waiver(clone());
  const m3 = x.milestones.find(m => m.id === "M3");
  m3.status = "complete";
  m3.completion_evidence = {
    evidence_file:"evidence/roadmap/M3.json",tested_commit:"d".repeat(40),
    workflow_run_head_sha:"d".repeat(40),workflow_run_conclusion:"success",
    workflow_run_id:55555,workflow_run_url:"https://github.com/payswapdotorg/Gamos-2.0/actions/runs/55555",
    completed_at:"2026-11-08T00:00:00Z",gate_ids:m3.acceptance_gates.map(g=>g.id).sort()
  };
  const r = validateRoadmap(x);
  assert.deepEqual(codes(r),["DEPENDENCY"]);
});
test("the activation waiver is scoped to the authorized milestone only",() => {
  const x = withM3Waiver(clone());
  x.milestones.find(m => m.id === "M4").status = "active"; // same incomplete dependency, no waiver
  assert.deepEqual(codes(validateRoadmap(x)),["STATUS","DEPENDENCY"]);
});
console.log("1.." + count);
console.log("# roadmap self-test: " + count + " passed, 0 failed");
