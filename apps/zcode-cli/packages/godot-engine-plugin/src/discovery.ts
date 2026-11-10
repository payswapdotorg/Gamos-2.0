/**
 * Godot executable discovery (M4 WP-2) — RED stub.
 *
 * Order: `GODOT_PATH` env override → PATH lookup → common install roots
 * (including the verified `/home/z/engines` layouts). All probing uses
 * `spawnSync(exe, ["--version"])` with argument arrays — never a shell — and
 * every accepted executable is resolved to its absolute real path. Version
 * verification uses the Godot FAMILY grammar (`<major>.<minor>.<patch>.<channel>
 * [<ordinal>][.extra]`, channels ordered dev < alpha < beta < rc < stable) and
 * the `>=4.2` minimum — fail-closed: an unparseable version is
 * `version-unknown`, never `available`-by-guess.
 */

export const GODOT_PATH_ENV = "GODOT_PATH";

export interface GodotVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly channel: "dev" | "alpha" | "beta" | "rc" | "stable";
  readonly channelOrdinal: number;
}

export interface GodotDiscovery {
  status: "available" | "unavailable" | "version-unknown";
  executable: string | null;
  rawVersion: string | null;
  parsed: GodotVersion | null;
  reason?: string;
}

export interface DiscoveryOptions {
  env?: Record<string, string | undefined>;
  roots?: string[];
}

function notImplemented(what: string): never {
  throw new Error(`gamos/godot-engine-plugin: not implemented yet (RED): ${what}`);
}

export function parseGodotExecutableVersion(raw: string): { ok: true; raw: string } & GodotVersion | { ok: false; raw: string; diagnostic: string } {
  return notImplemented("parseGodotExecutableVersion");
}

export function godotTemplatesVersion(version: GodotVersion): string {
  return notImplemented("godotTemplatesVersion");
}

export function defaultCommonRoots(): string[] {
  return notImplemented("defaultCommonRoots");
}

export function discoverGodot(options: DiscoveryOptions = {}): GodotDiscovery {
  return notImplemented("discoverGodot");
}
