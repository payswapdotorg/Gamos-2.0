/**
 * R14 deterministic-evaluation contracts.
 *
 * These are the pure function signatures and value equality/hashing rules
 * that simulation and replay will rely on (lock rules 12/15): the same
 * value, intent, command or document always canonicalizes and hashes to
 * the same output on every machine.
 *
 * Canonicalization rules (frozen):
 * - unit   -> `u()`
 * - bool   -> `b(1)` / `b(0)`
 * - int    -> `i(<decimal bigint>)`
 * - float  -> `f(<canonical float>)` where canonical float is
 *             `nan` | `inf` | `-inf` | `-0` | `String(v)`.
 *             Consequences: NaN equals NaN; -0 and +0 are DISTINCT;
 *             int 1 and float 1.0 are DISTINCT kinds.
 * - string -> `s(<JSON.stringify>)`
 * - list   -> `l[<item>,...]` (order significant)
 * - record -> `r{"<key>":<value>,...}` with keys sorted in UTF-16
 *             code-unit order (record field order is never significant)
 * - entity-ref -> `e(<world>,<scene>,<entity>)` with JSON-escaped segments
 *
 * `String(number)` is specified by ECMAScript (shortest round-trip decimal)
 * and is therefore deterministic across engines.
 *
 * Pure module: node:crypto hashing only, no other IO.
 */

import { createHash } from "node:crypto";
import type { EntityRef } from "../game-contracts/index.js";
import type { GameIRValue } from "./values.js";
import type { Command, GameEvent, Intent } from "./semantics.js";

/** Canonical textual form of a float per the frozen rules above. */
export function canonicalFloatForm(value: number): string {
  if (Number.isNaN(value)) return "nan";
  if (value === Number.POSITIVE_INFINITY) return "inf";
  if (value === Number.NEGATIVE_INFINITY) return "-inf";
  if (Object.is(value, -0)) return "-0";
  return String(value);
}

function canonicalEntityRefForm(ref: EntityRef): string {
  return `e(${JSON.stringify(ref.world)},${JSON.stringify(ref.scene)},${JSON.stringify(ref.entity)})`;
}

/** Canonical, deterministic textual form of a GameIR value. */
export function canonicalValueForm(value: GameIRValue): string {
  switch (value.kind) {
    case "unit":
      return "u()";
    case "bool":
      return value.value ? "b(1)" : "b(0)";
    case "int":
      return `i(${value.value.toString(10)})`;
    case "float":
      return `f(${canonicalFloatForm(value.value)})`;
    case "string":
      return `s(${JSON.stringify(value.value)})`;
    case "list":
      return `l[${value.items.map((item) => canonicalValueForm(item)).join(",")}]`;
    case "record": {
      const keys = Object.keys(value.fields).sort();
      const parts = keys.map((key) => {
        const field = value.fields[key];
        return field === undefined ? "" : `${JSON.stringify(key)}:${canonicalValueForm(field)}`;
      });
      return `r{${parts.join(",")}}`;
    }
    case "entity-ref":
      return canonicalEntityRefForm(value.ref);
  }
}

/**
 * Value equality under the frozen canonicalization rules. Field order of
 * records never matters; NaN equals NaN; -0 differs from +0; ints and
 * floats are different kinds and never equal.
 */
export function gameIRValuesEqual(a: GameIRValue, b: GameIRValue): boolean {
  return canonicalValueForm(a) === canonicalValueForm(b);
}

/** SHA-256 (hex) of the canonical form of `value`. */
export function hashGameIRValue(value: GameIRValue): string {
  return createHash("sha256").update(canonicalValueForm(value)).digest("hex");
}

/** Canonical form of an intent. Basis-free: intents stand alone. */
export function canonicalIntentForm(intent: Intent): string {
  const avatar = intent.actor.avatar === undefined ? "null" : JSON.stringify(intent.actor.avatar);
  return `it(${JSON.stringify(intent.type)},${canonicalValueForm(intent.payload)},${JSON.stringify(intent.actor.agent)},${avatar},${intent.tick})`;
}

/** Canonical form of a command. `basis` order is significant. */
export function canonicalCommandForm(command: Command): string {
  const basis = command.basis.map((intent) => canonicalIntentForm(intent)).join(",");
  return `cmd(${JSON.stringify(command.type)},${canonicalValueForm(command.payload)},${canonicalEntityRefForm(command.target)},${command.tick},basis=[${basis}])`;
}

/** Canonical form of an event. */
export function canonicalEventForm(event: GameEvent): string {
  const source = event.source === undefined ? "null" : canonicalEntityRefForm(event.source);
  return `ev(${JSON.stringify(event.type)},${canonicalValueForm(event.payload)},${source},${event.tick})`;
}

/** SHA-256 (hex) of the canonical form of an intent. */
export function hashIntent(intent: Intent): string {
  return createHash("sha256").update(canonicalIntentForm(intent)).digest("hex");
}

/** SHA-256 (hex) of the canonical form of a command. */
export function hashCommand(command: Command): string {
  return createHash("sha256").update(canonicalCommandForm(command)).digest("hex");
}

/** SHA-256 (hex) of the canonical form of an event. */
export function hashEvent(event: GameEvent): string {
  return createHash("sha256").update(canonicalEventForm(event)).digest("hex");
}

/**
 * A pure evaluator contract: same input, same output; no IO, clocks or
 * randomness. This is the signature simulation and replay implement.
 */
export type DeterministicEvaluator<I, O> = (input: I) => O;

/** Output of a simulation step: next state plus emitted events. */
export type SimulationStepOutput = {
  readonly state: GameIRValue;
  readonly events: readonly GameEvent[];
};

/** Input of a simulation step: current state plus adjudicated commands. */
export type SimulationStepInput = {
  readonly state: GameIRValue;
  readonly commands: readonly Command[];
};

export type SimulationStep = DeterministicEvaluator<SimulationStepInput, SimulationStepOutput>;

/**
 * Empirical determinism check for a {@link SimulationStep}: runs it twice
 * on the same input and compares canonical forms. A `true` result is
 * evidence, not proof — but a `false` result is a determinism BUG in the
 * step implementation, and replay built on it will diverge.
 */
export function verifySimulationStepDeterminism(step: SimulationStep, input: SimulationStepInput): boolean {
  const first: SimulationStepOutput = step(input);
  const second: SimulationStepOutput = step(input);
  if (canonicalValueForm(first.state) !== canonicalValueForm(second.state)) return false;
  if (first.events.length !== second.events.length) return false;
  for (let index = 0; index < first.events.length; index += 1) {
    const left = first.events[index];
    const right = second.events[index];
    if (left === undefined || right === undefined) return false;
    if (canonicalEventForm(left) !== canonicalEventForm(right)) return false;
  }
  return true;
}
