/**
 * Pure workspace path computation for the cross-engine plan builder (M3.3).
 *
 * The domain layer must not import node builtins directly (architecture rule
 * `domain-io`), so — exactly like adapters/canonical.ts provides node:crypto
 * for deterministic hashing — this adapter provides the node:path primitives
 * the builder needs. Every function here is a PURE string/path computation:
 * no filesystem access, no process spawning, ever.
 *
 * Platform note: the functions use the host's node:path semantics. The
 * cross-engine request contract already fails closed on backslashes and
 * non-canonical roots (a forward-slash root that does not resolve to itself
 * is rejected), so a non-POSIX host rejects the request instead of silently
 * deriving different paths — fail closed, never wrong.
 */

import { isAbsolute, join, relative, resolve, sep } from "node:path";

/** Is the value an absolute path (host semantics)? */
export function isAbsoluteHostPath(value: string): boolean {
  return isAbsolute(value);
}

/** Canonical resolved form (equal to the input iff the input is already canonical). */
export function resolveHostPath(value: string): string {
  return resolve(value);
}

/** Joins path segments into one path (host semantics — used for op input derivation). */
export function joinHostPath(...segments: string[]): string {
  return join(...segments);
}

/**
 * Path of `to` relative to `from`, normalized to forward slashes (the
 * canonical workspace-relative POSIX form the resource-claim contract uses).
 */
export function relativeHostPath(from: string, to: string): string {
  return relative(from, to).split(sep).join("/");
}
