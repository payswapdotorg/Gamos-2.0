/**
 * Engine-specific version grammars (contract 04 §4 revision 1 — M1.3).
 *
 * There is NO universal SemVer assumption: each engine family declares its own
 * parser and comparison. A version that fails its family parser is returned
 * raw-only with a diagnostic — compatibility checks then resolve to
 * *unknown* (fail closed per contract 02 §3), never "treat as compatible".
 */

import type { EngineFamily } from "../game-concept.js";

/**
 * Result of a family parse — a FLAT discriminated union: on success the
 * structured version fields sit at the top level alongside ok/raw; on failure
 * only raw + diagnostic are present (compatibility checks then resolve to
 * unknown — fail closed, contract 04 §4 rule 1).
 */
export type ParsedVersionResult<T> = (T & { ok: true; raw: string }) | { ok: false; raw: string; diagnostic: string };

/** Unity structured version (stream sequence participates in ordering). */
export interface UnityVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly stream: "a" | "b" | "f" | "c" | "p";
  readonly sequence: number;
  readonly revision?: string;
}

/** Blender structured version (semver-like + optional LTS tag). */
export interface BlenderVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly lts: boolean;
}

/** Godot structured version (major.minor.patch + channel). */
export interface GodotVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly channel: "stable" | "rc" | "beta" | "alpha" | "dev";
  readonly channelOrdinal: number;
  readonly mono: boolean;
}

/** Unreal structured version. */
export interface UnrealVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/** Babylon toolchain structured version (runtime's own grammar). */
export interface BabylonToolchainVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

const UNITY_PATTERN = /^(\d{4,})\.(\d+)\.(\d+)([abfcp])(\d+)(?:\s*\(([0-9a-f]{6,40})\))?$/i;
const BLENDER_PATTERN = /^blender\s+v?(\d+)\.(\d+)(?:\.(\d+))?(?:\s+lts)?$/i;
// Godot channels: the full form is <maj>.<min>.<patch>.<channel>[<ordinal>][.extra]
// (e.g. 4.2.1.stable.official.<build>). Pre-release builds of a minor version
// use <maj>.<min>.<channel><ordinal> (e.g. 4.3.rc1.official.abc) — patch is
// ABSENT, not zero — both shapes are legal (upstream `godot --version` output).
const GODOT_PATTERN = /^v?(\d+)\.(\d+)(?:\.(\d+))?\.(stable|rc|beta|alpha|dev)(\d+)?(?:\.(.*))?$/i;
const UNREAL_BRANCH_PATTERN = /^(\d+)\.(\d+)(?:\.(\d+))?-(.+)$/;

function failParse<T>(raw: string, diagnostic: string): ParsedVersionResult<T> {
  return { ok: false, raw, diagnostic };
}

/** Unity parser: `2022.3.10f1`, `6000.0.23f1`, `2022.3.10f1 (abcdef123456)`. */
export function parseUnityVersion(raw: string): ParsedVersionResult<UnityVersion> {
  const m = UNITY_PATTERN.exec(raw.trim());
  if (!m) {
    return failParse<UnityVersion>(raw, `not a Unity version: expected <major>.<minor>.<patch><stream a|b|f|c|p><seq>[ (<revision>)]`);
  }
  const value: UnityVersion = {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    stream: (m[4] as string).toLowerCase() as UnityVersion["stream"],
    sequence: Number(m[5] as string),
    ...(m[6] !== undefined ? { revision: m[6].toLowerCase() } : {}),
  };
  return { ok: true, raw, ...value };
}

const UNITY_STREAM_ORDER: Record<UnityVersion["stream"], number> = { a: 0, b: 1, f: 2, c: 2, p: 2 };

