/**
 * The `validate` entry: pure structural validation of GameIR documents.
 *
 * `validate` accepts `unknown`, never throws, and returns either the
 * narrowed document or the complete list of typed diagnostics. Diagnostics
 * are collected (not fail-fast) so tooling can report everything at once.
 * Errors make validation fail; warnings alone do not.
 *
 * Pure module.
 */

import {
  isGameIdentity,
  isGameLifecycleState,
  isHostRestriction,
  isPlatformCapabilityDescriptor,
  isSceneRef,
  isSpatialPartitionDescriptor,
  isStreamingPolicy,
  isTargetProfile,
  isValidIdText,
  isWorldKind,
} from "../game-contracts/index.js";
import { isGameIRValue } from "./values.js";
import { isValueShape } from "./shapes.js";
import { asEventTypeId, asIntentTypeId, isValidTypeIdText } from "./semantics.js";
import { asNodeId, isGameIRNodeKind } from "./nodes.js";
import type { GameIRNode, NodeId } from "./nodes.js";
import { isGameIRVersion } from "./document.js";
import type { GameIRDocument } from "./document.js";
import { error, hasErrors, warning } from "./diagnostics.js";
import type { Diagnostic, ValidationResult } from "./diagnostics.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdTextArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string" && isValidIdText(entry));
}

function isTypeIdTextArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string" && isValidTypeIdText(entry));
}

function isNodeIdArray(value: unknown): value is readonly NodeId[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string" && asNodeId(entry) !== undefined);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function validateWorldNode(node: Record<string, unknown>, path: string, diagnostics: Diagnostic[]): void {
  if (!isIdTextArray(node.scenes)) {
    diagnostics.push(error("GAMEIR/E005", "world node has invalid scenes list", `${path}.scenes`));
  }
  if (node.partitioning !== undefined && !isSpatialPartitionDescriptor(node.partitioning)) {
    diagnostics.push(error("GAMEIR/E013", "world node has invalid spatial partition descriptor", `${path}.partitioning`));
  }
  if (node.streaming !== undefined && !isStreamingPolicy(node.streaming)) {
    diagnostics.push(error("GAMEIR/E013", "world node has invalid streaming policy", `${path}.streaming`));
  }
}

function validateSceneNode(node: Record<string, unknown>, path: string, diagnostics: Diagnostic[]): void {
  if (typeof node.world !== "string" || !isValidIdText(node.world)) {
    diagnostics.push(error("GAMEIR/E005", "scene node has invalid world id", `${path}.world`));
  }
  if (!isIdTextArray(node.entities)) {
    diagnostics.push(error("GAMEIR/E005", "scene node has invalid entities list", `${path}.entities`));
  }
  if (node.partitioning !== undefined && !isSpatialPartitionDescriptor(node.partitioning)) {
    diagnostics.push(error("GAMEIR/E013", "scene node has invalid spatial partition descriptor", `${path}.partitioning`));
  }
}

function validateEntityNode(node: Record<string, unknown>, path: string, diagnostics: Diagnostic[]): void {
  if (typeof node.scene !== "string" || !isValidIdText(node.scene)) {
    diagnostics.push(error("GAMEIR/E005", "entity node has invalid scene id", `${path}.scene`));
  }
  if (!isGameIRValue(node.state)) {
    diagnostics.push(error("GAMEIR/E012", "entity node has invalid state value tree", `${path}.state`));
  }
  if (!isNodeIdArray(node.behaviors)) {
    diagnostics.push(error("GAMEIR/E005", "entity node has invalid behaviors list", `${path}.behaviors`));
  } else if (node.behaviors.length === 0) {
    diagnostics.push(warning("GAMEIR/W002", "entity node declares no behaviors", path));
  }
}

function validateRuleNode(node: Record<string, unknown>, path: string, diagnostics: Diagnostic[]): void {
  if (!isTypeIdTextArray(node.on) || !isTypeIdTextArray(node.handles) || !isTypeIdTextArray(node.emits)) {
    diagnostics.push(error("GAMEIR/E005", "rule node has invalid type id lists", path));
  }
}

function validateEventDeclarationNode(node: Record<string, unknown>, path: string, diagnostics: Diagnostic[]): void {
  if (typeof node.eventType !== "string" || asEventTypeId(node.eventType) === undefined) {
    diagnostics.push(error("GAMEIR/E005", "event declaration has invalid event type id", `${path}.eventType`));
  }
  if (!isValueShape(node.payload)) {
    diagnostics.push(error("GAMEIR/E005", "event declaration has invalid payload shape", `${path}.payload`));
  }
}

function validateCapabilityDeclarationNode(node: Record<string, unknown>, path: string, diagnostics: Diagnostic[]): void {
  if (!isPlatformCapabilityDescriptor(node.requirement)) {
    diagnostics.push(
      error("GAMEIR/E010", "capability declaration has invalid descriptor/policy", `${path}.requirement`),
    );
  }
}

