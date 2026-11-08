/**
 * GamosEngineDriver — the M3-RUNTIME integration-evidence driver.
 *
 * Same structural role as `AutoDriver` (Boundary B's driver port + the "model"),
 * but every dispatched ask runs a REAL engine operation (the Blender plugin's
 * typed ops) inside the workflow step, with:
 *   - per-instance `AbortController`s so `cancelAsk` kills the in-flight engine
 *     subprocess tree (the plugin's `RunBlenderOptions.signal`);
 *   - per-site dispatch/settlement timestamps so tests can PROVE concurrency
 *     overlap (ask#2.startAsk before ask#1.settled) and serialized causality
 *     (ask#2.startAsk after ask#1.settled);
 *   - structured recording of every raw engine-op outcome — a plugin
 *     `EngineFailure` becomes a structured `askFailed` (never a fabricated
 *     success), and the record keeps the failure code so tests can assert
 *     `aborted`/`timeout` evidence even when the run is already cancelled.
 *
 * The harness wiring mirrors `runScript` in tests/helpers.ts but constructs the
 * driver itself via `runWorkflowScript`'s `makeDriver` (the control.test.ts
 * pattern) — zero changes to the shared helpers, existing suites untouched.
 */

import type {
  ActorRef,
  ArtifactPublishRequest,
  ArtifactVersionRecord,
  AskMessage,
  AskStats,
  Caps,
  InstanceRef,
  JournalStorePort,
  JsonSchema,
  PersonaSpec,
  RunEvent,
  RunSettlement,
  SessionRef,
  SubmitVerdict,
  ValidateFn,
  WorkflowDriver,
  WorkflowReportSink,
  WorldReadOp,
} from "@zcode/dynamic-workflow";
import { inputHash, refToString, validate, WorkflowError } from "@zcode/dynamic-workflow";
import { runWorkflowScript } from "../src/index.js";
import { askSpecsFor, TEST_CWD } from "./helpers.js";

/** 适配真实校验器到引擎的 ValidateFn 契约（与 tests/helpers.ts 同一形态）。 */
const validateFn: ValidateFn = (schema, value) => validate(schema as JsonSchema, value);

/** Context handed to a real-engine ask handler. */
export interface EngineAskContext {
  readonly instance: InstanceRef;
  readonly message: AskMessage;
  /** Abort handle for THIS ask's engine operation — aborted by `cancelAsk`. */
  readonly signal: AbortSignal;
}

/**
 * One ask site's real-engine handler: runs the actual engine operation and
 * resolves with the raw plugin outcome (success payload or `EngineFailure` —
 * the driver turns a failure into a structured `askFailed`, never a success).
 */
export type EngineAskHandler = (ctx: EngineAskContext) => Promise<unknown>;

export interface GamosEngineDriverConfig {
  /** Per-site real-engine handlers, keyed by ask site id (`ask#1`, …). */
  handlers: Record<string, EngineAskHandler>;
  /**
   * World-read handler (positional args array). Absent → the AutoDriver
   * defaults (glob → [], read → ""). Tests pass a REAL filesystem reader so
   * scripts can inspect real artifacts via `files.read`.
   */
  worldReads?: (op: WorldReadOp, args: unknown[]) => unknown | Promise<unknown>;
  /**
   * Fired synchronously right after a successful `askSubmitAttempted` (the
   * journal write already happened). The resume test uses it to abort the run
   * in the same tick a completed step's result is durable.
   */
  onSubmitted?: (instance: InstanceRef) => void;
}

/** One dispatched ask: dispatch/settlement timestamps + the raw op outcome. */
export interface EngineAskRecord {
  readonly siteId: string;
  readonly ordinal: number;
  /** `Date.now()` at `startAsk` (engine dispatch → real op starts). */
  readonly startedAt: number;
  /** `Date.now()` when the op promise settled (submit/fail fired or skipped). */
  settledAt?: number;
  outcome?: "submitted" | "failed" | "no-handler";
  /** Raw engine-op resolution (success payload, or the thrown error). */
  opResult?: unknown;
  /** Structured plugin failure (`{ok:false, code, message}`) if that was the outcome. */
  structuredFailure?: { code: string; message: string };
}

const ENGINE_OP_STATS: AskStats = { tokens: 1, toolCalls: 1, turns: 1, worldToolCalls: 1 };
const TRIVIAL_STATS: AskStats = { tokens: 1, toolCalls: 0, turns: 1 };

export class GamosEngineDriver implements WorkflowDriver {
  readonly events: RunEvent[] = [];
  readonly startAsks: { session: SessionRef; instance: InstanceRef; message: AskMessage }[] = [];
  readonly sessionCreations: ActorRef[] = [];
  readonly cancels: InstanceRef[] = [];
  readonly records: EngineAskRecord[] = [];
  readonly artifactPublishes: ArtifactPublishRequest[] = [];

