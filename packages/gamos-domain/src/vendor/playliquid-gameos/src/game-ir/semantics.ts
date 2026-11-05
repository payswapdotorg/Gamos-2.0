/**
 * Lock rule 13: "AI emits typed intents; authoritative systems own state
 * mutation."
 *
 * This module defines the semantic contracts of that split:
 * - {@link Intent} is what an avatar/builder AGENT may emit: a typed,
 *   payload-carrying *request*. It has no target, no effect and no
 *   authority of any kind.
 * - {@link Command} is the authoritative mutation primitive. It is produced
 *   only by adjudication ({@link IntentAdjudicator}) which lives in the
 *   capability-broker/runtime packages — NOT here. This package defines
 *   the signatures, never the authority.
 * - {@link GameEvent} is the canonical observable outcome vocabulary.
 *
 * E2 (one canonical command/event path per behavior) is realized by making
 * these three unions the *only* event/intent/command vocabulary exported by
 * the kernel.
 *
 * Pure module: no IO, no clocks (logical ticks only), no randomness.
 */

import type { AgentId, AvatarId, Brand, EntityRef } from "../game-contracts/index.js";
import type { GameIRValue } from "./values.js";

/**
 * Logical time. A non-negative integer tick. Wall-clock time is
 * deliberately absent: determinism (R14) requires that evaluation depends
 * only on state, inputs and tick order.
 */
export type SemanticTick = number;

/** Returns true when `value` is a usable {@link SemanticTick}. */
export function isSemanticTick(value: unknown): value is SemanticTick {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Namespaced event type id, e.g. `avatar.movement.requested`.
 * Lowercase segments separated by single dots.
 */
export type EventTypeId = Brand<string, "EventTypeId">;
/** Namespaced intent type id. */
export type IntentTypeId = Brand<string, "IntentTypeId">;
/** Namespaced command type id. */
export type CommandTypeId = Brand<string, "CommandTypeId">;

const TYPE_ID_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/;

/** Returns true when `text` is valid type-id syntax. */
export function isValidTypeIdText(text: string): boolean {
  return TYPE_ID_PATTERN.test(text) && text.length <= 200;
}

/** Parses and validates `text` as an {@link EventTypeId}, or returns `undefined`. */
export function asEventTypeId(text: string): EventTypeId | undefined {
  return isValidTypeIdText(text) ? (text as EventTypeId) : undefined;
}

/** Parses and validates `text` as an {@link IntentTypeId}, or returns `undefined`. */
export function asIntentTypeId(text: string): IntentTypeId | undefined {
  return isValidTypeIdText(text) ? (text as IntentTypeId) : undefined;
}

/** Parses and validates `text` as a {@link CommandTypeId}, or returns `undefined`. */
export function asCommandTypeId(text: string): CommandTypeId | undefined {
  return isValidTypeIdText(text) ? (text as CommandTypeId) : undefined;
}

/** Who emitted an intent: an AI agent, optionally embodying an avatar. */
export type AgentRef = {
  readonly agent: AgentId;
  readonly avatar?: AvatarId;
};

/** A canonical observable event emitted by the game semantics. */
export type GameEvent = {
  readonly type: EventTypeId;
  readonly payload: GameIRValue;
  readonly tick: SemanticTick;
  readonly source?: EntityRef;
};

/** A typed request emitted by an AI agent. Carries zero authority. */
export type Intent = {
  readonly type: IntentTypeId;
  readonly payload: GameIRValue;
  readonly actor: AgentRef;
  readonly tick: SemanticTick;
};

/** The authoritative mutation primitive. Produced only by adjudication. */
export type Command = {
  readonly type: CommandTypeId;
  readonly payload: GameIRValue;
  readonly target: EntityRef;
  readonly tick: SemanticTick;
  /** The intents this command was adjudicated from, in emission order. */
  readonly basis: readonly Intent[];
};

/**
 * The adjudication seam: pure function signature that turns intents plus
 * current state into authoritative commands. IMPLEMENTATIONS LIVE
 * ELSEWHERE (capability broker + game policy + authoritative systems —
 * spec/architecture.md "Capability Broker"). The kernel exports only the
 * contract so that interactive and simulation runtimes share it (lock 12).
 */
export type IntentAdjudicator = (intents: readonly Intent[], state: GameIRValue) => readonly Command[];
