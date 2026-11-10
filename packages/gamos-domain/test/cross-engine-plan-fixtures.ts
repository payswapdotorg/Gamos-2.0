/**
 * Shared fixtures for the cross-engine plan builder test suites (M3.3 +
 * M4 WP-7) — extracted when the WP-7 target legs would otherwise have pushed
 * the single test file past the repository max-lines architecture bound.
 * The request builders, claim helpers, step constants and the pipeline model
 * context live here once; both test files import them unchanged.
 */

import { join } from "node:path";

import {
  CROSS_ENGINE_CORE_CAPABILITIES,
  buildCrossEngineAssetPlan,
} from "../src/domain/cross-engine-plan.js";
import type { CrossEnginePlanRequest } from "../src/domain/cross-engine-plan.js";
import type { GamePlanStep } from "../src/domain/game-plan.js";
import type { ResourceClaim, StepResourceClaims } from "../src/domain/resource-claims.js";
import { registerCapability } from "../src/domain/capability-registry.js";
import { registerEnginePluginCapabilities } from "../src/domain/engine-plugin.js";
import { buildMachineDiscoveryRecord, joinEngineState } from "../src/domain/discovery/discovery-record.js";
import type { DiscoveredEngine } from "../src/domain/discovery/discovery-record.js";
import { classifyIntent, buildGamingModelContext } from "../src/domain/intent.js";
import type { GamingModelContext } from "../src/domain/intent.js";
import type { EngineFamily } from "../src/engine-family.js";

export const NOW = "2026-11-12T10:00:00Z";
export const WORKSPACE_ROOT = "/workspace/gamos-pipeline";

export const BABYLON_STEPS = ["export-asset", "validate-export", "integrate-asset", "build-project", "verify-runtime"] as const;
export const UNITY_STEPS = ["export-asset", "validate-export", "import-asset", "build-project"] as const;
export const GODOT_STEPS = ["export-asset", "validate-export", "import-asset", "build-project", "verify-runtime"] as const;
export const UNREAL_STEPS = ["export-asset", "validate-export", "attach-editor", "describe-target", "verify-target"] as const;

export function babylonRequest(overrides: Record<string, unknown> = {}): CrossEnginePlanRequest {
  return {
    planId: "cross-engine-babylon-001",
    conceptRef: { conceptId: "concept-001", conceptSha256: "a".repeat(64) },
    acceptanceRecord: { recordId: "acc-001", recordSha256: "b".repeat(64) },
    workspaceRoot: WORKSPACE_ROOT,
    source: { projectIdentity: "source-blender", blendFile: "source-blender/hero.blend" },
    target: { engine: "babylon", projectIdentity: "target-babylon", projectRoot: "target-babylon" },
    format: "glb",
    interchange: { upAxis: "y" },
    maxConcurrency: 2,
    now: NOW,
    ...overrides,
  } as CrossEnginePlanRequest;
}

export function unityRequest(format: "fbx" | "glb" = "fbx", overrides: Record<string, unknown> = {}): CrossEnginePlanRequest {
  return babylonRequest({
    planId: "cross-engine-unity-001",
    target: { engine: "unity", projectIdentity: "target-unity", projectRoot: "target-unity" },
    format,
    ...overrides,
  });
}

/** The verified Blender→Godot interchange is GLB (the WP-3 runtime-verified hop recipe). */
export function godotRequest(overrides: Record<string, unknown> = {}): CrossEnginePlanRequest {
  return babylonRequest({
    planId: "cross-engine-godot-001",
    target: { engine: "godot", projectIdentity: "target-godot", projectRoot: "target-godot" },
    format: "glb",
    ...overrides,
  });
}

/**
 * The Blender→Unreal plan: the interchange artifact is exported and
 * manifest-validated, then the Unreal-side legs are the Remote Control typed
 * verification chain on the exact target object (attach → describe →
 * property-read). The unreal target fields are REQUIRED for the unreal leg
 * and rejected for every other engine (never silently ignored).
 */
