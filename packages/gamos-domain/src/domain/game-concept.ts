/**
 * GameConcept — the user's gaming intent in a structured, serializable form
 * (roadmap M1.1; contract 01 §3). Plain data: no engine runtime, no process.
 */

import { canonicalJson, canonicalSha256, assertJsonSafe } from "../adapters/canonical.js";

import { isEngineFamily, ENGINE_FAMILY_LIST as ENGINE_FAMILIES } from "../engine-family.js";
import type { EngineFamily } from "../engine-family.js";

export type { EngineFamily };
export { isEngineFamily };

/** A user-stated engine/platform preference, which may be a soft preference. */
export interface EngineFamilyPreference {
  readonly engineFamily: EngineFamily;
  readonly preference: "required" | "preferred" | "acceptable";
}

/** Where a GameConcept came from — provenance is mandatory (contract 09). */
export interface ConceptProvenance {
  readonly origin: "user-message" | "model-assisted" | "imported-file";
  /** Session/task id of the originating conversation when origin is user-message. */
  readonly sessionId?: string;
  /** Free-form source locator (message id, file path) — never secrets. */
  readonly sourceRef?: string;
  readonly capturedAt: string;
}

/** A user-provided reference (example game, asset, document) attached to a concept. */
export interface GameConceptReference {
  readonly kind: "game-title" | "asset" | "document" | "url";
  readonly ref: string;
  readonly note?: string;
}

/** Project context identity — a reference to discovery output, never inline data. */
export interface ProjectContextRef {
  readonly projectRoot: string;
  readonly discoveryRecordRef: string;
}

