/**
 * GameArtifact — concrete outputs of a game task (roadmap M1.1; contract 08):
 * files, scenes, builds, render results, screenshots, reports. An artifact
 * record MUST distinguish an EXPECTED artifact from one that EXISTS and has
 * been VERIFIED — expectation is never proof.
 */

import { canonicalJson, assertJsonSafe, canonicalSha256 } from "../adapters/canonical.js";

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

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ARTIFACT_KINDS = ["file", "scene", "build", "render", "screenshot", "report"] as const;
const PROOF_KINDS = ["filesystem-probe", "artifact-hash", "engine-query", "output-schema"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(field: string, reason: string): never {
  throw new Error(`GAMOS/GAME-ARTIFACT: ${field} — ${reason}`);
}

/** Validates + constructs a GameArtifact from raw input. Fail-closed. */
export function parseGameArtifact(input: unknown): GameArtifact {
  if (!isRecord(input)) fail("input", "must be a non-null object");
  if (typeof input.artifactId !== "string" || !ID_PATTERN.test(input.artifactId)) {
    fail("artifactId", `must match ${ID_PATTERN}`);
  }
  const artifactKind = input.kind;
  if (artifactKind !== "file" && artifactKind !== "scene" && artifactKind !== "build" && artifactKind !== "render" && artifactKind !== "screenshot" && artifactKind !== "report") {
    fail("kind", `must be one of ${ARTIFACT_KINDS.join("|")}, got ${JSON.stringify(artifactKind)}`);
  }
  const planRef = input.planRef;
  if (!isRecord(planRef)) fail("planRef", "must be an object");
  const planRefPlanId = planRef.planId;
  if (typeof planRefPlanId !== "string" || !ID_PATTERN.test(planRefPlanId)) {
    fail("planRef.planId", `must match ${ID_PATTERN}`);
  }
  if (planRef.stepId !== undefined && (typeof planRef.stepId !== "string" || !ID_PATTERN.test(planRef.stepId))) {
    fail("planRef.stepId", `must match ${ID_PATTERN} when present`);
  }
  const artifactDescription = input.description;
  if (typeof artifactDescription !== "string" || artifactDescription.length === 0) {
    fail("description", "must be a non-empty string");
  }
  if (typeof input.createdAt !== "string" || !Number.isFinite(Date.parse(input.createdAt))) {
    fail("createdAt", "must be an ISO-8601 timestamp");
  }

  let existence: ArtifactExistenceProof | undefined;
  if (input.existence !== undefined) {
    const ex = input.existence;
    if (!isRecord(ex)) fail("existence", "must be an object when present");
    if (typeof ex.verifiedAt !== "string" || !Number.isFinite(Date.parse(ex.verifiedAt))) {
      fail("existence.verifiedAt", "must be an ISO-8601 timestamp");
    }
    const verifiedBy = ex.verifiedBy;
    if (verifiedBy !== "filesystem-probe" && verifiedBy !== "artifact-hash" && verifiedBy !== "engine-query" && verifiedBy !== "output-schema") {
      fail("existence.verifiedBy", `must be one of ${PROOF_KINDS.join("|")}`);
    }
    if (typeof ex.path !== "string" || ex.path.length === 0) {
      fail("existence.path", "must be a non-empty path");
    }
    if (typeof ex.sha256 !== "string" || !SHA256_PATTERN.test(ex.sha256)) {
      fail("existence.sha256", "must be a 64-hex sha256");
    }
    if (ex.bytes !== undefined && (typeof ex.bytes !== "number" || !Number.isInteger(ex.bytes) || ex.bytes < 0)) {
      fail("existence.bytes", "must be a non-negative integer when present");
    }
    existence = {
      verifiedAt: ex.verifiedAt as string,
      verifiedBy: verifiedBy,
      path: ex.path as string,
      sha256: ex.sha256 as string,
      ...(ex.bytes !== undefined ? { bytes: ex.bytes as number } : {}),
    };
  }

  assertJsonSafe(input);

  const artifact: GameArtifact = {
    artifactId: input.artifactId,
    kind: artifactKind,
    planRef: {
      planId: planRefPlanId,
      ...(planRef.stepId !== undefined ? { stepId: planRef.stepId as string } : {}),
    },
    description: artifactDescription,
    ...(existence ? { existence } : {}),
    createdAt: input.createdAt,
  };
  assertJsonSafe(artifact);
  return artifact;
}

/** Deterministic canonical serialization. */
export function serializeGameArtifact(artifact: GameArtifact): string {
  return canonicalJson(artifact);
}

/** Stable SHA-256 content digest of the canonical serialization. */
export function hashGameArtifact(artifact: GameArtifact): string {
  return canonicalSha256(artifact);
}

/**
 * Identity rule: true only when the artifact carries a VERIFIED existence
 * proof (an expected artifact without proof is `expected`, not `verified`).
 */
export function isVerifiedArtifact(artifact: GameArtifact): boolean {
  const existence = artifact.existence;
  return Boolean(
    existence &&
      existence.path.length > 0 &&
      SHA256_PATTERN.test(existence.sha256) &&
      Number.isFinite(Date.parse(existence.verifiedAt)),
  );
}
