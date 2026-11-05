/**
 * GameSpec — exactly a PlayLiquid `GameIRDocument` (contract 01 revision 2:
 * exact-compatibility rule). This module REEXPORTS the vendored upstream
 * contract; it declares NO local document schema of its own.
 *
 * Runtime behavior reuses the upstream validation semantics (`validate()`),
 * then enforces the exact-field-set rule: a document carrying any
 * Gamos-specific extra field (e.g. `acceptance`, engine bindings, build
 * steps, capability references) is NOT a GameSpec — a schema violation,
 * not a tolerated extension.
 */

import { validate } from "../vendor/playliquid-gameos/src/game-ir/validate.js";
import { GAME_IR_VERSION, isGameIRVersion } from "../vendor/playliquid-gameos/src/game-ir/document.js";
import type { GameIRDocument } from "../vendor/playliquid-gameos/src/game-ir/document.js";
import { canonicalJson, canonicalSha256 } from "../adapters/canonical.js";

export type { GameIRDocument } from "../vendor/playliquid-gameos/src/game-ir/document.js";
export { GAME_IR_VERSION, isGameIRVersion } from "../vendor/playliquid-gameos/src/game-ir/document.js";
export { validate as validateGameIR, isGameIRDocument } from "../vendor/playliquid-gameos/src/game-ir/validate.js";

/** The exact upstream field set of a GameIRDocument (contract 01 §2 rule 1). */
export const GAME_SPEC_FIELD_SET: readonly string[] = Object.freeze([
  "irVersion",
  "identity",
  "lifecycle",
  "world",
  "entry",
  "nodes",
]);

/** A GameSpec IS a GameIRDocument — type-level identity, nothing more. */
export type GameSpec = GameIRDocument;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parses + validates a GameSpec from raw input using the upstream semantics
 * (fail-closed on diagnostics errors; unknown irVersion rejected explicitly
 * with E002). Additionally rejects documents carrying Gamos-specific EXTRA
 * fields beyond the exact upstream field set — contract 01 revision 2 makes
 * them schema violations, not tolerated extensions.
 */
export function parseGameSpec(input: unknown): GameSpec {
  // Upstream validation FIRST (unknown irVersion gets its explicit E002 code).
  const result = validate(input);
  if (!result.ok) {
    const errors = result.diagnostics
      .filter((d) => d.severity === "error")
      .map((d) => `${d.code} ${d.message} (${d.path})`)
      .join("; ");
    throw new Error(`GAMOS/GAME-SPEC: upstream GameIR validation failed — ${errors}`);
  }
  // Exact-field-set rule (contract 01 rev 2): extra fields are violations.
  if (isRecord(input)) {
    const extra = Object.keys(input).filter((key) => !GAME_SPEC_FIELD_SET.includes(key));
    if (extra.length > 0) {
      const known = extra.find((key) =>
        ["acceptance", "engineBinding", "capabilities", "buildSteps"].includes(key),
      );
      const hint = known
        ? ` ("${known}" belongs in the GamePlan layer — contract 01 §2 rule 2)`
        : "";
      throw new Error(
        `GAMOS/GAME-SPEC: document carries fields beyond the exact upstream GameIRDocument set${hint}: ${extra.join(", ")} (contract 01 revision 2: exact-compatibility rule)`,
      );
    }
  }
  return input as GameSpec;
}

/** Deterministic canonical serialization (sorted keys; the upstream doc shape). */
export function serializeGameSpec(spec: GameSpec): string {
  return canonicalJson(spec);
}

/** Stable SHA-256 content digest of the canonical serialization. */
export function hashGameSpec(spec: GameSpec): string {
  return canonicalSha256(spec);
}
