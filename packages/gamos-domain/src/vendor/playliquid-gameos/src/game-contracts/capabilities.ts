/**
 * R7 contract vocabulary: platform capability descriptors.
 *
 * Leaderboards, multiplayer, replay, rewards, social, achievements,
 * analytics, moderation and integrity are PLATFORM services (lock rule 17).
 * Games declare events and policies; they do not duplicate platform
 * authorities (lock rule 18). This module is exactly that declaration
 * vocabulary: typed capability identifiers plus policy shapes — never
 * implementations, clients or SDKs.
 *
 * Pure module.
 */

/** The platform capabilities a game may declare (R7 / lock rule 17). */
export type PlatformCapabilityId =
  | "leaderboard"
  | "multiplayer"
  | "replay"
  | "rewards"
  | "social"
  | "achievements"
  | "analytics"
  | "moderation"
  | "integrity";

/** All valid {@link PlatformCapabilityId} values. */
export const PLATFORM_CAPABILITY_IDS: readonly PlatformCapabilityId[] = Object.freeze([
  "leaderboard",
  "multiplayer",
  "replay",
  "rewards",
  "social",
  "achievements",
  "analytics",
  "moderation",
  "integrity",
]);

/** Returns true when `value` is a valid {@link PlatformCapabilityId}. */
export function isPlatformCapabilityId(value: unknown): value is PlatformCapabilityId {
  return typeof value === "string" && (PLATFORM_CAPABILITY_IDS as readonly string[]).includes(value);
}

/** Leaderboard policy: what is ranked and how. */
export type LeaderboardPolicy = {
  readonly metric: string;
  readonly ordering: "ascending" | "descending";
  readonly scope: "global" | "cohort" | "social";
};

/** Returns true when `value` is structurally a valid {@link LeaderboardPolicy}. */
export function isLeaderboardPolicy(value: unknown): value is LeaderboardPolicy {
  if (typeof value !== "object" || value === null) return false;
  const policy = value as Record<string, unknown>;
  return (
    typeof policy.metric === "string" &&
    policy.metric.length > 0 &&
    (policy.ordering === "ascending" || policy.ordering === "descending") &&
    (policy.scope === "global" || policy.scope === "cohort" || policy.scope === "social")
  );
}

/**
 * Multiplayer policy. R9 / lock rule 19: competitive outcomes are
 * authoritative outside the untrusted client — topologies that cannot
 * guarantee that must not be used for competitive play; enforcement lives
 * with the multiplayer platform service, not in this type.
 */
export type MultiplayerPolicy = {
  readonly topology: "authoritative-server" | "authoritative-relay" | "peer-to-peer";
  readonly maxPlayersPerSession: number;
  readonly sessionModel: "ad-hoc" | "matchmade";
};

/** Returns true when `value` is structurally a valid {@link MultiplayerPolicy}. */
export function isMultiplayerPolicy(value: unknown): value is MultiplayerPolicy {
  if (typeof value !== "object" || value === null) return false;
  const policy = value as Record<string, unknown>;
  return (
    (policy.topology === "authoritative-server" ||
      policy.topology === "authoritative-relay" ||
      policy.topology === "peer-to-peer") &&
    typeof policy.maxPlayersPerSession === "number" &&
    Number.isInteger(policy.maxPlayersPerSession) &&
    policy.maxPlayersPerSession >= 1 &&
    policy.maxPlayersPerSession <= 10000 &&
    (policy.sessionModel === "ad-hoc" || policy.sessionModel === "matchmade")
  );
}

/** Who may consume a replay artifact (R8). */
export type ReplayConsumer = "player" | "qa" | "integrity" | "simulation" | "lab";

/** All valid {@link ReplayConsumer} values. */
export const REPLAY_CONSUMERS: readonly ReplayConsumer[] = Object.freeze([
  "player",
  "qa",
  "integrity",
  "simulation",
  "lab",
]);

/** Replay policy: what is captured and for whom (R8, lock rule 15). */
export type ReplayPolicy = {
  readonly capture: "intent-log" | "state-delta" | "full-state";
  readonly determinismRequired: boolean;
  readonly consumers: readonly ReplayConsumer[];
};

