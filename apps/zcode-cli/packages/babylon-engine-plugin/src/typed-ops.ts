import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * Typed Babylon project operations (M2.3).
 *
 * This module is deliberately free of Node/package-manager execution: it owns
 * the frozen capability input schemas, the workspace path-safety rules and the
 * shared structured-failure shape. Everything here is unit-testable without a
 * Node install or a Babylon project.
 */

// ---------------------------------------------------------------------------
// Shared structured failure shape
// ---------------------------------------------------------------------------

/** Every engine-layer operation fails closed through this shape. */
export interface StructuredFailure {
  ok: false;
  code: string;
  reason: string;
  details?: unknown;
}

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

/**
 * Resolve an absolute input path against the workspace root.
 *
 * - requires absolute inputs (and an absolute workspace root)
 * - rejects `..` traversal that lands outside the workspace root
 *   (traversal that stays inside is fine)
 * - rejects symlink escapes: the deepest existing ancestor of the path must
 *   realpath inside the (realpath'd) workspace root
 *
 * Returns the lexically resolved absolute path (it is inside the root by
 * construction at call time).
 */
export function resolveWorkspacePath(inputPath: string, workspaceRoot: string): string {
  if (typeof inputPath !== "string" || inputPath.length === 0) {
    throw new PathSafetyError("Path must be a non-empty string");
  }
  if (typeof workspaceRoot !== "string" || workspaceRoot.length === 0) {
    throw new PathSafetyError("Workspace root must be a non-empty string");
  }
  if (!path.isAbsolute(inputPath)) {
    throw new PathSafetyError(`Path must be absolute, got relative path: ${inputPath}`);
  }
  if (!path.isAbsolute(workspaceRoot)) {
    throw new PathSafetyError(`Workspace root must be absolute, got: ${workspaceRoot}`);
  }
  const lexicalRoot = path.resolve(workspaceRoot);
  const resolved = path.resolve(inputPath);
  assertInsideRoot(resolved, lexicalRoot, `path escapes workspace root`);

  const realRoot = realPathOfExisting(workspaceRoot);
  const realAncestor = realPathOfExisting(resolved);
  assertInsideRoot(realAncestor, realRoot, "symlink escape out of workspace root");
  return resolved;
}

function assertInsideRoot(candidate: string, root: string, reason: string): void {
  const relative = path.relative(root, candidate);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return;
  }
  throw new PathSafetyError(`${reason}: ${candidate} is outside ${root}`);
}

function realPathOfExisting(candidate: string): string {
  if (existsSync(candidate)) {
    return realpathSync(candidate);
  }
  const parent = path.dirname(candidate);
  if (parent === candidate) {
    return candidate;
  }
  return path.join(realPathOfExisting(parent), path.basename(candidate));
}

// ---------------------------------------------------------------------------
// Frozen capability input schemas
// ---------------------------------------------------------------------------

export const ProjectInspectInput = z.object({
  projectRoot: z.string().min(1).describe("Absolute path to the Babylon project root inside the workspace."),
});
export type ProjectInspectInput = z.infer<typeof ProjectInspectInput>;

export const ProjectBuildInput = z.object({
  projectRoot: z.string().min(1).describe("Absolute path to the Babylon project root inside the workspace."),
});
export type ProjectBuildInput = z.infer<typeof ProjectBuildInput>;

export const ProjectRunInput = z
  .object({
    projectRoot: z.string().min(1).describe("Absolute path to the Babylon project root inside the workspace."),
    port: z
      .number()
      .int()
      .min(1)
      .max(65535)
      .optional()
      .describe(
        "Explicit loopback port for the dev server (strictPort: a conflict is an error, never a silent retry). A free port is auto-picked when unset.",
      ),
  })
  .describe("Start the project's declared dev/start script and health-check its runtime URL.");
export type ProjectRunInput = z.infer<typeof ProjectRunInput>;

/** Cancellation surface for `project_run` runtimes (not a standalone capability). */
export const ProjectStopInput = z.object({
  pid: z.number().int().positive().describe("Runtime pid returned by project_run."),
});
export type ProjectStopInput = z.infer<typeof ProjectStopInput>;

// ---------------------------------------------------------------------------
// Runtime HTML verification model (pure)
// ---------------------------------------------------------------------------

export type HtmlMount = "canvas" | "div" | null;

/**
 * Check whether served dev-server HTML exposes a render mount: a `<canvas`
 * element or a root `<div id="...">`. This is the headless HTTP-level check;
 * the full ZCode Browser verification (real rendered content, behavior
 * assertions such as `window.__GAMOS_BABYLON_READY__`) is owned by the
 * TL journey, not this plugin.
 */
export function detectHtmlMount(html: string): HtmlMount {
  if (/<canvas[\s>]/i.test(html)) {
    return "canvas";
  }
  if (/<div[^>]*\bid\s*=\s*["'][^"']+["']/i.test(html)) {
    return "div";
  }
  return null;
}
