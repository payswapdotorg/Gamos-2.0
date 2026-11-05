/**
 * Nominal-typing helper for the PlayLiquid GameOS contract vocabulary.
 *
 * Contract packages use branded primitives so that identifiers with identical
 * runtime representations (strings) cannot be accidentally mixed up at compile
 * time. Branding is purely type-level: values are ordinary strings at runtime
 * and remain JSON-serializable.
 *
 * This package is the vocabulary root of the GameOS module graph. It must not
 * import from any other package (module-dependency-matrix: game-contracts has
 * zero cross-package imports), and it must not re-use ZCode seam types.
 */

declare const brand: unique symbol;

/**
 * `Brand<T, B>` is a `T` nominally tagged with the label `B`.
 *
 * Example: `type WorldId = Brand<string, "WorldId">`.
 */
export type Brand<T, B extends string> = T & { readonly [brand]: B };
