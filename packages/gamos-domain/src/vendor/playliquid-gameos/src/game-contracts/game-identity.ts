/**
 * R1 contract vocabulary: game identity, kind and lifecycle state.
 *
 * A game is a Git repository (see `git.ts` for refs/lineage types). This
 * module binds repository identity to the semantic identity of the game
 * itself, plus the frozen lifecycle-state machine used across GameOS.
 *
 * Pure module.
 */

import { asGameId } from "./ids.js";
import type { GameId } from "./ids.js";
import { isGameLineage, isGitRef, isGitRepositoryCoordinates, canonicalRepositorySlug } from "./git.js";
import type { GameLineage, GitRef, GitRepositoryCoordinates } from "./git.js";

/**
 * Initial frozen vocabulary of game kinds. Extending this union is a
 * breaking contract change and must go through an Architecture Change
 * Request, not a silent edit inside an implementation Work Order.
 */
export type GameKind = "game" | "prototype" | "demo" | "toolkit";

/** All valid {@link GameKind} values. */
export const GAME_KINDS: readonly GameKind[] = Object.freeze(["game", "prototype", "demo", "toolkit"]);

/** Returns true when `value` is a valid {@link GameKind}. */
export function isGameKind(value: unknown): value is GameKind {
  return typeof value === "string" && (GAME_KINDS as readonly string[]).includes(value);
}

/**
 * R1: games live the normal Git lifecycle (branch/commit/PR/release).
 * The lifecycle *state* vocabulary below is the coarse-grained projection
 * of that lifecycle used by platform services; it intentionally has no
 * timestamps or actors — those belong to event history, not contracts.
 */
export type GameLifecycleState = "draft" | "active" | "released" | "deprecated" | "archived";

/** All valid {@link GameLifecycleState} values. */
export const GAME_LIFECYCLE_STATES: readonly GameLifecycleState[] = Object.freeze([
  "draft",
  "active",
  "released",
  "deprecated",
  "archived",
]);

/** Returns true when `value` is a valid {@link GameLifecycleState}. */
export function isGameLifecycleState(value: unknown): value is GameLifecycleState {
  return typeof value === "string" && (GAME_LIFECYCLE_STATES as readonly string[]).includes(value);
}

/**
 * Legal lifecycle transitions. `archived` is terminal. The table is frozen:
 * state-machine authority is single-owner (E1) and lives here, not in the
 * services that consume it.
 */
export const GAME_LIFECYCLE_TRANSITIONS: Readonly<Record<GameLifecycleState, readonly GameLifecycleState[]>> =
  Object.freeze({
    draft: Object.freeze(["active", "archived"] as readonly GameLifecycleState[]),
    active: Object.freeze(["released", "archived"] as readonly GameLifecycleState[]),
    released: Object.freeze(["deprecated", "archived"] as readonly GameLifecycleState[]),
    deprecated: Object.freeze(["archived"] as readonly GameLifecycleState[]),
    archived: Object.freeze([] as readonly GameLifecycleState[]),
  });

/** Returns true when `from -> to` is a legal lifecycle transition. */
export function canTransitionGameState(from: GameLifecycleState, to: GameLifecycleState): boolean {
  return GAME_LIFECYCLE_TRANSITIONS[from].includes(to);
}

/**
 * The identity of a game: what it is called, what kind it is, which Git
 * repository owns it, at which ref it is pinned, and where it came from.
 *
 * `GameIdentity` is immutable data; lifecycle state is carried separately
 * by GameIR documents so that the same identity can appear at different
 * lifecycle points without forking the identity record.
 */
export type GameIdentity = {
  readonly id: GameId;
  readonly displayName: string;
  readonly kind: GameKind;
  readonly repository: GitRepositoryCoordinates;
  readonly revision: GitRef;
  readonly lineage: GameLineage;
};

/** Returns true when `value` is structurally a valid {@link GameIdentity}. */
export function isGameIdentity(value: unknown): value is GameIdentity {
  if (typeof value !== "object" || value === null) return false;
  const identity = value as Record<string, unknown>;
  return (
    typeof identity.id === "string" &&
    asGameId(identity.id) !== undefined &&
    typeof identity.displayName === "string" &&
    identity.displayName.length > 0 &&
    isGameKind(identity.kind) &&
    isGitRepositoryCoordinates(identity.repository) &&
    isGitRef(identity.revision) &&
    isGameLineage(identity.lineage)
  );
}

/**
 * Canonical identity key: `owner/repository@commit`. Stable across hosts is
 * deliberately NOT attempted — the host is part of identity and is retained
 * in {@link GameIdentity.repository}; use the full coordinates when host
 * disambiguation matters.
 */
export function gameIdentityKey(identity: GameIdentity): string {
  return `${canonicalRepositorySlug(identity.repository)}@${identity.revision.commit}`;
}