/** Returns true when `value` is structurally a valid {@link ReplayPolicy}. */
export function isReplayPolicy(value: unknown): value is ReplayPolicy {
  if (typeof value !== "object" || value === null) return false;
  const policy = value as Record<string, unknown>;
  if (
    policy.capture !== "intent-log" &&
    policy.capture !== "state-delta" &&
    policy.capture !== "full-state"
  ) {
    return false;
  }
  if (typeof policy.determinismRequired !== "boolean") return false;
  if (!Array.isArray(policy.consumers)) return false;
  return policy.consumers.every((consumer) => (REPLAY_CONSUMERS as readonly string[]).includes(consumer));
}

/**
 * Rewards policy. R10: play-to-earn/rewards use platform entitlement and
 * economy infrastructure. Lock rule 41: no client-authoritative rewards —
 * encoded structurally as the literal `false` in `clientAuthoritative`.
 */
export type RewardsPolicy = {
  readonly mode: "points" | "entitlement";
  readonly settlement: "platform" | "external";
  readonly clientAuthoritative: false;
};

/** Returns true when `value` is structurally a valid {@link RewardsPolicy}. */
export function isRewardsPolicy(value: unknown): value is RewardsPolicy {
  if (typeof value !== "object" || value === null) return false;
  const policy = value as Record<string, unknown>;
  return (
    (policy.mode === "points" || policy.mode === "entitlement") &&
    (policy.settlement === "platform" || policy.settlement === "external") &&
    policy.clientAuthoritative === false
  );
}

/** Social graph policy. */
export type SocialPolicy = {
  readonly graphs: readonly ("friends" | "guilds" | "teams")[];
  readonly presence: boolean;
};

/** Returns true when `value` is structurally a valid {@link SocialPolicy}. */
export function isSocialPolicy(value: unknown): value is SocialPolicy {
  if (typeof value !== "object" || value === null) return false;
  const policy = value as Record<string, unknown>;
  if (!Array.isArray(policy.graphs)) return false;
  const validGraphs = ["friends", "guilds", "teams"];
  if (!policy.graphs.every((graph) => validGraphs.includes(graph as string))) return false;
  return typeof policy.presence === "boolean";
}

/** Achievements policy. */
export type AchievementsPolicy = {
  readonly visibility: "public" | "private" | "social";
  readonly progression: "metric" | "event";
};

/** Returns true when `value` is structurally a valid {@link AchievementsPolicy}. */
export function isAchievementsPolicy(value: unknown): value is AchievementsPolicy {
  if (typeof value !== "object" || value === null) return false;
  const policy = value as Record<string, unknown>;
  return (
    (policy.visibility === "public" || policy.visibility === "private" || policy.visibility === "social") &&
    (policy.progression === "metric" || policy.progression === "event")
  );
}

/** Analytics policy. Privacy class is explicit, never implicit. */
export type AnalyticsPolicy = {
  readonly events: readonly string[];
  readonly identity: "anonymous" | "pseudonymous" | "identified";
  readonly retentionDays: number;
};

/** Returns true when `value` is structurally a valid {@link AnalyticsPolicy}. */
export function isAnalyticsPolicy(value: unknown): value is AnalyticsPolicy {
  if (typeof value !== "object" || value === null) return false;
  const policy = value as Record<string, unknown>;
  if (!Array.isArray(policy.events) || policy.events.length === 0) return false;
  if (!policy.events.every((event) => typeof event === "string" && event.length > 0)) return false;
  if (policy.identity !== "anonymous" && policy.identity !== "pseudonymous" && policy.identity !== "identified") {
    return false;
  }
  return (
    typeof policy.retentionDays === "number" &&
    Number.isInteger(policy.retentionDays) &&
    policy.retentionDays >= 0
  );
}

/** Moderation policy: which surfaces are moderated and whether appeals exist. */
export type ModerationPolicy = {
  readonly surfaces: readonly ("chat" | "voice" | "behavior" | "content")[];
  readonly appealable: boolean;
};

/** Returns true when `value` is structurally a valid {@link ModerationPolicy}. */
export function isModerationPolicy(value: unknown): value is ModerationPolicy {
  if (typeof value !== "object" || value === null) return false;
  const policy = value as Record<string, unknown>;
  if (!Array.isArray(policy.surfaces)) return false;
  const validSurfaces = ["chat", "voice", "behavior", "content"];
  if (!policy.surfaces.every((surface) => validSurfaces.includes(surface as string))) return false;
  return typeof policy.appealable === "boolean";
}

