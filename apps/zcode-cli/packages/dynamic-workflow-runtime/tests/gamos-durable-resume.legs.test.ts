/**
 * M3-G4 durable-resume LEGS (directive §4) — the two process bodies the
 * orchestrating test (`gamos-durable-resume.test.ts`) spawns as REAL separate
 * processes. This spec is skipped unless GAMOS_DURABLE_LEG selects a leg.
 *
 * Each leg assembles the PRODUCTION stack exactly like the app does:
 *
 *   createSqliteSessionStore({ dbPath }).workflowJournalStore()   — the
 *     production SQLite `dwf_*` journal adapter (@zcode/adapters);
 *   createDynamicWorkflowRunService({ journal, parentSessionId, … })  — the
 *     production bootstrap service: its constructor runs
 *     `reconcileOrphanRuns` (dead-process convergence), submit/resume drive
 *     `launchDynamicWorkflowRun` → the production AgentRuntimeWorkflowDriver
 *     and the real harness (the workflow script runs in a spawned child
 *     speaking NDJSON);
 *   createActorRuntime — the app's actor seam. The actor model executes the
 *     REAL Blender typed engine operations (the same
 *     blender-engine-plugin ops the production MCP path dispatches) and
 *     submits the structured result through the real submit_result tool.
 *
 * The test-only GamosEngineDriver is NOT involved anywhere — it must not
 * become a production execution authority (directive §4).
 *
 *   leg 1: submit → write the report (runId) → keep running until the
 *          orchestrator SIGKILLs the whole process group (real process loss).
 *   leg 2: construct the service against the same db + parent session (the
 *          constructor converges the orphan to stopped(interrupted)), probe
 *          the journal row, `service.resume(runId)`, `waitForTask`, then
 *          write the full journal-derived evidence report.
 */

import { it, describe } from "vitest";

const LEG = process.env.GAMOS_DURABLE_LEG ?? "";
const DB_PATH = process.env.GAMOS_DURABLE_DB ?? "";
const WORKSPACE = process.env.GAMOS_DURABLE_WORKSPACE ?? "";
const BLEND = process.env.GAMOS_DURABLE_BLEND ?? "";
const OBJ_PATH = process.env.GAMOS_DURABLE_OBJ ?? "";
const PARENT_SESSION = process.env.GAMOS_DURABLE_PARENT_SESSION ?? "gamos-durable";
const RUN_ID = process.env.GAMOS_DURABLE_RUN_ID ?? "";
const MODE = process.env.GAMOS_DURABLE_MODE ?? "resume";
const VARIANT = process.env.GAMOS_DURABLE_SCRIPT_VARIANT ?? "core";
const REPORT_PATH = process.env.GAMOS_DURABLE_REPORT ?? "";
const PROBE_RESUME_AFTER_COMPLETION = process.env.GAMOS_DURABLE_PROBE_RESUME_AFTER_COMPLETION === "1";

const OP_TIMEOUT = 180_000;

