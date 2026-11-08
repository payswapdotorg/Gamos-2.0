/**
 * Gamos M2-G1 unity gate-status CLI (M2-A, final-closure directive §2).
 *
 * Invoked by the `unity-engine-status` job of `.github/workflows/gamos-m2-e2e.yml`
 * AFTER the unity-engine-plugin suite has run (success or failure — the step is
 * `if: always()`). Reads the four evidence inputs the classifier needs:
 *
 *   --evidence <path>  the suite's machine-evidence JSON
 *                      (GAMOS_UNITY_SUITE_EVIDENCE; discovery facts, exact
 *                      version contract, preflight license classification,
 *                      verified mutation/build artifacts)
 *   --results <path>   the vitest JSON-reporter per-test results
 *   --exit <path>      a file containing the suite exit code captured
 *                      independently of tee/pipeline behavior (PIPESTATUS[0])
 *   --log <path>       the retained suite log (contradiction checks)
 *   --output <path>    where to write the classified unity-gate-status.json
 *   --run-id <string>  recorded_at provenance (run id + attempt)
 *
 * Missing or unreadable input files map to null inputs — the classifier fails
 * closed (a crashed suite can never produce a passing gate record). The CLI
 * always exits 0 when a status was RECORDED: the suite step's own exit code
 * already colors the job; this step's job is honest recording, and the
 * roadmap completion check refuses M2 completion without positive
 * editor-verified gate evidence.
 *
 * Bundled with esbuild before running (same pattern as
 * scripts/gamos/m2-capability-cli.ts):
 *   pnpm exec esbuild scripts/gamos/m2-unity-gate-status.ts \
 *     --bundle --platform=node --format=esm --outfile=/tmp/m2-unity-gate-status.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { deriveUnityGateStatus } from "../../packages/gamos-domain/src/domain/unity-gate-status.js";

interface CliArgs {
  evidencePath: string | null;
  resultsPath: string | null;
  exitPath: string | null;
  logPath: string | null;
  outputPath: string | null;
  runId: string;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    evidencePath: null,
    resultsPath: null,
    exitPath: null,
    logPath: null,
    outputPath: null,
    runId: "-",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    const next = argv[index + 1];
    if (arg === "--evidence" && next !== undefined) {
      args.evidencePath = next;
      index += 1;
    } else if (arg === "--results" && next !== undefined) {
      args.resultsPath = next;
      index += 1;
    } else if (arg === "--exit" && next !== undefined) {
      args.exitPath = next;
      index += 1;
    } else if (arg === "--log" && next !== undefined) {
      args.logPath = next;
      index += 1;
    } else if (arg === "--output" && next !== undefined) {
      args.outputPath = next;
      index += 1;
    } else if (arg === "--run-id" && next !== undefined) {
      args.runId = next;
      index += 1;
    } else {
      throw new Error(
        `unexpected argument "${arg}" — usage: --evidence <path> --results <path> --exit <path> --log <path> --output <path> [--run-id <id>]`,
      );
    }
  }
  return args;
}

function readJsonOrNull(path: string | null): unknown {
  if (path === null) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null; // missing or malformed — the classifier fails closed
  }
}

function readLogOrNull(path: string | null): string | null {
  if (path === null) {
    return null;
  }
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function readExitCodeOrNull(path: string | null): number | null {
  if (path === null) {
    return null;
  }
  try {
    const text = readFileSync(path, "utf8").trim();
    if (text === "") {
      return null;
    }
    const value = Number.parseInt(text, 10);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.outputPath === null) {
    throw new Error("--output <path> is required (where to write unity-gate-status.json)");
  }

  const record = deriveUnityGateStatus({
    machineEvidence: readJsonOrNull(args.evidencePath),
    suiteResults: readJsonOrNull(args.resultsPath),
    suiteExitCode: readExitCodeOrNull(args.exitPath),
    suiteLog: readLogOrNull(args.logPath),
  });

  const output = {
    ...record,
    recorded_at: args.runId,
  };
  writeFileSync(args.outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`unity gate status written to ${args.outputPath}:`);
  console.log(JSON.stringify(output, null, 2));
}

main();