function validateAvatarBindingNode(node: Record<string, unknown>, path: string, diagnostics: Diagnostic[]): void {
  if (typeof node.role !== "string" || node.role.length === 0 || node.role.length > 64) {
    diagnostics.push(error("GAMEIR/E011", "avatar binding has invalid role", `${path}.role`));
  }
  if (!isHostRestriction(node.restrictions)) {
    diagnostics.push(error("GAMEIR/E011", "avatar binding has invalid host restrictions", `${path}.restrictions`));
  }
}

/**
 * ACR-001: granular validation of the optional document-level `world`
 * declaration. Absent means the legacy default (kind `game`, profile
 * unspecified) and is VALID — no diagnostic is emitted for absence.
 */
function validateWorldDeclaration(world: unknown, diagnostics: Diagnostic[]): void {
  if (typeof world !== "object" || world === null || Array.isArray(world)) {
    diagnostics.push(error("GAMEIR/E017", "world declaration must be an object", "world"));
    return;
  }
  const declaration = world as Record<string, unknown>;
  if (declaration.kind !== undefined && !isWorldKind(declaration.kind)) {
    diagnostics.push(
      error("GAMEIR/E019", `unknown world kind ${JSON.stringify(declaration.kind)}`, "world.kind"),
    );
  }
  if (declaration.targetProfile !== undefined && !isTargetProfile(declaration.targetProfile)) {
    diagnostics.push(
      error(
        "GAMEIR/E020",
        `unknown target profile ${JSON.stringify(declaration.targetProfile)}`,
        "world.targetProfile",
      ),
    );
  }
  for (const key of Object.keys(declaration)) {
    if (key !== "kind" && key !== "targetProfile") {
      diagnostics.push(error("GAMEIR/E017", `unknown world declaration key ${JSON.stringify(key)}`, "world"));
    }
  }
}

function validateNode(node: unknown, index: number, diagnostics: Diagnostic[]): void {
  const path = `nodes[${index}]`;
  if (!isRecord(node)) {
    diagnostics.push(error("GAMEIR/E005", `node at ${path} is not an object`, path));
    return;
  }
  if (typeof node.id !== "string" || asNodeId(node.id) === undefined) {
    diagnostics.push(error("GAMEIR/E005", "node has invalid id", `${path}.id`));
    return;
  }
  if (!isGameIRNodeKind(node.kind)) {
    diagnostics.push(error("GAMEIR/E005", `unknown node kind ${JSON.stringify(node.kind)}`, `${path}.kind`));
    return;
  }
  switch (node.kind) {
    case "world":
      validateWorldNode(node, path, diagnostics);
      break;
    case "scene":
      validateSceneNode(node, path, diagnostics);
      break;
    case "entity":
      validateEntityNode(node, path, diagnostics);
      break;
    case "rule":
      validateRuleNode(node, path, diagnostics);
      break;
    case "event-declaration":
      validateEventDeclarationNode(node, path, diagnostics);
      break;
    case "capability-declaration":
      validateCapabilityDeclarationNode(node, path, diagnostics);
      break;
    case "avatar-binding":
      validateAvatarBindingNode(node, path, diagnostics);
      break;
  }
}

