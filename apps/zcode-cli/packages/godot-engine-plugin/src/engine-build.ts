import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { godotTemplatesVersion, parseGodotExecutableVersion } from "./discovery.js";
import { ProjectBuildInput, resolveTemplatesDir, resolveWorkspacePath } from "./typed-ops.js";
import {
  OP_TIMEOUTS,
  type EngineFailure,
  invalidInput,
  pathFailure,
  resolveProjectRoot,
  sha256File,
} from "./engine-shared.js";
import { runGodotHeadless, type RunGodotOptions } from "./engine-run.js";

/**
 * godot/project.build (M4 WP-2) — headless export with honest prerequisites
 * and artifact-hash verification. Extracted verbatim from engine.ts at the
 * lint-forced module split (re-exported from engine.ts).
 */

export interface ProjectBuildSuccess {
  ok: true;
  projectRoot: string;
  preset: string;
  artifactPath: string;
  artifactSha256: string;
  artifactBytes: number;
  templatesVersion: string;
  pck: { mode: "separate" | "embedded" | "none"; path: string | null; sha256: string | null; bytes: number | null };
}

/** Parse the preset names + export paths from an export_presets.cfg (INI-ish, fail-closed scan). */
function parseExportPresets(projectRoot: string): { presets: Map<string, string | null> } {
  const presets = new Map<string, string | null>();
  const cfgPath = path.join(projectRoot, "export_presets.cfg");
  if (!existsSync(cfgPath)) {
    return { presets };
  }
  const text = readFileSync(cfgPath, "utf8");
  let current: string | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const section = /^\[preset\.(\d+)\]$/.exec(line);
    if (section) {
      current = null;
      continue;
    }
    const name = /^name="([^"]+)"$/.exec(line);
    if (name) {
      current = name[1] ?? "";
      presets.set(current, null);
      continue;
    }
    const exportPath = /^export_path="([^"]+)"$/.exec(line);
    if (exportPath && current !== null) {
      presets.set(current, exportPath[1] ?? "");
    }
  }
  return { presets };
}

