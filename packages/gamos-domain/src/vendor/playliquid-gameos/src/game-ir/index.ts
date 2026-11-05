/**
 * Public barrel of `@playliquid/game-ir` — the engine-independent semantic
 * kernel (lock rule 1). Imports `@playliquid/game-contracts` only, per the
 * module dependency matrix.
 */

export {
  GAME_IR_VALUE_KINDS,
  FORBIDDEN_RECORD_KEYS,
  MAX_VALUE_DEPTH,
  MAX_LIST_LENGTH,
  MAX_RECORD_FIELDS,
  isGameIRValueKind,
  isGameIRValue,
  gameIRValueKind,
} from "./values.js";
export type { GameIRValue, GameIRValueKind } from "./values.js";
export { isValueShape, valueMatchesShape } from "./shapes.js";
export type { ValueShape } from "./shapes.js";
export {
  isSemanticTick,
  isValidTypeIdText,
  asEventTypeId,
  asIntentTypeId,
  asCommandTypeId,
} from "./semantics.js";
export type {
  SemanticTick,
  EventTypeId,
  IntentTypeId,
  CommandTypeId,
  AgentRef,
  GameEvent,
  Intent,
  Command,
  IntentAdjudicator,
} from "./semantics.js";
export { GAME_IR_NODE_KINDS, asNodeId, isGameIRNodeKind } from "./nodes.js";
export type {
  NodeId,
  NodeKind,
  WorldNode,
  SceneNode,
  EntityNode,
  RuleNode,
  EventDeclarationNode,
  CapabilityDeclarationNode,
  AvatarBindingNode,
  GameIRNode,
} from "./nodes.js";
export { GAME_IR_VERSION, isGameIRVersion } from "./document.js";
export type { GameIRVersion, GameIRDocument } from "./document.js";
export { error, warning, hasErrors } from "./diagnostics.js";
export type { DiagnosticSeverity, DiagnosticCode, Diagnostic, ValidationOk, ValidationFail, ValidationResult } from "./diagnostics.js";
export {
  canonicalFloatForm,
  canonicalValueForm,
  gameIRValuesEqual,
  hashGameIRValue,
  canonicalIntentForm,
  canonicalCommandForm,
  canonicalEventForm,
  hashIntent,
  hashCommand,
  hashEvent,
  verifySimulationStepDeterminism,
} from "./evaluate.js";
export type {
  DeterministicEvaluator,
  SimulationStepInput,
  SimulationStepOutput,
  SimulationStep,
} from "./evaluate.js";
export { validate, isGameIRDocument, validationErrors, countNodeKinds } from "./validate.js";
