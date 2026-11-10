/**
 * Typed-operation input contracts (M4 WP-5) — the frozen zod schemas for the
 * five `unreal/*` capability surfaces registered by WP-4
 * (packages/gamos-domain/src/domain/engine-plugin-unreal.ts, implemented
 * VERBATIM from docs/gamos/M4-CAPABILITY-CONTRACTS.md §3). Every schema here
 * mirrors the record's input field list exactly; the op layer additionally
 * enforces the object-path grammar (object-paths.ts) and, for mutations, the
 * reviewed allowlists BEFORE any request is built.
 */

import { z } from "zod";
import { MAX_OBJECT_PATH_LENGTH, isValidFunctionName, isValidPropertyName } from "./object-paths.js";

/** The object-path schema shape (grammar-validated separately, fail-closed). */
const objectPathSchema = z.string().min(1).max(MAX_OBJECT_PATH_LENGTH);

/** Endpoint override: loopback host + the two documented RC ports. */
export const RcEndpointSchema = z.object({
  host: z.string().min(1).max(253),
  httpPort: z.number().int().min(1).max(65535),
  wsPort: z.number().int().min(1).max(65535),
});
export type RcEndpoint = z.infer<typeof RcEndpointSchema>;

// -- unreal/connection.inspect ------------------------------------------------

export const ConnectionInspectInput = z.object({
  endpoint: RcEndpointSchema.optional(),
});
export type ConnectionInspectInputT = z.infer<typeof ConnectionInspectInput>;

// -- unreal/object.inspect -----------------------------------------------------

export const ObjectInspectInput = z.object({
  objectPath: objectPathSchema,
});
export type ObjectInspectInputT = z.infer<typeof ObjectInspectInput>;

// -- unreal/property.read ------------------------------------------------------

export const PropertyReadInput = z.object({
  objectPath: objectPathSchema,
  propertyNames: z
    .array(z.string().min(1).max(128))
    .min(1)
    .max(32)
    .refine((names) => names.every((n) => isValidPropertyName(n)), {
      message: "property names must satisfy the identifier grammar (allowlisted name set, fail-closed)",
    }),
});
export type PropertyReadInputT = z.infer<typeof PropertyReadInput>;

// -- unreal/property.write -----------------------------------------------------

export const PropertyWriteInput = z.object({
  objectPath: objectPathSchema,
  property: z
    .string()
    .min(1)
    .max(128)
    .refine((p) => isValidPropertyName(p), {
      message: "property name must satisfy the identifier grammar (allowlisted, fail-closed)",
    }),
  value: z.unknown(),
  expectPreState: z.unknown().optional(),
  /** REQUIRED by the record: the post-mutation state the re-read must match. */
  expectPostState: z.unknown(),
});
export type PropertyWriteInputT = z.infer<typeof PropertyWriteInput>;

// -- unreal/function.invoke ----------------------------------------------------

export const FunctionInvokeInput = z.object({
  objectPath: objectPathSchema,
  functionName: z
    .string()
    .min(1)
    .max(128)
    .refine((f) => isValidFunctionName(f), {
      message: "functionName must satisfy the identifier grammar",
    }),
  arguments: z.record(z.string(), z.unknown()),
});
export type FunctionInvokeInputT = z.infer<typeof FunctionInvokeInput>;

// ---------------------------------------------------------------------------
// The reviewed property-mutation allowlist (M4 WP-5)
// ---------------------------------------------------------------------------

/**
 * Readiness §4.2 pins the operation-allowlist discipline to MUTATIONS
 * ("object paths, property names, function names and request schemas are
 * validated against the allowlist before any request is built"): property
 * writes are gated by this reviewed registry exactly as function invocations
 * are gated by the WP-4-recorded empty function allowlist
 * (function-allowlist.ts). The asymmetry with the WP-4 records is honest and
 * documented: the property.write record does not enumerate property names
 * (its availability is conditional on the EDITOR, not on a review state), but
 * no property has passed connector-side review either — so the shipped
 * registry is EMPTY at 0.1.0 and every property write fails closed
 * client-side until a reviewed entry lands with its own value schema and a
 * connector version bump. The protocol machinery is contract-tested against
 * injected REVIEW-CLASS entries; the shipped default stays fail-closed.
 */

export interface ReviewedPropertyEntry {
  /** The exact reviewed property name (identifier grammar, fail-closed). */
  propertyName: string;
  /**
   * The reviewed object-path scope: an exact validated object path, or an
   * exact package-path prefix ending in "/". Writes outside the reviewed
   * scope are refused.
   */
  objectPathPrefix: string;
  /** The reviewed value schema — values are validated BEFORE any request. */
  valueSchema: z.ZodType;
}

/** The reviewed property-mutation allowlist — EMPTY at 0.1.0 (review-first). */
export const REVIEWED_PROPERTY_ALLOWLIST: readonly ReviewedPropertyEntry[] = [];

/** Fail-closed lookup: a reviewed entry for this property within this scope. */
export function findReviewedProperty(
  allowlist: readonly ReviewedPropertyEntry[],
  propertyName: string,
  objectPath: string,
): ReviewedPropertyEntry | undefined {
  if (!isValidPropertyName(propertyName)) return undefined;
  return allowlist.find(
    (entry) =>
      entry.propertyName === propertyName &&
      (entry.objectPathPrefix.endsWith("/")
        ? objectPath.startsWith(entry.objectPathPrefix)
        : objectPath === entry.objectPathPrefix),
  );
}