/** Unity comparison: major, minor, patch, then stream order, then sequence. */
export function compareUnityVersions(a: ParsedVersionResult<UnityVersion>, b: ParsedVersionResult<UnityVersion>): number {
  if (!a.ok || !b.ok) throw new Error("GAMOS/ENGINE-VERSIONS: cannot compare unparseable Unity versions (fail closed)");
  return (
    (a.major - b.major) ||
    (a.minor - b.minor) ||
    (a.patch - b.patch) ||
    (UNITY_STREAM_ORDER[a.stream] - UNITY_STREAM_ORDER[b.stream]) ||
    (a.sequence - b.sequence)
  );
}

/** Blender parser: `Blender 4.1.1`, `Blender 4.2 LTS`, bare `4.1.1`. */
export function parseBlenderVersion(raw: string): ParsedVersionResult<BlenderVersion> {
  const trimmed = raw.trim().replace(/^blender\s+/i, "");
  const m = /^v?(\d+)\.(\d+)(?:\.(\d+))?(?:\s+lts)?$/i.exec(trimmed);
  if (!m) {
    return failParse<BlenderVersion>(raw, "not a Blender version: expected 'Blender <major>.<minor>[.<patch>][ LTS]'");
  }
  const value: BlenderVersion = {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: m[3] !== undefined ? Number(m[3]) : 0,
    lts: /lts/i.test(raw),
  };
  return { ok: true, raw, ...value };
}

/** Blender comparison: semver-like; the LTS flag does not invent ordering. */
export function compareBlenderVersions(a: ParsedVersionResult<BlenderVersion>, b: ParsedVersionResult<BlenderVersion>): number {
  if (!a.ok || !b.ok) throw new Error("GAMOS/ENGINE-VERSIONS: cannot compare unparseable Blender versions (fail closed)");
  return (a.major - b.major) || (a.minor - b.minor) || (a.patch - b.patch);
}

const GODOT_CHANNEL_ORDER: Record<GodotVersion["channel"], number> = { dev: 0, alpha: 1, beta: 2, rc: 3, stable: 4 };

/** Godot parser: `4.2.1.stable.official.<build>`, `4.3.rc1.official.abc`, mono suffix. */
export function parseGodotVersion(raw: string): ParsedVersionResult<GodotVersion> {
  const mono = /\.mono\b/i.test(raw) || /(^|\.)mono\b/i.test(raw.trim());
  const stripped = raw.trim().replace(/(^|\.)mono\b/i, "").replace(/^v/i, "");
  const m = GODOT_PATTERN.exec(stripped);
  if (!m) {
    return failParse<GodotVersion>(raw, "not a Godot version: expected <major>.<minor>.<patch>.<channel>[<ordinal>][.extra]");
  }
  const value: GodotVersion = {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: m[3] !== undefined ? Number(m[3]) : 0,
    channel: (m[4] as string).toLowerCase() as GodotVersion["channel"],
    channelOrdinal: m[5] !== undefined ? Number(m[5]) : 0,
    mono,
  };
  return { ok: true, raw, ...value };
}

/** Godot comparison: semver then channel order (dev < alpha < beta < rc < stable) then ordinal. */
export function compareGodotVersions(a: ParsedVersionResult<GodotVersion>, b: ParsedVersionResult<GodotVersion>): number {
  if (!a.ok || !b.ok) throw new Error("GAMOS/ENGINE-VERSIONS: cannot compare unparseable Godot versions (fail closed)");
  return (
    (a.major - b.major) ||
    (a.minor - b.minor) ||
    (a.patch - b.patch) ||
    (GODOT_CHANNEL_ORDER[a.channel] - GODOT_CHANNEL_ORDER[b.channel]) ||
    (a.channelOrdinal - b.channelOrdinal)
  );
}

