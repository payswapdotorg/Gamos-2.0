/**
 * The GameIR document: the engine-independent semantic kernel root (lock
 * rule 1). A document binds a game identity (R1) to a node graph and names
 * the entry scene.
 *
 * ACR-001 (2026-10-31, lock v1.1): documents MAY carry an optional
 * document-level `world` declaration (content kind + delivery target
 * profile — two distinct dimensions). The node/value vocabulary is
 * unchanged; the field is additive and optional, so `irVersion` stays "1"
 * and every pre-ACR document remains valid (kind defaults to `game`).
 *
 * Pure module.
 */

import type { GameIdentity, GameLifecycleState, SceneRef, WorldDeclaration } from "../game-contracts/index.js";
import type { GameIRNode } from "./nodes.js";

/**
 * GameIR document format version. Frozen at "1"; any change to the node or
 * value vocabulary requires a new version constant and an Architecture
 * Change Request.
 */
export type GameIRVersion = "1";

/** The current {@link GameIRVersion}. */
export const GAME_IR_VERSION: GameIRVersion = "1";

/** Returns true when `value` names a known {@link GameIRVersion}. */
export function isGameIRVersion(value: unknown): value is GameIRVersion {
  return value === GAME_IR_VERSION;
}

/** The root of a GameIR document. */
export type GameIRDocument = {
  readonly irVersion: GameIRVersion;
  readonly identity: GameIdentity;
  readonly lifecycle?: GameLifecycleState;
  /** ACR-001: optional content-kind / target-profile declaration (both dimensions independently optional). */
  readonly world?: WorldDeclaration;
  readonly entry: SceneRef;
  readonly nodes: readonly GameIRNode[];
};
