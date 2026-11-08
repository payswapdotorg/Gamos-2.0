/**
 * M3-RUNTIME integration evidence — the M3-G3/M3.4 runtime gates against the
 * REAL Dynamic Workflow runtime (script → lowering → sandbox child → engine)
 * with REAL Blender engine operations inside the workflow steps
 * (GamosEngineDriver → the blender-engine-plugin's typed ops).
 *
 * Gate clauses covered (M3.3/M3.5 evidence):
 *   G3 — concurrency: independent real engine ops overlap under
 *        maxConcurrency=2; dependent work waits (serialized causality);
 *        conflicting unordered writes are prevented BEFORE execution by the
 *        parseGamePlan resource-claim conflict gate, and the serialized
 *        variant executes through the runtime leaving a consistent blend.
 *   G4 — resume: an interrupted workflow resumes from the durable journal
 *        without re-executing completed steps (the resumed leg produces the
 *        real export artifact that reflects the pre-abort mutation).
 *   G4 — cancellation: aborting during a real engine operation kills the
 *        engine subprocess tree (structured `aborted` failure), never reports
 *        success, and never dispatches the dependent follow-up.
 *
 * Real-engine gate: these tests only mean anything against an actual Blender.
 * Fixture executables are NOT acceptable here — a miss must be an honest skip.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { InMemoryJournalStore } from "@zcode/dynamic-workflow";
import { discoverBlender } from "../../blender-engine-plugin/src/discovery.js";
import {
  assetExport,
  bootstrapEmptyScene,
  sceneInspect,
  sceneModify,
  sceneRender,
} from "../../blender-engine-plugin/src/engine.js";
import { parseGamePlan } from "../../../../../packages/gamos-domain/src/domain/game-plan.js";
import { GamosEngineDriver, runEngineScript, type EngineAskHandler } from "./gamos-engine-driver.js";

const discovery = discoverBlender();
const exe = discovery.executable;
const realBlenderFound = discovery.status === "available" && typeof exe === "string" && exe.length > 0;

if (!realBlenderFound) {
  console.log(
    `SKIP: real Blender unavailable — M3-G3/G4 runtime integration gate NOT passing (status=${discovery.status}, reason=${discovery.reason ?? "none"})`,
  );
} else {
  console.log(`[gamos-evidence] real Blender executable: ${exe}`);
  console.log(`[gamos-evidence] raw version: ${discovery.rawVersion}`);
}

const BLENDER = exe as string;
const OP_TIMEOUT = 120_000;

/** 脚本里的 typed-ask 接口：与驱动实际提交的真实 op 结果逐字段对齐。 */
const OBJECT_SUMMARY_IFACE =
  "interface SceneObjectSummary { name: string; type: string; location?: number[] | null; rotation?: number[] | null; scale?: number[] | null; materialColor?: number[] | null; }";
const SCENE_IFACE =
  "interface SceneSummary { name: string; objectCount: number; objects: SceneObjectSummary[]; }";
const INSPECT_IFACE =
  "interface SceneInspectOutcome { ok: boolean; blendFile: string; blenderVersion: string; sceneCount: number; scenes: SceneSummary[]; }";
const MODIFY_IFACE = [
  "interface ModifyVerificationSummary { ok: boolean; failures: string[]; inspectedObjects: number; }",
  "interface SceneModifyOutcome { ok: boolean; blendFile: string; applied: unknown[]; saved: boolean; sha256: string | null; verification: ModifyVerificationSummary; }",
].join("\n");

