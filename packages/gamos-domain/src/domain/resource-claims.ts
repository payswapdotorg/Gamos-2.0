/**
 * Resource claims — the additive, versioned contract declaring which workspace
 * resources a GamePlan step reads or writes (M3.3/M3.5; final-closure handoff
 * §5.3; prepared plan §4.2). The GamePlan wire format gains the claims as an
 * OPTIONAL per-step field (`steps[].resourceClaims`) so unchanged plans hash
 * byte-identically; claims are plan identity and participate in the
 * deterministic plan hash.
 *
 * Binding rules (handoff §5.3, quoted):
 *   1. Two read-only steps may run concurrently when their resource claims
 *      are compatible.
 *   2. A write must not run concurrently with a read or write that overlaps
 *      its declared resource.
 *   3. Conflicting unordered writes must fail closed or be explicitly
 *      serialized through a deterministic dependency decision.
 *   4. No silent race resolution or arbitrary registry-order fallback.
 *   5. Resource paths must be canonicalized and confined to the selected
 *      workspace.
 *   6. Symlink escapes, traversal, path aliasing and ambiguous ownership
 *      must fail closed.
 *
 * This module is pure data validation + conflict semantics. It is NOT a
 * scheduler, lock manager or journal: actual enforcement of a step's declared
 * write scope happens on the capability execution path (rule 8), and runtime
 * confinement (symlink resolution, workspace jail) is an executor
 * responsibility recorded here as declared, canonical, workspace-relative
 * paths only.
 *
 * Module direction: game-plan.ts imports THIS module (never the reverse —
 * the architecture check forbids the cycle); conflict analysis accepts a
 * structural step view instead of importing the GamePlanStep type.
 */

/**
 * Structural step view for conflict analysis. `GamePlanStep` is structurally
 * assignable to this shape, so plans analyze without a module-level import
 * back into game-plan.ts (which would create a dependency cycle).
 */
export interface ClaimableStep {
  readonly stepId: string;
  readonly dependsOn: readonly string[];
  readonly resourceClaims?: StepResourceClaims;
}

export const RESOURCE_CLAIMS_SCHEMA_ID = "gamos/resource-claims@1";
export const RESOURCE_CLAIMS_SCHEMA_VERSION = 1;

/** Access mode of a claim. */
export type ResourceClaimAccess = "read" | "write";

/**
 * Semantic scope of a claim:
 * - `project`         — project-wide mutation or inspection state;
 * - `scene`           — a whole scene/document file;
 * - `asset-path`      — an individual existing asset file;
 * - `generated-output`— a path that does not exist yet (engine output);
 * - `staging`         — temporary staging path for deterministic integration.
 */
export type ResourceClaimScope =
  | "project"
  | "scene"
  | "asset-path"
  | "generated-output"
  | "staging";

/** One declared resource access. */
export interface ResourceClaim {
  readonly access: ResourceClaimAccess;
  readonly scope: ResourceClaimScope;
  readonly path: string;
  readonly label?: string;
}

/** The versioned claim set attached to a step (`steps[].resourceClaims`). */
export interface StepResourceClaims {
  readonly schemaVersion: 1;
  readonly claims: readonly ResourceClaim[];
}

/** A conflict between two unordered steps' claims (fail-closed evidence). */
export interface ClaimConflict {
  readonly kind: "read-write" | "write-write" | "ambiguous-alias";
  readonly stepA: string;
  readonly stepB: string;
  readonly path: string;
  readonly reason: string;
}

const ACCESS_MODES = ["read", "write"] as const;
const CLAIM_SCOPES = ["project", "scene", "asset-path", "generated-output", "staging"] as const;

const SEGMENT_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9_-])?$/;
const RESERVED_DEVICE_PATTERN = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
const MAX_PATH_LENGTH = 512;
const MAX_SEGMENTS = 24;
const MAX_SEGMENT_LENGTH = 255;

