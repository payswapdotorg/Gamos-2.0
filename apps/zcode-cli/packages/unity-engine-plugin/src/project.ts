import { existsSync, readFileSync, readdirSync, statSync, type Dirent } from "node:fs";
import path from "node:path";
import {
  parseUnityVersionLine,
  type StructuredFailure,
  type UnityVersion,
} from "./typed-ops.js";

/**
 * Unity project metadata (M2.1).
 *
 * Pure filesystem inspection of a project root: the REAL Unity project
 * markers (`ProjectSettings/ProjectVersion.txt` read AND parsed, plus an
 * `Assets/` directory) decide project identity — a directory without BOTH is
 * `not-a-unity-project`, never a guess. All `.unity` scene files under
 * `Assets/` are listed (bounded). Nothing here spawns a process — the
 * execution layer lives in `engine.ts`.
 *
 * Machine-neutral shared metadata: every reported path is relative to the
 * project root (repo-relative evidence paths only).
 */

export const MAX_SCENE_FILES = 50;
/** Safety cap on walked directory entries while listing scenes. */
const MAX_WALKED_ENTRIES = 5000;

export interface UnityProjectVersion {
  raw: string;
  parsed: UnityVersion | null;
  revision: string | null;
}

export interface ProjectMetadata {
  ok: true;
  projectRoot: string;
  projectVersion: UnityProjectVersion;
  hasAssets: boolean;
  sceneFiles: string[];
  sceneCount: number;
  sceneSearchTruncated: boolean;
  packagesManifestPresent: boolean;
  /** Project-relative paths of the evidence this inspection is based on. */
  evidencePaths: string[];
}

export type ProjectInspection = ProjectMetadata | StructuredFailure;

// ---------------------------------------------------------------------------
// Project inspection
// ---------------------------------------------------------------------------

/**
 * Inspect a Unity project root's real markers. Fails closed: invalid root,
 * missing markers, and unparseable `ProjectVersion.txt` are structured
 * failures.
 *
 * NOTE (honesty): a passing inspection proves PROJECT identity only — it is
 * NOT evidence that a Unity Editor is installed or licensed.
 */
export function inspectUnityProject(projectRoot: string): ProjectInspection {
  if (typeof projectRoot !== "string" || projectRoot.length === 0 || !path.isAbsolute(projectRoot)) {
    return failure("project-root-invalid", `project root must be an absolute path: ${String(projectRoot)}`);
  }
  if (!existsSync(projectRoot)) {
    return failure("project-root-missing", `project root does not exist: ${projectRoot}`);
  }
  try {
    if (!statSync(projectRoot).isDirectory()) {
      return failure("project-root-invalid", `project root is not a directory: ${projectRoot}`);
    }
  } catch (error) {
    return failure("project-root-invalid", `cannot stat project root ${projectRoot}: ${messageOf(error)}`);
  }

  const versionFile = path.join(projectRoot, "ProjectSettings", "ProjectVersion.txt");
  const assetsDir = path.join(projectRoot, "Assets");

  if (!isFile(versionFile) || !isDirectory(assetsDir)) {
    return failure(
      "not-a-unity-project",
      `missing Unity project markers in ${projectRoot}: requires BOTH ProjectSettings/ProjectVersion.txt and an Assets/ directory` +
        ` (found version file: ${isFile(versionFile)}, found Assets/: ${isDirectory(assetsDir)}) — ` +
        `note that a project marker is not editor availability`,
    );
  }

  let raw: string;
  try {
    raw = readFileSync(versionFile, "utf8");
  } catch (error) {
    return failure("project-version-read", `cannot read ${versionFile}: ${messageOf(error)}`);
  }

  const projectVersion = parseProjectVersion(raw);
  if (!projectVersion) {
    return failure(
      "project-version-unparseable",
      `malformed ProjectVersion.txt at ${versionFile}: expected an "m_EditorVersion: <version>" line matching the Unity grammar (e.g. 6000.0.23f1)`,
    );
  }

  const scenes = listSceneFiles(projectRoot);
  const evidencePaths = [
    "ProjectSettings/ProjectVersion.txt",
    ...(scenes.sceneFiles.length > 0 ? [scenes.sceneFiles[0] as string] : []),
  ];

  return {
    ok: true,
    projectRoot,
    projectVersion,
    hasAssets: true, // marker-gated: Assets/ existence is required above
    sceneFiles: scenes.sceneFiles,
    sceneCount: scenes.sceneFiles.length,
    sceneSearchTruncated: scenes.truncated,
    packagesManifestPresent: isFile(path.join(projectRoot, "Packages", "manifest.json")),
    evidencePaths,
  };
}

/**
 * Parse ProjectVersion.txt content:
 *
 *     m_EditorVersion: 6000.0.23f1
 *     m_EditorVersionWithRevision: 6000.0.23f1 (ab2b18a5f80dcba39fd8f5ee57b07edc7c0f600f)
 */
export function parseProjectVersion(
  content: string,
): { raw: string; parsed: UnityVersion; revision: string | null } | null {
  const versionLine = /^m_EditorVersion:\s*(\S+)\s*$/m.exec(content);
  if (!versionLine || !versionLine[1]) {
    return null;
  }
  const parsedLine = parseUnityVersionLine(versionLine[1]);
  if (!parsedLine) {
    return null;
  }
  const revisionLine = /^m_EditorVersionWithRevision:\s*\S+\s*\(([0-9a-fA-F]{40})\)\s*$/m.exec(content);
  return {
    raw: parsedLine.raw,
    parsed: parsedLine.parsed,
    revision: revisionLine?.[1] ?? null,
  };
}

// ---------------------------------------------------------------------------
// Scene listing
// ---------------------------------------------------------------------------

/**
 * List all `.unity` scene files under `Assets/` as project-relative POSIX
 * paths, sorted,
 * bounded at MAX_SCENE_FILES with an honest `truncated` flag.
 */
export function listSceneFiles(projectRoot: string): { sceneFiles: string[]; truncated: boolean } {
  const found: string[] = [];
  let walked = 0;
  let truncated = false;

  const walk = (dir: string, relativeDir: string): void => {
    if (truncated || walked >= MAX_WALKED_ENTRIES) {
      return;
    }
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directories are skipped, not guessed
    }
    for (const entry of entries) {
      if (truncated) return;
      walked += 1;
      if (walked > MAX_WALKED_ENTRIES) {
        return;
      }
      if (entry.name.startsWith(".")) continue;
      const relative = relativeDir === "" ? entry.name : `${relativeDir}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), relative);
      } else if (entry.isFile() && entry.name.endsWith(".unity")) {
        if (found.length >= MAX_SCENE_FILES) {
          truncated = true;
          return;
        }
        found.push(relative);
      }
    }
  };

  const assets = path.join(projectRoot, "Assets");
  if (isDirectory(assets)) {
    walk(assets, "Assets");
  }
  found.sort((left, right) => left.localeCompare(right));
  return { sceneFiles: found, truncated };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function failure(code: string, reason: string): StructuredFailure {
  return { ok: false, code, reason };
}

function isFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function isDirectory(candidate: string): boolean {
  try {
    return statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