/** The structured gaming intent. Independent of engine-specific runtimes. */
export interface GameConcept {
  readonly conceptId: string;
  readonly kind: "gaming";
  readonly genre: readonly string[];
  readonly mechanics: readonly string[];
  readonly platformPreferences: readonly EngineFamilyPreference[];
  readonly references: readonly GameConceptReference[];
  readonly constraints: readonly string[];
  readonly projectContext?: ProjectContextRef;
  readonly acceptanceExpectations: readonly string[];
  readonly provenance: ConceptProvenance;
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const REFERENCE_KINDS = ["game-title", "asset", "document", "url"] as const;
const PROVENANCE_ORIGINS = ["user-message", "model-assisted", "imported-file"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.length > 0);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function fail(field: string, reason: string): never {
  throw new Error(`GAMOS/GAME-CONCEPT: ${field} — ${reason}`);
}

/**
 * Validates + constructs a GameConcept from raw input. Fail-closed:
 * malformed fields, wrong kinds, non-serializable input and missing
 * provenance all throw with a field-specific error.
 */
export function createGameConcept(input: unknown): GameConcept {
  if (!isRecord(input)) fail("input", "must be a non-null object");

  if (input.kind !== "gaming") fail("kind", `must be "gaming", got ${JSON.stringify(input.kind)}`);
  if (!isNonEmptyString(input.conceptId)) fail("conceptId", "must be a non-empty string");
  if (!ID_PATTERN.test(input.conceptId)) fail("conceptId", `must match ${ID_PATTERN}`);
  if (input.genre !== undefined && !isStringArray(input.genre)) fail("genre", "must be an array of non-empty strings");
  if (input.mechanics !== undefined && !isStringArray(input.mechanics)) fail("mechanics", "must be an array of non-empty strings");
  if (input.constraints !== undefined && !isStringArray(input.constraints)) fail("constraints", "must be an array of non-empty strings");
  if (input.acceptanceExpectations !== undefined && !isStringArray(input.acceptanceExpectations)) {
    fail("acceptanceExpectations", "must be an array of non-empty strings");
  }

  // Provenance is mandatory (contract 09).
  const provenance = input.provenance;
  if (!isRecord(provenance)) fail("provenance", "is mandatory and must be an object");
  const provenanceOrigin = provenance.origin;
  if (provenanceOrigin !== "user-message" && provenanceOrigin !== "model-assisted" && provenanceOrigin !== "imported-file") {
    fail("provenance.origin", `must be one of ${PROVENANCE_ORIGINS.join("|")}`);
  }
  if (!isIsoTimestamp(provenance.capturedAt)) fail("provenance.capturedAt", "must be an ISO-8601 timestamp");
  if (provenance.sessionId !== undefined && !isNonEmptyString(provenance.sessionId)) {
    fail("provenance.sessionId", "must be a non-empty string when present");
  }
  if (provenance.sourceRef !== undefined && !isNonEmptyString(provenance.sourceRef)) {
    fail("provenance.sourceRef", "must be a non-empty string when present");
  }

  // Platform preferences: validated engine families + preference kinds.
  const preferences = input.platformPreferences ?? [];
  if (!Array.isArray(preferences)) fail("platformPreferences", "must be an array");
  for (const entry of preferences) {
    if (!isRecord(entry)) fail("platformPreferences[]", "each entry must be an object");
    if (!isEngineFamily(entry.engineFamily)) {
      fail("platformPreferences[].engineFamily", `must be one of ${ENGINE_FAMILIES.join("|")}, got ${JSON.stringify(entry.engineFamily)}`);
    }
    if (entry.preference !== "required" && entry.preference !== "preferred" && entry.preference !== "acceptable") {
      fail("platformPreferences[].preference", 'must be "required" | "preferred" | "acceptable"');
    }
  }

  // References: kind + non-empty ref, optional note.
  const references = input.references ?? [];
  if (!Array.isArray(references)) fail("references", "must be an array");
  for (const entry of references) {
    if (!isRecord(entry)) fail("references[]", "each entry must be an object");
    const referenceKind = entry.kind;
    if (referenceKind !== "game-title" && referenceKind !== "asset" && referenceKind !== "document" && referenceKind !== "url") {
      fail("references[].kind", `must be one of ${REFERENCE_KINDS.join("|")}`);
    }
    if (!isNonEmptyString(entry.ref)) fail("references[].ref", "must be a non-empty string");
    if (entry.note !== undefined && typeof entry.note !== "string") fail("references[].note", "must be a string when present");
  }

  // Project context is a REFERENCE to discovery output, never inline data.
  let projectContext: ProjectContextRef | undefined;
  if (input.projectContext !== undefined) {
    const pc = input.projectContext;
    if (!isRecord(pc)) fail("projectContext", "must be an object");
    if (!isNonEmptyString(pc.projectRoot)) fail("projectContext.projectRoot", "must be a non-empty string");
    if (!isNonEmptyString(pc.discoveryRecordRef)) fail("projectContext.discoveryRecordRef", "must be a non-empty string");
    projectContext = {
      projectRoot: pc.projectRoot,
      discoveryRecordRef: pc.discoveryRecordRef,
    };
  }

  // Fail closed on non-serializable input (cycles, functions, undefined...).
  assertSerializable(input);

  const concept: GameConcept = {
    conceptId: input.conceptId,
    kind: "gaming",
    genre: (input.genre ?? []) as readonly string[],
    mechanics: (input.mechanics ?? []) as readonly string[],
    platformPreferences: preferences as readonly EngineFamilyPreference[],
    references: references as readonly GameConceptReference[],
    constraints: (input.constraints ?? []) as readonly string[],
    ...(projectContext ? { projectContext } : {}),
    acceptanceExpectations: (input.acceptanceExpectations ?? []) as readonly string[],
    provenance: {
      origin: provenance.origin as ConceptProvenance["origin"],
      ...(isNonEmptyString(provenance.sessionId) ? { sessionId: provenance.sessionId } : {}),
      ...(isNonEmptyString(provenance.sourceRef) ? { sourceRef: provenance.sourceRef } : {}),
      capturedAt: provenance.capturedAt,
    },
  };
  assertSerializable(concept);
  return concept;
}

/** Deterministic canonical serialization (sorted keys, stable array order). */
export function serializeGameConcept(concept: GameConcept): string {
  return canonicalJson(concept);
}

/** Stable content digest of the canonical serialization. */
export function hashGameConcept(concept: GameConcept): string {
  return canonicalSha256(concept);
}

function assertSerializable(value: unknown): void {
  // Throws on cycles/undefined/functions (fail closed); see canonical.ts.
  assertJsonSafe(value);
}
