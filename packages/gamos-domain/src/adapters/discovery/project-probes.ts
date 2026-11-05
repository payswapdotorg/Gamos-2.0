/**
 * Read-only project discovery probes (contract 04 §1/§5 — M1.3).
 *
 * Discovery reads REAL files/metadata from the workspace root. A project must
 * have an evidence-backed identity and detected metadata; non-project
 * directories produce no records (no fake data). Pure filesystem reads only —
 * no process spawning (the engine-binary probes in contract 04 §5 that call
 * executables run through the agent tool layer, not this module).
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { EngineFamily } from "../../engine-family.js";

/** One family's detection result from real files. */
export interface ProjectProbeResult {
  readonly engineFamily: EngineFamily;
  readonly isProject: boolean;
  /** Filesystem evidence backing the detection (never empty when isProject). */
  readonly evidence: readonly string[];
  readonly projectName: string;
  readonly rawVersion?: string;
}

/** Aggregated detection over all families. */
export interface ProjectEngineDetection {
  readonly root: string;
  readonly isProject: boolean;
  readonly detected: readonly ProjectProbeResult[];
  readonly nonProjectReason?: string;
}

function toResult(family: EngineFamily, isProject: boolean, evidence: string[], projectName: string, rawVersion?: string): ProjectProbeResult {
  return { engineFamily: family, isProject, evidence, projectName, ...(rawVersion !== undefined ? { rawVersion } : {}) };
}

/** Unity: `ProjectSettings/ProjectVersion.txt` (m_EditorVersionWithRevision). */
export function discoverUnityProject(root: string): ProjectProbeResult {
  const versionFile = join(root, "ProjectSettings", "ProjectVersion.txt");
  if (existsSync(versionFile)) {
    const content = readFileSync(versionFile, "utf8");
    const m = /m_EditorVersionWithRevision:\s*(.+)/.exec(content);
    const raw = m?.[1]?.trim() ?? undefined;
    // Strip the parenthesized revision for the comparable raw form.
    const versionOnly = raw ? raw.replace(/\s*\([0-9a-f]{6,40}\)/i, "").trim() : undefined;
    const rawVersion = versionOnly ?? raw;
    return {
      engineFamily: "unity",
      isProject: true,
      evidence: ["ProjectSettings/ProjectVersion.txt"],
      projectName: basename(root) || root,
      ...(rawVersion !== undefined ? { rawVersion } : {}),
    };
  }
  return toResult("unity", false, [], basename(root) || root);
}

/** Blender: `*.blend` files in the root (or a single level of subdirectories). */
export function discoverBlenderProject(root: string): ProjectProbeResult {
  const blendFiles = listFiles(root).filter((f) => f.toLowerCase().endsWith(".blend"));
  const firstBlend = blendFiles[0];
  if (firstBlend !== undefined) {
    return toResult("blender", true, [firstBlend], basename(root) || root);
  }
  return toResult("blender", false, [], basename(root) || root);
}

/** Godot: `project.godot` (config_version + application/config/name). */
export function discoverGodotProject(root: string): ProjectProbeResult {
  const projectFile = join(root, "project.godot");
  if (existsSync(projectFile)) {
    const content = readFileSync(projectFile, "utf8");
    const nameMatch = /config\/name\s*=\s*"?([^"\n]+)"?/.exec(content);
    const godotName = nameMatch?.[1]?.trim();
    return {
      engineFamily: "godot",
      isProject: true,
      evidence: ["project.godot"],
      projectName: godotName !== undefined && godotName.length > 0 ? godotName : basename(root) || root,
    };
  }
  return toResult("godot", false, [], basename(root) || root);
}

/** Unreal: `*.uproject` descriptor in the root. */
export function discoverUnrealProject(root: string): ProjectProbeResult {
  const uproject = listFiles(root).find((f) => f.toLowerCase().endsWith(".uproject"));
  if (uproject) {
    return toResult("unreal", true, [uproject], basename(uproject).replace(/\.uproject$/i, ""));
  }
  return toResult("unreal", false, [], basename(root) || root);
}

/** Babylon: `package.json` with `@babylonjs/*` dependencies (or a babylon script reference). */
export function discoverBabylonProject(root: string): ProjectProbeResult {
  const pkgFile = join(root, "package.json");
  if (existsSync(pkgFile)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgFile, "utf8")) as Record<string, unknown> & { name?: unknown };
      const deps: Record<string, string> = {
        ...((pkg.dependencies as Record<string, string> | undefined) ?? {}),
        ...((pkg.devDependencies as Record<string, string> | undefined) ?? {}),
      };
      const babylonDep = Object.keys(deps).find((d) => d === "babylonjs" || d.startsWith("@babylonjs/"));
      if (babylonDep) {
        const pkgName = typeof pkg.name === "string" ? pkg.name : "";
        const babylonName = pkgName.length > 0 ? pkgName : basename(root) || root;
        return toResult("babylon", true, ["package.json"], babylonName);
      }
    } catch {
      // malformed package.json → not a Babylon project via this probe
    }
  }
  // index.html referencing babylon CDN/script is also a marker.
  const indexFile = join(root, "index.html");
  if (existsSync(indexFile)) {
    const html = readFileSync(indexFile, "utf8");
    if (/babylon/i.test(html)) {
      return toResult("babylon", true, ["index.html"], basename(root) || root);
    }
  }
  return toResult("babylon", false, [], basename(root) || root);
}

/** Aggregates all family probes for a workspace root. */
export function detectProjectEngines(root: string): ProjectEngineDetection {
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    return { root, isProject: false, detected: [], nonProjectReason: `workspace root does not exist or is not a directory: ${root}` };
  }
  const probes = [
    discoverUnityProject(root),
    discoverBlenderProject(root),
    discoverGodotProject(root),
    discoverUnrealProject(root),
    discoverBabylonProject(root),
  ];
  const detected = probes.filter((p) => p.isProject);
  if (detected.length === 0) {
    return { root, isProject: false, detected: [], nonProjectReason: "no engine-family project markers found (no ProjectVersion.txt, *.blend, project.godot, *.uproject, babylon package.json/index.html)" };
  }
  return { root, isProject: true, detected };
}

function listFiles(root: string, depth = 1): string[] {
  const out: string[] = [];
  let entries: Array<{ name: string; isFile: () => boolean; isDirectory: () => boolean }>;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const target = join(root, entry.name);
    if (entry.isFile()) out.push(target);
    else if (entry.isDirectory() && depth > 0 && !entry.name.startsWith(".")) {
      out.push(...listFiles(target, depth - 1));
    }
  }
  return out;
}
