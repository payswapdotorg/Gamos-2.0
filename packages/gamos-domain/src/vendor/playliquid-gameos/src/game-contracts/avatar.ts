/**
 * R5 contract vocabulary: avatar/agent portability.
 *
 * An avatar is Body + Intelligence (spec/architecture.md "Avatar"). Avatars
 * are portable *packages* that may be imported into multiple games, and
 * host games may restrict their capabilities. This module defines what a
 * avatar declares about itself, what a host may restrict, and the pure
 * compatibility assessment between the two.
 *
 * Capability enforcement at runtime belongs to the Capability Broker (lock
 * rule 4) — this file only defines the vocabulary and the pure math.
 *
 * Pure module.
 */

import { asAgentId, asAvatarId } from "./ids.js";
import type { AgentId, AvatarId } from "./ids.js";

/**
 * Sensor capabilities (perception), per spec/architecture.md "Avatar".
 */
export type SensorCapabilityId =
  | "vision"
  | "audio"
  | "touch"
  | "smell"
  | "taste"
  | "proprioception"
  | "vestibular";

/**
 * Actuator capabilities (action), per spec/architecture.md "Avatar".
 */
export type ActuatorCapabilityId = "movement" | "manipulation" | "speech" | "gaze" | "sensory-output";

/** Every capability an avatar may declare. */
export type AvatarCapabilityId = SensorCapabilityId | ActuatorCapabilityId;

/** All valid {@link SensorCapabilityId} values. */
export const SENSOR_CAPABILITY_IDS: readonly SensorCapabilityId[] = Object.freeze([
  "vision",
  "audio",
  "touch",
  "smell",
  "taste",
  "proprioception",
  "vestibular",
]);

/** All valid {@link ActuatorCapabilityId} values. */
export const ACTUATOR_CAPABILITY_IDS: readonly ActuatorCapabilityId[] = Object.freeze([
  "movement",
  "manipulation",
  "speech",
  "gaze",
  "sensory-output",
]);

/** All valid {@link AvatarCapabilityId} values. */
export const AVATAR_CAPABILITY_IDS: readonly AvatarCapabilityId[] = Object.freeze([
  ...SENSOR_CAPABILITY_IDS,
  ...ACTUATOR_CAPABILITY_IDS,
]);

/** Returns true when `value` is a valid {@link AvatarCapabilityId}. */
export function isAvatarCapabilityId(value: unknown): value is AvatarCapabilityId {
  return typeof value === "string" && (AVATAR_CAPABILITY_IDS as readonly string[]).includes(value);
}

/** How strongly an avatar relies on a capability. */
export type CapabilityRequirement = "required" | "preferred" | "optional";

const CAPABILITY_REQUIREMENTS: readonly CapabilityRequirement[] = Object.freeze([
  "required",
  "preferred",
  "optional",
]);

/** Returns true when `value` is a valid {@link CapabilityRequirement}. */
export function isCapabilityRequirement(value: unknown): value is CapabilityRequirement {
  return typeof value === "string" && (CAPABILITY_REQUIREMENTS as readonly string[]).includes(value);
}

function requirementStrength(requirement: CapabilityRequirement): number {
  switch (requirement) {
    case "required":
      return 3;
    case "preferred":
      return 2;
    case "optional":
      return 1;
  }
}

/** A single declared capability with its requirement level. */
export type AvatarCapability = {
  readonly capability: AvatarCapabilityId;
  readonly requirement: CapabilityRequirement;
};

/** Returns true when `value` is structurally a valid {@link AvatarCapability}. */
export function isAvatarCapability(value: unknown): value is AvatarCapability {
  if (typeof value !== "object" || value === null) return false;
  const capability = value as Record<string, unknown>;
  return isAvatarCapabilityId(capability.capability) && isCapabilityRequirement(capability.requirement);
}

/** R5 portability classes. Only `portable` avatars may be imported freely. */
export type AvatarPortability = "locked" | "exportable" | "portable";

const AVATAR_PORTABILITY_CLASSES: readonly AvatarPortability[] = Object.freeze([
  "locked",
  "exportable",
  "portable",
]);

/** Returns true when `value` is a valid {@link AvatarPortability}. */
export function isAvatarPortability(value: unknown): value is AvatarPortability {
  return typeof value === "string" && (AVATAR_PORTABILITY_CLASSES as readonly string[]).includes(value);
}

/** Data policy the avatar's host must honor for avatar-owned data. */
export type AvatarDataPolicy = {
  readonly persistence: "none" | "session" | "persistent";
  readonly crossGameMemory: boolean;
};

/** Returns true when `value` is structurally a valid {@link AvatarDataPolicy}. */
export function isAvatarDataPolicy(value: unknown): value is AvatarDataPolicy {
  if (typeof value !== "object" || value === null) return false;
  const policy = value as Record<string, unknown>;
  return (
    (policy.persistence === "none" || policy.persistence === "session" || policy.persistence === "persistent") &&
    typeof policy.crossGameMemory === "boolean"
  );
}