function validateGraph(document: Record<string, unknown>, diagnostics: Diagnostic[]): void {
  const nodes = asArray(document.nodes).filter((node): node is Record<string, unknown> => isRecord(node));

  const nodeIds = new Set<string>();
  for (const node of nodes) {
    const id = typeof node.id === "string" ? node.id : "";
    if (id !== "" && nodeIds.has(id)) {
      diagnostics.push(error("GAMEIR/E006", `duplicate node id ${JSON.stringify(id)}`, "nodes"));
    }
    nodeIds.add(id);
  }

  const worldNodes = nodes.filter((node) => node.kind === "world");
  const sceneNodes = nodes.filter((node) => node.kind === "scene");
  const entityNodes = nodes.filter((node) => node.kind === "entity");
  const ruleNodes = nodes.filter((node) => node.kind === "rule");
  const eventDeclarations = nodes.filter((node) => node.kind === "event-declaration");

  const declaredWorlds = new Set(worldNodes.map((node) => `${node.world}`));
  const declaredScenes = new Set(sceneNodes.map((node) => `${node.world}/${node.scene}`));
  const declaredEventTypes = new Set(eventDeclarations.map((node) => `${node.eventType}`));

  if (isRecord(document.entry)) {
    const entry = document.entry;
    if (
      typeof entry.world === "string" &&
      isValidIdText(entry.world) &&
      typeof entry.scene === "string" &&
      isValidIdText(entry.scene) &&
      !declaredScenes.has(`${entry.world}/${entry.scene}`)
    ) {
      diagnostics.push(error("GAMEIR/E007", "entry scene does not resolve to a declared scene node", "entry"));
    }
  }

  for (const node of sceneNodes) {
    if (typeof node.world === "string" && isValidIdText(node.world) && !declaredWorlds.has(node.world)) {
      diagnostics.push(
        error("GAMEIR/E014", `scene references undeclared world ${JSON.stringify(node.world)}`, "nodes"),
      );
    }
  }

  for (const node of entityNodes) {
    if (typeof node.scene === "string" && isValidIdText(node.scene)) {
      const resolved = sceneNodes.some((scene) => `${scene.scene}` === `${node.scene}`);
      if (!resolved) {
        diagnostics.push(
          error("GAMEIR/E008", `entity references undeclared scene ${JSON.stringify(node.scene)}`, "nodes"),
        );
      }
    }
  }

  const usedEventTypes = new Set<string>();
  for (const node of ruleNodes) {
    for (const reference of [...asArray(node.on), ...asArray(node.emits)]) {
      if (typeof reference === "string") {
        usedEventTypes.add(reference);
        if (!declaredEventTypes.has(reference)) {
          diagnostics.push(
            error("GAMEIR/E009", `rule references undeclared event type ${JSON.stringify(reference)}`, "nodes"),
          );
        }
      }
    }
    for (const handle of asArray(node.handles)) {
      if (typeof handle === "string" && asIntentTypeId(handle) === undefined) {
        diagnostics.push(
          error("GAMEIR/E005", `rule handles invalid intent type id ${JSON.stringify(handle)}`, "nodes"),
        );
      }
    }
  }

  for (const node of eventDeclarations) {
    if (typeof node.eventType === "string" && !usedEventTypes.has(node.eventType)) {
      diagnostics.push(
        warning("GAMEIR/W001", `declared event type ${JSON.stringify(node.eventType)} is never used`, "nodes"),
      );
    }
  }
}

/**
 * Pure structural validation of a GameIR document.
 *
 * @param input anything (typically parsed JSON or an in-memory object)
 * @returns `{ ok: true, document }` when structurally valid, else every
 *          diagnostic found. Never throws.
 */
export function validate(input: unknown): ValidationResult {
  const diagnostics: Diagnostic[] = [];
  try {
    if (!isRecord(input)) {
      diagnostics.push(error("GAMEIR/E001", "document must be a non-null object", "$"));
      return { ok: false, diagnostics };
    }
    if (!isGameIRVersion(input.irVersion)) {
      diagnostics.push(
        error("GAMEIR/E002", `unsupported irVersion ${JSON.stringify(input.irVersion)}, expected "1"`, "irVersion"),
      );
    }
    if (!isGameIdentity(input.identity)) {
      diagnostics.push(error("GAMEIR/E003", "identity is not a valid GameIdentity", "identity"));
    }
    if (input.lifecycle !== undefined && !isGameLifecycleState(input.lifecycle)) {
      diagnostics.push(error("GAMEIR/E015", "invalid lifecycle state", "lifecycle"));
    }
    if (input.world !== undefined) {
      validateWorldDeclaration(input.world, diagnostics);
    }
    if (!isSceneRef(input.entry)) {
      diagnostics.push(error("GAMEIR/E016", "entry is not a valid SceneRef", "entry"));
    }
    if (!Array.isArray(input.nodes)) {
      diagnostics.push(error("GAMEIR/E004", "nodes must be an array", "nodes"));
    } else {
      for (let index = 0; index < input.nodes.length; index += 1) {
        validateNode(input.nodes[index], index, diagnostics);
      }
      validateGraph(input, diagnostics);
    }
  } catch {
    diagnostics.push(error("GAMEIR/E018", "internal safety net: validate must never throw", "$"));
  }

  if (hasErrors(diagnostics)) {
    return { ok: false, diagnostics };
  }
  return { ok: true, document: input as GameIRDocument, diagnostics };
}

/** Type-guard shorthand: true when `validate(input)` succeeds. */
export function isGameIRDocument(input: unknown): input is GameIRDocument {
  return validate(input).ok;
}

/** Collects only the error-severity diagnostics of a result. */
export function validationErrors(result: ValidationResult): readonly Diagnostic[] {
  return result.ok ? [] : result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
}

/** Counts nodes of each kind in a *validated* document (consumer helper). */
export function countNodeKinds(document: GameIRDocument): Record<GameIRNode["kind"], number> {
  const counts: Record<GameIRNode["kind"], number> = {
    world: 0,
    scene: 0,
    entity: 0,
    rule: 0,
    "event-declaration": 0,
    "capability-declaration": 0,
    "avatar-binding": 0,
  };
  for (const node of document.nodes) {
    counts[node.kind] += 1;
  }
  return counts;
}