  private readonly cancelled = new Set<string>();
  private readonly aborters = new Map<string, AbortController>();
  private readonly opChains = new Map<string, Promise<EngineAskRecord>>();
  private sink: WorkflowReportSink | undefined;

  constructor(
    readonly journal: JournalStorePort,
    private readonly config: GamosEngineDriverConfig,
  ) {}

  /** harness 构造引擎后回填 sink（打破 driver↔engine 环依赖）。 */
  attach(sink: WorkflowReportSink): void {
    this.sink = sink;
  }

  createActorSession(actor: ActorRef, _persona: PersonaSpec): Promise<SessionRef> {
    this.sessionCreations.push(actor);
    return Promise.resolve({ id: `session:${refToString(actor)}` });
  }

  startAsk(session: SessionRef, instance: InstanceRef, message: AskMessage): void {
    this.startAsks.push({ session, instance, message });
    const record: EngineAskRecord = {
      siteId: instance.siteId,
      ordinal: instance.ordinal,
      startedAt: Date.now(),
    };
    this.records.push(record);
    const handler = this.config.handlers[instance.siteId];
    if (handler === undefined) {
      // 非 engine 步骤的兜底：untyped ask 回最终文本；typed ask 提交 `{}`（多半校验失败，
      // 仅兜底——与 AutoDriver 的 defaultAction 同一姿态）。
      record.settledAt = Date.now();
      record.outcome = "no-handler";
      const sink = this.requireSink();
      if (message.typed) {
        sink.askStats(instance, TRIVIAL_STATS);
        sink.askSubmitAttempted(instance, {});
      } else {
        sink.askTurnEnded(instance, "ok");
      }
      return;
    }
    const controller = new AbortController();
    this.aborters.set(refToString(instance), controller);
    // 经微任务触发 handler：同步抛出转成拒绝（真 driver 是 async 方法，天然如此）。
    const op = Promise.resolve().then(() => handler({ instance, message, signal: controller.signal }));
    const chain = op.then(
      (payload) => {
        record.settledAt = Date.now();
        record.opResult = payload;
        const failure = engineFailureOf(payload);
        if (failure !== undefined) {
          record.outcome = "failed";
          record.structuredFailure = failure;
          if (this.cancelled.has(refToString(instance))) return record;
          this.requireSink().askFailed(
            instance,
            new WorkflowError(
              "DriverError",
              `engine operation failed (${failure.code}): ${failure.message}`,
            ),
          );
          return record;
        }
        record.outcome = "submitted";
        if (this.cancelled.has(refToString(instance))) return record;
        const sink = this.requireSink();
        sink.askStats(instance, ENGINE_OP_STATS);
        sink.askSubmitAttempted(instance, payload);
        this.config.onSubmitted?.(instance);
        return record;
      },
      (error: unknown) => {
        record.settledAt = Date.now();
        record.opResult = error;
        record.outcome = "failed";
        if (this.cancelled.has(refToString(instance))) return record;
        this.requireSink().askFailed(instance, toWorkflowError(error, instance));
        return record;
      },
    );
    this.opChains.set(instance.siteId, chain);
  }

  respondToSubmit(instance: InstanceRef, verdict: SubmitVerdict): void {
    if (verdict.kind === "accept") return;
    // 真实 op 结果没过脚本的 schema = 装配错误，大声失败而不是悬挂或静默 repair。
    const violations =
      verdict.kind === "reject"
        ? verdict.violations.map((v) => `${v.path}: expected ${v.expected}, got ${v.got}`).join("; ")
        : "the typed ask ended without a submit";
    queueMicrotask(() => {
      this.requireSink().askFailed(
        instance,
        new WorkflowError(
          "DriverError",
          `GamosEngineDriver payload did not validate (${verdict.kind}): ${violations}`,
        ),
      );
    });
  }

  cancelAsk(instance: InstanceRef): void {
    this.cancels.push(instance);
    const key = refToString(instance);
    this.cancelled.add(key);
    // 杀掉该 ask 的在飞 engine 子进程树（插件在 signal abort 时 kill 整个进程组）。
    this.aborters.get(key)?.abort();
  }

  executeWorldRead(op: WorldReadOp, args: unknown[]): Promise<unknown> {
    const handler = this.config.worldReads ?? defaultWorldRead;
    return Promise.resolve(handler(op, args));
  }

  // async 而不是 `Promise.resolve(handler(...))`：同步抛出必须转成拒绝而不是从
  // executeArtifactPublish 同步逃逸（与 AutoDriver 同一理由）。
  async executeArtifactPublish(request: ArtifactPublishRequest): Promise<ArtifactVersionRecord> {
    this.artifactPublishes.push(request);
    return defaultArtifactPublish(request);
  }

