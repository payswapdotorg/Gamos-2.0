/**
 * Branded identifier vocabulary shared by GameOS contract packages.
 *
 * All identifiers are human-readable slugs so that GameIR documents stay
 * diffable in Git (R1: games are Git repositories; the semantic layer must
 * remain reviewable as text).
 *
 * Pure module: no IO, no clocks, no randomness.
 */

import type { Brand } from "./brand.js";

/** Canonical identifier text: 1..63 chars, `[a-z0-9]` boundaries, inner `-`. */
export const ID_TEXT_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Returns true when `text` is a valid canonical identifier slug. */
export function isValidIdText(text: string): boolean {
  return ID_TEXT_PATTERN.test(text);
}

export type GameId = Brand<string, "GameId">;
export type WorldId = Brand<string, "WorldId">;
export type SceneId = Brand<string, "SceneId">;
export type RegionId = Brand<string, "RegionId">;
export type ZoneId = Brand<string, "ZoneId">;
export type ChunkId = Brand<string, "ChunkId">;
export type EntityId = Brand<string, "EntityId">;
export type AvatarId = Brand<string, "AvatarId">;
export type AgentId = Brand<string, "AgentId">;

/** Parses and validates `text` as a {@link GameId}, or returns `undefined`. */
export function asGameId(text: string): GameId | undefined {
  return isValidIdText(text) ? (text as GameId) : undefined;
}

/** Parses and validates `text` as a {@link WorldId}, or returns `undefined`. */
export function asWorldId(text: string): WorldId | undefined {
  return isValidIdText(text) ? (text as WorldId) : undefined;
}

/** Parses and validates `text` as a {@link SceneId}, or returns `undefined`. */
export function asSceneId(text: string): SceneId | undefined {
  return isValidIdText(text) ? (text as SceneId) : undefined;
}

/** Parses and validates `text` as a {@link RegionId}, or returns `undefined`. */
export function asRegionId(text: string): RegionId | undefined {
  return isValidIdText(text) ? (text as RegionId) : undefined;
}

/** Parses and validates `text` as a {@link ZoneId}, or returns `undefined`. */
export function asZoneId(text: string): ZoneId | undefined {
  return isValidIdText(text) ? (text as ZoneId) : undefined;
}

/** Parses and validates `text` as a {@link ChunkId}, or returns `undefined`. */
export function asChunkId(text: string): ChunkId | undefined {
  return isValidIdText(text) ? (text as ChunkId) : undefined;
}

/** Parses and validates `text` as an {@link EntityId}, or returns `undefined`. */
export function asEntityId(text: string): EntityId | undefined {
  return isValidIdText(text) ? (text as EntityId) : undefined;
}

/** Parses and validates `text` as an {@link AvatarId}, or returns `undefined`. */
export function asAvatarId(text: string): AvatarId | undefined {
  return isValidIdText(text) ? (text as AvatarId) : undefined;
}

/** Parses and validates `text` as an {@link AgentId}, or returns `undefined`. */
export function asAgentId(text: string): AgentId | undefined {
  return isValidIdText(text) ? (text as AgentId) : undefined;
}
