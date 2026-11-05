/**
 * Machine-local discovery records (contract 04 §2/§3 — M1.3).
 *
 * The machine-local record carries workspacePath + discoveredAt + host
 * fingerprint so stale cross-machine data is detectable. The effective engine
 * state is the transient JOIN of shared project metadata (gamos.project.json —
 * machine-neutral) with the machine-local record at task time. Unavailable and
 * unknown states are explicit (fail closed).
 */

import type { EngineFamily } from "../game-concept.js";
import {
  parseUnityVersion,
  parseBlenderVersion,
  parseGodotVersion,
  parseUnrealVersion,
  parseBabylonToolchainVersion,
  evaluateVersionPredicate,
} from "./engine-versions.js";

/** Shared project metadata — `gamos.project.json` in the workspace (machine-neutral). */
export interface GamosProjectMetadata {
  readonly schemaVersion: 2;
  readonly workspacePath: string;
  readonly gameirRefs?: readonly string[];
  readonly engineBindings?: readonly {
    engineFamily: EngineFamily;
    versionPredicate?: string;
  }[];
}

/** One engine probe result for THIS machine (machine-local). */
export interface DiscoveredEngine {
  readonly engineFamily: EngineFamily;
  readonly installed: boolean;
  readonly rawVersion?: string;
  readonly parsedVersion?: unknown;
  readonly executablePath?: string;
  readonly headlessCapable: boolean;
  readonly displayServerRequired: boolean;
  readonly notes?: string;
}

/** Machine-local discovery record — `<dataBaseDir>/gamos/discovery/<workspace-hash>.json`. */
export interface MachineEngineDiscovery {
  readonly schemaVersion: 2;
  readonly workspacePath: string;
  readonly host: { platform: string; arch: string };
  readonly discoveredAt: string;
  readonly discoveryVersion: string;
  readonly engines: readonly DiscoveredEngine[];
}

/** Effective state of a declared engine binding after the task-time join. */
export interface EffectiveEngineState {
  readonly engineFamily: EngineFamily;
  readonly state: "available" | "unavailable" | "unknown" | "display-required";
  readonly versionMatch?: boolean;
  readonly reason?: string;
}

/** Builds a valid machine-local record (schema `gamos/engine-discovery@2`). */
export function buildMachineDiscoveryRecord(
  workspacePath: string,
  engines: readonly DiscoveredEngine[],
  host: { platform: string; arch: string },
  discoveredAt: string = new Date().toISOString(),
): MachineEngineDiscovery {
  for (const engine of engines) {
    if (!engine.installed && !engine.notes) {
      throw new Error(
        `GAMOS/DISCOVERY: engine ${engine.engineFamily} installed:false MUST carry an explicit reason in notes (contract 04 §3 rule 2)`,
      );
    }
  }
  return {
    schemaVersion: 2,
    workspacePath,
    host,
    discoveredAt,
    discoveryVersion: "gamos/engine-discovery@2",
    engines,
  };
}

/** Stale detection: host fingerprint or workspace mismatch marks the record stale. */
export function isRecordStale(
  record: MachineEngineDiscovery,
  currentHost: { platform: string; arch: string },
  currentWorkspacePath?: string,
): boolean {
  if (record.host.platform !== currentHost.platform || record.host.arch !== currentHost.arch) return true;
  if (currentWorkspacePath !== undefined && record.workspacePath !== currentWorkspacePath) return true;
  return false;
}

/**
 * Task-time JOIN: shared declarations × machine-local discovery → effective
 * engine states (transient conversation context; contract 04 §2 rule 2).
 * Fail closed: declared-but-not-installed → unavailable with reason;
 * unparseable raw version → unknown; unparseable predicate → unknown.
 */
export function joinEngineState(
  shared: GamosProjectMetadata,
  local: MachineEngineDiscovery,
): readonly EffectiveEngineState[] {
  const bindings = shared.engineBindings ?? [];
  return bindings.map((binding) => {
    const discovered = local.engines.find((e) => e.engineFamily === binding.engineFamily);
    if (!discovered || !discovered.installed) {
      return {
        engineFamily: binding.engineFamily,
        state: "unavailable" as const,
        reason: discovered?.notes ?? `no discovery record for ${binding.engineFamily} on this machine`,
      };
    }
    if (discovered.displayServerRequired) {
      return {
        engineFamily: binding.engineFamily,
        state: "display-required" as const,
        reason: "engine present but a display server is required for this operation",
      };
    }
    if (binding.versionPredicate !== undefined) {
      const parsed = parseForFamily(binding.engineFamily, discovered.rawVersion ?? "");
      const match = evaluateVersionPredicate(binding.engineFamily, binding.versionPredicate, parsed as never);
      if (match === "unknown") {
        return {
          engineFamily: binding.engineFamily,
          state: "unknown" as const,
          reason: `version predicate ${JSON.stringify(binding.versionPredicate)} could not be evaluated against raw ${JSON.stringify(discovered.rawVersion)} (fail closed — never treated as compatible)`,
        };
      }
      if (!match) {
        return {
          engineFamily: binding.engineFamily,
          state: "unavailable" as const,
          versionMatch: false,
          reason: `installed version ${discovered.rawVersion} does not satisfy ${binding.versionPredicate}`,
        };
      }
      return { engineFamily: binding.engineFamily, state: "available" as const, versionMatch: true };
    }
    return { engineFamily: binding.engineFamily, state: "available" as const };
  });
}

function parseForFamily(family: EngineFamily, raw: string): unknown {
  switch (family) {
    case "unity":
      return parseUnityVersion(raw);
    case "blender":
      return parseBlenderVersion(raw);
    case "godot":
      return parseGodotVersion(raw);
    case "unreal":
      return parseUnrealVersion(raw);
    case "babylon":
      return parseBabylonToolchainVersion(raw);
    default:
      return { ok: false, raw, diagnostic: "core family has no version grammar" };
  }
}
