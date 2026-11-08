/**
 * M3 journey evidence provenance regression (directive 2026-11-08 §3).
 *
 * The M3 CI workflow executes `scripts/gamos/m3-ui-journey.mjs`, but the
 * committed evidence it produced identified itself as
 * `scripts/gamos/m2-ui-journey.mjs` (an un-updated verbatim copy in the
 * evidence-metadata initializer) — wrong provenance. This test fails closed
 * on that class: the committed evidence must identify its actual generating
 * script, carry per-stage execution provenance (run token + merged-chunk
 * distinction), and record CI execution identity when produced by CI.
 *
 * It reads the COMMITTED evidence bundle (not a fixture), so it stays green
 * only as long as every regeneration keeps provenance honest.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../../..");
const EVIDENCE_PATH = join(REPO_ROOT, "evidence/phase-m3/journey/m3-journey-evidence.json");
const SCRIPT_PATH = join(REPO_ROOT, "scripts/gamos/m3-ui-journey.mjs");

/** The M3 journey script's own identity — the single source of truth. */
const M3_SCRIPT_ID = "scripts/gamos/m3-ui-journey.mjs";
/** The m2 journey's identity — MUST never appear as the m3 evidence's script. */
const M2_SCRIPT_ID = "scripts/gamos/m2-ui-journey.mjs";

function loadEvidence(): Record<string, unknown> {
  expect(existsSync(EVIDENCE_PATH), `committed evidence must exist: ${EVIDENCE_PATH}`).toBe(true);
  return JSON.parse(readFileSync(EVIDENCE_PATH, "utf8")) as Record<string, unknown>;
}

describe("M3 journey evidence provenance (directive §3 — fail-closed)", () => {
  it("identifies the M3 journey script, never the M2 script", () => {
    const evidence = loadEvidence();
    expect(evidence.script).toBe(M3_SCRIPT_ID);
    expect(evidence.script).not.toBe(M2_SCRIPT_ID);
  });

  it("records its generating source's sha256, matching the committed script", () => {
    const evidence = loadEvidence();
    const recorded = evidence.source_sha256;
    expect(typeof recorded).toBe("string");
    expect(recorded).toMatch(/^[0-9a-f]{64}$/);
    const actual = createHash("sha256").update(readFileSync(SCRIPT_PATH)).digest("hex");
    expect(recorded).toBe(actual);
  });

  it("records the top-level run token and run timestamps", () => {
    const evidence = loadEvidence();
    expect(typeof evidence.run_token).toBe("string");
    expect(evidence.run_token).toMatch(/^GAMOS-M3-\d{14}$/);
    expect(typeof evidence.started_at).toBe("string");
    expect(typeof evidence.finished_at).toBe("string");
  });

  it("records CI execution identity (workflow run id + tested commit) or an explicit null for local runs", () => {
    const evidence = loadEvidence();
    const ci = evidence.ci as Record<string, unknown> | undefined;
    expect(ci && typeof ci === "object").toBe(true);
    // The fresh CI journey is the authoritative single-run acceptance proof:
    // the committed evidence must come from a CI run (workflow run id and
    // tested commit present), never from an untagged local chunk run.
    expect(ci.workflow_run_id).toMatch(/^\d+$/);
    expect(ci.tested_commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it("carries per-stage execution provenance: run token + timestamps on every stage row", () => {
    const evidence = loadEvidence();
    const stages = evidence.stages as Record<string, Record<string, unknown>>;
    const ids = Object.keys(stages);
    expect(ids.length).toBeGreaterThanOrEqual(7);
    for (const id of ids) {
      const row = stages[id];
      expect(`${id}.run_token`, "stage row must carry the run token of the run that executed it").toEqual(
        expect.stringMatching(/^GAMOS-M3-\d{14}$/),
      );
      expect(`${id}.at`, "stage row must carry its execution timestamp").toEqual(expect.any(String));
    }
  });

  it("distinguishes stages executed in this run from stages merged from prior local chunks", () => {
    const evidence = loadEvidence();
    const summary = evidence.summary as Record<string, unknown>;
    const stages = evidence.stages as Record<string, Record<string, unknown>>;
    // The authoritative committed evidence is a fresh single-run CI journey:
    // every mandatory stage executed in that one run — nothing merged.
    const merged = Object.keys(stages).filter((id) => stages[id].merged_from_prior_chunk === true);
    expect(merged, `the committed single-run evidence must contain no merged chunk stages (found: ${merged.join(",")})`).toEqual([]);
    expect(summary.stages_merged_from_prior_chunks).toEqual([]);
    expect(summary.stages_executed_this_run).toEqual(Object.keys(stages));
    // stages_requested must be the full mandatory set for a single-run proof.
    expect(summary.stages_requested).toEqual([
      "M3J0",
      "M3J1",
      "M3J2",
      "M3J3",
      "M3J4",
      "M3J5",
      "M3J6",
    ]);
  });
});
