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
import type { ProvenanceRef } from "./provenance.js";
import {
  validateProvenanceRef,
  PROVENANCE_SCHEMA_ID,
} from "./provenance.js";

// Canonical provenance semantics (contract 09 §4, `gamos/provenance@2`) are
// shared with engine-plugin records — one schema, two consumers.
export type {
  ProvenanceRef,
  ProvenanceSource,
  ProvenancePublisher,
  ProvenanceSurface,
} from "./provenance.js";

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

const CAPABILITY_ID_PATTERN = /^[a-z0-9-]+(\/[a-z0-9.-]+)+$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9a-zA-Z.-]+)?$/;
const ENGINE_FAMILIES = ["unity", "blender", "babylon", "godot", "unreal", "core"] as const;
const PROVIDER_KINDS = [
  "engine-binary",
  "mcp-server",
  "app-plugin",
  "agent-tool",
  "remote-service",
] as const;
const PERMISSION_KINDS = [
  "filesystem-write",
  "command-execution",
  "network-access",
  "engine-headless",
  "engine-gui",
  "artifact-publish",
] as const;
const REVERSIBILITY_KINDS = ["reversible", "recoverable", "irreversible"] as const;
const VERIFICATION_METHODS = ["output-schema", "artifact-hash", "filesystem-probe", "engine-query"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function fail(field: string, reason: string): never {
  throw new Error(`GAMOS/CAPABILITY-REGISTRY: ${field} — ${reason} (contract 02: incomplete execution-safety records are rejected at registration)`);
}

/**
 * Registers a capability record. Fail-closed: an incomplete execution-safety
 * block (provider identity, prerequisites, compatibility, reversibility,
 * idempotency, timeout, cancellation, verification) rejects registration.
 */
export function registerCapability(record: unknown): CapabilityRecord {
  if (!isRecord(record)) fail("record", "must be a non-null object");

  const recordId = record.id;
  if (typeof recordId !== "string" || !CAPABILITY_ID_PATTERN.test(recordId)) {
    fail("id", `must match ${CAPABILITY_ID_PATTERN} ("<engine>/<verb>" or "core/<verb>")`);
  }
  const recordVersion = record.version;
  if (typeof recordVersion !== "string" || !SEMVER_PATTERN.test(recordVersion)) {
    fail("version", "must be a valid semver of the capability contract");
  }
  if (!isNonEmptyString(record.title)) fail("title", "must be a non-empty string");
  if (!isNonEmptyString(record.description)) fail("description", "must be a non-empty string");
  if (record.engineFamily !== undefined) {
    if (!(ENGINE_FAMILIES as readonly string[]).includes(record.engineFamily as string)) {
      fail("engineFamily", `must be one of ${ENGINE_FAMILIES.join("|")} when present`);
    }
  }

  const input = validateJsonSchemaSpec(record.input, "input");
  const output = validateJsonSchemaSpec(record.output, "output");

  if (!Array.isArray(record.permissions)) fail("permissions", "must be an array");
  const permissionsList = record.permissions as unknown[];
  for (const perm of permissionsList as Record<string, unknown>[]) {
    if (!isRecord(perm)) fail("permissions[]", "each entry must be an object");
    const permKind = perm.kind;
    if (!(PERMISSION_KINDS as readonly string[]).includes(permKind as string)) {
      fail("permissions[].kind", `must be one of ${PERMISSION_KINDS.join("|")} (contract 06 mapping)`);
    }
    const permScope = perm.scope;
    if (typeof permScope !== "string" || permScope.length === 0) fail("permissions[].scope", "must be a non-empty string");
    const permRationale = perm.rationale;
    if (typeof permRationale !== "string" || permRationale.length === 0) fail("permissions[].rationale", "must be a non-empty string");
  }

  const availability = record.availability;
  if (!isRecord(availability)) fail("availability", "must be an object (contract 07)");
  const availabilityState = availability.state;
  if (availabilityState !== "available" && availabilityState !== "unavailable" && availabilityState !== "conditional") {
    fail("availability.state", 'must be "available" | "unavailable" | "conditional"');
  }
  const availabilityReason = availability.reason;
  if (typeof availabilityReason !== "string" || availabilityReason.length === 0) {
    fail("availability.reason", "must be a non-empty string");
  }

  if (availability.prerequisites !== undefined && !Array.isArray(availability.prerequisites)) {
    fail("availability.prerequisites", "must be an array when present");
  }

  const provenance = record.provenance;
  if (!isRecord(provenance)) fail("provenance", "must be an object (contract 09: missing provenance is a registration failure)");
  // Canonical `gamos/provenance@2` validation (contract 09 §4) — the same
  // semantics engine-plugin records consume (shared provenance module).
  const provenanceValidation = validateProvenanceRef(provenance);
  if (!provenanceValidation.ok) {
    fail(provenanceValidation.field, `${provenanceValidation.reason} — canonical ${PROVENANCE_SCHEMA_ID} is required (contract 09 §4; capability and engine-plugin records share this schema)`);
  }

  const provider = record.provider;
  if (!isRecord(provider)) fail("provider", "provider identity is REQUIRED (who executes this capability)");
  const providerKind = provider.kind;
  if (!(PROVIDER_KINDS as readonly string[]).includes(providerKind as string)) {
    fail("provider.kind", `must be one of ${PROVIDER_KINDS.join("|")}`);
  }
  const providerIdentity = provider.identity;
  if (typeof providerIdentity !== "string" || providerIdentity.length === 0) {
    fail("provider.identity", "must be a non-empty identity string (e.g. executable id or plugin id)");
  }
  if (provider.discoveredVia !== undefined && !isNonEmptyString(provider.discoveredVia)) {
    fail("provider.discoveredVia", "must be a non-empty discovery probe id when present");
  }

  const prerequisitesList = Array.isArray(record.prerequisites) ? (record.prerequisites as unknown[]) : undefined;
  if (prerequisitesList === undefined) {
    fail("prerequisites", "must be an array (even empty — the data is mandatory)");
  }
  for (const prereq of (prerequisitesList ?? []) as Record<string, unknown>[]) {
    if (!isRecord(prereq)) fail("prerequisites[]", "each entry must be an object");
    const prereqId = prereq.id;
    if (typeof prereqId !== "string" || prereqId.length === 0) fail("prerequisites[].id", "must be a non-empty string");
    const prereqDescription = prereq.description;
    if (typeof prereqDescription !== "string" || prereqDescription.length === 0) {
      fail("prerequisites[].description", "must be a non-empty string");
    }
  }

  const compatibility = record.compatibility;
  if (!isRecord(compatibility)) fail("compatibility", "must be an object");
  const compatibilityEngineVersions = compatibility.engineVersions;
  if (compatibilityEngineVersions !== undefined && (typeof compatibilityEngineVersions !== "string" || (compatibilityEngineVersions as string).length === 0)) {
    fail("compatibility.engineVersions", "must be a non-empty engine-specific version predicate when present");
  }
  const compatibilityRuntime = compatibility.runtime;
  if (compatibilityRuntime !== undefined && (typeof compatibilityRuntime !== "string" || (compatibilityRuntime as string).length === 0)) {
    fail("compatibility.runtime", "must be a non-empty string when present");
  }

  const reversibility = record.reversibility;
  if (!isRecord(reversibility)) fail("reversibility", "must be an object");
  const reversibilityKind = reversibility.kind;
  if (!(REVERSIBILITY_KINDS as readonly string[]).includes(reversibilityKind as string)) {
    fail("reversibility.kind", `must be one of ${REVERSIBILITY_KINDS.join("|")}`);
  }
  const reversibilityNotes = reversibility.notes;
  if (typeof reversibilityNotes !== "string" || reversibilityNotes.length === 0) {
    fail("reversibility.notes", "must be a non-empty string");
  }

  const idempotency = record.idempotency;
  if (!isRecord(idempotency)) fail("idempotency", "must be an object");
  const idempotencyRepeatable = idempotency.repeatable;
  if (typeof idempotencyRepeatable !== "boolean") fail("idempotency.repeatable", "must be a boolean");
  if (idempotency.dedupeKey !== undefined && !isNonEmptyString(idempotency.dedupeKey)) {
    fail("idempotency.dedupeKey", "must be a non-empty input-derived key when present");
  }

  const timeout = record.timeout;
  if (!isRecord(timeout)) fail("timeout", "must be an object");
  const timeoutDefaultMs = timeout.defaultMs;
  if (!Number.isInteger(timeoutDefaultMs) || (timeoutDefaultMs as number) <= 0) {
    fail("timeout.defaultMs", "must be a positive integer");
  }
  const timeoutMaxMs = timeout.maxMs;
  if (!Number.isInteger(timeoutMaxMs) || (timeoutMaxMs as number) < (timeoutDefaultMs as number)) {
    fail("timeout.maxMs", "must be a positive integer >= defaultMs");
  }

  const cancellation = record.cancellation;
  if (!isRecord(cancellation)) fail("cancellation", "must be an object");
  const cancellationSupported = cancellation.supported;
  if (typeof cancellationSupported !== "boolean") fail("cancellation.supported", "must be a boolean");
  const cancellationSemantics = cancellation.semantics;
  if (typeof cancellationSemantics !== "string" || cancellationSemantics.length === 0) {
    fail("cancellation.semantics", "must be a non-empty string describing the cancellation semantics");
  }

  const verification = record.verification;
  if (!isRecord(verification)) fail("verification", "must be an object (how success is PROVEN — never assumed)");
  const verificationMethod = verification.method;
  if (!(VERIFICATION_METHODS as readonly string[]).includes(verificationMethod as string)) {
    fail("verification.method", `must be one of ${VERIFICATION_METHODS.join("|")}`);
  }
  const verificationSpec = verification.spec;
  if (typeof verificationSpec !== "string" || verificationSpec.length === 0) {
    fail("verification.spec", "must be a non-empty spec reference");
  }

  const validated: CapabilityRecord = {
    id: recordId,
    version: recordVersion,
    title: record.title as string,
    description: record.description as string,
    ...(record.engineFamily !== undefined ? { engineFamily: record.engineFamily as EngineFamily } : {}),
    input,
    output,
    permissions: permissionsList as readonly PermissionSpec[],
    availability: {
      state: availabilityState,
      reason: availabilityReason as string,
      ...(availability.prerequisites !== undefined ? { prerequisites: availability.prerequisites as readonly string[] } : {}),
    },
    // Canonical provenance is retained verbatim (contract 09 §4 retention —
    // no source, commit, path, publisher, surface or review field is dropped).
    provenance: provenanceValidation.ref,
    provider: {
      kind: providerKind as CapabilityRecord["provider"]["kind"],
      identity: providerIdentity,
      ...(provider.discoveredVia !== undefined ? { discoveredVia: provider.discoveredVia as string } : {}),
    },
    prerequisites: prerequisitesList as CapabilityRecord["prerequisites"],
    compatibility: {
      ...(compatibilityEngineVersions !== undefined ? { engineVersions: compatibilityEngineVersions as string } : {}),
      ...(compatibilityRuntime !== undefined ? { runtime: compatibilityRuntime as string } : {}),
      ...(compatibility.notes !== undefined && typeof compatibility.notes === "string" ? { notes: compatibility.notes } : {}),
    },
    reversibility: { kind: reversibilityKind as CapabilityRecord["reversibility"]["kind"], notes: reversibilityNotes as string },
    idempotency: {
      repeatable: idempotencyRepeatable,
      ...(idempotency.dedupeKey !== undefined ? { dedupeKey: idempotency.dedupeKey as string } : {}),
    },
    timeout: { defaultMs: timeoutDefaultMs as number, maxMs: timeoutMaxMs as number },
    cancellation: { supported: cancellationSupported, semantics: cancellationSemantics as string },
    verification: { method: verificationMethod as CapabilityRecord["verification"]["method"], spec: verificationSpec as string },
  };
  return validated;
}

function validateJsonSchemaSpec(value: unknown, field: string): JsonSchemaSpec {
  if (!isRecord(value)) fail(field, "must be a JSON Schema object");
  if (value.type !== "object") fail(`${field}.type`, 'must be "object"');
  if (!isRecord(value.properties)) fail(`${field}.properties`, "must be an object");
  if (value.required !== undefined && !Array.isArray(value.required)) {
    fail(`${field}.required`, "must be an array when present");
  }
  return {
    ...(value.$schema !== undefined && isNonEmptyString(value.$schema) ? { $schema: value.$schema } : {}),
    type: "object",
    properties: value.properties,
    ...(value.required !== undefined ? { required: value.required } : {}),
    ...(value.additionalProperties !== undefined && typeof value.additionalProperties === "boolean"
      ? { additionalProperties: value.additionalProperties }
      : {}),
  };
}

/**
 * Fail-closed resolution for dispatch: validates id, version, engine-family
 * compatibility, availability, prerequisites and input against the registry
 * view. Returns the resolved record or an explicit error carrying the
 * requested id/version, the fail-closed reason and remediation data
 * (available alternatives as DATA, never auto-selected).
 */
export function resolveCapability(
  registry: ReadonlyMap<string, CapabilityRecord>,
  request: { id: string; version?: string; engineFamily?: EngineFamily; input?: unknown; prerequisites?: readonly string[] },
): { ok: true; record: CapabilityRecord } | { ok: false; error: CapabilityResolutionError } {
  const { id, version } = request;

  // 1. Unknown id → fail closed with remediation data (available alternatives).
  const candidates = [...registry.values()].filter((record) => record.id === id);
  if (candidates.length === 0) {
    return {
      ok: false,
      error: {
        code: "unknown-id",
        requestedId: id,
        ...(version !== undefined ? { requestedVersion: version } : {}),
        reason: `capability id ${JSON.stringify(id)} is not registered (fail closed: no registry-order fallback exists — contract 02 §3)`,
        remediation: registry.size
          ? [...registry.values()].map((record) => ({
              capabilityId: record.id,
              version: record.version,
              difference: `registered alternative: ${record.title} (${record.provider.kind}/${record.provider.identity})`,
            }))
          : [],
      },
    };
  }

  // 2. Unknown / mismatched version → fail closed.
  let record: CapabilityRecord | undefined;
  if (version === undefined) {
    record = candidates[0];
  } else {
    record = candidates.find((candidate) => candidate.version === version);
    if (!record) {
      const known = candidates.map((candidate) => candidate.version);
      return {
        ok: false,
        error: {
          code: known.some((v) => v.split("+")[0] === (version as string).split("+")[0])
            ? "version-mismatch"
            : "unknown-version",
          requestedId: id,
          requestedVersion: version,
          reason: `capability ${id} is registered at ${known.join(", ")} — requested ${version} is unknown (fail closed)`,
          remediation: known.map((v) => ({
            capabilityId: id,
            version: v,
            difference: "registered version of the requested capability",
          })),
        },
      };
    }
  }
  if (!record) {
    return {
      ok: false,
      error: {
        code: "unknown-id",
        requestedId: id,
        reason: "registry lookup returned no record",
        remediation: [],
      },
    };
  }

  // 3. Engine-family compatibility → fail closed (contract 04: engine-specific grammars).
  if (request.engineFamily !== undefined && record.engineFamily !== undefined && record.engineFamily !== request.engineFamily) {
    return {
      ok: false,
      error: {
        code: "engine-incompatible",
        requestedId: id,
        ...(version !== undefined ? { requestedVersion: version } : {}),
        reason: `capability ${id} is bound to engine family ${record.engineFamily}; requested ${request.engineFamily} (fail closed — no silent engine substitution)`,
        remediation: [],
      },
    };
  }

  // 4. Availability → fail closed with reason (contract 07).
  if (record.availability.state === "unavailable") {
    return {
      ok: false,
      error: {
        code: "unavailable",
        requestedId: id,
        ...(version !== undefined ? { requestedVersion: version } : {}),
        reason: `capability ${id} is unavailable: ${record.availability.reason}`,
        remediation: [...registry.values()]
          .filter((candidate) => candidate.id !== id && candidate.availability.state === "available")
          .map((candidate) => ({
            capabilityId: candidate.id,
            version: candidate.version,
            difference: `available alternative: ${candidate.title} (substitution requires disclosure + approval — contract 02 §3 rule 3)`,
          })),
      },
    };
  }

  // 5. Conditional availability → prerequisite evaluation (explicit state + remediation).
  if (record.availability.state === "conditional") {
    const declared = record.availability.prerequisites ?? [];
    if (declared.length > 0) {
      const satisfied = new Set(request.prerequisites ?? []);
      const missing = declared.filter((prereq) => !satisfied.has(prereq));
      if (missing.length > 0) {
        return {
          ok: false,
          error: {
            code: "missing-prerequisite",
            requestedId: id,
            ...(version !== undefined ? { requestedVersion: version } : {}),
            reason: `capability ${id} requires prerequisites that are not satisfied: ${missing.join(", ")}`,
            remediation: record.prerequisites
              .filter((prereq) => missing.includes(prereq.id))
              .map((prereq) => ({
                capabilityId: `${id}`,
                version: record.version,
                difference: `remediation: satisfy prerequisite "${prereq.id}" — ${prereq.description}`,
              })),
          },
        };
      }
    }
  }

  // 6. Input validation against the record's input schema (tool error).
  if (request.input !== undefined) {
    const inputError = validateAgainstSchema(request.input, record.input);
    if (inputError) {
      return {
        ok: false,
        error: {
          code: "invalid-input",
          requestedId: id,
          ...(version !== undefined ? { requestedVersion: version } : {}),
          reason: `input for ${id} violates its declared schema: ${inputError}`,
          remediation: [],
        },
      };
    }
  }

  return { ok: true, record };
}

function validateAgainstSchema(input: unknown, schema: JsonSchemaSpec): string | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return "input must be an object";
  }
  const record = input as Record<string, unknown>;
  for (const key of schema.required ?? []) {
    if (!(key in record)) return `missing required property "${key}"`;
  }
  return null;
}

/** Lookup by stable id + contract version. Unknown id/version fail closed. */
export function getCapability(registry: ReadonlyMap<string, CapabilityRecord>, id: string, version?: string): CapabilityRecord {
  const candidates = [...registry.values()].filter((record) => record.id === id);
  if (candidates.length === 0) {
    throw new Error(`GAMOS/CAPABILITY-REGISTRY: unknown capability id ${JSON.stringify(id)} (fail closed)`);
  }
  const resolved =
    version === undefined ? candidates[0] : candidates.find((candidate) => candidate.version === version);
  if (!resolved) {
    throw new Error(
      `GAMOS/CAPABILITY-REGISTRY: capability ${id} has no version ${version} (registered: ${candidates.map((c) => c.version).join(", ")})`,
    );
  }
  return resolved;
}

/** Lists registered capabilities (append-only once published). */
export function listCapabilities(registry: ReadonlyMap<string, CapabilityRecord>): readonly CapabilityRecord[] {
  return [...registry.values()];
}
