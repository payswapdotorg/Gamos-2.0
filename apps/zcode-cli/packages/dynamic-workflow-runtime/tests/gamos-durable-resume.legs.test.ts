/**
 * M3-G4 durable-resume LEGS (directive §4) — the two process bodies the
 * orchestrating test (`gamos-durable-resume.test.ts`) spawns as REAL separate
 * processes. This spec is skipped unless GAMOS_DURABLE_LEG selects a leg.
 *
 * Each leg assembles the PRODUCTION stack (SQLite dwf_* journal adapter +
 * bootstrap DynamicWorkflowRunService + AgentRuntimeWorkflowDriver + the real
 * harness) with a real-Blender actor seam, exactly like the app does — the
 * test-only GamosEngineDriver is NOT involved (it must not become a
 * production execution authority).
 */

import { describe, it } from "vitest";

const LEG = process.env.GAMOS_DURABLE_LEG ?? "";

describe.skipIf(LEG !== "leg1" && LEG !== "leg2")("gamos durable-resume legs", () => {
  it(
    `leg harness (${LEG})`,
    async () => {
      // RED state (failing-test-first commit): the production-path
      // process-restart harness does not exist yet. The orchestrating test
      // fails against this stub for exactly that reason — recorded before
      // the implementation lands.
      throw new Error(
        `durable-resume leg harness not implemented (RED) — GAMOS_DURABLE_LEG=${LEG}; ` +
          "the production-path process-restart proof (SQLite dwf_* journal + bootstrap service + real Blender) is not assembled in tests yet",
      );
    },
    600_000,
  );
});