describe.skipIf(LEG !== "leg1" && LEG !== "leg2")("gamos durable-resume legs (production stack)", () => {
  it(
    `leg harness (${LEG})`,
    async () => {
      // The production stack is imported INSIDE the test so the RED stub
      // commit stays import-light and the child process only pays the import
      // cost when the harness actually runs.
      const { createHash } = await import("node:crypto");
      const { readFile, writeFile: writeFileFn } = await import("node:fs/promises");
      const { existsSync, readFileSync, statSync } = await import("node:fs");
      const { createSqliteSessionStore } = await import("../../adapters/src/storage/session-store/sqlite-session-store.js");
      const { createDynamicWorkflowRunService } = await import("../../bootstrap/src/app/dynamic-workflow-run-service.js");
      const { AgentRuntime } = await import("../../core/src/runtime/agent-runtime.js");
      const { createRootTraceContext } = await import("../../contracts/src/tracing/tracer.js");
      const { createSessionId, createTurnId } = await import("../../contracts/src/interfaces/shared.js");
      const { createInMemorySessionEventStore } = await import("../../contracts/src/events/in-memory-session-event-store.js");
      const { sceneModify, sceneInspect, assetExport } = await import("../../blender-engine-plugin/src/engine.js");
      const { discoverBlender } = await import("../../blender-engine-plugin/src/discovery.js");

      const discovery = discoverBlender();
      if (discovery.status !== "available" || typeof discovery.executable !== "string") {
        throw new Error(`leg ${LEG}: real Blender unavailable (${discovery.status}: ${discovery.reason ?? "?"})`);
      }
      const BLENDER = discovery.executable;

      /* ——— the workflow scripts (byte-identical across legs: scriptHash) ——— */

      const IFACES = [
        "interface SceneObjectSummary { name: string; type: string; location?: number[] | null; rotation?: number[] | null; scale?: number[] | null; materialColor?: number[] | null; }",
        "interface SceneSummary { name: string; objectCount: number; objects: SceneObjectSummary[]; }",
        "interface SceneInspectOutcome { ok: boolean; blendFile: string; blenderVersion: string; sceneCount: number; scenes: SceneSummary[]; }",
        "interface ModifyVerificationSummary { ok: boolean; failures: string[]; inspectedObjects: number; }",
        "interface SceneModifyOutcome { ok: boolean; blendFile: string; applied: unknown[]; saved: boolean; sha256: string | null; verification: ModifyVerificationSummary; }",
        "interface ExportDependentFileSummary { path: string; mediaType: string; byteLength: number; sha256: string; }",
        "interface AppliedInterchangeSummary { format: string; handedness: string; upAxis: string; forwardAxis?: string; units: string; scaleFactor?: number; appliedTransforms?: string; materials?: { referenced: string[]; embedded: boolean }; }",
        "interface AssetExportOutcome { ok: boolean; outputPath: string; bytes: number; sha256: string; format: string; selection: string[] | null; blenderVersion: string; sourceSha256: string; unitScale: number; appliedInterchange: AppliedInterchangeSummary; dependentFiles: ExportDependentFileSummary[]; }",
      ].join("\n");

      const CORE_SCRIPT = [
        IFACES,
        'const mutator = agent("mutator", "Mutates the blend.");',
        'const inspector = agent("inspector", "Inspects the blend.");',
        'const exporter = agent("exporter", "Exports the mutated cube.");',
        'const mutation = await mutator.ask<SceneModifyOutcome>("Durable leg 1: modify the blend — add GamosResumeCube.");',
        'const inspection = await inspector.ask<SceneInspectOutcome>("Durable leg 2: inspect the blend.");',
        'const exported = await exporter.ask<AssetExportOutcome>("Durable leg 3: export GamosResumeCube to OBJ.");',
        'const objText = await files.read("exports/gamos-resume-cube.obj");',
        "return {",
        "  saved: mutation.saved,",
        '  sawCube: inspection.scenes[0].objects.map((o) => o.name).includes("GamosResumeCube"),',
        "  exportBytes: exported.bytes,",
        "  exportSha256: exported.sha256,",
        '  objContainsCube: objText.includes("GamosResumeCube"),',
        "};",
      ].join("\n");

      const VERIFIER_SCRIPT = [
        IFACES,
        'const mutator = agent("mutator", "Mutates the blend.");',
        'const inspector = agent("inspector", "Inspects the blend.");',
        'const exporter = agent("exporter", "Exports the mutated cube.");',
        'const verifier = agent("verifier", "Verifies the blend after export.");',
        'const mutation = await mutator.ask<SceneModifyOutcome>("Durable leg 1: modify the blend — add GamosResumeCube.");',
        'const inspection = await inspector.ask<SceneInspectOutcome>("Durable leg 2: inspect the blend.");',
        'const exported = await exporter.ask<AssetExportOutcome>("Durable leg 3: export GamosResumeCube to OBJ.");',
        'const verification = await verifier.ask<SceneInspectOutcome>("Durable leg 4: verify the blend — final inspection.");',
        'const objText = await files.read("exports/gamos-resume-cube.obj");',
        "return {",
        "  saved: mutation.saved,",
        '  sawCube: inspection.scenes[0].objects.map((o) => o.name).includes("GamosResumeCube"),',
        '  verifiedCube: verification.scenes[0].objects.map((o) => o.name).includes("GamosResumeCube"),',
        "  exportBytes: exported.bytes,",
        "  exportSha256: exported.sha256,",
        '  objContainsCube: objText.includes("GamosResumeCube"),',
        "};",
      ].join("\n");

      const scriptText = VARIANT === "with-verifier" ? VERIFIER_SCRIPT : CORE_SCRIPT;

      /* ——— the actor seam: real Blender ops behind the real submit tool ——— */

      const turns: Record<string, number> = { modify: 0, inspect: 0, export: 0, verify: 0 };
      let cancelHook: (() => void) | null = null;

      const lastUserPrompt = (request: unknown): string => {
        const messages = (request as { messages?: unknown[] } | undefined)?.messages ?? [];
        for (let i = messages.length - 1; i >= 0; i--) {
          const message = messages[i] as { role?: unknown; content?: unknown };
          if (message?.role !== "user") continue;
          const content = message.content;
          if (typeof content === "string") return content;
          if (Array.isArray(content)) {
            return content.map((part) => (typeof (part as { text?: unknown })?.text === "string" ? (part as { text: string }).text : "")).join("");
          }
          return "";
        }
        return "";
      };

      const runRealOp = async (prompt: string, signal?: AbortSignal): Promise<unknown> => {
        if (/leg 1|modify/i.test(prompt)) {
          return sceneModify(
            BLENDER,
            { blendFile: BLEND, operations: [{ op: "add-primitive", primitive: "cube", name: "GamosResumeCube", location: [2, 2, 2] }], save: true },
            WORKSPACE,
            { timeoutMs: OP_TIMEOUT, signal },
          );
        }
        if (/leg 3|export/i.test(prompt)) {
          return assetExport(
            BLENDER,
            { blendFile: BLEND, outputPath: OBJ_PATH, format: "OBJ", selection: ["GamosResumeCube"] },
            WORKSPACE,
            { timeoutMs: OP_TIMEOUT, signal },
          );
        }
        if (/leg 4|verify/i.test(prompt)) {
          return sceneInspect(BLENDER, { blendFile: BLEND }, WORKSPACE, { timeoutMs: OP_TIMEOUT, signal });
        }
        return sceneInspect(BLENDER, { blendFile: BLEND }, WORKSPACE, { timeoutMs: OP_TIMEOUT, signal });
      };

      const opKeyFor = (prompt: string): string => {
        // The ask instructions carry their own leg numbering ("Durable leg N:");
        // anchor on it — free-form keyword fallbacks would mis-key on interface
        // names in the typed-submit epilogue (e.g. ModifyVerificationSummary).
        const byLeg = prompt.match(/Durable leg (\d)/);
        if (byLeg) {
          const key = ({ 1: "modify", 2: "inspect", 3: "export", 4: "verify" } as Record<string, string>)[byLeg[1]!];
          if (key) return key;
        }
        if (/\bmodify\b/i.test(prompt)) return "modify";
        if (/\bexport\b/i.test(prompt)) return "export";
        if (/\bverify\b/i.test(prompt)) return "verify";
        return "inspect";
      };

      const makeModel = (generateText: (request: unknown) => Promise<unknown>) => ({
        providerId: "gamos-test",
        modelId: "blender-actor",
        properties: {
          contextWindow: 200_000,
          inputFormat: { supportsText: true, supportsImage: true, supportsVideo: true, supportsAudio: false, supportsPdf: true },
          outputFormat: { supportsText: true },
          supportsToolCall: true,
          supportsJsonSchemaOutput: true,
          supportsNativeWebSearch: false,
          supportsMidConversationSystem: true,
        },
        optionSpecs: { reasoningLevel: { values: ["disabled"] }, maxOutputTokens: { max: 32_000 } },
        options: { maxOutputTokens: 32_000, reasoningLevel: "disabled" },
        bind() { return makeModel(generateText); },
        generateText,
        async *streamText(this: { generateText: (request: unknown) => Promise<{ text: string; finishReason: string; usage: unknown }> }, request: unknown) {
          const result = await this.generateText(request);
          if (result.text) {
            yield { id: "t0", type: "text_start" };
            yield { id: "t0", type: "text_delta", text: result.text };
            yield { id: "t0", type: "text_end" };
          }
          yield { type: "finish", finishReason: result.finishReason, usage: result.usage };
        },
      });

      /* ——— the production service ——— */

      const sessionStore = await createSqliteSessionStore({ dbPath: DB_PATH });
      const journal = sessionStore.workflowJournalStore();
      const actorEventStore = createInMemorySessionEventStore();
      const logger = {
        debug() {}, info() {}, warn() {}, error() {},
      };

      const service = createDynamicWorkflowRunService({
        journal,
        parentSessionId: PARENT_SESSION,
        fileSystemPort: {
          // a REAL world-read: the driver resolves script-relative paths to
          // ABSOLUTE workspace paths before calling the port
          // (workflow-world-read.ts assertWithinWorkspace) — accept both.
          async readTextFile(request: { path: string }) {
            const target = request.path.startsWith("/") ? request.path : `${WORKSPACE}/${request.path}`;
            const content = await readFile(target, "utf8");
            return { path: request.path, content, encoding: "utf-8", bytesRead: content.length, sizeBytes: content.length, truncated: false };
          },
          async searchFiles() { throw new Error("durable-resume leg: searchFiles unsupported"); },
          createDirectory: async () => { throw new Error("durable-resume leg: createDirectory unsupported"); },
          stat: async () => { throw new Error("durable-resume leg: stat unsupported"); },
          readBinaryFile: async () => { throw new Error("durable-resume leg: readBinaryFile unsupported"); },
          readTextFileRange: async () => { throw new Error("durable-resume leg: readTextFileRange unsupported"); },
        } as never,
        executionPort: {
          exec: async () => { throw new Error("durable-resume leg: executionPort unsupported (no git world-reads in this script)"); },
        } as never,
        logger: logger as never,
        createActorRuntime: (input: {
          sessionId: string;
          persona?: { system?: string };
          submitPort: unknown;
          escalatePort: unknown;
        }) => {
          const runtime = new AgentRuntime(
            input.sessionId,
            {
              systemPrompt: input.persona?.system ?? "You are a workflow actor.",
              mode: "yolo",
              taskType: "workflow_child",
              subagents: { enabled: false },
              modelSelection: { providerId: "gamos-test", modelId: "blender-actor" },
            } as never,
            {
              eventStore: actorEventStore,
              eventSink: { onSessionEvent() {} },
              modelFactory: () =>
                makeModel(async (request: unknown) => {
                  const prompt = lastUserPrompt(request);
                  const key = opKeyFor(prompt);
                  turns[key] += 1;
                  // cancel-during-export: fire the cancel once the export op is
                  // GENUINELY in flight. 50ms after the export turn starts, the
                  // Blender subprocess is always still booting (cold start is
                  // ~1s+ on any machine — on a fast CI runner the whole tiny
                  // OBJ export can finish inside a 400ms window, which would
                  // let the run advance past the export before the cancel
                  // lands; 50ms keeps the cancel inside the engine op on every
                  // runner while still being after admission).
                  if (key === "export" && MODE === "cancel-during-export" && cancelHook) {
                    const hook = cancelHook;
                    cancelHook = null;
                    setTimeout(hook, 50);
                  }
                  const abortSignal = (request as { abortSignal?: AbortSignal } | undefined)?.abortSignal;
                  const result = (await runRealOp(prompt, abortSignal)) as { ok: boolean; code?: string; message?: string };
                  if (abortSignal?.aborted) throw (abortSignal.reason ?? new Error("aborted"));
                  if (!result.ok) throw new Error(`engine op failed (${result.code ?? "?"}): ${result.message ?? ""}`);
                  return {
                    finishReason: "tool-calls",
                    model: "blender-actor",
                    text: "",
                    toolCalls: [{ id: `submit-${key}-${turns[key]}`, name: "submit_result", input: { result } }],
                    usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
                  };
                }),
              workflowSubmitPort: input.submitPort,
              workflowEscalatePort: input.escalatePort,
            } as never,
          );
          // No actor transcript store is wired in this harness (the durable
          // dwf_* JOURNAL is the authority under test) — same choice as the
          // production service harness; pin the rehydration call instead.
          (runtime as unknown as { resumeFromStore: () => Promise<unknown> }).resumeFromStore = async () => ({ resumed: true });
          return runtime;
        },
      });

      const writeReport = (report: unknown) => writeFileFn(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");

      // cancel-during-export (leg2 harden mode): the hook is fired by the actor
      // seam 400ms after the export op starts — mid-flight, against a REAL
      // engine operation.
      if (LEG === "leg2" && MODE === "cancel-during-export") {
        cancelHook = () => { void service.cancel(RUN_ID, "user"); };
      }

      if (LEG === "leg1") {
        const submitted = (await service.submit({
          cwd: WORKSPACE,
          parentSessionId: PARENT_SESSION,
          scriptText,
          trace: createRootTraceContext({ sessionId: createSessionId("gamos-durable"), turnId: createTurnId("leg1") }),
        } as never)) as { runId: string };
        await writeReport({ leg: 1, pid: process.pid, runId: submitted.runId, submittedAt: new Date().toISOString() });
        // Real process loss is delivered externally (whole-group SIGKILL):
        // stay alive, owning the run, until then.
        await new Promise(() => {});
      }

      // ——— leg 2: a NEW process against the SAME persisted journal ———

      // The constructor already ran reconcileOrphanRuns: the orphaned run row
      // must now decode to stopped(interrupted) — the dead-process convergence.
      const orphan = journal.getRun(RUN_ID);
      const orphanBeforeResume = orphan
        ? { status: orphan.status, failureCode: orphan.failure?.code ?? null, stopReason: orphan.stopReason ?? null }
        : null;

      const resumeResult = (await service.resume(RUN_ID)) as { ok: boolean; reason?: string; message?: string };

      let runAfterSettle: { status: string; stopReason: string | null; result: unknown; failure: { code?: string; message?: string } | null } | null = null;
      let nodes: { siteId: string; ordinal: number; status: string; resultDigest: string | null }[] = [];
      let cachedSettles: { siteId: string; ordinal: number }[] = [];
      let artifactFile: { bytes: number; sha256: string } | null = null;
      let resumeAfterCompletion: { ok: boolean; reason?: string } | undefined;
      let harnessError: string | null = null;

      const buildReport = (complete: boolean) => ({
        leg: 2,
        pid: process.pid,
        mode: MODE,
        complete,
        orphanBeforeResume,
        resume: { ok: resumeResult.ok, ...(resumeResult.ok ? {} : { reason: resumeResult.reason }) },
        runAfterSettle,
        nodes,
        cachedSettles,
        turns,
        artifactFile,
        ...(resumeAfterCompletion ? { resumeAfterCompletion } : {}),
        ...(harnessError ? { harnessError } : {}),
      });

      const readRunRow = () => {
        const run = journal.getRun(RUN_ID);
        return run
          ? {
              status: run.status,
              stopReason: run.stopReason ?? null,
              result: run.result ?? null,
              failure: run.failure ? { code: run.failure.code, message: run.failure.message } : null,
            }
          : null;
      };

      try {
        if (resumeResult.ok) {
          // Evidence-first: the settlement report is written the moment the
          // run settles — any later enrichment (or an unexpected harness
          // fault) can never lose the proof. waitForTask is raced against a
          // journal-poll for the terminal state (completed/failed/stopped) so
          // a stopped run whose task-wait face never resolves can still not
          // hang the proof.
          const TERMINAL = new Set(["completed", "failed", "stopped", "errored", "cancelled"]);
          await Promise.race([
            service.waitForTask(RUN_ID).catch(() => undefined),
            (async () => {
              const startedAt = Date.now();
              for (;;) {
                const row = journal.getRun(RUN_ID);
                if (row && TERMINAL.has(row.status)) return;
                if (Date.now() - startedAt > 180_000) return;
                await new Promise((r) => setTimeout(r, 100));
              }
            })(),
          ]);
          runAfterSettle = readRunRow();
          await writeReport(buildReport());
          if (PROBE_RESUME_AFTER_COMPLETION) {
            resumeAfterCompletion = (await service.resume(RUN_ID)) as { ok: boolean; reason?: string };
          }
          nodes = (journal.listNodes(RUN_ID, { kinds: "all" }) as { siteId: string; ordinal: number; status: string }[]).map((n) => ({
            siteId: n.siteId,
            ordinal: n.ordinal,
            status: n.status,
            resultDigest: null,
          }));
          for (const n of nodes) {
            const full = journal.getNode(RUN_ID, n.siteId, n.ordinal) as { result?: unknown } | undefined;
            n.resultDigest = full?.result === undefined ? null : createHash("sha256").update(JSON.stringify(full.result)).digest("hex");
          }
          // StoredEvent shape: { sequence, event: RunEvent, timeCreated } — the
          // RunEvent (with cached/instance) lives under .event.
          const events = journal.listEvents(RUN_ID, { types: "all", reportItems: "all" }) as { sequence: number; event: { type: string; cached?: boolean; instance?: { siteId?: string; ordinal?: number } } }[];
          cachedSettles = events
            .filter((e) => e.event?.type === "node-settled" && e.event?.cached === true)
            .map((e) => ({ siteId: String(e.event.instance?.siteId ?? "?"), ordinal: Number(e.event.instance?.ordinal ?? 0) }));
          if (existsSync(OBJ_PATH)) {
            const bytes = statSync(OBJ_PATH).size;
            const sha256 = createHash("sha256").update(readFileSync(OBJ_PATH)).digest("hex");
            artifactFile = { bytes, sha256 };
          }
        }
      } catch (e) {
        harnessError = e instanceof Error ? `${e.stack ?? e.message}`.slice(0, 4000) : String(e);
      }
      if (runAfterSettle === null) runAfterSettle = readRunRow();

      await writeReport(buildReport(true));
      sessionStore.close();
    },
    600_000,
  );
});
