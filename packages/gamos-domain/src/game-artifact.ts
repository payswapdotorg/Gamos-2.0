/**
 * GameArtifact — concrete outputs of a game task (roadmap M1.1; contract 08):
 * files, scenes, builds, render results, screenshots, reports. An artifact
 * record MUST distinguish an EXPECTED artifact from one that EXISTS and has
 * been VERIFIED — expectation is never proof.
 */

/** Evidence that an artifact actually exists (verified, not assumed). */
export interface ArtifactExistenceProof {
  readonly verifiedAt: string;
  readonly verifiedBy: "filesystem-probe" | "artifact-hash" | "engine-query" | "output-schema";
  /** Absolute or workspace-relative path of the verified artifact. */
  readonly path: string;
  readonly sha256: string;
  readonly bytes?: number;
}

/** The artifact record (pure data). */
export interface GameArtifact {
  readonly artifactId: string;
  readonly kind: "file" | "scene" | "build" | "render" | "screenshot" | "report";
  readonly planRef: {
    readonly planId: string;
    readonly stepId?: string;
  };
  readonly description: string;
  /**
   * Expected artifacts carry NO existence proof; a record with a proof has
   * been actually observed and hashed. The distinction is normative.
   */
  readonly existence?: ArtifactExistenceProof;
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// RED stubs — behavior implemented in the GREEN commit.
// ---------------------------------------------------------------------------

/** Validates + constructs a GameArtifact from raw input. Fail-closed. */
export function parseGameArtifact(_input: unknown): GameArtifact {
  throw new Error("GAMOS/M1.1/RED: parseGameArtifact is not implemented yet");
}

/** Deterministic canonical serialization. */
export function serializeGameArtifact(_artifact: GameArtifact): string {
  throw new Error("GAMOS/M1.1/RED: serializeGameArtifact is not implemented yet");
}

/** Stable content digest of the canonical serialization. */
export function hashGameArtifact(_artifact: GameArtifact): string {
  throw new Error("GAMOS/M1.1/RED: hashGameArtifact is not implemented yet");
}

/**
 * Identity rule: true only when the artifact carries a VERIFIED existence
 * proof (an expected artifact without proof is `expected`, not `verified`).
 */
export function isVerifiedArtifact(_artifact: GameArtifact): boolean {
  throw new Error("GAMOS/M1.1/RED: isVerifiedArtifact is not implemented yet");
}
