/**
 * Canonical deterministic serialization for the Gamos domain documents
 * (contract 01 §3: plain serializable data; deterministic serialization/hash
 * behavior where the upstream GameIR contract requires it).
 *
 * Canonical JSON: sorted object keys (Unicode code-point order), no
 * insignificant whitespace, UTF-8. Arrays keep their order (order is
 * semantic). The digest is SHA-256 over the canonical bytes.
 */

import { createHash } from "node:crypto";

/** Serializes any JSON-safe value to canonical JSON (sorted keys, no spaces). */
export function canonicalJson(value: unknown): string {
  return stringifyCanonical(value);
}

/** SHA-256 digest of the canonical serialization. */
export function canonicalSha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function stringifyCanonical(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) {
    throw new TypeError("GAMOS/DOMAIN: undefined is not serializable (fail closed)");
  }
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number": {
      if (!Number.isFinite(value)) {
        throw new TypeError(`GAMOS/DOMAIN: non-finite number ${value} is not serializable (fail closed)`);
      }
      return JSON.stringify(value);
    }
    case "string":
      return JSON.stringify(value);
    case "object":
      break;
    default:
      throw new TypeError(`GAMOS/DOMAIN: value of type ${typeof value} is not serializable (fail closed)`);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stringifyCanonical(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stringifyCanonical(record[key])}`)
    .join(",")}}`;
}

/** Non-mutating deep clone via canonical JSON round-trip. */
export function canonicalClone<T extends object>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}

/**
 * Fail-closed structural check: is the value JSON-safe (no cycles, no
 * functions, no symbols, no undefined properties reachable)?
 */
export function assertJsonSafe(value: unknown): void {
  assertSafe(value, new WeakSet<object>());
}

function assertSafe(value: unknown, seen: WeakSet<object>): void {
  if (value === null) return;
  switch (typeof value) {
    case "boolean":
    case "number":
    case "string":
      return;
    case "undefined":
    case "function":
    case "symbol":
    case "bigint":
      throw new TypeError(
        `GAMOS/DOMAIN: ${typeof value} is not serializable (fail closed)`,
      );
    case "object":
      break;
    default:
      throw new TypeError(`GAMOS/DOMAIN: unexpected type ${typeof value}`);
  }
  const object = value as object;
  if (seen.has(object)) {
    throw new TypeError("GAMOS/DOMAIN: circular reference detected (fail closed)");
  }
  seen.add(object);
  try {
    if (Array.isArray(object)) {
      for (const entry of object) assertSafe(entry, seen);
      return;
    }
    for (const key of Object.keys(object)) {
      assertSafe((object as Record<string, unknown>)[key], seen);
    }
  } finally {
    seen.delete(object);
  }
}
