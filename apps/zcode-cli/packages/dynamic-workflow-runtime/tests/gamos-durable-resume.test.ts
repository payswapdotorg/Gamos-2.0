/**
 * M3-G4 durable-journal resume — the REAL process-restart proof (directive §4,
 * 2026-11-08).
 *
 * The prior G4 evidence (`gamos-engine-runtime.test.ts`) proves in-process
 * journal replay with `InMemoryJournalStore` + the test-only
 * GamosEngineDriver: two invocations in ONE process sharing one journal
 * object. Valuable — but it does NOT prove that a workflow, started through
 * the PRODUCTION execution path with a persistent SQLite `dwf_*` journal,
 * survives the LOSS OF THE OWNING PROCESS and resumes in a NEW process via
 * the existing ZCode resume path.
 *
 * This test closes exactly that gap, TDD-first (the failing-test commit is
 * recorded before the harness implementation):
 *
 *   leg 1 (child process): the production stack —
 *     `createSqliteSessionStore({dbPath}).workflowJournalStore()` (the
 *     production SQLite dwf_* journal adapter) +
 *     `createDynamicWorkflowRunService` (the production bootstrap service,
 *     its `AgentRuntimeWorkflowDriver`, the real harness spawning the
 *     workflow-script child) + a real-Blender actor seam (the same typed
 *     engine ops the production path dispatches) — submits a multi-step
 *     workflow and keeps running until it is KILLED.
 *   [the orchestrator polls the journal file itself, then SIGKILLs the whole
 *    process group — real process loss: rows are left `running`, nothing is
 *    gracefully closed]
 *   leg 2 (a NEW process): constructs the service against the SAME db file +
 *    parent session (the constructor's `reconcileOrphanRuns` converges the
 *    orphan), calls the production `service.resume(runId)`, and waits for
 *    settlement through `waitForTask`.
 *
 * Assertions (per the directive):
 *   - completed steps replay from the SQLite journal with ZERO re-dispatch
 *     (turn counts per op; cached node-settled events);
 *   - the pending step executes against REAL Blender;
 *   - the final output matches the actual pre-interruption scene mutation;
 *   - journal, settlement and artifact evidence agree;
 *   - the interrupted step's journaled result bytes are IDENTICAL across the
 *     restart (the durability property itself).
 *
 * Harden cases: kill before a result is committed (re-dispatch), script-hash
 * mismatch (service refuses `script_mismatch`), resume after completion
 * (`not_resumable`), cancellation during a live engine operation (stopped,
 * persisted as cancelled — never completed; the dependent step never runs),
 * and a missing on-disk artifact after the journal says exported (the
 * resumed run fails LOUDLY — never fabricates success).
 *
 * Real-engine gate: like the other gamos runtime gates, these tests only
 * mean anything against an actual Blender — a miss is an honest skip.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { discoverBlender } from "../../blender-engine-plugin/src/discovery.js";
import { bootstrapEmptyScene } from "../../blender-engine-plugin/src/engine.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = join(HERE, "..");
const LEGS_SPEC = "tests/gamos-durable-resume.legs.test.ts";
const VITEST_CLI = join(PACKAGE_DIR, "node_modules", "vitest", "vitest.mjs");

const discovery = discoverBlender();
const exe = discovery.executable;
const realBlenderFound = discovery.status === "available" && typeof exe === "string" && exe.length > 0;
if (!realBlenderFound) {
  console.log(
    `SKIP: real Blender unavailable — M3-G4 durable process-restart gate NOT passing (status=${discovery.status}, reason=${discovery.reason ?? "none"})`,
  );
}
const BLENDER = exe as string;

const OP_TIMEOUT = 180_000;
const LEG_TIMEOUT = 900_000;

interface Leg1Report {
  leg: 1;
  pid: number;
  runId: string;
  submittedAt: string;
}

interface NodeSummary {
  siteId: string;
  ordinal: number;
  status: string;
  resultDigest: string | null;
}

interface Leg2Report {
  leg: 2;
  orphanBeforeResume: { status: string; failureCode: string | null; stopReason: string | null } | null;
  resume: { ok: boolean; reason?: string };
  runAfterSettle: { status: string; stopReason: string | null; result: unknown; failure: { code?: string; message?: string } | null } | null;
  nodes: NodeSummary[];
  cachedSettles: { siteId: string; ordinal: number }[];
  turns: Record<string, number>;
  artifactFile: { bytes: number; sha256: string } | null;
  resumeAfterCompletion?: { ok: boolean; reason?: string };
}

/**
 * Spawn a leg as a REAL separate process (a vitest run of the legs spec).
 * Wrapped in `sh -c "echo LEG-BOOT >&2; exec node …"` so the child emits a
 * heartbeat BEFORE node even starts: a leg that cannot echo is broken, not
 * slow — and the orchestrator respawns it once instead of waiting on a
 * startup-hung child (observed: rare vitest worker IPC deadlock under
 * heavy load on constrained machines). `exec` keeps the SAME pid, so the
 * detached process-group kill semantics are unchanged.
 */
