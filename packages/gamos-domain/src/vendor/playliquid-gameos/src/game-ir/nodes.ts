/**
 * GameIR node vocabulary: the declarative building blocks a GameIR document
 * is composed of. Node kinds cover the GameIR contents named in
 * spec/architecture.md: world topology (world/scene/entity), mechanics
 * (rules), event declarations, platform declarations (lock 18) and avatar
 * bindings (R5).
 *
 * Every node is immutable data. Nodes describe; they never execute.
 *
 * Pure module.
 */

import type {
  EntityId,
  HostRestriction,
  PlatformCapabilityDescriptor,
  SceneId,
  SpatialPartitionDescriptor,
  StreamingPolicy,
  WorldId,
  Brand,
} from "../game-contracts/index.js";
import type { GameIRValue } from "./values.js";
import type { ValueShape } from "./shapes.js";
import type { EventTypeId, IntentTypeId } from "./semantics.js";

/** Identity of a node within a GameIR document. */
export type NodeId = Brand<string, "NodeId">;

/** Parses and validates `text` as a {@link NodeId}, or returns `undefined`. */
export function asNodeId(text: string): NodeId | undefined {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(text) ? (text as NodeId) : undefined;
}

/** All node kinds a GameIR document may contain. */
export type NodeKind = "world" | "scene" | "entity" | "rule" | "event-declaration" | "capability-declaration" | "avatar-binding";

/** All valid {@link NodeKind} values. */
export const GAME_IR_NODE_KINDS: readonly NodeKind[] = Object.freeze([
  "world",
  "scene",
  "entity",
  "rule",
  "event-declaration",
  "capability-declaration",
  "avatar-binding",
]);

/** Returns true when `value` is a valid {@link NodeKind}. */
export function isGameIRNodeKind(value: unknown): value is NodeKind {
  return typeof value === "string" && (GAME_IR_NODE_KINDS as readonly string[]).includes(value);
}

/** Static world topology: a world and the scenes it contains. */
export type WorldNode = {
  readonly id: NodeId;
  readonly kind: "world";
  readonly world: WorldId;
  readonly scenes: readonly SceneId[];
  readonly partitioning?: SpatialPartitionDescriptor;
  readonly streaming?: StreamingPolicy;
};

/** A scene: a logical unit of a world, with its entities. */
export type SceneNode = {
  readonly id: NodeId;
  readonly kind: "scene";
  readonly world: WorldId;
  readonly scene: SceneId;
  readonly entities: readonly EntityId[];
  readonly partitioning?: SpatialPartitionDescriptor;
};

/** An entity: initial state plus the rule nodes that give it behavior. */
export type EntityNode = {
  readonly id: NodeId;
  readonly kind: "entity";
  readonly scene: SceneId;
  readonly entity: EntityId;
  readonly state: GameIRValue;
  readonly behaviors: readonly NodeId[];
};

/** A rule: which events wake it, which intents it handles, what it emits. */
export type RuleNode = {
  readonly id: NodeId;
  readonly kind: "rule";
  readonly on: readonly EventTypeId[];
  readonly handles: readonly IntentTypeId[];
  readonly emits: readonly EventTypeId[];
};

/** Declares a semantic event type and its payload shape (lock 18). */
export type EventDeclarationNode = {
  readonly id: NodeId;
  readonly kind: "event-declaration";
  readonly eventType: EventTypeId;
  readonly payload: ValueShape;
};

/** Declares a platform capability need with its policy (R7 / lock 18). */
export type CapabilityDeclarationNode = {
  readonly id: NodeId;
  readonly kind: "capability-declaration";
  readonly requirement: PlatformCapabilityDescriptor;
};

/**
 * Binds an avatar role into the game and states the host restrictions the
 * game applies to imported avatars in that role (R5).
 */
export type AvatarBindingNode = {
  readonly id: NodeId;
  readonly kind: "avatar-binding";
  readonly role: string;
  readonly restrictions: HostRestriction;
};

/** Any GameIR node. */
export type GameIRNode =
  | WorldNode
  | SceneNode
  | EntityNode
  | RuleNode
  | EventDeclarationNode
  | CapabilityDeclarationNode
  | AvatarBindingNode;
