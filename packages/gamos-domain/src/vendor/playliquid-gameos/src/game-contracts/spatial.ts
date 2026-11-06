/**
 * R15 contract vocabulary: world/scene/entity references and spatial
 * partitioning TYPES.
 *
 * The canonical spatial hierarchy is World -> Region -> Zone -> Chunk
 * (spec/architecture.md "World"). This module defines reference types into
 * that hierarchy plus partition-scheme descriptors and streaming policies.
 * It contains partitioning *types only* — no partitioning algorithms, no
 * runtime, no IO. Implementations belong to world-runtime and adapters.
 *
 * Pure module.
 */

import { asChunkId, asEntityId, asRegionId, asSceneId, asWorldId, asZoneId } from "./ids.js";
import type { ChunkId, EntityId, RegionId, SceneId, WorldId, ZoneId } from "./ids.js";

/** Immutable 2D vector. */
export type Vec2 = readonly [number, number];
/** Immutable 3D vector. */
export type Vec3 = readonly [number, number, number];

/** Axis-aligned 2D bounds. */
export type Bounds2 = { readonly min: Vec2; readonly max: Vec2 };
/** Axis-aligned 3D bounds. */
export type Bounds3 = { readonly min: Vec3; readonly max: Vec3 };

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Returns true when both components are finite numbers. */
export function isFiniteVec2(v: Vec2): boolean {
  return isFiniteNumber(v[0]) && isFiniteNumber(v[1]);
}

/** Returns true when all three components are finite numbers. */
export function isFiniteVec3(v: Vec3): boolean {
  return isFiniteNumber(v[0]) && isFiniteNumber(v[1]) && isFiniteNumber(v[2]);
}

function isVec2(value: unknown): value is Vec2 {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  );
}

function isVec3(value: unknown): value is Vec3 {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number" &&
    typeof value[2] === "number"
  );
}

/** Returns true when `b` is a usable 2D bounds (finite, min <= max per axis). */
export function isValidBounds2(b: Bounds2): boolean {
  return isFiniteVec2(b.min) && isFiniteVec2(b.max) && b.min[0] <= b.max[0] && b.min[1] <= b.max[1];
}

/** Returns true when `b` is a usable 3D bounds (finite, min <= max per axis). */
export function isValidBounds3(b: Bounds3): boolean {
  return (
    isFiniteVec3(b.min) &&
    isFiniteVec3(b.max) &&
    b.min[0] <= b.max[0] &&
    b.min[1] <= b.max[1] &&
    b.min[2] <= b.max[2]
  );
}

/** Returns true when `point` lies inside `b` (inclusive). */
export function bounds3ContainsPoint(b: Bounds3, point: Vec3): boolean {
  return (
    point[0] >= b.min[0] &&
    point[0] <= b.max[0] &&
    point[1] >= b.min[1] &&
    point[1] <= b.max[1] &&
    point[2] >= b.min[2] &&
    point[2] <= b.max[2]
  );
}

/** The levels of the canonical spatial hierarchy. */
export type SpatialLevel = "region" | "zone" | "chunk";

/** All valid {@link SpatialLevel} values, outermost first. */
export const SPATIAL_LEVELS: readonly SpatialLevel[] = Object.freeze(["region", "zone", "chunk"]);

/** Returns true when `value` is a valid {@link SpatialLevel}. */
export function isSpatialLevel(value: unknown): value is SpatialLevel {
  return typeof value === "string" && (SPATIAL_LEVELS as readonly string[]).includes(value);
}

/** Depth of a spatial level: region = 1, zone = 2, chunk = 3. */
export function spatialLevelDepth(level: SpatialLevel): 1 | 2 | 3 {
  switch (level) {
    case "region":
      return 1;
    case "zone":
      return 2;
    case "chunk":
      return 3;
  }
}

/** How a world's space is partitioned. Descriptors only — no algorithms. */
export type SpatialPartitionScheme = "uniform-grid" | "quadtree" | "octree" | "explicit";

/**
 * Declarative description of a spatial partition. `uniform-grid` and the
 * trees describe generated partitions; `explicit` marks hand-authored
 * boundaries (common for authored scenes).
 */
