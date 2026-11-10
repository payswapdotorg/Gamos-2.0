/**
 * The reviewed per-function invocation allowlist (M4 WP-5) — readiness §4.2:
 * unrestricted remote function execution, remote Python execution and remote
 * console-command execution are DISABLED. Only individually reviewed, typed
 * invocations are possible, and every functionName is validated against this
 * allowlist BEFORE any request is built.
 *
 * The WP-4 record pins the discipline VERBATIM
 * (packages/gamos-domain/src/domain/engine-plugin-unreal.ts,
 * `unreal/function.invoke`): "The reviewed allowlist is EMPTY at 1.0.0: no
 * function has passed review yet, so every functionName fails closed
 * client-side until an entry lands with its own reviewed argument schema —
 * each added function is a record version bump (the append-only encoding
 * this line pins), and a GENERIC unrestricted function.call capability is
 * FORBIDDEN by design."
 *
 * This module is that allowlist. It is EMPTY at connector 0.1.0 for exactly
 * the recorded reason: no function has passed review. The connector accepts
 * the allowlist as a constructor option (defaulting to this constant) so the
 * protocol machinery remains contract-testable against injected REVIEW-CLASS
 * entries — the shipped default stays fail-closed for every functionName.
 */

import type { z } from "zod";
import { isValidFunctionName } from "./object-paths.js";

/** A single reviewed function entry: an exact functionName plus its scope. */
export interface ReviewedFunctionEntry {
  /** The exact reviewed function name (identifier grammar, fail-closed). */
  functionName: string;
  /**
   * The reviewed object-path scope this function may be invoked on: an exact
   * validated object path, or an exact package-path prefix ending in "/".
   * The connector refuses invocations outside the reviewed scope.
   */
  objectPathPrefix: string;
  /** The reviewed argument schema — arguments are validated BEFORE any request. */
  argumentSchema: z.ZodType;
}

/**
 * The reviewed per-function allowlist — EMPTY at 0.1.0 (no function has
 * passed review). Adding an entry is a reviewed change with a connector
 * version bump; the register-side record version bumps with it (the
 * append-only encoding the WP-4 record pins).
 */
export const REVIEWED_FUNCTION_ALLOWLIST: readonly ReviewedFunctionEntry[] = [];

/** Fail-closed lookup: an entry for this functionName within this object path's scope. */
export function findReviewedFunction(
  allowlist: readonly ReviewedFunctionEntry[],
  functionName: string,
  objectPath: string,
): ReviewedFunctionEntry | undefined {
  if (!isValidFunctionName(functionName)) return undefined;
  return allowlist.find(
    (entry) =>
      entry.functionName === functionName &&
      (entry.objectPathPrefix.endsWith("/")
        ? objectPath.startsWith(entry.objectPathPrefix)
        : objectPath === entry.objectPathPrefix),
  );
}
