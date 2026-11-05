/**
 * GameSpec — exactly a PlayLiquid `GameIRDocument` (contract 01 revision 2:
 * exact-compatibility rule). This module REEXPORTS the vendored upstream
 * contract; it declares NO local document schema of its own.
 *
 * The runtime behavior (parseGameSpec / serializeGameSpec) reuses the upstream
 * validation semantics (`validate()` from the vendored kernel) and enforces the
 * exact-field-set rule: a document carrying any Gamos-specific extra field
 * (e.g. `acceptance`, engine bindings, build steps, capability references) is
 * NOT a GameSpec — that is a schema violation, not a tolerated extension.
 */

import { validate } from "./vendor/playliquid-gameos/src/game-ir/validate.js";
import { GAME_IR_VERSION, isGameIRVersion } from "./vendor/playliquid-gameos/src/game-ir/document.js";
import type { GameIRDocument } from "./vendor/playliquid-gameos/src/game-ir/document.js";

export type { GameIRDocument } from "./vendor/playliquid-gameos/src/game-ir/document.js";
export { GAME_IR_VERSION, isGameIRVersion } from "./vendor/playliquid-gameos/src/game-ir/document.js";
export { validate as validateGameIR } from "./vendor/playliquid-gameos/src/game-ir/validate.js";
export { isGameIRDocument } from "./vendor/playliquid-gameos/src/game-ir/validate.js";

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

// ---------------------------------------------------------------------------
// RED stubs — behavior implemented in the GREEN commit.
// ---------------------------------------------------------------------------

/**
 * Parses + validates a GameSpec from raw input using the upstream semantics
 * (fail-closed on diagnostics errors; unknown irVersion rejected explicitly).
 * Additionally rejects documents carrying Gamos-specific EXTRA fields, which
 * the upstream kernel tolerates by default — contract 01 revision 2 makes
 * them schema violations for Gamos.
 */
export function parseGameSpec(_input: unknown): GameSpec {
  throw new Error("GAMOS/M1.1/RED: parseGameSpec is not implemented yet");
}

/** Deterministic canonical serialization (sorted keys; the upstream doc shape). */
export function serializeGameSpec(_spec: GameSpec): string {
  throw new Error("GAMOS/M1.1/RED: serializeGameSpec is not implemented yet");
}

/** Stable content digest of the canonical serialization. */
export function hashGameSpec(_spec: GameSpec): string {
  throw new Error("GAMOS/M1.1/RED: hashGameSpec is not implemented yet");
}
