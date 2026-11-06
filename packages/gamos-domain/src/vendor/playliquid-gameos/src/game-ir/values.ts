/**
 * R14 contract vocabulary: the GameIR value system.
 *
 * GameIR values are the engine-independent data language of the semantic
 * kernel. Every payload, entity state and declaration argument in a GameIR
 * document is built from these values, so their structure is deliberately
 * small, totally ordered and canonically serializable (see `evaluate.ts`).
 *
 * Determinism rules baked into the value system:
 * - integers are arbitrary-precision `bigint` (no float drift);
 * - floats are IEEE-754 float64 with explicitly specified canonical forms;
 * - record fields are unordered at the type level but canonically ordered
 *   (UTF-16 code-unit key order) during evaluation/hashing.
 *
 * Pure module.
 */

import { isEntityRef } from "../game-contracts/index.js";
import type { EntityRef } from "../game-contracts/index.js";

/** A GameIR value. See module docs for the determinism rules. */
export type GameIRValue =
  | { readonly kind: "unit" }
  | { readonly kind: "bool"; readonly value: boolean }
  | { readonly kind: "int"; readonly value: bigint }
  | { readonly kind: "float"; readonly value: number }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "list"; readonly items: readonly GameIRValue[] }
  | { readonly kind: "record"; readonly fields: Readonly<Record<string, GameIRValue>> }
  | { readonly kind: "entity-ref"; readonly ref: EntityRef };

/** Discriminator values of {@link GameIRValue}. */
export type GameIRValueKind = GameIRValue["kind"];

/** All valid {@link GameIRValueKind} values. */
export const GAME_IR_VALUE_KINDS: readonly GameIRValueKind[] = Object.freeze([
  "unit",
  "bool",
  "int",
  "float",
  "string",
  "list",
  "record",
  "entity-ref",
]);

/** Returns true when `value` is a valid {@link GameIRValueKind}. */
export function isGameIRValueKind(value: unknown): value is GameIRValueKind {
  return typeof value === "string" && (GAME_IR_VALUE_KINDS as readonly string[]).includes(value);
}

/**
 * Record keys that are structurally dangerous (prototype-pollution-shaped)
 * and therefore rejected by the value guard and by `validate`.
 */
export const FORBIDDEN_RECORD_KEYS: readonly string[] = Object.freeze(["__proto__", "constructor", "prototype"]);

/** Structural budget: maximum nesting depth of a value tree. */
export const MAX_VALUE_DEPTH = 64;
/** Structural budget: maximum length of a list value. */
export const MAX_LIST_LENGTH = 4096;
/** Structural budget: maximum number of fields in a record value. */
export const MAX_RECORD_FIELDS = 256;

/**
 * Total structural guard for {@link GameIRValue}, including the depth/size
 * budgets. Never throws; never performs IO.
 */
export function isGameIRValue(value: unknown, depth = 0): value is GameIRValue {
  if (depth > MAX_VALUE_DEPTH) return false;
  if (typeof value !== "object" || value === null) return false;
  const node = value as Record<string, unknown>;
  switch (node.kind) {
    case "unit":
      return true;
    case "bool":
      return typeof node.value === "boolean";
    case "int":
      return typeof node.value === "bigint";
    case "float":
      return typeof node.value === "number";
    case "string":
      return typeof node.value === "string";
    case "list": {
      if (!Array.isArray(node.items)) return false;
      if (node.items.length > MAX_LIST_LENGTH) return false;
      return node.items.every((item) => isGameIRValue(item, depth + 1));
    }
    case "record": {
      if (typeof node.fields !== "object" || node.fields === null) return false;
      const fields = node.fields as Record<string, unknown>;
      const keys = Object.keys(fields);
      if (keys.length > MAX_RECORD_FIELDS) return false;
      for (const key of keys) {
        if (key.length === 0 || (FORBIDDEN_RECORD_KEYS as readonly string[]).includes(key)) return false;
        if (!isGameIRValue(fields[key], depth + 1)) return false;
      }
      return true;
    }
    case "entity-ref":
      return isEntityRef(node.ref);
    default:
      return false;
  }
}

/** Returns the kind discriminator of a *valid* value. */
export function gameIRValueKind(value: GameIRValue): GameIRValueKind {
  return value.kind;
}