  emit(event: RunEvent): void {
    this.events.push(event);
  }

  // ——————————————————————————————— 断言辅助 ———————————————————————————————

  startAskCount(): number {
    return this.startAsks.length;
  }

  startAsksFor(siteId: string): { instance: InstanceRef }[] {
    return this.startAsks.filter((call) => call.instance.siteId === siteId);
  }

  recordFor(siteId: string): EngineAskRecord | undefined {
    return this.records.find((record) => record.siteId === siteId);
  }

  eventsOfType<T extends RunEvent["type"]>(type: T): Array<Extract<RunEvent, { type: T }>> {
    return this.events.filter((e) => e.type === type) as Array<Extract<RunEvent, { type: T }>>;
  }

  /**
   * 等待某站点的 engine op 兑现（成功或结构化失败）并返回其记录——「没有孤儿子进程」
   * 的证明口：插件在 abort 时 kill 整个进程树，op promise 兑现即树已收口。
   */
  opSettled(siteId: string): Promise<EngineAskRecord> {
    const chain = this.opChains.get(siteId);
    if (chain === undefined) {
      return Promise.reject(new Error(`GamosEngineDriver: no engine op fired for ${siteId}`));
    }
    return chain;
  }

  private requireSink(): WorkflowReportSink {
    if (this.sink === undefined) throw new Error("GamosEngineDriver: sink 未 attach");
    return this.sink;
  }
}

/** 结构化识别插件的 EngineFailure（`{ok:false, code, message}`）；其余形状返回 undefined。 */
function engineFailureOf(payload: unknown): { code: string; message: string } | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const record = payload as { ok?: unknown; code?: unknown; message?: unknown };
  if (record.ok !== false) return undefined;
  if (typeof record.code !== "string" || typeof record.message !== "string") return undefined;
  return { code: record.code, message: record.message };
}

function toWorkflowError(error: unknown, instance: InstanceRef): WorkflowError {
  if (error instanceof WorkflowError) return error;
  return new WorkflowError(
    "DriverError",
    `engine operation for ${refToString(instance)} failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
    { cause: error },
  );
}

/** 缺省 world-read：glob → []，read → ""（与 AutoDriver 的 defaultWorldRead 同语义）。 */
function defaultWorldRead(op: WorldReadOp): unknown {
  return op === "glob" ? [] : "";
}

/** 缺省的产物发布：按请求回显一条记录（与 AutoDriver 的 default 同形态）。 */
function defaultArtifactPublish(request: ArtifactPublishRequest): ArtifactVersionRecord {
  return {
    id: request.id,
    kind: request.op,
    version: request.version,
    contentType: request.op === "markdown" ? "text/markdown" : "application/octet-stream",
    bytes: (request.content ?? request.path ?? "").length,
    uri: `zcode-artifact://gamos/${request.id}/${request.version}`,
    ...(request.path === undefined ? {} : { sourcePath: request.path }),
    publishedAt: 1,
  };
}

// ——————————————————————————————— harness 装配 ———————————————————————————————

export interface EngineRunOptions {
  caps?: Caps;
  runId?: string;
  /** harness 墙钟超时（kill 子进程并 failed）——缺省 180s，给真实 Blender 足够余量。 */
  timeoutMs?: number;
  /** 外部取消信号（真取消：中止在飞 ask、kill 沙箱子进程、结算 stopped）。 */
  signal?: AbortSignal;
}

export interface EngineRunResult {
  settlement: RunSettlement;
  driver: GamosEngineDriver;
}

/**
 * 用真实管线跑一份脚本，driver 换成 {@link GamosEngineDriver}（真实 engine 操作）。
 * `scriptHash` 由脚本文本确定性计算（`inputHash`）：同一文本 = 同一哈希，resume 的
 * 逐字节同一性由引擎的 ScriptHashMismatch 门强制执行。
 */
export async function runEngineScript(
  scriptText: string,
  driver: GamosEngineDriver,
  opts: EngineRunOptions = {},
): Promise<EngineRunResult> {
  const settlement = await runWorkflowScript({
    scriptText,
    cwd: TEST_CWD,
    runId: opts.runId ?? "gamos-engine-run",
    caps: opts.caps ?? { maxConcurrency: 2 },
    askSpecs: askSpecsFor(scriptText),
    validate: validateFn,
    scriptHash: inputHash(scriptText),
    makeDriver: (sink) => {
      driver.attach(sink);
      return driver;
    },
    timeoutMs: opts.timeoutMs ?? 180_000,
    ...(opts.signal === undefined ? {} : { signal: opts.signal }),
  });
  return { settlement, driver };
}
