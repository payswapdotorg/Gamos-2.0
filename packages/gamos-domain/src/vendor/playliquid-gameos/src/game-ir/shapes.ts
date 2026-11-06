/**
 * Value shapes: the declarative type language used by event and node
 * declarations to describe what a payload must look like.
 *
 * Shapes are structural descriptions — checking a value against a shape is
 * a pure function (`valueMatchesShape`), never a coercion or a schema
 * library dependency (E3: no provider SDKs in domain contracts).
 *
 * Pure module.
 */

import { isGameIRValue } from "./values.js";
import type { GameIRValue } from "./values.js";

/** Describes the structure of a {@link GameIRValue}. */
export type ValueShape =
  | { readonly kind: "unit" }
  | { readonly kind: "bool" }
  | { readonly kind: "int" }
  | { readonly kind: "float" }
  | { readonly kind: "string" }
  | { readonly kind: "list"; readonly element: ValueShape }
  | { readonly kind: "record"; readonly fields: Readonly<Record<string, ValueShape>> }
  | { readonly kind: "entity-ref" };

/** Returns true when `value` is structurally a valid {@link ValueShape}. */
export function isValueShape(value: unknown, depth = 0): value is ValueShape {
  if (depth > 64) return false;
  if (typeof value !== "object" || value === null) return false;
  const shape = value as Record<string, unknown>;
  switch (shape.kind) {
    case "unit":
    case "bool":
    case "int":
    case "float":
    case "string":
    case "entity-ref":
      return true;
    case "list":
      return isValueShape(shape.element, depth + 1);
    case "record": {
      if (typeof shape.fields !== "object" || shape.fields === null) return false;
      const fields = shape.fields as Record<string, unknown>;
      for (const key of Object.keys(fields)) {
        if (key.length === 0) return false;
        if (!isValueShape(fields[key], depth + 1)) return false;
      }
      return true;
    }
    default:
      return false;
  }
}

/** Returns true when `value` satisfies `shape`. Both must be valid. */
export function valueMatchesShape(value: GameIRValue, shape: ValueShape): boolean {
  if (!isGameIRValue(value)) return false;
  if (value.kind !== shape.kind) return false;
  switch (value.kind) {
    case "list": {
      if (shape.kind !== "list") return false;
      return value.items.every((item) => valueMatchesShape(item, shape.element));
    }
    case "record": {
      if (shape.kind !== "record") return false;
      for (const key of Object.keys(shape.fields)) {
        const field = value.fields[key];
        if (field === undefined) return false;
        const fieldShape = shape.fields[key];
        if (fieldShape === undefined) return false;
        if (!valueMatchesShape(field, fieldShape)) return false;
      }
      return true;
    }
    case "unit":
    case "bool":
    case "int":
    case "float":
    case "string":
    case "entity-ref":
      return true;
  }
}
