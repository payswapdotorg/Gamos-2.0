import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BRIDGE_MARKER, resolveBridgeRoot, type BridgeScript } from "./typed-ops.js";
import { type EngineFailure, excerpt } from "./engine-shared.js";
import { runGodotHeadless, type RunGodotOptions } from "./engine-run.js";

/**
 * Bridge protocol (M4 WP-2): data-only communication with the committed
 * GDScript bridges — a JSON input file goes in, a JSON report file comes out
 * (pointed at by the `GAMOS_GODOT_REPORT:` stdout marker). A report arriving
 * any other way is not trusted (tamper discipline). Extracted verbatim from
 * engine.ts at the lint-forced module split (re-exported from engine.ts).
 */

function extractBridgeReportPath(stdout: string): string | null {
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith(BRIDGE_MARKER)) {
      const reportPath = trimmed.slice(BRIDGE_MARKER.length).trim();
      if (reportPath.length > 0) return reportPath;
    }
  }
  return null;
}

export async function loadBridgeReport(
  reportPath: string,
): Promise<{ ok: true; report: Record<string, unknown> } | { ok: false; failure: EngineFailure }> {
  if (!existsSync(reportPath)) {
    return {
      ok: false,
      failure: {
        ok: false,
        code: "godot-bridge-report-missing",
        message: `bridge report was not written: ${reportPath}`,
      },
    };
  }
  let text: string;
  try {
    text = await readFile(reportPath, "utf8");
  } catch (error) {
    return {
      ok: false,
      failure: {
        ok: false,
        code: "godot-bridge-report-missing",
        message: `bridge report is unreadable: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      failure: {
        ok: false,
        code: "godot-bridge-report-invalid",
        message: `bridge report is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      failure: {
        ok: false,
        code: "godot-bridge-report-invalid",
        message: `bridge report is not a JSON object: ${excerpt(text)}`,
      },
    };
  }
  const report = parsed as Record<string, unknown>;
  if (report.ok !== true) {
    return {
      ok: false,
      failure: {
        ok: false,
        code: "godot-bridge-failed",
        message: "the data-only bridge reported a failure",
        details: report,
      },
    };
  }
  return { ok: true, report };
}

/** Run a committed bridge with a typed JSON payload; returns the validated report or a structured failure. */
export async function runBridge(
  executable: string,
  script: BridgeScript,
  projectRoot: string,
  payload: unknown,
  options: RunGodotOptions,
  opTimeoutMs: number,
): Promise<{ ok: true; report: Record<string, unknown> } | { ok: false; failure: EngineFailure }> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "gamos-godot-bridge-"));
  try {
    const inputPath = path.join(tmp, "input.json");
    const reportPath = path.join(tmp, "report.json");
    await writeFile(inputPath, JSON.stringify(payload));
    const scriptPath = path.join(resolveBridgeRoot(), script);
    const run = await runGodotHeadless(
      executable,
      ["--headless", "--path", projectRoot, "--script", scriptPath, "--", inputPath, reportPath],
      { ...options, timeoutMs: options.timeoutMs ?? opTimeoutMs },
    );
    if (run.spawnError !== null) {
      return { ok: false, failure: { ok: false, code: "godot-run-failed", message: `failed to spawn ${executable}: ${run.spawnError}` } };
    }
    if (run.timedOut) {
      return { ok: false, failure: { ok: false, code: "godot-runaway", message: "engine run exceeded the bounded time and the process group was killed" } };
    }
    // Tamper discipline: the bridge must have pointed at OUR report path via
    // the stdout marker — a report any other way is not trusted.
    const markerPath = extractBridgeReportPath(run.stdout);
    if (markerPath === null || path.resolve(markerPath) !== path.resolve(reportPath)) {
      return {
        ok: false,
        failure: {
          ok: false,
          code: "godot-bridge-report-missing",
          message: `the bridge did not report through the stdout marker (expected ${reportPath})`,
          details: { markerPath, stdoutExcerpt: excerpt(run.stdout, 800) },
        },
      };
    }
    const outcome = await loadBridgeReport(reportPath);
    if (!outcome.ok) {
      return outcome;
    }
    return { ok: true, report: outcome.report };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
