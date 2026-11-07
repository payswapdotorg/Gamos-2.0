/**
 * Canonical provenance reference — contract 09 §4, schema `gamos/provenance@2`.
 *
 * Single source of truth for provenance semantics, consumed by BOTH:
 *   - capability records (contract 02 §2 `provenance: ProvenanceRef`), and
 *   - engine-plugin records (contract 03/09 `PluginProcessDeclaration.provenance`).
 *
 * The schema (frozen contract 09 revision 2 — do not extend here):
 *
 *   interface ProvenanceRef {
 *     publisher: "zcode-official" | "gamos-tl" | "community";
 *     source: { type: "marketplace"; marketplaceId: string; version: string; sha256: string }
 *           | { type: "repository"; repo: string; commitSha: string; path: string };
 *     surfaces?: Array<"ui" | "mcp">;   // which execution surfaces this provenance covers
 *     reviewedBy?: string;              // TL login for TL-reviewed plugins
 *     reviewRef?: string;               // REQUIRED for community mcp-carrying plugins (§3.6)
 *   }
 *
 * This module is pure data validation (the domain package stays pure — no
 * process spawning, no sockets, no resolution I/O). Reference RESOLUTION at
 * load time is injected by callers via a resolver callback (see
 * validatePluginProcessTrust options) so an unresolvable provenance reference
 * produces an explicit disabled/rejected state (contract 09 §3 rule 7).
 */

/** Contract 09 §4 publisher values (closed set). */
export type ProvenancePublisher = "zcode-official" | "gamos-tl" | "community";

/** Execution surfaces a provenance ref may cover (contract 09 §2). */
export type ProvenanceSurface = "ui" | "mcp";

/** Marketplace artifact source (contract 09 §4). */
export interface MarketplaceProvenanceSource {
  readonly type: "marketplace";
  readonly marketplaceId: string;
  readonly version: string;
  readonly sha256: string;
}

/** Repository source (contract 09 §4) — repository, commit and path. */
export interface RepositoryProvenanceSource {
  readonly type: "repository";
  readonly repo: string;
  readonly commitSha: string;
  readonly path: string;
}

/** The structured source identifying a marketplace artifact or a repository location. */
export type ProvenanceSource = MarketplaceProvenanceSource | RepositoryProvenanceSource;

/** The canonical provenance ref (contract 09 §4, `gamos/provenance@2`). */
export interface ProvenanceRef {
  readonly publisher: ProvenancePublisher;
  readonly source: ProvenanceSource;
  /** Which execution surfaces this provenance covers. */
  readonly surfaces?: readonly ProvenanceSurface[];
  /** TL login for TL-reviewed plugins. */
  readonly reviewedBy?: string;
  /** PR / ledger decision_ref — REQUIRED for community mcp-carrying plugins. */
  readonly reviewRef?: string;
}

/** Structured validation outcome. */
export type ProvenanceValidation =
  | { ok: true; ref: ProvenanceRef }
  | { ok: false; field: string; reason: string };

/** The schema id named by frozen contract 09 §4. */
export const PROVENANCE_SCHEMA_ID = "gamos/provenance@2";

const PUBLISHERS: readonly string[] = ["zcode-official", "gamos-tl", "community"];
const SURFACES: readonly string[] = ["ui", "mcp"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isHexOfLength(value: unknown, length: number): value is string {
  return typeof value === "string" && new RegExp(`^[0-9a-f]{${length}}$`).test(value);
}

/**
 * Validates an unknown value against the canonical `gamos/provenance@2`
 * schema. Fail closed on every structural deviation: unknown publisher,
 * loose-string sources, missing marketplace version/hash, missing repository
 * commit/path, malformed hashes, invalid surfaces.
 */
export function validateProvenanceRef(input: unknown): ProvenanceValidation {
  if (!isRecord(input)) {
    return {
      ok: false,
      field: "provenance",
      reason: `provenance must be an object following the canonical ${PROVENANCE_SCHEMA_ID} schema (contract 09 §4)`,
    };
  }

  const publisher = input.publisher;
  if (typeof publisher !== "string" || !PUBLISHERS.includes(publisher)) {
    return {
      ok: false,
      field: "provenance.publisher",
      reason: `publisher must be one of "zcode-official" | "gamos-tl" | "community" (got ${JSON.stringify(publisher)}) — canonical ${PROVENANCE_SCHEMA_ID} values only (contract 09 §4)`,
    };
  }

  const source = input.source;
  if (!isRecord(source)) {
    return {
      ok: false,
      field: "provenance.source",
      reason: `source must be a structured object — { type: "marketplace", marketplaceId, version, sha256 } or { type: "repository", repo, commitSha, path } — loose-string sources are not ${PROVENANCE_SCHEMA_ID} (contract 09 §4)`,
    };
  }

  if (source.type === "marketplace") {
    if (!isNonEmptyString(source.marketplaceId)) {
      return { ok: false, field: "provenance.source.marketplaceId", reason: "marketplace source requires a non-empty marketplaceId (contract 09 §4)" };
    }
    if (!isNonEmptyString(source.version)) {
      return { ok: false, field: "provenance.source.version", reason: "marketplace source requires a version (contract 09 §4)" };
    }
    if (!isHexOfLength(source.sha256, 64)) {
      return { ok: false, field: "provenance.source.sha256", reason: "marketplace source requires a 64-hex sha256 artifact hash (contract 09 §4)" };
    }
  } else if (source.type === "repository") {
    if (!isNonEmptyString(source.repo)) {
      return { ok: false, field: "provenance.source.repo", reason: "repository source requires a non-empty repo (contract 09 §4)" };
    }
    if (!isHexOfLength(source.commitSha, 40)) {
      return { ok: false, field: "provenance.source.commitSha", reason: "repository source requires a 40-hex git commitSha (contract 09 §4)" };
    }
    if (!isNonEmptyString(source.path)) {
      return { ok: false, field: "provenance.source.path", reason: "repository source requires a non-empty path (contract 09 §4)" };
    }
  } else {
    return {
      ok: false,
      field: "provenance.source.type",
      reason: `source.type must be "marketplace" or "repository" (got ${JSON.stringify(source.type)}) — canonical ${PROVENANCE_SCHEMA_ID} sources only (contract 09 §4)`,
    };
  }

  const surfaces = input.surfaces;
  if (surfaces !== undefined) {
    if (!Array.isArray(surfaces) || surfaces.length === 0 || !surfaces.every((s) => typeof s === "string" && SURFACES.includes(s))) {
      return {
        ok: false,
        field: "provenance.surfaces",
        reason: `surfaces, when present, must be a non-empty array of "ui" | "mcp" (got ${JSON.stringify(surfaces)}) — which execution surfaces this provenance covers (contract 09 §4)`,
      };
    }
  }

  const reviewedBy = input.reviewedBy;
  if (reviewedBy !== undefined && !isNonEmptyString(reviewedBy)) {
    return { ok: false, field: "provenance.reviewedBy", reason: "reviewedBy, when present, must be a non-empty string (the TL login for TL-reviewed plugins, contract 09 §4)" };
  }

  const reviewRef = input.reviewRef;
  if (reviewRef !== undefined && !isNonEmptyString(reviewRef)) {
    return { ok: false, field: "provenance.reviewRef", reason: "reviewRef, when present, must be a non-empty string — the PR / ledger decision_ref identifying the review (contract 09 §4)" };
  }

  // Retention: the canonical record is passed through verbatim — no field of
  // the structured source, surfaces, publisher, reviewer or review ref is
  // dropped or rewritten by validation.
  return { ok: true, ref: input as ProvenanceRef };
}
