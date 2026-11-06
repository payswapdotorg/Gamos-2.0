/**
 * GamePlan → Dynamic Workflow script artifact (directive §12 / contract 05 revision 2 — M1.5).
 *
 * The script IS the GamePlan: it is authored/compiled/executed by the EXISTING
 * ZCode Dynamic Workflow infrastructure (facade calls, compiler, runtime,
 * governor, dwf_* journal, run pane, resume/cancel). This module generates
 * the artifact deterministically from a validated GamePlan plus the
 * provenance-backed model context — it does NOT schedule, journal or execute
 * anything itself (explicit prohibitions, contract 05 §2).
 *
 * Mapping (contract 05 §2 table):
 *   plan steps        → agent() sites (one per step; capability work as asks)
 *   dependencies      → script structure (topological levels; Promise.all
 *                       within a level) — the compiler proves them
 *   parallelism       → Promise.all levels; the governor's max_concurrency
 *                       governs actual model concurrency (no Gamos scheduler)
 *   unavailable engine/capability → explicit throw guard BEFORE any step
 *                       (fail closed — never mock success, contract 05 §3 r3)
 *   acceptance        → report() completion + return summary referencing the
 *                       plan's AcceptanceRecord
 *   read-only plans   → only log/agent.ask/report calls are emitted; no
 *                       world.run / git mutation / files write
 */

import { hashGamePlan } from "./game-plan.js";
import type { GamePlan, GamePlanStep } from "./game-plan.js";
import { isEngineFamily } from "../engine-family.js";
import type { EngineFamily } from "../engine-family.js";
import type { GamingModelContext, ContextCapabilityEntry } from "./intent.js";

/** The generated script artifact plus the mapping record (machine-readable). */
export interface GamePlanWorkflowScript {
  readonly scriptText: string;
  readonly planId: string;
  readonly planSha256: string;
  readonly stepSites: readonly {
    readonly stepId: string;
    readonly agentName: string;
    readonly capabilityId: string;
    readonly capabilityVersion: string;
  }[];
  readonly guards: readonly {
    readonly family: EngineFamily;
    readonly state: string;
    readonly reason: string;
  }[];
  readonly readOnly: boolean;
  readonly stepCount: number;
  readonly parallelLevels: number;
  readonly generatedFrom: "gamos/model-context@1";
}

function familyOfCapability(context: GamingModelContext, capabilityId: string): EngineFamily | undefined {
  const entry: ContextCapabilityEntry | undefined = context.capabilities.find((c) => c.id === capabilityId);
  const family = entry?.engineFamily;
  return typeof family === "string" && isEngineFamily(family) ? family : undefined;
}

/** The engine state the context observed for a family (absent = unknown — fail closed). */
function observedEngineState(context: GamingModelContext, family: EngineFamily): { state: string; reason: string } {
  const engine = context.engines.find((e) => e.family === family);
  if (!engine) {
    return { state: "unknown", reason: `no machine-discovery observation for ${family} in the model context (fail closed)` };
  }
  return { state: engine.state, reason: engine.reason ?? `engine ${family} observed ${engine.state}` };
}

/** Topological levels of the plan's step DAG (parseGamePlan already proved it acyclic + resolvable). */
function topoLevels(steps: readonly GamePlanStep[]): GamePlanStep[][] {
  const byId = new Map(steps.map((s) => [s.stepId, s]));
  const done = new Set<string>();
  const levels: GamePlanStep[][] = [];
  let remaining = [...steps];
  while (remaining.length > 0) {
    const level = remaining.filter((s) => s.dependsOn.every((d) => done.has(d) || !byId.has(d)));
    if (level.length === 0) {
      // Unreachable for validated plans (acyclicity is proven upstream); keep a
      // deterministic fallback ordering so generation itself never loops.
      levels.push(remaining);
      break;
    }
    levels.push(level);
    for (const s of level) done.add(s.stepId);
    remaining = remaining.filter((s) => !done.has(s.stepId));
  }
  return levels;
}

/** A valid TS/JS identifier fragment for a step id (step ids may contain dashes). */
function sanitized(stepId: string): string {
  return stepId.replace(/[^A-Za-z0-9_]/g, "_");
}

const READ_ONLY_MARKER = /read[- ]only/i;

/**
 * Builds the Dynamic Workflow script artifact for a GamePlan from the model
 * context (real observations only — every guard and embedded state traces to
 * the context). Deterministic: the same plan + context produce byte-identical
 * output. Read-only plans emit only log/agent.ask/report calls.
 */