function fail(field: string, reason: string): never {
  throw new Error(`GAMOS/RESOURCE-CLAIMS: ${field} — ${reason}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Canonical claim path: a workspace-relative POSIX path with printable-ASCII
 * segments. Returns the canonical path, or null when the input must fail
 * closed (absolute, traversal, backslash, empty segment, control character,
 * Windows-unsafe character, non-ASCII, space, leading dot/hyphen, trailing
 * dot, reserved device name, oversized path or segment).
 */
export function canonicalizeClaimPath(path: string): string | null {
  if (typeof path !== "string" || path.length === 0 || path.length > MAX_PATH_LENGTH) return null;
  if (path.includes("\\")) return null;
  if (/[\u0000-\u001f\u007f]/.test(path)) return null;
  if (path.startsWith("/") || path.endsWith("/")) return null;
  if (path.includes("//")) return null;
  const segments = path.split("/");
  if (segments.length > MAX_SEGMENTS) return null;
  for (const segment of segments) {
    if (segment.length === 0 || segment.length > MAX_SEGMENT_LENGTH) return null;
    if (!SEGMENT_PATTERN.test(segment)) return null;
    if (RESERVED_DEVICE_PATTERN.test(segment)) return null;
  }
  return path;
}

/**
 * Validates + constructs a claim set (`gamos/resource-claims@1`). Fail-closed
 * on unknown schema versions, malformed access/scope/path/label, read claims
 * over generated outputs, and exact duplicate claims.
 */
export function validateResourceClaims(input: unknown): StepResourceClaims {
  if (!isRecord(input)) fail("resourceClaims", "must be a non-null object");
  if (input.schemaVersion !== RESOURCE_CLAIMS_SCHEMA_VERSION) {
    fail(
      "resourceClaims.schemaVersion",
      `must be exactly ${RESOURCE_CLAIMS_SCHEMA_VERSION} (schema ${RESOURCE_CLAIMS_SCHEMA_ID}); unknown schema versions fail closed`,
    );
  }
  if (!Array.isArray(input.claims) || input.claims.length === 0) {
    fail("resourceClaims.claims", "must be an array with at least one claim");
  }
  const seen = new Set<string>();
  const claims: ResourceClaim[] = [];
  for (const entry of input.claims as unknown[]) {
    if (!isRecord(entry)) fail("resourceClaims.claims[]", "each claim must be a non-null object");
    const allowedKeys = new Set(["access", "scope", "path", "label"]);
    for (const key of Object.keys(entry)) {
      if (!allowedKeys.has(key)) {
        fail("resourceClaims.claims[]", `unknown claim field "${key}" — exact field set is access, scope, path, label`);
      }
    }
    if (!(ACCESS_MODES as readonly string[]).includes(String(entry.access))) {
      fail("resourceClaims.claims[].access", `must be one of ${ACCESS_MODES.join("|")}`);
    }
    if (!(CLAIM_SCOPES as readonly string[]).includes(String(entry.scope))) {
      fail("resourceClaims.claims[].scope", `must be one of ${CLAIM_SCOPES.join("|")}`);
    }
    if (typeof entry.path !== "string" || canonicalizeClaimPath(entry.path) === null) {
      fail(
        "resourceClaims.claims[].path",
        "must be a canonical workspace-relative POSIX path (traversal, absolute, backslash, control, Windows-unsafe, non-ASCII, space, leading dot/hyphen, trailing dot, reserved device and oversize inputs all fail closed)",
      );
    }
    if (entry.label !== undefined && (typeof entry.label !== "string" || entry.label.trim().length === 0)) {
      fail("resourceClaims.claims[].label", "must be a non-empty string when present");
    }
    if (entry.access === "read" && entry.scope === "generated-output") {
      fail(
        "resourceClaims.claims[]",
        'a "generated-output" scope can only be written — reading a not-yet-generated output is a plan error',
      );
    }
    const key = `${String(entry.access)}|${String(entry.scope)}|${String(entry.path)}`;
    if (seen.has(key)) {
      fail(
        "resourceClaims.claims[]",
        `duplicate claim (${String(entry.access)} ${String(entry.scope)} ${String(entry.path)}) — ambiguous duplication fails closed`,
      );
    }
    seen.add(key);
    claims.push(
      entry.label === undefined
        ? { access: entry.access as ResourceClaimAccess, scope: entry.scope as ResourceClaimScope, path: entry.path as string }
        : {
            access: entry.access as ResourceClaimAccess,
            scope: entry.scope as ResourceClaimScope,
            path: entry.path as string,
            label: entry.label as string,
          },
    );
  }
  return { schemaVersion: RESOURCE_CLAIMS_SCHEMA_VERSION, claims };
}

function segments(path: string): readonly string[] {
  return path.split("/");
}

/**
 * Overlap semantics: two claims overlap when their canonical paths are equal,
 * differ only by letter case (case-insensitive engines alias them), or one
 * path is a segment-wise containment prefix of the other (case-insensitive,
 * for the same reason). Sibling prefixes ("a/b" vs "a/bc") never overlap.
 */
export function claimsOverlap(a: ResourceClaim, b: ResourceClaim): boolean {
  if (a.path === b.path) return true;
  const lowerA = a.path.toLowerCase();
  const lowerB = b.path.toLowerCase();
  if (lowerA === lowerB) return true;
  const as = segments(lowerA);
  const bs = segments(lowerB);
  const shorter = Math.min(as.length, bs.length);
  for (let i = 0; i < shorter; i++) {
    if (as[i] !== bs[i]) return false;
  }
  return as.length !== bs.length;
}

/**
 * Finds every conflict between the resource claims of steps that are NOT
 * serialized by an explicit (transitive) dependsOn edge. Steps without claims
 * never conflict. The result is deterministically ordered by
 * (stepA, stepB, path); each conflict carries a remediation reason naming the
 * explicit serialization decision (no silent race resolution).
 */
export function findClaimConflicts(steps: readonly ClaimableStep[]): readonly ClaimConflict[] {
  const claimSets = new Map<string, readonly ResourceClaim[]>();
  const dependsOn = new Map<string, readonly string[]>();
  for (const step of steps) {
    dependsOn.set(step.stepId, step.dependsOn);
    const claims = step.resourceClaims?.claims;
    if (claims !== undefined) claimSets.set(step.stepId, claims);
  }

  // Transitive dependency reachability (serialization evidence).
  const reachableCache = new Map<string, Set<string>>();
  const collect = (id: string, into: Set<string>): void => {
    for (const dep of dependsOn.get(id) ?? []) {
      if (!into.has(dep)) {
        into.add(dep);
        collect(dep, into);
      }
    }
  };
  for (const id of claimSets.keys()) {
    const set = new Set<string>();
    collect(id, set);
    reachableCache.set(id, set);
  }

  const conflicts: ClaimConflict[] = [];
  const ids = [...claimSets.keys()].sort();
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i] as string;
      const b = ids[j] as string;
      const ordered =
        (reachableCache.get(a)?.has(b) ?? false) || (reachableCache.get(b)?.has(a) ?? false);
      if (ordered) continue;
      for (const claimA of claimSets.get(a) ?? []) {
        for (const claimB of claimSets.get(b) ?? []) {
          if (!claimsOverlap(claimA, claimB)) continue;
          const ambiguous =
            claimA.path !== claimB.path && claimA.path.toLowerCase() === claimB.path.toLowerCase();
          // Rule 1: two read-only steps over the SAME resource are compatible
          // (rule 6 still fails closed on case-aliased ambiguity).
          if (!ambiguous && claimA.access === "read" && claimB.access === "read") continue;
          let kind: ClaimConflict["kind"];
          let path: string;
          if (ambiguous) {
            kind = "ambiguous-alias";
            path = claimA.path < claimB.path ? claimA.path : claimB.path;
          } else if (claimA.access === "write" && claimB.access === "write") {
            kind = "write-write";
            path = claimA.path.length <= claimB.path.length ? claimA.path : claimB.path;
          } else {
            kind = "read-write";
            path = claimA.access === "write" ? claimA.path : claimB.path;
          }
          const reason =
            kind === "ambiguous-alias"
              ? `case-aliased resource paths "${claimA.path}" and "${claimB.path}" are ambiguous ownership (case-insensitive engines may alias them) — fail closed; use one canonical spelling (handoff §5.3 rule 6)`
              : `unordered conflicting claims (${kind}) over "${path}" — serialize the steps with an explicit dependsOn edge (a deterministic dependency decision recorded in workflow evidence) or narrow the resource claims; conflicting concurrent access fails closed (handoff §5.3 rules 2-4)`;
          conflicts.push({ kind, stepA: a, stepB: b, path, reason });
        }
      }
    }
  }
  conflicts.sort((x, y) => {
    const byPair = `${x.stepA}\u0000${x.stepB}`.localeCompare(`${y.stepA}\u0000${y.stepB}`);
    if (byPair !== 0) return byPair;
    return x.path.localeCompare(y.path);
  });
  return conflicts;
}
