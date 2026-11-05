/**
 * GameConcept — the user's gaming intent in a structured, serializable form
 * (roadmap M1.1; contract 01 §3). Plain data: no engine runtime, no process.
 *
 * RED stub: type declarations only — runtime construction/validation/serialization
 * behavior is implemented in the GREEN commit (TDD RED→GREEN).
 */

/** Engine families Gamos knows by name (M1.3 discovers real installations). */
export type EngineFamily = "unity" | "blender" | "babylon" | "godot" | "unreal" | "core";

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

// ---------------------------------------------------------------------------
// RED stubs — behavior implemented in the GREEN commit.
// ---------------------------------------------------------------------------

/** Validates + constructs a GameConcept from raw input. Fail-closed. */
export function createGameConcept(_input: unknown): GameConcept {
  throw new Error("GAMOS/M1.1/RED: createGameConcept is not implemented yet");
}

/** Deterministic canonical serialization (sorted keys, stable array order). */
export function serializeGameConcept(_concept: GameConcept): string {
  throw new Error("GAMOS/M1.1/RED: serializeGameConcept is not implemented yet");
}

/** Stable content digest of the canonical serialization. */
export function hashGameConcept(_concept: GameConcept): string {
  throw new Error("GAMOS/M1.1/RED: hashGameConcept is not implemented yet");
}
