import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ZodError } from "zod";
import { PathSafetyError, resolveWorkspacePath } from "./typed-ops.js";

/**
 * Shared engine-layer plumbing (M4 WP-2): the structured-failure taxonomy,
 * per-op timeout defaults and the workspace/project path pre-checks shared
 * by every typed operation. Extracted verbatim from engine.ts at the
 * lint-forced module split (the public API stays re-exported from engine.ts).
 */

export const DEFAULT_TIMEOUT_MS = 300_000;
export const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

/** Per-op defaults mirroring the registered capability records' timeout fields. */
export const OP_TIMEOUTS = {
  projectInspect: 60_000,
  sceneModify: 120_000,
  sceneInspect: 120_000,
  scriptCheck: 60_000,
  assetImport: 600_000,
  projectBuild: 600_000,
  projectRun: 300_000,
} as const;

/**
 * Script parse diagnostics — PRE-EXISTING project script state surfaced by any
 * full-project engine pass (import, export). These lines are crash lines for
 * script.check/project.run (the classifier stays untouched), but during an
 * IMPORT pass they describe scripts unrelated to the imported asset: they are
 * reported as diagnostics while the filesystem probe remains the sole verdict.
 */
export const SCRIPT_PARSE_DIAGNOSTIC =
  /^(?:SCRIPT ERROR: Parse Error:.*|ERROR: Failed to load script ".*" with error "Parse error"\.)$/;

export interface EngineFailure {
  ok: false;
  code: string;
  message: string;
  details?: unknown;
}

export function invalidInput(error: ZodError): EngineFailure {
  return {
    ok: false,
    code: "invalid-input",
    message: "input failed the frozen typed-operation schema",
    details: { issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) },
  };
}

export function pathFailure(error: unknown): EngineFailure {
  if (error instanceof PathSafetyError) {
    return { ok: false, code: "path-safety", message: error.message };
  }
  return { ok: false, code: "path-safety", message: error instanceof Error ? error.message : String(error) };
}

export function excerpt(text: string, limit = 400): string {
  const trimmed = text.trim();
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit)}…`;
}

export async function sha256File(file: string): Promise<string> {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

/** Resolve + pre-check a project root: absolute, inside the workspace, with a real project.godot. */
export function resolveProjectRoot(
  input: { projectRoot: string },
  workspaceRoot: string,
): { ok: true; projectRoot: string } | { ok: false; failure: EngineFailure } {
  let resolved: string;
  try {
    resolved = resolveWorkspacePath(input.projectRoot, workspaceRoot);
  } catch (error) {
    return { ok: false, failure: pathFailure(error) };
  }
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    return { ok: false, failure: { ok: false, code: "project-root-missing", message: `project root not found: ${resolved}` } };
  }
  if (!existsSync(path.join(resolved, "project.godot"))) {
    return { ok: false, failure: { ok: false, code: "project-godot-missing", message: `project.godot not found under: ${resolved}` } };
  }
  return { ok: true, projectRoot: resolved };
}

/** Workspace temp directory helper (bounded lifetime; always removed). */
export async function withTempDir<T>(work: (tmp: string) => Promise<T>): Promise<T> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "gamos-godot-op-"));
  try {
    return await work(tmp);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