/** Unreal parser: `5.3.2-+++UE+Release-5.3+<commit>`, `++UE5+Release-5.3` (brand-prefix stripping). */
export function parseUnrealVersion(raw: string): ParsedVersionResult<UnrealVersion> {
  let s = raw.trim();
  // Strip engine-brand prefixes: ++UE5+Release-5.3 → 5.3
  const brand = /^\++ue\d*\+release-(\d+)\.(\d+)(?:\.(\d+))?$/i.exec(s);
  if (brand) {
    return {
      ok: true,
      raw,
      major: Number(brand[1]),
      minor: Number(brand[2]),
      patch: brand[3] !== undefined ? Number(brand[3]) : 0,
    };
  }
  // Strip leading +++UE+Release- style prefixes from full forms.
  s = s.replace(/^\++ue\d*(\+\w+)*-/i, "");
  const m = UNREAL_BRANCH_PATTERN.exec(s);
  if (!m) {
    return failParse<UnrealVersion>(raw, "not an Unreal version: expected <major>.<minor>[.<patch>]-<branch> or ++UE<n>+Release-<maj>.<min>");
  }
  const value: UnrealVersion = {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: m[3] !== undefined ? Number(m[3]) : 0,
  };
  return { ok: true, raw, ...value };
}

/** Unreal comparison: semver only (branch/commit are not ordered). */
export function compareUnrealVersions(a: ParsedVersionResult<UnrealVersion>, b: ParsedVersionResult<UnrealVersion>): number {
  if (!a.ok || !b.ok) throw new Error("GAMOS/ENGINE-VERSIONS: cannot compare unparseable Unreal versions (fail closed)");
  return (a.major - b.major) || (a.minor - b.minor) || (a.patch - b.patch);
}

/** Babylon toolchain parser: the underlying runtime's own grammar (Node-style semver). */
export function parseBabylonToolchainVersion(raw: string): ParsedVersionResult<BabylonToolchainVersion> {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(raw.trim());
  if (!m) {
    return failParse<BabylonToolchainVersion>(raw, "not a toolchain semver: expected v?<major>.<minor>.<patch>");
  }
  const value: BabylonToolchainVersion = {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
  };
  return { ok: true, raw, ...value };
}

/** Babylon toolchain comparison: semver. */
export function compareBabylonToolchainVersions(a: ParsedVersionResult<BabylonToolchainVersion>, b: ParsedVersionResult<BabylonToolchainVersion>): number {
  if (!a.ok || !b.ok) throw new Error("GAMOS/ENGINE-VERSIONS: cannot compare unparseable toolchain versions (fail closed)");
  return (a.major - b.major) || (a.minor - b.minor) || (a.patch - b.patch);
}

type AnyVersion =
  | ParsedVersionResult<UnityVersion>
  | ParsedVersionResult<BlenderVersion>
  | ParsedVersionResult<GodotVersion>
  | ParsedVersionResult<UnrealVersion>
  | ParsedVersionResult<BabylonToolchainVersion>;

type Comparator = (a: AnyVersion, b: AnyVersion) => number;

const FAMILY_COMPARATORS: Record<EngineFamily, Comparator> = {
  unity: compareUnityVersions as Comparator,
  blender: compareBlenderVersions as Comparator,
  godot: compareGodotVersions as Comparator,
  unreal: compareUnrealVersions as Comparator,
  babylon: compareBabylonToolchainVersions as Comparator,
  core: (a, b) => (a === b ? 0 : -1),
};

/**
 * Evaluates a shared-metadata version predicate (`>=2022.3`, `2022.3.*`, `4.x`)
 * against a parsed version using the FAMILY grammar. Fail closed: an
 * unparseable version or a malformed predicate yields "unknown", never
 * "compatible" (contract 04 §4 rule 1/2).
 */