/**
 * What an avatar declares about itself when it arrives at a host game.
 * Declarations only — the host decides what it actually grants (see
 * {@link HostRestriction}).
 */
export type AvatarManifest = {
  readonly avatar: AvatarId;
  readonly agent?: AgentId;
  readonly capabilities: readonly AvatarCapability[];
  readonly portability: AvatarPortability;
  readonly dataPolicy: AvatarDataPolicy;
};

/** Returns true when `value` is structurally a valid {@link AvatarManifest}. */
export function isAvatarManifest(value: unknown): value is AvatarManifest {
  if (typeof value !== "object" || value === null) return false;
  const manifest = value as Record<string, unknown>;
  if (typeof manifest.avatar !== "string" || asAvatarId(manifest.avatar) === undefined) return false;
  if (manifest.agent !== undefined) {
    if (typeof manifest.agent !== "string" || asAgentId(manifest.agent) === undefined) return false;
  }
  if (!Array.isArray(manifest.capabilities)) return false;
  if (!manifest.capabilities.every((capability) => isAvatarCapability(capability))) return false;
  return isAvatarPortability(manifest.portability) && isAvatarDataPolicy(manifest.dataPolicy);
}

/**
 * R5: host games can restrict avatar capabilities. A restriction denies
 * capabilities outright, routes some through host approval, and may demand
 * sandboxing. Restrictions are declarative; enforcement is the Capability
 * Broker's job at runtime.
 */
export type HostRestriction = {
  readonly denied: readonly AvatarCapabilityId[];
  readonly approvalRequired: readonly AvatarCapabilityId[];
  readonly sandboxed: boolean;
};

/** Returns true when `value` is structurally a valid {@link HostRestriction}. */
export function isHostRestriction(value: unknown): value is HostRestriction {
  if (typeof value !== "object" || value === null) return false;
  const restriction = value as Record<string, unknown>;
  if (!Array.isArray(restriction.denied)) return false;
  if (!restriction.denied.every((capability) => isAvatarCapabilityId(capability))) return false;
  if (!Array.isArray(restriction.approvalRequired)) return false;
  if (!restriction.approvalRequired.every((capability) => isAvatarCapabilityId(capability))) return false;
  return typeof restriction.sandboxed === "boolean";
}

/** Outcome of assessing an {@link AvatarManifest} against a {@link HostRestriction}. */
export type AvatarCompatibility = {
  /** False only when a `required` capability is denied outright. */
  readonly compatible: boolean;
  readonly granted: readonly AvatarCapabilityId[];
  readonly approvalRequired: readonly AvatarCapabilityId[];
  readonly denied: readonly AvatarCapabilityId[];
  /** Preferred/optional capabilities that were denied (quality degradation). */
  readonly degraded: readonly AvatarCapabilityId[];
};

function effectiveRequirements(manifest: AvatarManifest): Map<AvatarCapabilityId, CapabilityRequirement> {
  const effective = new Map<AvatarCapabilityId, CapabilityRequirement>();
  for (const entry of manifest.capabilities) {
    const previous = effective.get(entry.capability);
    // Deterministic conflict rule: the strictest declaration wins.
    if (previous === undefined || requirementStrength(entry.requirement) > requirementStrength(previous)) {
      effective.set(entry.capability, entry.requirement);
    }
  }
  return effective;
}

/**
 * Pure compatibility assessment. Rules:
 * - a `required` capability denied by the host makes the pairing incompatible;
 * - denied preferred/optional capabilities degrade but stay compatible;
 * - `approvalRequired` is reported for awareness and never flips compatibility;
 * - duplicate declarations of the same capability resolve to the strictest.
 */
export function assessAvatarCompatibility(
  manifest: AvatarManifest,
  restriction: HostRestriction,
): AvatarCompatibility {
  const effective = effectiveRequirements(manifest);
  const granted: AvatarCapabilityId[] = [];
  const approvalRequired: AvatarCapabilityId[] = [];
  const denied: AvatarCapabilityId[] = [];
  const degraded: AvatarCapabilityId[] = [];
  let compatible = true;

  for (const [capability, requirement] of effective) {
    if (restriction.denied.includes(capability)) {
      denied.push(capability);
      if (requirement === "required") {
        compatible = false;
      } else {
        degraded.push(capability);
      }
      continue;
    }
    if (restriction.approvalRequired.includes(capability)) {
      approvalRequired.push(capability);
    }
    granted.push(capability);
  }

  return {
    compatible,
    granted: Object.freeze(granted),
    approvalRequired: Object.freeze(approvalRequired),
    denied: Object.freeze(denied),
    degraded: Object.freeze(degraded),
  };
}