function spawnLeg(env: Record<string, string>, attempt: number): ChildProcess {
  const cmd = `echo LEG-BOOT-\${attempt} >&2; exec "\${LEG_NODE:-node}" "\${LEG_VITEST}" run "\${LEG_SPEC}" --reporter=dot`;
  return spawn("sh", ["-c", cmd], {
    cwd: PACKAGE_DIR,
    env: {
      ...process.env,
      ...env,
      GAMOS_DURABLE_BLENDER: BLENDER,
      LEG_NODE: process.execPath,
      LEG_VITEST: VITEST_CLI,
      LEG_SPEC: LEGS_SPEC,
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true, // own process group — the orchestrator can SIGKILL the whole tree
  });
}

/** Wait for the leg's boot heartbeat (its first output byte). */
function waitBootHeartbeat(output: () => string, child: ChildProcess, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (output().length > 0) return resolve();
      if (child.exitCode !== null || child.signalCode !== null) return reject(new Error("leg child exited before any output"));
      if (Date.now() - startedAt > timeoutMs) return killProcessGroup(child), reject(new Error("leg child produced no boot heartbeat"));
      setTimeout(tick, 100);
    };
    tick();
  });
}

/** Live output accessor — a plain string return would freeze the snapshot at
 * attach time (strings are immutable; later `data` events rebind the closure
 * variable, never the captured value). */
function collectOutput(child: ChildProcess, tag: string): () => string {
  let out = "";
  child.on("error", (e) => { out += `\n[spawn-error:${tag}] ${e.stack ?? e.message}\n`; });
  child.stdout?.on("data", (d) => { out += String(d); });
  child.stderr?.on("data", (d) => { out += String(d); });
  return () => out;
}

/** SIGKILL the entire leg process group (real process loss — nothing graceful). */
function killProcessGroup(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) return;
  try { process.kill(-pid, "SIGKILL"); } catch { /* already gone */ }
}

function waitFor(predicate: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - startedAt > timeoutMs) return reject(new Error(`timeout waiting for ${what}`));
      setTimeout(tick, 50);
    };
    tick();
  });
}

/**
 * Read the journal db directly — the orchestrator's own eyes. A read-write
 * connection that only issues SELECTs: WAL readers never block writers, and
 * unlike `readOnly: true` connections it always observes fresh commits
 * (observed lag with a readOnly handle on a live WAL).
 */
function openJournalReader(dbPath: string): DatabaseSync {
  return new DatabaseSync(dbPath);
}

function nodeStatuses(db: DatabaseSync, runId: string): { siteId: string; ordinal: number; status: string; resultDigest: string | null }[] {
  const rows = db.prepare("SELECT site_id, ordinal, status, result_json FROM dwf_node WHERE run_id = ? ORDER BY site_id, ordinal").all(runId) as {
    site_id: string; ordinal: number; status: string; result_json: string | null;
  }[];
  return rows.map((r) => ({
    siteId: r.site_id,
    ordinal: r.ordinal,
    status: r.status,
    resultDigest: r.result_json === null ? null : createHash("sha256").update(r.result_json).digest("hex"),
  }));
}