export function evaluateVersionPredicate(
  family: EngineFamily,
  predicate: string,
  parsed: AnyVersion | { ok: false; raw: string; diagnostic: string },
): boolean | "unknown" {
  if (!parsed || (parsed as { ok?: boolean }).ok !== true) return "unknown";
  const trimmed = predicate.trim();
  const comparator = FAMILY_COMPARATORS[family];

  const range = /^(>=|<=|>|<|=)?\s*(.+)$/.exec(trimmed);
  if (!range) return "unknown";
  const op = range[1] ?? "=";
  const targetRaw = (range[2] as string).trim();

  // Wildcard forms: "2022.3.*" / "4.x" → prefix equality on (major, minor).
  const wildcard = /^(\d+)(?:\.(\d+))?(?:\.\*|\.[xX])$/.exec(targetRaw);
  if (wildcard) {
    const major = Number(wildcard[1]);
    const minor = wildcard[2] !== undefined ? Number(wildcard[2]) : null;
    const v = parsed as unknown as { ok?: boolean; major?: number; minor?: number };
    if (v.major === undefined || v.minor === undefined) return "unknown";
    const majorMatch = v.major === major;
    const minorMatch = minor === null || v.minor === minor;
    return op === "=" || op === ">=" ? majorMatch && minorMatch : false;
  }

  // Parse the predicate target with the SAME family grammar. Predicates may use
  // PARTIAL versions (e.g. Unity ">=2022.3", Blender ">=4.1") — the family's
  // two-part prefix is a legal predicate target and compares as major/minor
  // with patch/stream defaulted to 0/f.
  const target = parsePredicateTarget(family, targetRaw);
  if (!target.ok) return "unknown";
  const cmp = comparator(parsed as AnyVersion, target as unknown as AnyVersion);
  switch (op) {
    case ">=":
      return cmp >= 0;
    case "<=":
      return cmp <= 0;
    case ">":
      return cmp > 0;
    case "<":
      return cmp < 0;
    default:
      return cmp === 0;
  }
}

function parsePredicateTarget(family: EngineFamily, targetRaw: string): { ok: boolean; raw: string; diagnostic?: string; [key: string]: unknown } {
  const partial = /^(\d+)\.(\d+)$/.exec(targetRaw.trim());
  switch (family) {
    case "unity":
      if (partial) {
        return { ok: true, raw: targetRaw, major: Number(partial[1]), minor: Number(partial[2]), patch: 0, stream: "f", sequence: 0 };
      }
      break;
    case "blender":
      if (partial) {
        return { ok: true, raw: targetRaw, major: Number(partial[1]), minor: Number(partial[2]), patch: 0, lts: false };
      }
      break;
    case "godot":
      if (partial) {
        return { ok: true, raw: targetRaw, major: Number(partial[1]), minor: Number(partial[2]), patch: 0, channel: "stable", channelOrdinal: 0, mono: false };
      }
      break;
    case "unreal":
      if (partial) {
        return { ok: true, raw: targetRaw, major: Number(partial[1]), minor: Number(partial[2]), patch: 0 };
      }
      break;
    case "babylon":
      if (partial) {
        return { ok: true, raw: targetRaw, major: Number(partial[1]), minor: Number(partial[2]), patch: 0 };
      }
      break;
    default:
      return { ok: false, raw: targetRaw, diagnostic: "core family has no version grammar" };
  }
  return parseAnyByFamily(family, targetRaw);
}

function parseAnyByFamily(family: EngineFamily, raw: string): { ok: boolean; raw: string; diagnostic?: string; [key: string]: unknown } {
  switch (family) {
    case "unity": {
      const r = parseUnityVersion(raw);
      return r as unknown as { ok: boolean; raw: string; diagnostic?: string };
    }
    case "blender": {
      const r = parseBlenderVersion(raw);
      return r as unknown as { ok: boolean; raw: string; diagnostic?: string };
    }
    case "godot": {
      const r = parseGodotVersion(raw);
      return r as unknown as { ok: boolean; raw: string; diagnostic?: string };
    }
    case "unreal": {
      const r = parseUnrealVersion(raw);
      return r as unknown as { ok: boolean; raw: string; diagnostic?: string };
    }
    case "babylon": {
      const r = parseBabylonToolchainVersion(raw);
      return r as unknown as { ok: boolean; raw: string; diagnostic?: string };
    }
    default:
      return { ok: false, raw, diagnostic: "core family has no version grammar" };
  }
}

function parseByFamily(family: EngineFamily, raw: string): { ok: boolean; raw: string; diagnostic?: string; [key: string]: unknown } {
  return parseAnyByFamily(family, raw);
}
