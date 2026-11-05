/**
 * ACR-001 contract vocabulary: World content kinds and delivery target
 * profiles — two DISTINCT dimensions of a World.
 *
 * - `WorldKind` is the CONTENT axis: what the World is (a Spark, a game, an
 *   experience, a digital twin, another extensible kind).
 * - `TargetProfile` is the DELIVERY axis: how the World is delivered
 *   (spark_vertical, web, desktop, mobile, xr, dedicated_server, simulation).
 *
 * Neither implies the other: a Spark-kind World may target `web`/`mobile`/
 * `xr`, and a `game`-kind World may be delivered `spark_vertical`.
 *
 * Distinct from `GameKind` in `game-identity.ts` (the artifact-maturity
 * axis: game | prototype | demo | toolkit). Both axes coexist on a GameIR
 * document: `identity.kind` is the artifact kind; the optional document-level
 * `world` declaration carries this module's content kind and target profile.
 *
 * Authority: `spec/acr/ACR-001-world-kind-and-target-profile-separation.md`
 * (accepted 2026-10-31; lock v1.1 Amendment 1). Extending either registry is
 * a breaking contract change and must go through an ACR, not a silent edit
 * inside an implementation Work Order.
 *
 * Pure module. Single definition site (E1): GameIR and the runtime/build
 * surfaces import from here — they must never re-declare these types.
 */

/**
 * Initial frozen vocabulary of World content kinds (ACR-001 §3).
 */
export type WorldKind = "spark" | "game" | "experience" | "digital_twin" | "other";

/** All valid {@link WorldKind} values (ACR-001 §3). */
export const WORLD_KINDS: readonly WorldKind[] = Object.freeze([
  "spark",
  "game",
  "experience",
  "digital_twin",
  "other",
]);

/** Returns true when `value` is a valid {@link WorldKind}. */
export function isWorldKind(value: unknown): value is WorldKind {
  return typeof value === "string" && (WORLD_KINDS as readonly string[]).includes(value);
}

/**
 * Initial frozen vocabulary of delivery target profiles (ACR-001 §3).
 * `spark_vertical` is the 9:16 mobile-first fast-start profile.
 */
export type TargetProfile = "spark_vertical" | "web" | "desktop" | "mobile" | "xr" | "dedicated_server" | "simulation";

/** All valid {@link TargetProfile} values (ACR-001 §3). */
export const TARGET_PROFILES: readonly TargetProfile[] = Object.freeze([
  "spark_vertical",
  "web",
  "desktop",
  "mobile",
  "xr",
  "dedicated_server",
  "simulation",
]);

/** Returns true when `value` is a valid {@link TargetProfile}. */
export function isTargetProfile(value: unknown): value is TargetProfile {
  return typeof value === "string" && (TARGET_PROFILES as readonly string[]).includes(value);
}

/**
 * The optional document-level World declaration (ACR-001 §4). Both fields
 * are independently optional — the two dimensions are declared separately.
 */
export type WorldDeclaration = {
  readonly kind?: WorldKind;
  readonly targetProfile?: TargetProfile;
};

/**
 * Legacy default (ACR-001 §4): a document without a `world` declaration (or
 * without `world.kind`) is a pre-ACR World and resolves to the `game`
 * content kind — every pre-ACR document in this repository is a game by
 * construction. There is NO default target profile: absent means
 * unspecified, and build binding is driven by the build-target list alone
 * (exactly the pre-ACR behavior).
 */
export const DEFAULT_WORLD_KIND: WorldKind = "game";

/** Resolves the effective content kind of a declaration (or of no declaration). */
export function resolveWorldKind(declaration: WorldDeclaration | undefined): WorldKind {
  return declaration?.kind ?? DEFAULT_WORLD_KIND;
}

/** Returns true when `value` is structurally a valid {@link WorldDeclaration}. */
export function isWorldDeclaration(value: unknown): value is WorldDeclaration {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const declaration = value as Record<string, unknown>;
  if (declaration.kind !== undefined && !isWorldKind(declaration.kind)) return false;
  if (declaration.targetProfile !== undefined && !isTargetProfile(declaration.targetProfile)) return false;
  for (const key of Object.keys(declaration)) {
    if (key !== "kind" && key !== "targetProfile") return false;
  }
  return true;
}