export type SpatialPartitionDescriptor =
  | { readonly scheme: "uniform-grid"; readonly cellSize: Vec3; readonly bounds: Bounds3 }
  | { readonly scheme: "quadtree"; readonly bounds: Bounds2; readonly maxDepth: number }
  | { readonly scheme: "octree"; readonly bounds: Bounds3; readonly maxDepth: number }
  | { readonly scheme: "explicit" };

const MAX_PARTITION_DEPTH = 64;

/** Returns true when `value` is structurally a valid {@link SpatialPartitionDescriptor}. */
export function isSpatialPartitionDescriptor(value: unknown): value is SpatialPartitionDescriptor {
  if (typeof value !== "object" || value === null) return false;
  const descriptor = value as Record<string, unknown>;
  switch (descriptor.scheme) {
    case "uniform-grid": {
      if (!isVec3(descriptor.cellSize)) return false;
      const cellSize = descriptor.cellSize;
      if (cellSize[0] <= 0 || cellSize[1] <= 0 || cellSize[2] <= 0) return false;
      return isBounds3Node(descriptor.bounds);
    }
    case "quadtree":
      return (
        isBounds2Node(descriptor.bounds) &&
        typeof descriptor.maxDepth === "number" &&
        Number.isInteger(descriptor.maxDepth) &&
        descriptor.maxDepth >= 1 &&
        descriptor.maxDepth <= MAX_PARTITION_DEPTH
      );
    case "octree":
      return (
        isBounds3Node(descriptor.bounds) &&
        typeof descriptor.maxDepth === "number" &&
        Number.isInteger(descriptor.maxDepth) &&
        descriptor.maxDepth >= 1 &&
        descriptor.maxDepth <= MAX_PARTITION_DEPTH
      );
    case "explicit":
      return true;
    default:
      return false;
  }
}

function isBounds2Node(value: unknown): value is Bounds2 {
  if (typeof value !== "object" || value === null) return false;
  const bounds = value as Record<string, unknown>;
  if (!isVec2(bounds.min) || !isVec2(bounds.max)) return false;
  return bounds.min[0] <= bounds.max[0] && bounds.min[1] <= bounds.max[1];
}

function isBounds3Node(value: unknown): value is Bounds3 {
  if (typeof value !== "object" || value === null) return false;
  const bounds = value as Record<string, unknown>;
  if (!isVec3(bounds.min) || !isVec3(bounds.max)) return false;
  return (
    bounds.min[0] <= bounds.max[0] &&
    bounds.min[1] <= bounds.max[1] &&
    bounds.min[2] <= bounds.max[2]
  );
}

/**
 * R15 streaming contract: chunks may be independently streamed, cached and
 * built *when the contract permits*. This is the "permit" — a declarative
 * policy attached to world/scene nodes, never an IO behavior.
 */
export type StreamingPolicy = {
  readonly streamable: boolean;
  readonly cacheable: boolean;
  readonly independentlyBuilt: boolean;
};

/** Returns true when `value` is structurally a valid {@link StreamingPolicy}. */
export function isStreamingPolicy(value: unknown): value is StreamingPolicy {
  if (typeof value !== "object" || value === null) return false;
  const policy = value as Record<string, unknown>;
  return (
    typeof policy.streamable === "boolean" &&
    typeof policy.cacheable === "boolean" &&
    typeof policy.independentlyBuilt === "boolean"
  );
}

/** Reference to a world. */
export type WorldRef = { readonly world: WorldId };

/** Reference to a scene within a world. */
export type SceneRef = { readonly world: WorldId; readonly scene: SceneId };

/** Reference to an entity within a scene of a world. */
export type EntityRef = { readonly world: WorldId; readonly scene: SceneId; readonly entity: EntityId };

/** Reference to a region (top level of the spatial hierarchy). */
export type RegionRef = { readonly world: WorldId; readonly region: RegionId };

/** Reference to a zone (second level of the spatial hierarchy). */
export type ZoneRef = { readonly world: WorldId; readonly region: RegionId; readonly zone: ZoneId };

