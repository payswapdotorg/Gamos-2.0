/**
 * Versioned capability registry — data + validation logic for the
 * `gamos/capability@2` schema (roadmap M1.2; contract 02 revision 1).
 *
 * The registry is a DATA CATALOG consumed by the existing agent tool layer.
 * It never dispatches processes and is not a tool bus. Selection is
 * FAIL-CLOSED: unknown id, version mismatch, engine incompatibility and
 * unavailability are explicit errors; there is NO silent registry-order
 * fallback. Meaningful substitutions require disclosure + the existing
 * ZCode approval path (the approval record names both capabilities).
 */

import type { EngineFamily } from "./game-concept.js";

/** JSON Schema (draft 2020-12) describing a capability input or output. */
export interface JsonSchemaSpec {
  readonly $schema?: string;
  readonly type: "object";
  readonly properties: Record<string, unknown>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
}

/** Permission requirement mapped to the existing ZCode permission system (contract 06). */
export interface PermissionSpec {
  readonly kind:
    | "filesystem-write"
    | "command-execution"
    | "network-access"
    | "engine-headless"
    | "engine-gui"
    | "artifact-publish";
  readonly scope: string;
  readonly rationale: string;
}

/** Availability specification (contract 07): local/remote/unavailable with reason. */
export interface AvailabilitySpec {
  readonly state: "available" | "unavailable" | "conditional";
  readonly reason: string;
  readonly prerequisites?: readonly string[];
}

/** Provenance reference (contract 09): who published this capability and where. */
export interface ProvenanceRef {
  readonly publisher: "official" | "community" | "local";
  /** Repository coordinates or local path identity; never secrets. */
  readonly source: string;
  readonly commitSha?: string;
  readonly verifiedAt?: string;
}

/** The capability record (schema `gamos/capability@2`, contract 02 §2). */
export interface CapabilityRecord {
  readonly id: string;
  readonly version: string;
  readonly title: string;
  readonly description: string;
  readonly engineFamily?: EngineFamily;
  readonly input: JsonSchemaSpec;
  readonly output: JsonSchemaSpec;
  readonly permissions: readonly PermissionSpec[];
  readonly availability: AvailabilitySpec;
  readonly provenance: ProvenanceRef;

  // Execution-safety record — ALL fields REQUIRED (revision 1).
  readonly provider: {
    kind: "engine-binary" | "mcp-server" | "app-plugin" | "agent-tool" | "remote-service";
    identity: string;
    discoveredVia?: string;
  };
  readonly prerequisites: readonly {
    id: string;
    description: string;
  }[];
  readonly compatibility: {
    engineVersions?: string;
    runtime?: string;
    notes?: string;
  };
  readonly reversibility: {
    kind: "reversible" | "recoverable" | "irreversible";
    notes: string;
  };
  readonly idempotency: {
    repeatable: boolean;
    dedupeKey?: string;
  };
  readonly timeout: {
    defaultMs: number;
    maxMs: number;
  };
  readonly cancellation: {
    supported: boolean;
    semantics: string;
  };
  readonly verification: {
    method: "output-schema" | "artifact-hash" | "filesystem-probe" | "engine-query";
    spec: string;
  };
}

// ---------------------------------------------------------------------------
// RED stubs — behavior implemented in the GREEN commit.
// ---------------------------------------------------------------------------

/**
 * Registers a capability record. Fail-closed: an incomplete execution-safety
 * block (provider identity, prerequisites, compatibility, reversibility,
 * idempotency, timeout, cancellation, verification) rejects registration.
 */
export function registerCapability(_record: unknown): CapabilityRecord {
  throw new Error("GAMOS/M1.2/RED: registerCapability is not implemented yet");
}

/** Lookup by stable id + contract version. Unknown id/version fail closed. */
export function getCapability(_registry: ReadonlyMap<string, CapabilityRecord>, _id: string, _version?: string): CapabilityRecord {
  throw new Error("GAMOS/M1.2/RED: getCapability is not implemented yet");
}

/**
 * Fail-closed resolution for dispatch: validates id, version, engine-family
 * compatibility, availability, prerequisites and input against the registry
 * view. Returns the resolved record or an explicit error carrying the
 * requested id/version, the fail-closed reason and remediation data
 * (available alternatives as DATA, never auto-selected).
 */
export function resolveCapability(
  _registry: ReadonlyMap<string, CapabilityRecord>,
  _request: { id: string; version?: string; engineFamily?: EngineFamily; input?: unknown },
): { ok: true; record: CapabilityRecord } | { ok: false; error: CapabilityResolutionError } {
  throw new Error("GAMOS/M1.2/RED: resolveCapability is not implemented yet");
}

export interface CapabilityResolutionError {
  readonly code:
    | "unknown-id"
    | "unknown-version"
    | "version-mismatch"
    | "engine-incompatible"
    | "unavailable"
    | "missing-prerequisite"
    | "invalid-input";
  readonly requestedId: string;
  readonly requestedVersion?: string;
  readonly reason: string;
  readonly remediation: readonly {
    capabilityId: string;
    version: string;
    difference: string;
  }[];
}

/** Lists registered capabilities (append-only once published). */
export function listCapabilities(_registry: ReadonlyMap<string, CapabilityRecord>): readonly CapabilityRecord[] {
  throw new Error("GAMOS/M1.2/RED: listCapabilities is not implemented yet");
}