function runRow(db: DatabaseSync, runId: string): { status: string; result_json: string | null; failure_json: string | null } | undefined {
  return db.prepare("SELECT status, result_json, failure_json FROM dwf_run WHERE id = ?").get(runId) as
    | { status: string; result_json: string; failure_json: string }
    | undefined;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** Poll until the report file exists AND parses (fs.writeFile creates the
 * file before the content lands — existence alone races the write). */
async function waitForJson<T>(path: string, timeoutMs: number, what: string): Promise<T> {
  const startedAt = Date.now();
  for (;;) {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as T;
    } catch {
      /* not written/parseable yet */
    }
    if (Date.now() - startedAt > timeoutMs) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** waitForJson that dumps the leg child's collected output on timeout — a
 * leg that never reported must never fail silently. */
async function waitForJsonWithOutput<T>(path: string, timeoutMs: number, what: string, child: ChildProcess, output: () => string): Promise<T> {
  try {
    return await waitForJson<T>(path, timeoutMs, what);
  } catch (e) {
    console.error(`=== leg child output (${what}) ===\n${output().slice(-4000)}`);
    killProcessGroup(child);
    throw e;
  }
}

/** Run one full leg1 → kill → leg2 cycle and return the evidence. */
interface CycleOptions {
  /** Kill once these node statuses are observed (predicate over the live db). */
  killWhen: (nodes: { siteId: string; ordinal: number; status: string }[], db: DatabaseSync) => boolean;
  /** Mutation applied to the workspace/db between the kill and leg2. */
  betweenLegs?: (ctx: { dbPath: string; runId: string; workspace: string; objPath: string }) => void;
  leg2Mode?: "resume" | "cancel-during-export";
  scriptVariant?: "core" | "with-verifier";
  probeResumeAfterCompletion?: boolean;
}

interface CycleResult {
  workspace: string;
  dbPath: string;
  runId: string;
  leg1Report: Leg1Report;
  leg2Report: Leg2Report;
  nodesAtKill: { siteId: string; ordinal: number; status: string; resultDigest: string | null }[];
  runAtKill: { status: string } | undefined;
  nodesAfterKillDigests: Record<string, string | null>;
  leg1Exit: { code: number | null; signal: string | null };
  leg2ExitCode: number | null;
  leg2Output: () => string;
}

function runCycle(caseName: string, options: CycleOptions): Promise<CycleResult> {
  const TERMINAL_AT_KILL = new Set(["completed", "failed", "cancelled", "errored"]);
  return (async () => {
    const first = await runCycleOnce(caseName, options);
    cycleWorkspaces.push(first.workspace);
    if (first.runAtKill === undefined || !TERMINAL_AT_KILL.has(first.runAtKill.status)) return first;
    // The engine outran the poller (the kill would land on an already-settled
    // run — not process loss). One retry of the WHOLE cycle: a harness timing
    // tolerance, never a proof retry — every assertion still runs in full.
    console.log(
      `[gamos-durable] late kill for ${caseName} (run was ${first.runAtKill.status} at kill time) — retrying the cycle once`,
    );
    rmSync(first.workspace, { recursive: true, force: true });
    const retried = await runCycleOnce(caseName, options);
    cycleWorkspaces.push(retried.workspace);
    return retried;
  })();
}

function runCycleOnce(caseName: string, options: CycleOptions): Promise<CycleResult> {
  return (async () => {
    const workspace = mkdtempSync(join(tmpdir(), `gamos-durable-${caseName}-`));
    const dbPath = join(workspace, "session.db");
    const blend = join(workspace, "scene.blend");
    const objPath = join(workspace, "exports", "gamos-resume-cube.obj");
    const parentSession = `gamos-durable-${caseName}`;
    const leg1ReportPath = join(workspace, "leg1-report.json");
    const leg2ReportPath = join(workspace, "leg2-report.json");
    cpSync(PRISTINE_BLEND, blend);

    // ——— leg 1: the production stack in a REAL process, until killed ———
    let leg1 = spawnLeg({
      GAMOS_DURABLE_LEG: "leg1",
      GAMOS_DURABLE_DB: dbPath,
      GAMOS_DURABLE_WORKSPACE: workspace,
      GAMOS_DURABLE_BLEND: blend,
      GAMOS_DURABLE_OBJ: objPath,
      GAMOS_DURABLE_PARENT_SESSION: parentSession,
      GAMOS_DURABLE_SCRIPT_VARIANT: options.scriptVariant ?? "core",
      GAMOS_DURABLE_REPORT: leg1ReportPath,
    }, 1);
    let leg1Output = collectOutput(leg1, "leg1");
    let leg2Output: () => string = () => "";
    let leg2: ChildProcess | null = null;
    try {
    // Boot heartbeat: a leg child that produced NOTHING (rare vitest worker
    // IPC deadlock under load) is respawned once — bounded, loud if it recurs.
    try {
      await waitBootHeartbeat(leg1Output, leg1, 90_000);
    } catch {
      killProcessGroup(leg1);
      console.warn(`[gamos-durable] leg1 boot heartbeat missing for ${caseName} — respawning once`);
      const respawned = spawnLeg({
        GAMOS_DURABLE_LEG: "leg1",
        GAMOS_DURABLE_DB: dbPath,
        GAMOS_DURABLE_WORKSPACE: workspace,
        GAMOS_DURABLE_BLEND: blend,
        GAMOS_DURABLE_OBJ: objPath,
        GAMOS_DURABLE_PARENT_SESSION: parentSession,
        GAMOS_DURABLE_SCRIPT_VARIANT: options.scriptVariant ?? "core",
        GAMOS_DURABLE_REPORT: leg1ReportPath,
      }, 2);
      leg1Output = collectOutput(respawned, "leg1-retry");
      await waitBootHeartbeat(leg1Output, respawned, 90_000);
      // @ts-expect-error re-bind the cycle's leg1 handle to the respawned child
      leg1 = respawned;
    }
    const leg1Report = await waitForJsonWithOutput<Leg1Report>(leg1ReportPath, 240_000, "leg1 report (submit)", leg1, leg1Output);
    const runId = leg1Report.runId;

    // ——— poll the journal FILE until the kill condition ———
    const reader = openJournalReader(dbPath);
    await waitFor(() => {
      const nodes = nodeStatuses(reader, runId);
      return options.killWhen(nodes, reader);
    }, 300_000, `kill condition for ${caseName}`);
    // Late-kill guard: the kill must land on a NON-terminal run (process loss
    // mid-flight). If the engine outran the poller, retry the cycle ONCE —
    // a harness timing tolerance, never a proof retry (every assertion below
    // still runs in full on the retried cycle).
    const nodesAtKill = nodeStatuses(reader, runId);
    const runAtKill = runRow(reader, runId);
    const completedDigestsAtKill: Record<string, string | null> = {};
    for (const n of nodesAtKill) {
      if (n.status === "completed") completedDigestsAtKill[`${n.siteId}#${n.ordinal}`] = n.resultDigest;
    }
    reader.close();

    // ——— REAL process loss: SIGKILL the whole leg1 process group ———
    killProcessGroup(leg1);
    const leg1Exit = await new Promise<{ code: number | null; signal: string | null }>((resolve) => {
      leg1.on("exit", (code, signal) => resolve({ code, signal }));
    });
    // Give SQLite a moment to be fully quiescent after the group kill.
    await new Promise((r) => setTimeout(r, 500));

    if (options.betweenLegs) options.betweenLegs({ dbPath, runId, workspace, objPath });

    // ——— leg 2: a NEW process against the SAME persisted journal ———
    leg2 = spawnLeg({
      GAMOS_DURABLE_LEG: "leg2",
      GAMOS_DURABLE_MODE: options.leg2Mode ?? "resume",
      GAMOS_DURABLE_DB: dbPath,
      GAMOS_DURABLE_WORKSPACE: workspace,
      GAMOS_DURABLE_BLEND: blend,
      GAMOS_DURABLE_OBJ: objPath,
      GAMOS_DURABLE_PARENT_SESSION: parentSession,
      GAMOS_DURABLE_RUN_ID: runId,
      GAMOS_DURABLE_SCRIPT_VARIANT: options.scriptVariant ?? "core",
      GAMOS_DURABLE_REPORT: leg2ReportPath,
      ...(options.probeResumeAfterCompletion ? { GAMOS_DURABLE_PROBE_RESUME_AFTER_COMPLETION: "1" } : {}),
    }, 1);
    leg2Output = collectOutput(leg2, "leg2");
    try {
      await waitBootHeartbeat(leg2Output, leg2, 120_000);
    } catch {
      killProcessGroup(leg2);
      console.warn(`[gamos-durable] leg2 boot heartbeat missing for ${caseName} — respawning once`);
      const respawned2 = spawnLeg({
        GAMOS_DURABLE_LEG: "leg2",
        GAMOS_DURABLE_MODE: options.leg2Mode ?? "resume",
        GAMOS_DURABLE_DB: dbPath,
        GAMOS_DURABLE_WORKSPACE: workspace,
        GAMOS_DURABLE_BLEND: blend,
        GAMOS_DURABLE_OBJ: objPath,
        GAMOS_DURABLE_PARENT_SESSION: parentSession,
        GAMOS_DURABLE_RUN_ID: runId,
        GAMOS_DURABLE_SCRIPT_VARIANT: options.scriptVariant ?? "core",
        GAMOS_DURABLE_REPORT: leg2ReportPath,
        ...(options.probeResumeAfterCompletion ? { GAMOS_DURABLE_PROBE_RESUME_AFTER_COMPLETION: "1" } : {}),
      }, 2);
      leg2Output = collectOutput(respawned2, "leg2-retry");
      await waitBootHeartbeat(leg2Output, respawned2, 120_000);
      leg2 = respawned2;
    }
    const leg2Report = await waitForJsonWithOutput<Leg2Report>(leg2ReportPath, 420_000, `leg2 report for ${caseName}`, leg2, leg2Output);
    // Bounded exit wait: the report is the evidence; a hung teardown must not
    // hang the proof (bounded wait, then a group kill like any real cleanup).
    const leg2ExitCode = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => {
        killProcessGroup(leg2);
        resolve(null);
      }, 240_000);
      leg2.on("exit", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });

    // ——— durability: the completed steps' journaled result bytes survive the restart UNCHANGED ———
    const after = openJournalReader(dbPath);
    const nodesAfter = nodeStatuses(after, runId);
    const nodesAfterKillDigests: Record<string, string | null> = {};
    for (const n of nodesAfter) nodesAfterKillDigests[`${n.siteId}#${n.ordinal}`] = n.resultDigest;
    after.close();

    return {
      workspace, dbPath, runId, leg1Report, leg2Report,
      nodesAtKill, runAtKill, nodesAfterKillDigests,
      completedDigestsAtKill, leg1Exit, leg2ExitCode, leg2Output,
    };
    } finally {
      // No zombie leaks on ANY failure path: a leg child that was spawned but
      // never reached its designed death (group-kill / natural exit) is killed
      // here — its engine, workers and Blender grandchildren go with it.
      killProcessGroup(leg1);
      if (leg2) killProcessGroup(leg2);
    }
  })();
}