describe.skipIf(!realBlenderFound)("gamos M3-RUNTIME — real engine operations under the real Dynamic Workflow runtime", () => {
  let workspace = "";
  let blendA = "";
  let blendB = "";

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), "gamos-runtime-ws-"));
    blendA = join(workspace, "blend-a.blend");
    blendB = join(workspace, "blend-b.blend");
    const bootA = await bootstrapEmptyScene(BLENDER, blendA, { timeoutMs: 180_000 });
    if (!bootA.ok) throw new Error(`bootstrap A failed: ${JSON.stringify(bootA)}`);
    const bootB = await bootstrapEmptyScene(BLENDER, blendB, { timeoutMs: 180_000 });
    if (!bootB.ok) throw new Error(`bootstrap B failed: ${JSON.stringify(bootB)}`);
    // 两个 blend 各自的标志 cube——并发用例据此证明两次真实 inspect 各自命中各自的文件。
    const seedA = await sceneModify(
      BLENDER,
      {
        blendFile: blendA,
        operations: [{ op: "add-primitive", primitive: "cube", name: "GamosBlendACube", location: [0, 0, 0] }],
        save: true,
      },
      workspace,
      { timeoutMs: OP_TIMEOUT },
    );
    if (!seedA.ok) throw new Error(`seed A failed: ${JSON.stringify(seedA)}`);
    const seedB = await sceneModify(
      BLENDER,
      {
        blendFile: blendB,
        operations: [{ op: "add-primitive", primitive: "cube", name: "GamosBlendBCube", location: [1, 1, 1] }],
        save: true,
      },
      workspace,
      { timeoutMs: OP_TIMEOUT },
    );
    if (!seedB.ok) throw new Error(`seed B failed: ${JSON.stringify(seedB)}`);
    console.log(
      `[gamos-evidence] workspace bootstrap: blendA=${blendA} (sha256=${bootA.sha256}, seeded ${seedA.sha256}); blendB=${blendB} (sha256=${bootB.sha256}, seeded ${seedB.sha256})`,
    );
  }, 300_000);

  afterAll(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  // ——————————————————————————————— G3 — 并发 ———————————————————————————————

  it(
    "two independent real engine operations run concurrently under maxConcurrency=2",
    async () => {
      const script = [
        OBJECT_SUMMARY_IFACE,
        SCENE_IFACE,
        INSPECT_IFACE,
        'const scoutA = agent("scout-a", "Inspects blend A.");',
        'const scoutB = agent("scout-b", "Inspects blend B.");',
        "const inspections = await Promise.all([",
        '  scoutA.ask<SceneInspectOutcome>("Inspect the scene objects of blend A."),',
        '  scoutB.ask<SceneInspectOutcome>("Inspect the scene objects of blend B."),',
        "]);",
        "const inspectA = inspections[0];",
        "const inspectB = inspections[1];",
        "return {",
        "  aObjects: inspectA.scenes[0].objects.map((o) => o.name),",
        "  bObjects: inspectB.scenes[0].objects.map((o) => o.name),",
        "};",
      ].join("\n");

      const handlers: Record<string, EngineAskHandler> = {
        "ask#1": (ctx) =>
          sceneInspect(BLENDER, { blendFile: blendA }, workspace, { timeoutMs: OP_TIMEOUT, signal: ctx.signal }),
        "ask#2": (ctx) =>
          sceneInspect(BLENDER, { blendFile: blendB }, workspace, { timeoutMs: OP_TIMEOUT, signal: ctx.signal }),
      };
      const journal = new InMemoryJournalStore();
      const driver = new GamosEngineDriver(journal, { handlers });
      const { settlement } = await runEngineScript(script, driver, {
        runId: "g3-concurrency",
        caps: { maxConcurrency: 2 },
      });

      expect(settlement.status).toBe("completed");
      const artifact = (settlement as { artifact: { aObjects: string[]; bObjects: string[] } }).artifact;
      // 两次真实 inspect 各自命中各自的 blend（互不含对方的标志 cube）。
      expect(artifact.aObjects).toContain("GamosBlendACube");
      expect(artifact.aObjects).not.toContain("GamosBlendBCube");
      expect(artifact.bObjects).toContain("GamosBlendBCube");
      expect(artifact.bObjects).not.toContain("GamosBlendACube");

      // 两个 journal 节点都 completed。
      expect(journal.getNode("g3-concurrency", "ask#1", 1)?.status).toBe("completed");
      expect(journal.getNode("g3-concurrency", "ask#2", 1)?.status).toBe("completed");

      // 并发重叠的铁证：ask#2 派发时间戳严格早于 ask#1 的结算时间戳。
      const r1 = driver.recordFor("ask#1");
      const r2 = driver.recordFor("ask#2");
      expect(r1?.startedAt).toBeDefined();
      expect(r2?.startedAt).toBeDefined();
      expect(r1?.settledAt).toBeDefined();
      expect(r2?.startedAt!).toBeLessThan(r1?.settledAt!);
      const overlapMs = (r1?.settledAt ?? 0) - (r2?.startedAt ?? 0);
      const staggerMs = (r2?.startedAt ?? 0) - (r1?.startedAt ?? 0);
      console.log(
        `[gamos-evidence] G3 concurrency: ask#2 dispatched ${staggerMs}ms after ask#1; ask#1 settled ${overlapMs}ms after ask#2 dispatched (overlap=${overlapMs}ms, ask#1 duration=${(r1?.settledAt ?? 0) - (r1?.startedAt ?? 0)}ms, ask#2 duration=${(r2?.settledAt ?? 0) - (r2?.startedAt ?? 0)}ms)`,
      );

      // 引擎守住了 maxConcurrency=2：ask#2 在 ask#1 仍在飞时就被派发（事件序：两个
      // node-dispatched 都先于 ask#1 的 node-settled）。
      const events = driver.events;
      const dispatchedAsk2 = events.findIndex(
        (e) => e.type === "node-dispatched" && e.instance.siteId === "ask#2",
      );
      const settledAsk1 = events.findIndex(
        (e) => e.type === "node-settled" && e.instance.siteId === "ask#1" && e.outcome === "ok",
      );
      expect(dispatchedAsk2).toBeGreaterThanOrEqual(0);
      expect(settledAsk1).toBeGreaterThanOrEqual(0);
      expect(dispatchedAsk2).toBeLessThan(settledAsk1);
    },
    240_000,
  );

  it(
    "dependent work waits: the inspect observes the mutation the modify made",
    async () => {
      const script = [
        OBJECT_SUMMARY_IFACE,
        SCENE_IFACE,
        INSPECT_IFACE,
        MODIFY_IFACE,
        'const mutator = agent("mutator", "Mutates blend A.");',
        'const inspector = agent("inspector", "Inspects blend A.");',
        'const mutation = await mutator.ask<SceneModifyOutcome>("Add GamosRuntimeCube to blend A.");',
        'const inspection = await inspector.ask<SceneInspectOutcome>("Inspect blend A after the mutation.");',
        "return {",
        "  saved: mutation.saved,",
        "  verificationOk: mutation.verification.ok,",
        "  mutationSha256: mutation.sha256,",
        "  inspectObjectNames: inspection.scenes[0].objects.map((o) => o.name),",
        "};",
      ].join("\n");

      const handlers: Record<string, EngineAskHandler> = {
        "ask#1": (ctx) =>
          sceneModify(
            BLENDER,
            {
              blendFile: blendA,
              operations: [
                {
                  op: "add-primitive",
                  primitive: "cube",
                  name: "GamosRuntimeCube",
                  location: [1, 2, 3],
                  scale: [1.5, 1.5, 1.5],
                },
              ],
              save: true,
            },
            workspace,
            { timeoutMs: OP_TIMEOUT, signal: ctx.signal },
          ),
        "ask#2": (ctx) =>
          sceneInspect(BLENDER, { blendFile: blendA }, workspace, { timeoutMs: OP_TIMEOUT, signal: ctx.signal }),
      };
      const journal = new InMemoryJournalStore();
      const driver = new GamosEngineDriver(journal, { handlers });
      const { settlement } = await runEngineScript(script, driver, { runId: "g3-dependent" });

      expect(settlement.status).toBe("completed");
      const artifact = (settlement as {
        artifact: {
          saved: boolean;
          verificationOk: boolean;
          mutationSha256: string | null;
          inspectObjectNames: string[];
        };
      }).artifact;
      // 真实因果链：修改真实落盘（saved + 引擎复核通过 + 64-hex sha），且后续 inspect 观察到它。
      expect(artifact.saved).toBe(true);
      expect(artifact.verificationOk).toBe(true);
      expect(artifact.mutationSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(artifact.inspectObjectNames).toContain("GamosRuntimeCube");
      console.log(
        `[gamos-evidence] G3 dependent chain: GamosRuntimeCube observed by the follow-up inspect; saved blend sha256=${artifact.mutationSha256}`,
      );

      // 串行化证据：ask#2 的派发不早于 ask#1 的结算。
      const r1 = driver.recordFor("ask#1");
      const r2 = driver.recordFor("ask#2");
      expect(r2?.startedAt!).toBeGreaterThanOrEqual(r1?.settledAt!);
      const gapMs = (r2?.startedAt ?? 0) - (r1?.settledAt ?? 0);
      console.log(`[gamos-evidence] G3 serialization: ask#2 dispatched ${gapMs}ms after ask#1 settled`);

      // journal 次序：node-settled(ask#1) 先于 node-queued / node-dispatched(ask#2)。
      const events = driver.events;
      const settledAsk1 = events.findIndex(
        (e) => e.type === "node-settled" && e.instance.siteId === "ask#1" && e.outcome === "ok",
      );
      const queuedAsk2 = events.findIndex((e) => e.type === "node-queued" && e.instance.siteId === "ask#2");
      const dispatchedAsk2 = events.findIndex(
        (e) => e.type === "node-dispatched" && e.instance.siteId === "ask#2",
      );
      expect(settledAsk1).toBeGreaterThanOrEqual(0);
      expect(queuedAsk2).toBeGreaterThanOrEqual(0);
      expect(dispatchedAsk2).toBeGreaterThanOrEqual(0);
      expect(settledAsk1).toBeLessThan(queuedAsk2);
      expect(settledAsk1).toBeLessThan(dispatchedAsk2);

      expect(journal.getNode("g3-dependent", "ask#1", 1)?.status).toBe("completed");
      expect(journal.getNode("g3-dependent", "ask#2", 1)?.status).toBe("completed");
    },
    240_000,
  );

  it(
    "conflicting unordered writes are prevented before execution; the serialized variant executes consistently",
    async () => {
      // —— 冲突门（parseGamePlan，执行之前）：同一 asset-path 上的两笔 unordered write 被拒。
      const claimWrite = (path: string) => ({
        schemaVersion: 1,
        claims: [{ access: "write" as const, scope: "asset-path" as const, path }],
      });
      const planBase = {
        planId: "plan-g3-conflict",
        conceptRef: { conceptId: "concept-g3", conceptSha256: "a".repeat(64) },
        permissions: [
          { kind: "engine-headless" as const, scope: "workspace", rationale: "headless blender mutation" },
        ],
        acceptanceRecord: { recordId: "record-g3", recordSha256: "b".repeat(64) },
        artifactExpectations: [{ artifactKind: "scene" as const, verificationMethod: "engine-query" as const }],
        executionConstraints: { maxConcurrency: 2 },
        createdAt: "2026-11-08T00:00:00+00:00",
        provenance: { authoredBy: "tl" as const },
      };
      const unorderedPlan = {
        ...planBase,
        steps: [
          {
            stepId: "step-write-a",
            capability: { capabilityId: "blender/scene.modify", capabilityVersion: "1.0.0", input: {} },
            dependsOn: [],
            resourceClaims: claimWrite("assets/scene.blend"),
          },
          {
            stepId: "step-write-b",
            capability: { capabilityId: "blender/scene.modify", capabilityVersion: "1.0.0", input: {} },
            dependsOn: [],
            resourceClaims: claimWrite("assets/scene.blend"),
          },
        ],
      };
      expect(() => parseGamePlan(unorderedPlan)).toThrow(/conflicting unordered claims/);
      expect(() => parseGamePlan(unorderedPlan)).toThrow(/dependsOn/);

      // —— 串行化变体（同一计划 + 显式 dependsOn step-write-b→step-write-a）解析干净。
      const serializedPlan = {
        ...planBase,
        steps: [
          {
            stepId: "step-write-a",
            capability: { capabilityId: "blender/scene.modify", capabilityVersion: "1.0.0", input: {} },
            dependsOn: [],
            resourceClaims: claimWrite("assets/scene.blend"),
          },
          {
            stepId: "step-write-b",
            capability: { capabilityId: "blender/scene.modify", capabilityVersion: "1.0.0", input: {} },
            dependsOn: ["step-write-a"],
            resourceClaims: claimWrite("assets/scene.blend"),
          },
        ],
      };
      const plan = parseGamePlan(serializedPlan);
      expect(plan.steps[1]?.dependsOn).toEqual(["step-write-a"]);
      console.log("[gamos-evidence] G3 conflict gate: unordered write-write REJECTED at parse; serialized variant accepted");

      // —— 串行变体经真实 runtime 执行（依赖序 = 脚本的 await 序）：终态一致。
      const script = [
        OBJECT_SUMMARY_IFACE,
        SCENE_IFACE,
        INSPECT_IFACE,
        MODIFY_IFACE,
        'const claimantA = agent("claimant-a", "Serialized write 1 to blend A.");',
        'const claimantB = agent("claimant-b", "Serialized write 2 to blend A.");',
        'const verifier = agent("verifier", "Verifies the combined final state.");',
        'const first = await claimantA.ask<SceneModifyOutcome>("Serialized write 1: add GamosClaimCubeA.");',
        'const second = await claimantB.ask<SceneModifyOutcome>("Serialized write 2: add GamosClaimCubeB.");',
        'const final = await verifier.ask<SceneInspectOutcome>("Inspect the final combined state.");',
        "const objects = final.scenes[0].objects.map((o) => ({ name: o.name, location: o.location, scale: o.scale }));",
        "return { bothSaved: first.saved && second.saved, objects };",
      ].join("\n");

      const handlers: Record<string, EngineAskHandler> = {
        "ask#1": (ctx) =>
          sceneModify(
            BLENDER,
            {
              blendFile: blendA,
              operations: [{ op: "add-primitive", primitive: "cube", name: "GamosClaimCubeA", location: [1, 0, 0] }],
              save: true,
            },
            workspace,
            { timeoutMs: OP_TIMEOUT, signal: ctx.signal },
          ),
        "ask#2": (ctx) =>
          sceneModify(
            BLENDER,
            {
              blendFile: blendA,
              operations: [
                { op: "add-primitive", primitive: "cube", name: "GamosClaimCubeB", location: [3, 0, 0], scale: [2, 1, 1] },
              ],
              save: true,
            },
            workspace,
            { timeoutMs: OP_TIMEOUT, signal: ctx.signal },
          ),
        "ask#3": (ctx) =>
          sceneInspect(BLENDER, { blendFile: blendA }, workspace, { timeoutMs: OP_TIMEOUT, signal: ctx.signal }),
      };
      const journal = new InMemoryJournalStore();
      const driver = new GamosEngineDriver(journal, { handlers });
      const { settlement } = await runEngineScript(script, driver, { runId: "g3-serialized" });

      expect(settlement.status).toBe("completed");
      const artifact = (settlement as {
        artifact: { bothSaved: boolean; objects: { name: string; location?: number[] | null; scale?: number[] | null }[] };
      }).artifact;
      expect(artifact.bothSaved).toBe(true);
      const cubeA = artifact.objects.find((o) => o.name === "GamosClaimCubeA");
      const cubeB = artifact.objects.find((o) => o.name === "GamosClaimCubeB");
      expect(cubeA).toBeDefined();
      expect(cubeB).toBeDefined();
      // 终态精确校验（镜像 blender 插件集成测试的核对方式）。
      expect(cubeA?.location?.[0]).toBeCloseTo(1, 6);
      expect(cubeA?.location?.[1]).toBeCloseTo(0, 6);
      expect(cubeA?.location?.[2]).toBeCloseTo(0, 6);
      expect(cubeB?.location?.[0]).toBeCloseTo(3, 6);
      expect(cubeB?.location?.[1]).toBeCloseTo(0, 6);
      expect(cubeB?.location?.[2]).toBeCloseTo(0, 6);
      expect(cubeB?.scale?.[0]).toBeCloseTo(2, 6);
      expect(cubeB?.scale?.[1]).toBeCloseTo(1, 6);
      expect(cubeB?.scale?.[2]).toBeCloseTo(1, 6);
      for (const site of ["ask#1", "ask#2", "ask#3"]) {
        expect(journal.getNode("g3-serialized", site, 1)?.status).toBe("completed");
      }
      console.log(
        `[gamos-evidence] G3 serialized execution: both mutations applied, final scene has ${artifact.objects.length} objects with exact transforms`,
      );
    },
    300_000,
  );

  // ——————————————————————————————— G4 — resume ———————————————————————————————

  it(
    "an interrupted workflow resumes from the durable journal without re-executing completed steps",
    async () => {
      const script = [
        OBJECT_SUMMARY_IFACE,
        SCENE_IFACE,
        INSPECT_IFACE,
        MODIFY_IFACE,
        "interface ExportDependentFileSummary { path: string; mediaType: string; byteLength: number; sha256: string; }",
        "interface AppliedInterchangeSummary { format: string; handedness: string; upAxis: string; forwardAxis?: string; units: string; scaleFactor?: number; appliedTransforms?: string; materials?: { referenced: string[]; embedded: boolean }; }",
        "interface AssetExportOutcome { ok: boolean; outputPath: string; bytes: number; sha256: string; format: string; selection: string[] | null; blenderVersion: string; sourceSha256: string; unitScale: number; appliedInterchange: AppliedInterchangeSummary; dependentFiles: ExportDependentFileSummary[]; }",
        'const mutator = agent("mutator", "Mutates blend B.");',
        'const inspector = agent("inspector", "Inspects blend B.");',
        'const exporter = agent("exporter", "Exports the mutated cube.");',
        'const mutation = await mutator.ask<SceneModifyOutcome>("Resume leg 1: add GamosResumeCube to blend B.");',
        'const inspection = await inspector.ask<SceneInspectOutcome>("Resume leg 2: inspect blend B.");',
        'const exported = await exporter.ask<AssetExportOutcome>("Resume leg 3: export GamosResumeCube to OBJ.");',
        'const objText = await files.read("exports/gamos-resume-cube.obj");',
        "return {",
        "  saved: mutation.saved,",
        '  sawCube: inspection.scenes[0].objects.map((o) => o.name).includes("GamosResumeCube"),',
        "  exportBytes: exported.bytes,",
        "  exportSha256: exported.sha256,",
        '  objContainsCube: objText.includes("GamosResumeCube"),',
        "};",
      ].join("\n");

      const objPath = join(workspace, "exports", "gamos-resume-cube.obj");
      const journal = new InMemoryJournalStore();
      const controller = new AbortController();

      // 第一趟：ask#1（真实 modify）与 ask#2（真实 inspect）完成落库；ask#2 的结果**落库之后**
      // 的同一拍里中止整个 run（onSubmitted 在 askSubmitAttempted 返回后同步触发——journal 行
      // 已然 durable），于是 ask#3（导出）从未派发。
      const firstDriver = new GamosEngineDriver(journal, {
        handlers: {
          "ask#1": (ctx) =>
            sceneModify(
              BLENDER,
              {
                blendFile: blendB,
                operations: [{ op: "add-primitive", primitive: "cube", name: "GamosResumeCube", location: [2, 2, 2] }],
                save: true,
              },
              workspace,
              { timeoutMs: OP_TIMEOUT, signal: ctx.signal },
            ),
          "ask#2": (ctx) =>
            sceneInspect(BLENDER, { blendFile: blendB }, workspace, { timeoutMs: OP_TIMEOUT, signal: ctx.signal }),
          "ask#3": (ctx) =>
            assetExport(
              BLENDER,
              { blendFile: blendB, outputPath: objPath, format: "OBJ", selection: ["GamosResumeCube"] },
              workspace,
              { timeoutMs: OP_TIMEOUT, signal: ctx.signal },
            ),
        },
        onSubmitted: (instance) => {
          if (instance.siteId === "ask#2") controller.abort();
        },
      });
      const first = await runEngineScript(script, firstDriver, {
        runId: "g4-resume",
        signal: controller.signal,
      });

      expect(first.settlement).toEqual({ status: "stopped", reason: "user" });
      expect(journal.getRun("g4-resume")?.status).toBe("stopped");
      expect(journal.getNode("g4-resume", "ask#1", 1)?.status).toBe("completed");
      expect(journal.getNode("g4-resume", "ask#2", 1)?.status).toBe("completed");
      const n3 = journal.getNode("g4-resume", "ask#3", 1);
      expect(n3 === undefined || n3.status !== "completed").toBe(true);
      console.log(
        `[gamos-evidence] G4 resume leg 1: stopped after ask#2 settled (ask#3 ${n3 === undefined ? "never dispatched" : `left ${n3.status}`})`,
      );

      // 第二趟：同一 journal + 逐字节同一脚本（scriptHash 一致）；已完成的 ask#1/ask#2 若被重新
      // 执行就大声失败；ask#3 真实导出。
      const secondDriver = new GamosEngineDriver(journal, {
        handlers: {
          "ask#1": () => {
            throw new Error("ask#1 must NOT re-execute on resume (journal hit required)");
          },
          "ask#2": () => {
            throw new Error("ask#2 must NOT re-execute on resume (journal hit required)");
          },
          "ask#3": (ctx) =>
            assetExport(
              BLENDER,
              { blendFile: blendB, outputPath: objPath, format: "OBJ", selection: ["GamosResumeCube"] },
              workspace,
              { timeoutMs: OP_TIMEOUT, signal: ctx.signal },
            ),
        },
        worldReads: (op, args) => {
          if (op === "read") return readFile(join(workspace, String(args[0])), "utf8");
          return op === "glob" ? [] : "";
        },
      });
      const second = await runEngineScript(script, secondDriver, { runId: "g4-resume" });

      expect(second.settlement.status).toBe("completed");
      const artifact = (second.settlement as {
        artifact: {
          saved: boolean;
          sawCube: boolean;
          exportBytes: number;
          exportSha256: string;
          objContainsCube: boolean;
        };
      }).artifact;
      // 复放出来的前两步结果 + 新执行的真实导出，整合成最终 artifact。
      expect(artifact.saved).toBe(true);
      expect(artifact.sawCube).toBe(true);
      expect(artifact.objContainsCube).toBe(true);
      expect(artifact.exportBytes).toBeGreaterThan(0);
      expect(artifact.exportSha256).toMatch(/^[0-9a-f]{64}$/);

      // 完成的步骤零重派发：run 2 只有 ask#3 真正 startAsk。
      expect(secondDriver.startAsksFor("ask#1")).toHaveLength(0);
      expect(secondDriver.startAsksFor("ask#2")).toHaveLength(0);
      expect(secondDriver.startAsksFor("ask#3")).toHaveLength(1);
      expect(secondDriver.sessionCreations).toHaveLength(1);
      // 复放短路证据：cached 结算事件 ≥ 2（ask#1、ask#2）。
      const cached = secondDriver.eventsOfType("node-settled").filter((e) => e.cached === true);
      expect(cached.length).toBeGreaterThanOrEqual(2);

      // 导出产物在盘上真实存在、字节与 sha256 与 run 2 的结果一致、内容含突变对象名。
      const objStat = await stat(objPath);
      expect(objStat.size).toBe(artifact.exportBytes);
      const objBytes = await readFile(objPath);
      expect(createHash("sha256").update(objBytes).digest("hex")).toBe(artifact.exportSha256);
      expect(objBytes.toString("utf8")).toContain("GamosResumeCube");
      console.log(
        `[gamos-evidence] G4 resume leg 2: ask#3 exported ${objStat.size} bytes (sha256=${artifact.exportSha256}) reflecting the pre-abort GamosResumeCube mutation`,
      );
    },
    300_000,
  );

  // ——————————————————————————————— G4 — 取消 ———————————————————————————————

  it(
    "cancellation during a real engine operation kills the engine subprocess and never reports success",
    async () => {
      const script = [
        "interface SceneRenderOutcome { ok: boolean; outputPath: string; bytes: number; sha256: string; engine: string; device: string | null; resolution: { x: number; y: number }; cameraProvisioned: boolean; }",
        'const renderer = agent("renderer", "Renders the big frame.");',
        'const follower = agent("follower", "A dependent step that must never start.");',
        'const rendered = await renderer.ask<SceneRenderOutcome>("Render blend A at 3200x2400 with CYCLES.");',
        'const followUp = await follower.ask<string>("Dependent follow-up after the render.");',
        "return { renderBytes: rendered.bytes, followUp };",
      ].join("\n");

      const renderOutput = join(workspace, "render-big.png");
      const journal = new InMemoryJournalStore();
      const controller = new AbortController();
      const driver = new GamosEngineDriver(journal, {
        handlers: {
          "ask#1": (ctx) => {
            // op 起跑 ~500ms 后外部中止（3200x2400 CYCLES 需数秒，必然仍在飞）。
            setTimeout(() => controller.abort(), 500);
            return sceneRender(
              BLENDER,
              { blendFile: blendA, outputPath: renderOutput, engine: "CYCLES", resolution: { x: 3200, y: 2400 } },
              workspace,
              { timeoutMs: 240_000, signal: ctx.signal },
            );
          },
        },
      });
      const { settlement } = await runEngineScript(script, driver, {
        runId: "g4-cancel",
        signal: controller.signal,
      });

      // run 停下而不是完成；绝不报告成功。
      expect(settlement).toEqual({ status: "stopped", reason: "user" });
      expect(journal.getRun("g4-cancel")?.status).toBe("stopped");
      // 在飞节点留在 running（准入记录保留），绝不是 completed。
      expect(journal.getNode("g4-cancel", "ask#1", 1)?.status).toBe("running");
      // 依赖步骤从未派发。
      expect(driver.startAsksFor("ask#2")).toHaveLength(0);
      expect(driver.recordFor("ask#2")).toBeUndefined();
      // cancelAsk 到达 driver（并在那里中止了 op 的 AbortController）。
      expect(driver.cancels.some((i) => i.siteId === "ask#1")).toBe(true);

      // 引擎操作以结构化 aborted 失败兑现——插件 kill 了整棵进程树，没有孤儿子进程，
      // 也没有被谎报的成功。
      const rec = await driver.opSettled("ask#1");
      expect(rec.outcome).toBe("failed");
      expect(rec.structuredFailure?.code).toBe("aborted");
      const failure = rec.opResult as { ok: boolean; code: string } | undefined;
      expect(failure?.ok).toBe(false);
      expect(existsSync(renderOutput)).toBe(false);
      console.log(
        `[gamos-evidence] G4 cancellation: structured failure code=${rec.structuredFailure?.code} (${rec.structuredFailure?.message}); render artifact never landed; dependent ask never dispatched`,
      );
    },
    120_000,
  );
});
