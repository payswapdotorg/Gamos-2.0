/**
 * Public barrel of `@playliquid/game-contracts`.
 *
 * This package is the vocabulary root of the GameOS module graph:
 * it imports nothing outside itself (module-dependency-matrix) and
 * defines its own seam types rather than re-using ZCode ones.
 */

export type { Brand } from "./brand.js";
export {
  ID_TEXT_PATTERN,
  isValidIdText,
  asGameId,
  asWorldId,
  asSceneId,
  asRegionId,
  asZoneId,
  asChunkId,
  asEntityId,
  asAvatarId,
  asAgentId,
} from "./ids.js";
export type {
  GameId,
  WorldId,
  SceneId,
  RegionId,
  ZoneId,
  ChunkId,
  EntityId,
  AvatarId,
  AgentId,
} from "./ids.js";
export {
  isCommitShaText,
  asCommitSha,
  asBranchName,
  asTagName,
  isValidBranchNameText,
  isValidTagNameText,
  gitRefCommit,
  isGitRef,
  isGitRepositoryCoordinates,
  canonicalRepositorySlug,
  isForkPoint,
  isGameLineage,
  lineageContainsCommit,
} from "./git.js";
export type { CommitSha, BranchName, TagName, GitRef, GitRepositoryCoordinates, ForkPoint, GameLineage } from "./git.js";
export {
  GAME_KINDS,
  isGameKind,
  GAME_LIFECYCLE_STATES,
  isGameLifecycleState,
  GAME_LIFECYCLE_TRANSITIONS,
  canTransitionGameState,
  isGameIdentity,
  gameIdentityKey,
} from "./game-identity.js";
export type { GameKind, GameLifecycleState, GameIdentity } from "./game-identity.js";
export {
  WORLD_KINDS,
  TARGET_PROFILES,
  DEFAULT_WORLD_KIND,
  isWorldKind,
  isTargetProfile,
  isWorldDeclaration,
  resolveWorldKind,
} from "./world.js";
export type { WorldKind, TargetProfile, WorldDeclaration } from "./world.js";
export {
  isFiniteVec2,
  isFiniteVec3,
  isValidBounds2,
  isValidBounds3,
  bounds3ContainsPoint,
  SPATIAL_LEVELS,
  isSpatialLevel,
  spatialLevelDepth,
  isSpatialPartitionDescriptor,
  isStreamingPolicy,
  isWorldRef,
  isSceneRef,
  isEntityRef,
  isRegionRef,
  isZoneRef,
  isChunkRef,
  sceneRefFromEntity,
  worldRefFromScene,
  canonicalRefPath,
} from "./spatial.js";
export type {
  Vec2,
  Vec3,
  Bounds2,
  Bounds3,
  SpatialLevel,
  SpatialPartitionScheme,
  SpatialPartitionDescriptor,
  StreamingPolicy,
  WorldRef,
  SceneRef,
  EntityRef,
  RegionRef,
  ZoneRef,
  ChunkRef,
  SpatialRef,
} from "./spatial.js";
export {
  SENSOR_CAPABILITY_IDS,
  ACTUATOR_CAPABILITY_IDS,
  AVATAR_CAPABILITY_IDS,
  isAvatarCapabilityId,
  isCapabilityRequirement,
  isAvatarCapability,
  isAvatarPortability,
  isAvatarDataPolicy,
  isAvatarManifest,
  isHostRestriction,
  assessAvatarCompatibility,
} from "./avatar.js";
export type {
  SensorCapabilityId,
  ActuatorCapabilityId,
  AvatarCapabilityId,
  CapabilityRequirement,
  AvatarCapability,
  AvatarPortability,
  AvatarDataPolicy,
  AvatarManifest,
  HostRestriction,
  AvatarCompatibility,
} from "./avatar.js";
export {
  PLATFORM_CAPABILITY_IDS,
  isPlatformCapabilityId,
  isLeaderboardPolicy,
  isMultiplayerPolicy,
  REPLAY_CONSUMERS,
  isReplayPolicy,
  isRewardsPolicy,
  isSocialPolicy,
  isAchievementsPolicy,
  isAnalyticsPolicy,
  isModerationPolicy,
  isIntegrityPolicy,
  isPlatformCapabilityDescriptor,
  isPlatformCapabilitySet,
  findPlatformCapability,
} from "./capabilities.js";
export type {
  PlatformCapabilityId,
  LeaderboardPolicy,
  MultiplayerPolicy,
  ReplayConsumer,
  ReplayPolicy,
  RewardsPolicy,
  SocialPolicy,
  AchievementsPolicy,
  AnalyticsPolicy,
  ModerationPolicy,
  IntegrityPolicy,
  PlatformCapabilityDescriptor,
  PlatformCapabilitySet,
} from "./capabilities.js";