let PRISTINE_BLEND = "";
/** Transient cycle workspaces (afterAll cleans them). */
const cycleWorkspaces: string[] = [];

describe.skipIf(!realBlenderFound)("gamos M3-G4 durable journal — production-path process-restart resume", () => {
  let workspaceRoot = "";

  beforeAll(async () => {
    workspaceRoot = await mkdtempSync(join(tmpdir(), "gamos-durable-root-"));
    PRISTINE_BLEND = join(workspaceRoot, "pristine.blend");
    const boot = await bootstrapEmptyScene(BLENDER, PRISTINE_BLEND, { timeoutMs: OP_TIMEOUT });
    if (!boot.ok) throw new Error(`pristine bootstrap failed: ${JSON.stringify(boot)}`);
  }, LEG_TIMEOUT);

  afterAll(() => {
    if (workspaceRoot) rmSync(workspaceRoot, { recursive: true, force: true });
    // /tmp hygiene: every cycle workspace (db + wal + blend + exports) is
    // transient evidence — the durable proof is the assertions, not the files.
    for (const w of cycleWorkspaces) rmSync(w, { recursive: true, force: true });
  });

  it(
    "resumes from the durable SQLite journal after process loss without re-dispatching completed steps",
    async () => {
      const r = await runCycle("core", {
        killWhen: (nodes) =>
          nodes.some((n) => n.siteId === "ask#1" && n.status === "completed") &&
          nodes.some((n) => n.siteId === "ask#2" && n.status === "completed"),
      });

      // The kill landed after two real Blender ops committed, run row still running (orphan).
      expect(r.nodesAtKill.filter((n) => n.status === "completed").map((n) => n.siteId)).toEqual(["ask#1", "ask#2"]);
      expect(r.runAtKill?.status).toBe("running");
      expect(r.leg1Exit.signal).toBe("SIGKILL");

      // Leg2's service constructor converged the orphan to stopped(interrupted).
      expect(r.leg2Report.orphanBeforeResume?.status).toBe("stopped");
      expect(r.leg2Report.orphanBeforeResume?.failureCode).toBe("Interrupted");
      expect(r.leg2Report.resume).toEqual({ ok: true });

      // Settlement completed; the artifact integrates the pre-kill mutation + the fresh export.
      expect(r.leg2Report.runAfterSettle.status).toBe("completed");
      const output = r.leg2Report.runAfterSettle.result as Record<string, unknown>;
      expect(output.saved).toBe(true);
      expect(output.sawCube).toBe(true);
      expect(output.objContainsCube).toBe(true);
      expect(typeof output.exportBytes).toBe("number");
      expect(output.exportBytes as number).toBeGreaterThan(0);
      expect(output.exportSha256).toMatch(/^[0-9a-f]{64}$/);

      // ZERO re-dispatch of the completed steps: only the export op ran in leg2.
      expect(r.leg2Report.turns.modify).toBe(0);
      expect(r.leg2Report.turns.inspect).toBe(0);
      expect(r.leg2Report.turns.export).toBe(1);
      expect(r.leg2Report.turns.verify ?? 0).toBe(0);
      // Replay short-circuit evidence: cached settles for ask#1 and ask#2.
      expect(r.leg2Report.cachedSettles.map((c) => c.siteId).sort()).toEqual(["ask#1", "ask#2"]);
      // The pending step executed and committed.
      expect(r.leg2Report.nodes.find((n) => n.siteId === "ask#3")?.status).toBe("completed");

      // Journal, settlement and artifact evidence agree.
      expect(r.leg2Report.artifactFile?.bytes).toBe(output.exportBytes);
      expect(r.leg2Report.artifactFile?.sha256).toBe(output.exportSha256);
      expect(existsSync(join(r.workspace, "exports", "gamos-resume-cube.obj"))).toBe(true);

      // THE durability property: completed steps' journaled results byte-identical across the restart.
      for (const [key, digest] of Object.entries(r.completedDigestsAtKill)) {
        expect(r.nodesAfterKillDigests[key], `${key}: journaled result must survive the restart unchanged`).toBe(digest);
      }
      console.log(
        `[gamos-evidence] G4 durable resume: runId=${r.runId} — kill after ask#1/ask#2 committed (SIGKILL whole group), new process resumed via service.resume; 0 re-dispatches, export ${r.leg2Report.artifactFile?.bytes}B sha256=${String(r.leg2Report.artifactFile?.sha256).slice(0, 16)}…, journaled results byte-identical across restart`,
      );
    },
    LEG_TIMEOUT,
  );

  it(
    "a step whose result was NOT yet committed is re-dispatched live on resume (kill mid-flight)",
    async () => {
      const r = await runCycle("midflight", {
        killWhen: (nodes) =>
          nodes.some((n) => n.siteId === "ask#1" && n.status === "completed") &&
          nodes.some((n) => n.siteId === "ask#2" && n.status === "running"),
      });

      expect(r.runAtKill?.status).toBe("running");
      expect(r.leg2Report.resume).toEqual({ ok: true });
      expect(r.leg2Report.runAfterSettle.status).toBe("completed");
      // ask#1 replayed from the journal (zero turns); ask#2 re-executed (one inspect turn); ask#3 executed.
      expect(r.leg2Report.turns.modify).toBe(0);
      expect(r.leg2Report.turns.inspect).toBe(1);
      expect(r.leg2Report.turns.export).toBe(1);
      expect(r.leg2Report.cachedSettles.map((c) => c.siteId)).toEqual(["ask#1"]);
      const output = r.leg2Report.runAfterSettle.result as Record<string, unknown>;
      expect(output.saved).toBe(true);
      expect(output.sawCube).toBe(true);
      console.log(
        `[gamos-evidence] G4 durable mid-flight kill: ask#2 was re-dispatched live (running row), ask#1 replayed from the journal; final artifact still reflects the real mutation`,
      );
    },
    LEG_TIMEOUT,
  );

  it(
    "refuses resume when the stored script was tampered (script-hash mismatch) — never silently accepts",
    async () => {
      const r = await runCycle("mismatch", {
        killWhen: (nodes) =>
          nodes.some((n) => n.siteId === "ask#1" && n.status === "completed") &&
          nodes.some((n) => n.siteId === "ask#2" && n.status === "completed"),
        betweenLegs: ({ dbPath, runId }) => {
          const db = new DatabaseSync(dbPath);
          db.prepare("UPDATE dwf_run SET script_text = script_text || '\n// tampered' WHERE id = ?").run(runId);
          db.close();
        },
      });

      expect(r.leg2Report.resume.ok).toBe(false);
      expect(r.leg2Report.resume.reason).toBe("script_mismatch");
      // The run row was NOT flipped to a fabricated terminal state by the refusal.
      expect(["stopped", "running"]).toContain(r.leg2Report.runAfterSettle?.status ?? "stopped");
      console.log(
        `[gamos-evidence] G4 script-hash mismatch: service refused resume (script_mismatch) — the recorded hash vs the recompiled tampered text disagree loudly`,
      );
    },
    LEG_TIMEOUT,
  );

  it(
    "resume after completion is refused (duplicate invocation pinned as not_resumable)",
    async () => {
      const r = await runCycle("dupresume", {
        killWhen: (nodes) =>
          nodes.some((n) => n.siteId === "ask#1" && n.status === "completed") &&
          nodes.some((n) => n.siteId === "ask#2" && n.status === "completed"),
        probeResumeAfterCompletion: true,
      });

      expect(r.leg2Report.runAfterSettle.status).toBe("completed");
      expect(r.leg2Report.resumeAfterCompletion).toEqual({ ok: false, reason: "not_resumable" });
      // And no second execution happened: only the leg-2 export turn ever ran.
      expect(r.leg2Report.turns.modify).toBe(0);
      expect(r.leg2Report.turns.inspect).toBe(0);
      expect(r.leg2Report.turns.export).toBe(1);
      console.log(`[gamos-evidence] G4 duplicate resume: refused not_resumable after settlement; zero extra dispatches`);
    },
    LEG_TIMEOUT,
  );

  it(
    "cancellation during a live engine operation settles stopped (persisted as cancelled, never completed) and the dependent step never runs",
    async () => {
      const r = await runCycle("cancelop", {
        scriptVariant: "with-verifier",
        killWhen: (nodes) =>
          nodes.some((n) => n.siteId === "ask#1" && n.status === "completed") &&
          nodes.some((n) => n.siteId === "ask#2" && n.status === "completed"),
        leg2Mode: "cancel-during-export",
      });

      expect(r.leg2Report.resume).toEqual({ ok: true });
      // The run settled STOPPED (user cancel), persisted physically as cancelled — never completed.
      expect(r.leg2Report.runAfterSettle.status).not.toBe("completed");
      expect(["stopped", "cancelled"]).toContain(r.leg2Report.runAfterSettle.status);
      expect(r.leg2Report.runAfterSettle.stopReason).toBe("user");
      // The export op was in flight when the cancel landed (it started).
      expect(r.leg2Report.turns.export).toBe(1);
      // The DEPENDENT verifier step never dispatched.
      expect(r.leg2Report.turns.verify ?? 0).toBe(0);
      expect(r.leg2Report.nodes.find((n) => n.siteId === "ask#4")).toBeUndefined();
      // No fabricated success: the final artifact never landed.
      expect(r.leg2Report.artifactFile).toBeNull();
      console.log(
        `[gamos-evidence] G4 cancel-during-op: settlement stopped(user) persisted cancelled; verifier dependent never dispatched; no artifact`,
      );
    },
    LEG_TIMEOUT,
  );

  it(
    "a missing on-disk artifact after the journal says exported fails the resumed run LOUDLY — never fabricates success",
    async () => {
      const r = await runCycle("missingart", {
        scriptVariant: "with-verifier",
        killWhen: (nodes) =>
          nodes.some((n) => n.siteId === "ask#3" && n.status === "completed"),
        betweenLegs: ({ objPath }) => {
          rmSync(objPath, { force: true });
        },
      });

      // ask#3 (export) completed pre-kill; its journaled result replays — but the
      // on-disk artifact is gone, so the real world-read must fail the run.
      expect(r.nodesAtKill.some((n) => n.siteId === "ask#3" && n.status === "completed")).toBe(true);
      expect(r.leg2Report.resume).toEqual({ ok: true });
      // The decoded logical status for a failed run is "errored" (physical row: failed).
      expect(r.leg2Report.runAfterSettle.status).toBe("errored");
      // The verifier ask ran for real (it precedes the read); the failure is structured, not silent.
      expect(r.leg2Report.turns.verify).toBe(1);
      expect(r.leg2Report.runAfterSettle.failure?.code).toBeTruthy();
      console.log(
        `[gamos-evidence] G4 missing artifact: journaled export replayed but the real files.read failed — run failed loudly (code=${r.leg2Report.runAfterSettle.failure?.code}), never a fabricated success`,
      );
    },
    LEG_TIMEOUT,
  );
});