export function buildGamePlanWorkflowScript(plan: GamePlan, context: GamingModelContext): GamePlanWorkflowScript {
  const planSha256 = hashGamePlan(plan);
  const readOnly = READ_ONLY_MARKER.test(JSON.stringify(plan.executionConstraints ?? {})) || plan.steps.every((s) => Boolean(s.constraints?.read_only));

  // Required engine families: the plan's engine binding + every step capability's family.
  const requiredFamilies = new Set<EngineFamily>();
  if (plan.engineBinding && plan.engineBinding.engineFamily !== "core") {
    requiredFamilies.add(plan.engineBinding.engineFamily);
  }
  for (const step of plan.steps) {
    const family = familyOfCapability(context, step.capability.capabilityId);
    if (family !== undefined && family !== "core") requiredFamilies.add(family);
  }

  // Fail-closed guards: every required family must be observed "available".
  const guards = [...requiredFamilies].sort().map((family) => {
    const observed = observedEngineState(context, family);
    return { family, ...observed };
  });
  const failingGuards = guards.filter((g) => g.state !== "available");

  const stepSites = plan.steps.map((step) => ({
    stepId: step.stepId,
    agentName: `gamos-${plan.planId}-${step.stepId}`,
    capabilityId: step.capability.capabilityId,
    capabilityVersion: step.capability.capabilityVersion,
  }));
  const levels = topoLevels(plan.steps);

  const engineStatesLiteral = [...requiredFamilies].sort().map((family) => {
    const observed = observedEngineState(context, family);
    return `  ${JSON.stringify(family)}: ${JSON.stringify(observed.state)},`;
  }).join("\n");

  const lines: string[] = [];
  lines.push(`// Gamos GamePlan — Dynamic Workflow script artifact (contract 05 revision 2).`);
  lines.push(`// The script IS the GamePlan: compiled/executed/journaled by the existing ZCode`);
  lines.push(`// Dynamic Workflow infrastructure (dwf_* journal, run pane, resume/cancel).`);
  if (readOnly) {
    lines.push(`// Read-only plan: inspection/validation only — no writes, no git mutations, no`);
    lines.push(`// engine execution (M1 constraint; native engine mutations arrive in M2).`);
  }
  lines.push(`// plan: ${plan.planId} (sha256 ${planSha256})`);
  lines.push(`// context: gamos/model-context@1 generatedAt ${context.generatedAt}, observed via ${context.provenance.observedVia.join(", ")}`);
  lines.push(`// project: ${context.project.isProject ? `${context.project.identity ?? context.project.root} (${context.project.root})` : `non-project (${context.project.nonProjectReason ?? "no markers"})`}`);
  lines.push("");
  lines.push(`// Observed engine states (machine-local discovery JOIN — embedded evidence).`);
  lines.push(`// Guards fail closed: unavailable or unknown NEVER proceeds (never mock success).`);
  lines.push(`const engineStates: Readonly<Record<string, string>> = {`);
  lines.push(engineStatesLiteral.length > 0 ? engineStatesLiteral : `  core: "available",`);
  lines.push(`};`);
  lines.push("");
  lines.push(`log(${JSON.stringify(`Gamos GamePlan ${plan.planId}: ${plan.steps.length} steps, ${levels.length} level${levels.length === 1 ? "" : "s"}${readOnly ? ", read-only" : ""}`)});`);
  lines.push("");
  for (const guard of failingGuards) {
    lines.push(`// Fail-closed engine guard (contract 05 §3 rule 3): ${guard.family} is ${guard.state}.`);
    lines.push(`if (engineStates[${JSON.stringify(guard.family)}] !== "available") {`);
    lines.push(`  throw new Error(${JSON.stringify(`Gamos engine guard: ${guard.family} is ${guard.state} on this machine — ${guard.reason} (fail closed; never mock success)`)});`);
    lines.push(`}`);
    lines.push("");
  }
  for (const capability of context.capabilities) {
    if (!capability.resolved && plan.steps.some((s) => s.capability.capabilityId === capability.id)) {
      lines.push(`// Fail-closed capability guard: ${capability.id} could not be resolved.`);
      lines.push(`throw new Error(${JSON.stringify(`Gamos capability guard: ${capability.id} is unavailable — ${capability.reason ?? "unresolved"} (fail closed; never mock success)`)});`);
      lines.push("");
    }
  }
  const levelVarNames: string[][] = [];
  for (const [li, level] of levels.entries()) {
    const vars: string[] = [];
    for (const step of level) {
      const persona = readOnly
        ? "Gamos read-only capability executor. Inspect and report only; make no filesystem writes, no git mutations, no engine executions."
        : "Gamos capability executor. Follow the capability's contract and its permission requirements.";
      lines.push(`// step ${step.stepId} — capability ${step.capability.capabilityId} (${step.capability.capabilityVersion})`);
      const varName = `n_${sanitized(step.stepId)}`;
      lines.push(`const ${varName} = agent(${JSON.stringify(`gamos-${plan.planId}-${step.stepId}`)}, { system: ${JSON.stringify(persona)} }).ask(${JSON.stringify(
        `Execute capability ${step.capability.capabilityId} (${step.capability.capabilityVersion}) for GamePlan ${plan.planId}. Input: ${JSON.stringify(step.capability.input)}. ${
          readOnly ? "Read-only: observe and report; do not modify anything." : "Follow the capability contract."
        } Report what you actually observed.`,
      )});`);
      vars.push(varName);
    }
    if (vars.length === 1) {
      lines.push(`await ${vars[0]!};`);
    } else if (vars.length > 1) {
      lines.push(`await Promise.all([${vars.join(", ")}]);`);
    }
    lines.push(`log(${JSON.stringify(`Gamos GamePlan ${plan.planId}: level ${li + 1} complete (${level.map((s) => s.stepId).join(", ")})`)});`);
    lines.push("");
    levelVarNames.push(vars);
  }
  lines.push(
    `report(${JSON.stringify({ planId: plan.planId, planSha256, stepsCompleted: plan.steps.length, acceptanceRecord: plan.acceptanceRecord.recordId, readOnly })});`,
  );
  lines.push("");
  lines.push(
    `return { planId: ${JSON.stringify(plan.planId)}, planSha256: ${JSON.stringify(planSha256)}, stepsCompleted: ${plan.steps.length}, acceptanceRecord: ${JSON.stringify(plan.acceptanceRecord.recordId)} };`,
  );

  const scriptText = `${lines.join("\n")}\n`;

  return {
    scriptText,
    planId: plan.planId,
    planSha256,
    stepSites,
    guards,
    readOnly,
    stepCount: plan.steps.length,
    parallelLevels: levels.length,
    generatedFrom: "gamos/model-context@1",
  };
}
