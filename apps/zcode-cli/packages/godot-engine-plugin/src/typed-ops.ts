/**
 * Typed Godot operations (M4 WP-2) — RED stub.
 *
 * This module owns the frozen input schemas, the workspace path-safety rules,
 * the fixed bridge-script plan and the pure verification models. It is
 * deliberately free of Godot execution (unit-testable without an engine).
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Workspace path safety
// ---------------------------------------------------------------------------

export class PathSafetyError extends Error {
  readonly code = "PATH_SAFETY";

  constructor(message: string) {
    super(message);
    this.name = "PathSafetyError";
  }
}

export function resolveWorkspacePath(inputPath: string, workspaceRoot: string): string {
  throw new Error("gamos/godot-engine-plugin: not implemented yet (RED): resolveWorkspacePath");
}

// ---------------------------------------------------------------------------
// Frozen capability input schemas
// ---------------------------------------------------------------------------

export const PROPERTY_TYPES: Record<string, "vec3" | "bool"> = {
  position: "vec3",
  rotation: "vec3",
  scale: "vec3",
  visible: "bool",
};

export const ModifyOperation: z.ZodTypeAny = z.never();
export const SceneModifyInput: z.ZodTypeAny = z.never();
export const ProjectInspectInput: z.ZodTypeAny = z.never();
export const ScriptCheckInput: z.ZodTypeAny = z.never();
export const AssetImportInput: z.ZodTypeAny = z.never();
export const ProjectBuildInput: z.ZodTypeAny = z.never();
export const ProjectRunInput: z.ZodTypeAny = z.never();

// ---------------------------------------------------------------------------
// Fixed bridge-script plan (NO dynamic code generation)
// ---------------------------------------------------------------------------

export const BRIDGE_MARKER = "GAMOS_GODOT_REPORT:";

export const BRIDGE_SCRIPTS = ["project_inspect.gd", "scene_modify.gd", "scene_inspect.gd"] as const;
export type BridgeScript = (typeof BRIDGE_SCRIPTS)[number];

export interface BridgePlan {
  readonly scriptPath: string;
  readonly args: string[];
}

export function resolveBridgeRoot(bridgeRoot?: string): string {
  throw new Error("gamos/godot-engine-plugin: not implemented yet (RED): resolveBridgeRoot");
}

export function buildBridgeScript(script: BridgeScript, args: string[], bridgeRoot?: string): BridgePlan {
  throw new Error("gamos/godot-engine-plugin: not implemented yet (RED): buildBridgeScript");
}

// ---------------------------------------------------------------------------
// Verification models (pure)
// ---------------------------------------------------------------------------

export interface ReadbackQuery {
  readonly nodePath: string;
  readonly property: string;
}

export interface ReadbackResult {
  readonly nodePath?: string;
  readonly property?: string;
  readonly value?: unknown;
  readonly error?: string;
}

export interface AppliedOperation {
  readonly nodePath: string;
  readonly property: string;
  readonly value: unknown;
}

export function verifySceneReadback(
  applied: readonly AppliedOperation[],
  readback: readonly ReadbackResult[],
): { ok: boolean; failures: string[] } {
  throw new Error("gamos/godot-engine-plugin: not implemented yet (RED): verifySceneReadback");
}

export const CRASH_LINE_PATTERNS: readonly RegExp[] = [];

export function scanCrashLines(output: string): string[] {
  throw new Error("gamos/godot-engine-plugin: not implemented yet (RED): scanCrashLines");
}

export function resolveTemplatesDir(env?: Record<string, string | undefined>): string {
  throw new Error("gamos/godot-engine-plugin: not implemented yet (RED): resolveTemplatesDir");
}

export interface BridgeEngineVersionInfo {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly status: string;
}

export function engineVersionInfoMatches(rawVersion: string, info: BridgeEngineVersionInfo): boolean {
  throw new Error("gamos/godot-engine-plugin: not implemented yet (RED): engineVersionInfoMatches");
}