export function unrealRequest(overrides: Record<string, unknown> = {}): CrossEnginePlanRequest {
  return babylonRequest({
    planId: "cross-engine-unreal-001",
    target: {
      engine: "unreal",
      projectIdentity: "target-unreal",
      projectRoot: "target-unreal",
      objectPath: "/Game/Gamos/GamosAsset.GamosAsset",
      propertyNames: ["StaticMesh", "Name"],
    },
    format: "fbx",
    ...overrides,
  });
}

/** Deep key-order shuffle: every nested object's keys are reversed. */
export function shuffledKeyOrder<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => shuffledKeyOrder(entry)) as unknown as T;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).reverse();
    const out: Record<string, unknown> = {};
    for (const [key, val] of entries) out[key] = shuffledKeyOrder(val);
    return out as unknown as T;
  }
  return value;
}

export function claimsOf(step: GamePlanStep): readonly ResourceClaim[] {
  const claims: StepResourceClaims | undefined = step.resourceClaims;
  return claims?.claims ?? [];
}

export function claimTuples(step: GamePlanStep): string[] {
  return claimsOf(step).map((c) => `${c.access} ${c.scope} ${c.path}`);
}


// ---------------------------------------------------------------------------
// Fixture: a pipeline model context (real registry records + machine discovery)
// ---------------------------------------------------------------------------

export function makePipelineContext(installed: boolean, _target: "babylon" | "unity" | "godot" | "unreal", families: readonly EngineFamily[]): GamingModelContext {
  const engines: DiscoveredEngine[] = families.map((family) =>
    installed
      ? {
          engineFamily: family,
          installed: true,
          rawVersion:
            family === "blender"
              ? "blender 4.1.1"
              : family === "babylon"
                ? "24.14.0"
                : family === "godot"
                  ? "4.2.2.stable.official.15073afe3"
                  : family === "unreal"
                    ? "5.3.2-1234567"
                    : "6000.0.23f1",
          headlessCapable: true,
          // The RC connector's HTTP/WS ops need no display on THIS machine —
          // the editor's own display requirement is the maintainer-side
          // machine's concern (readiness §4.2 attach model); displayServerRequired
          // here describes the DISCOVERED endpoint's ops, not the editor GUI.
          displayServerRequired: false,
        }
      : {
          engineFamily: family,
          installed: false,
          notes: `${family} toolchain not found on this machine`,
          headlessCapable: false,
          displayServerRequired: false,
        },
  );
  const machineDiscovery = buildMachineDiscoveryRecord(WORKSPACE_ROOT, engines, { platform: "linux", arch: "x64" }, NOW);
  const engineStates = joinEngineState(
    { schemaVersion: 2, workspacePath: WORKSPACE_ROOT, engineBindings: families.map((family) => ({ engineFamily: family })) },
    machineDiscovery,
  );

  const registry = registerEnginePluginCapabilities();
  for (const coreRecord of CROSS_ENGINE_CORE_CAPABILITIES) {
    const registered = registerCapability(coreRecord);
    registry.set(`${registered.id}@${registered.version}`, registered);
  }
  // The engine records are CONDITIONAL (runtime prerequisites guarded by the
  // engine-state JOIN, contract 07); the script-generation context carries the
  // registered records as resolved DATA so the generator can derive the
  // required engine families — the fail-closed authority stays with the
  // embedded engine-state guards.
  const capabilityResults = [...registry.values()].map((record) => ({
    request: { id: record.id, version: record.version },
    ok: true as const,
    record,
  }));

  return buildGamingModelContext({
    now: NOW,
    workspaceRoot: WORKSPACE_ROOT,
    classification: classifyIntent(`Plan the cross-engine game asset pipeline from Blender into ${_target === "babylon" ? "Babylon" : _target === "unity" ? "Unity" : _target === "godot" ? "Godot" : "Unreal"}.`),
    projectDetection: {
      root: WORKSPACE_ROOT,
      isProject: true,
      detected: [
        {
          engineFamily: _target,
          isProject: true,
          evidence: [_target === "babylon" ? "package.json" : _target === "unity" ? "ProjectSettings/ProjectVersion.txt" : _target === "godot" ? "project.godot" : "GamosTarget.uproject"],
          projectName: "gamos-target",
        },
      ],
    },
    machineDiscovery,
    engineStates,
    capabilityResults,
  });
}

