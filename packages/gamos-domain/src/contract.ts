/**
 * gamos-domain 对外契约：调用方要想正确调用就必须知道的一切都写在这里；其余对外不可见。
 *
 * 本模块是纯游戏域包（roadmap M1.1/M1.2）：GameConcept、GameSpec（= 上游
 * PlayLiquid GameIRDocument 的 exact 兼容）、GamePlan、AcceptanceRecord、
 * GameArtifact，以及 `gamos/capability@2` 能力注册表数据与 fail-closed
 * 选择/校验逻辑。所有函数均为纯数据/校验/确定性解析，无进程、无网络、无 UI。
 */

export type {
  EngineFamily,
  EngineFamilyPreference,
  ConceptProvenance,
  GameConceptReference,
  ProjectContextRef,
  GameConcept,
} from "./domain/game-concept.js";
export {
  createGameConcept,
  serializeGameConcept,
  hashGameConcept,
} from "./domain/game-concept.js";

export type { GameSpec } from "./domain/game-spec.js";
export {
  GAME_SPEC_FIELD_SET,
  GAME_IR_VERSION,
  isGameIRVersion,
  parseGameSpec,
  serializeGameSpec,
  hashGameSpec,
  validateGameIR,
  isGameIRDocument,
} from "./domain/game-spec.js";

export type {
  GameSpecRef,
  CapabilityStepRef,
  GamePlanStep,
  EngineBinding,
  PlanPermissionRequirement,
  AcceptanceRecordRef,
  PlanArtifactExpectation,
  GamePlan,
} from "./domain/game-plan.js";
export {
  parseGamePlan,
  serializeGamePlan,
  hashGamePlan,
} from "./domain/game-plan.js";

export type {
  AcceptanceCriterion,
  AcceptanceCriterionResult,
  AcceptanceRecord,
} from "./domain/acceptance-record.js";
export {
  parseAcceptanceRecord,
  serializeAcceptanceRecord,
  hashAcceptanceRecord,
  evaluateAcceptanceStatus,
} from "./domain/acceptance-record.js";

export type {
  ArtifactExistenceProof,
  GameArtifact,
} from "./domain/game-artifact.js";
export {
  parseGameArtifact,
  serializeGameArtifact,
  hashGameArtifact,
  isVerifiedArtifact,
} from "./domain/game-artifact.js";

// 能力注册表（M1.2，`gamos/capability@2`）——同样从本契约出口。
export type {
  CapabilityRecord,
  ProvenanceRef,
  AvailabilitySpec,
  PermissionSpec,
} from "./domain/capability-registry.js";
export {
  registerCapability,
  getCapability,
  resolveCapability,
  listCapabilities,
} from "./domain/capability-registry.js";

// 项目发现与引擎版本文法（M1.3，contract 04 §1/§2/§4）。
// adapters 层的 read-only 文件系统探测 + domain 层的机器本地记录与 JOIN。
export type { ProjectProbeResult, ProjectEngineDetection } from "./adapters/discovery/project-probes.js";
export {
  discoverUnityProject,
  discoverBlenderProject,
  discoverGodotProject,
  discoverUnrealProject,
  discoverBabylonProject,
  detectProjectEngines,
} from "./adapters/discovery/project-probes.js";
export type {
  ParsedVersionResult,
  UnityVersion,
  BlenderVersion,
  GodotVersion,
  UnrealVersion,
  BabylonToolchainVersion,
} from "./domain/discovery/engine-versions.js";
export {
  parseUnityVersion,
  compareUnityVersions,
  parseBlenderVersion,
  compareBlenderVersions,
  parseGodotVersion,
  compareGodotVersions,
  parseUnrealVersion,
  compareUnrealVersions,
  parseBabylonToolchainVersion,
  compareBabylonToolchainVersions,
  evaluateVersionPredicate,
} from "./domain/discovery/engine-versions.js";
export type {
  GamosProjectMetadata,
  DiscoveredEngine,
  MachineEngineDiscovery,
  EffectiveEngineState,
} from "./domain/discovery/discovery-record.js";
export {
  buildMachineDiscoveryRecord,
  isRecordStale,
  joinEngineState,
} from "./domain/discovery/discovery-record.js";

// 意图解析与结构化模型上下文（M1.4，directive §11 / contract 05 §3）。
export type {
  IntentRequestKind,
  MentionedEngine,
  IntentClassification,
  IntentIssue,
  CapabilityRequestResult,
  IntentResolutionInput,
  IntentResolution,
  GamingContextObservations,
  ContextCapabilityEntry,
  GamingModelContext,
} from "./domain/intent.js";
export {
  classifyIntent,
  resolveGamingIntent,
  buildGamingModelContext,
} from "./domain/intent.js";