export async function projectBuild(
  executable: string,
  input: unknown,
  workspaceRoot: string,
  options: RunGodotOptions = {},
): Promise<ProjectBuildSuccess | EngineFailure> {
  const parsed = ProjectBuildInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const root = resolveProjectRoot(parsed.data, workspaceRoot);
  if (!root.ok) return root.failure;

  let outPath: string;
  try {
    outPath = resolveWorkspacePath(parsed.data.outPath, workspaceRoot);
  } catch (error) {
    return pathFailure(error);
  }
  if (!existsSync(outPath) || !statSync(outPath).isDirectory()) {
    return { ok: false, code: "export-out-dir-missing", message: `output directory must pre-exist (honest error, never auto-created): ${outPath}` };
  }

  // Prerequisite 1: the preset must be declared (allowlisted) in export_presets.cfg.
  const { presets } = parseExportPresets(root.projectRoot);
  const exportPath = presets.get(parsed.data.preset);
  if (exportPath === undefined) {
    return {
      ok: false,
      code: "unknown-export-preset",
      message: `export preset "${parsed.data.preset}" is not declared in export_presets.cfg`,
      details: { available: [...presets.keys()] },
    };
  }
  if (exportPath === null || exportPath === "") {
    return {
      ok: false,
      code: "preset-export-path-missing",
      message: `export preset "${parsed.data.preset}" declares no export_path — the artifact filename is unknown`,
    };
  }

  // Prerequisite 2: export templates for the EXACT engine version (fail-closed,
  // honest reason — mismatched or missing templates never silently pass).
  // Prerequisite 2a is spawn-independent: the export-templates ROOT is checked
  // WITHOUT consulting the engine — an absent root is an honest, actionable
  // failure even when the executable cannot run at all.
  const env = { ...process.env, ...(options.env ?? {}) };
  const templatesRoot = resolveTemplatesDir(env);
  if (!existsSync(templatesRoot)) {
    return {
      ok: false,
      code: "godot-export-templates-missing",
      message: `export templates are missing: the export-templates root does not exist — expected ${templatesRoot}`,
      details: { templatesRoot },
    };
  }
  const versionRun = await runGodotHeadless(executable, ["--version"], { ...options, timeoutMs: 60_000 });
  const rawVersion = (versionRun.stdout || versionRun.stderr).trim().split(/\r?\n/)[0]?.trim() ?? "";
  const versionParsed = parseGodotExecutableVersion(rawVersion);
  if (!versionParsed.ok) {
    return { ok: false, code: "godot-version-unparseable", message: `engine reported an unparseable version: ${rawVersion}` };
  }
  const templatesVersion = godotTemplatesVersion(versionParsed);
  const templatesDir = path.join(templatesRoot, templatesVersion);
  if (!existsSync(templatesDir)) {
    return {
      ok: false,
      code: "godot-export-templates-missing",
      message: `export templates for the exact engine version are missing: expected ${templatesDir} (version ${templatesVersion})`,
      details: { templatesDir, templatesVersion },
    };
  }
  const releaseTemplate = path.join(templatesDir, "linux_release.x86_64");
  if (!existsSync(releaseTemplate)) {
    return {
      ok: false,
      code: "godot-export-templates-missing",
      message: `the linux release export template is missing from ${templatesDir}`,
      details: { templatesDir, templatesVersion },
    };
  }

  const artifactPath = path.join(outPath, path.basename(exportPath));
  const run = await runGodotHeadless(
    executable,
    ["--headless", "--path", root.projectRoot, "--export-release", parsed.data.preset, artifactPath],
    { ...options, timeoutMs: options.timeoutMs ?? OP_TIMEOUTS.projectBuild, env: options.env },
  );
  if (run.spawnError !== null) {
    return { ok: false, code: "godot-run-failed", message: `failed to spawn ${executable}: ${run.spawnError}` };
  }
  if (run.timedOut) {
    return { ok: false, code: "godot-runaway", message: "export exceeded the bounded time and the process group was killed" };
  }

  // Verified engine fact: a FAILED export still exits 0 — the engine's failure
  // line AND the artifact probe are the authority, never the exit code.
  const combined = `${run.stdout}\n${run.stderr}`;
  const exportFailure = /ERROR: Project export for preset "([^"]+)" failed/.exec(combined);
  if (exportFailure || !existsSync(artifactPath)) {
    return {
      ok: false,
      code: "export-engine-failed",
      message: `the headless export failed for preset "${parsed.data.preset}" (the artifact was not produced)`,
      details: { exitStatus: run.exitStatus, failureLine: exportFailure?.[0] ?? null },
    };
  }

  const artifactBytes = statSync(artifactPath).size;
  if (artifactBytes < 1_000_000 || artifactBytes > 512_000_000) {
    return {
      ok: false,
      code: "export-artifact-out-of-bounds",
      message: `the exported artifact size ${artifactBytes} B is outside the reviewed bounds [1 MB, 512 MB]`,
      details: { artifactPath, artifactBytes },
    };
  }
  const artifactSha256 = await sha256File(artifactPath);

  // The pck contract: the engine writes either a separate .pck next to the
  // binary or embeds it into the binary (binary larger than the bare template).
  const pckPath = artifactPath.replace(/\.[^./\\]+$/, "") + ".pck";
  let pck: ProjectBuildSuccess["pck"];
  if (existsSync(pckPath)) {
    pck = { mode: "separate", path: pckPath, sha256: await sha256File(pckPath), bytes: statSync(pckPath).size };
  } else {
    const templateBytes = statSync(releaseTemplate).size;
    if (artifactBytes > templateBytes + 1024) {
      pck = { mode: "embedded", path: null, sha256: null, bytes: artifactBytes - templateBytes };
    } else {
      pck = { mode: "none", path: null, sha256: null, bytes: null };
    }
  }
  if (pck.mode === "none") {
    return {
      ok: false,
      code: "export-artifact-not-verified",
      message: "neither a separate nor an embedded PCK was detected in the export — refusing to claim a verified build",
      details: { artifactPath, artifactBytes, templateBytes: statSync(releaseTemplate).size },
    };
  }

  return {
    ok: true,
    projectRoot: root.projectRoot,
    preset: parsed.data.preset,
    artifactPath,
    artifactSha256,
    artifactBytes,
    templatesVersion,
    pck,
  };
}