/** Reference to a chunk (third level of the spatial hierarchy). */
export type ChunkRef = {
  readonly world: WorldId;
  readonly region: RegionId;
  readonly zone: ZoneId;
  readonly chunk: ChunkId;
};

/** Any reference into the world/scene/entity or spatial hierarchies. */
export type SpatialRef = WorldRef | SceneRef | EntityRef | RegionRef | ZoneRef | ChunkRef;

/** Returns true when `value` is structurally a valid {@link WorldRef}. */
export function isWorldRef(value: unknown): value is WorldRef {
  if (typeof value !== "object" || value === null) return false;
  const ref = value as Record<string, unknown>;
  return typeof ref.world === "string" && asWorldId(ref.world) !== undefined;
}

/** Returns true when `value` is structurally a valid {@link SceneRef}. */
export function isSceneRef(value: unknown): value is SceneRef {
  if (typeof value !== "object" || value === null) return false;
  const ref = value as Record<string, unknown>;
  return (
    typeof ref.world === "string" &&
    asWorldId(ref.world) !== undefined &&
    typeof ref.scene === "string" &&
    asSceneId(ref.scene) !== undefined
  );
}

/** Returns true when `value` is structurally a valid {@link EntityRef}. */
export function isEntityRef(value: unknown): value is EntityRef {
  if (typeof value !== "object" || value === null) return false;
  const ref = value as Record<string, unknown>;
  return (
    typeof ref.world === "string" &&
    asWorldId(ref.world) !== undefined &&
    typeof ref.scene === "string" &&
    asSceneId(ref.scene) !== undefined &&
    typeof ref.entity === "string" &&
    asEntityId(ref.entity) !== undefined
  );
}

/** Returns true when `value` is structurally a valid {@link RegionRef}. */
export function isRegionRef(value: unknown): value is RegionRef {
  if (typeof value !== "object" || value === null) return false;
  const ref = value as Record<string, unknown>;
  return (
    typeof ref.world === "string" &&
    asWorldId(ref.world) !== undefined &&
    typeof ref.region === "string" &&
    asRegionId(ref.region) !== undefined
  );
}

/** Returns true when `value` is structurally a valid {@link ZoneRef}. */
export function isZoneRef(value: unknown): value is ZoneRef {
  if (typeof value !== "object" || value === null) return false;
  const ref = value as Record<string, unknown>;
  return isRegionRef(value) && typeof ref.zone === "string" && asZoneId(ref.zone) !== undefined;
}

/** Returns true when `value` is structurally a valid {@link ChunkRef}. */
export function isChunkRef(value: unknown): value is ChunkRef {
  if (typeof value !== "object" || value === null) return false;
  const ref = value as Record<string, unknown>;
  return isZoneRef(value) && typeof ref.chunk === "string" && asChunkId(ref.chunk) !== undefined;
}

/** Projects a {@link SceneRef} out of an {@link EntityRef}. */
export function sceneRefFromEntity(ref: EntityRef): SceneRef {
  return { world: ref.world, scene: ref.scene };
}

/** Projects a {@link WorldRef} out of a {@link SceneRef}. */
export function worldRefFromScene(ref: SceneRef): WorldRef {
  return { world: ref.world };
}

/**
 * Canonical, human-readable slash path for any {@link SpatialRef}.
 * Deterministic for validated refs; intended for logs, diagnostics and
 * human review. (Hashing in game-ir uses its own fully-escaped form.)
 */
export function canonicalRefPath(ref: SpatialRef): string {
  if (isEntityRef(ref)) {
    return `world/${ref.world}/scene/${ref.scene}/entity/${ref.entity}`;
  }
  if (isSceneRef(ref)) {
    return `world/${ref.world}/scene/${ref.scene}`;
  }
  if (isChunkRef(ref)) {
    return `world/${ref.world}/region/${ref.region}/zone/${ref.zone}/chunk/${ref.chunk}`;
  }
  if (isZoneRef(ref)) {
    return `world/${ref.world}/region/${ref.region}/zone/${ref.zone}`;
  }
  if (isRegionRef(ref)) {
    return `world/${ref.world}/region/${ref.region}`;
  }
  return `world/${ref.world}`;
}