/**
 * Competitive-integrity policy. R11: the platform exposes *probabilistic*
 * evidence (behavioral signals such as trajectories, timing and outcome
 * patterns); enforcement is policy-driven. The type encodes "report-only"
 * vs "policy-driven" so games cannot silently upgrade evidence into
 * punishment logic.
 */
export type IntegrityPolicy = {
  readonly signals: readonly ("behavioral" | "timing" | "trajectory" | "outcome")[];
  readonly enforcement: "report-only" | "policy-driven";
};

/** Returns true when `value` is structurally a valid {@link IntegrityPolicy}. */
export function isIntegrityPolicy(value: unknown): value is IntegrityPolicy {
  if (typeof value !== "object" || value === null) return false;
  const policy = value as Record<string, unknown>;
  if (!Array.isArray(policy.signals)) return false;
  const validSignals = ["behavioral", "timing", "trajectory", "outcome"];
  if (!policy.signals.every((signal) => validSignals.includes(signal as string))) return false;
  return policy.enforcement === "report-only" || policy.enforcement === "policy-driven";
}

/**
 * A game's declaration of one platform capability need, with the policy
 * shape that matches the capability. The discriminated union makes it a
 * type error to attach, say, a leaderboard policy to multiplayer.
 */
export type PlatformCapabilityDescriptor =
  | { readonly capability: "leaderboard"; readonly required: boolean; readonly policy: LeaderboardPolicy }
  | { readonly capability: "multiplayer"; readonly required: boolean; readonly policy: MultiplayerPolicy }
  | { readonly capability: "replay"; readonly required: boolean; readonly policy: ReplayPolicy }
  | { readonly capability: "rewards"; readonly required: boolean; readonly policy: RewardsPolicy }
  | { readonly capability: "social"; readonly required: boolean; readonly policy: SocialPolicy }
  | { readonly capability: "achievements"; readonly required: boolean; readonly policy: AchievementsPolicy }
  | { readonly capability: "analytics"; readonly required: boolean; readonly policy: AnalyticsPolicy }
  | { readonly capability: "moderation"; readonly required: boolean; readonly policy: ModerationPolicy }
  | { readonly capability: "integrity"; readonly required: boolean; readonly policy: IntegrityPolicy };

/** Returns true when `value` is structurally a valid {@link PlatformCapabilityDescriptor}. */
export function isPlatformCapabilityDescriptor(value: unknown): value is PlatformCapabilityDescriptor {
  if (typeof value !== "object" || value === null) return false;
  const descriptor = value as Record<string, unknown>;
  if (typeof descriptor.required !== "boolean") return false;
  switch (descriptor.capability) {
    case "leaderboard":
      return isLeaderboardPolicy(descriptor.policy);
    case "multiplayer":
      return isMultiplayerPolicy(descriptor.policy);
    case "replay":
      return isReplayPolicy(descriptor.policy);
    case "rewards":
      return isRewardsPolicy(descriptor.policy);
    case "social":
      return isSocialPolicy(descriptor.policy);
    case "achievements":
      return isAchievementsPolicy(descriptor.policy);
    case "analytics":
      return isAnalyticsPolicy(descriptor.policy);
    case "moderation":
      return isModerationPolicy(descriptor.policy);
    case "integrity":
      return isIntegrityPolicy(descriptor.policy);
    default:
      return false;
  }
}

/** A set of capability declarations; each capability may appear at most once. */
export type PlatformCapabilitySet = readonly PlatformCapabilityDescriptor[];

/** Returns true when `value` is a valid set (valid descriptors, no duplicates). */
export function isPlatformCapabilitySet(value: unknown): value is PlatformCapabilitySet {
  if (!Array.isArray(value)) return false;
  if (!value.every((descriptor) => isPlatformCapabilityDescriptor(descriptor))) return false;
  const seen = new Set<string>();
  for (const descriptor of value) {
    if (seen.has(descriptor.capability)) return false;
    seen.add(descriptor.capability);
  }
  return true;
}

/** Finds the declaration of `capability` in a {@link PlatformCapabilitySet}. */
export function findPlatformCapability(
  set: PlatformCapabilitySet,
  capability: PlatformCapabilityId,
): PlatformCapabilityDescriptor | undefined {
  return set.find((descriptor) => descriptor.capability === capability);
}
