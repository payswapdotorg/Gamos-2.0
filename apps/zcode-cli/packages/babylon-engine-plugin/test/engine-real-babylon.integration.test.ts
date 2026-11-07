import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { get as httpGet } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { discoverNode } from "../src/discovery.js";
import {
  listRuntimes,
  projectBuild,
  projectInspect,
  projectRun,
  resolvePackageManagerCommand,
  runNodeCommand,
  stopRuntime,
} from "../src/engine.js";

const FIXTURE_DIR = fileURLToPath(new URL("./fixture/babylon-app", import.meta.url));

// Real-toolchain gate: these tests only mean something against an actual Node
// runtime, a working npm, and network access for the declared dependency fetch
// (`npm ci` of @babylonjs/core + vite from the committed fixture lockfile).
// Fixture executables are NOT acceptable here — a miss must be an honest skip.
const discovery = discoverNode();
const nodeExe = discovery.executable;
const npmProbe = spawnSync("npm", ["--version"], { encoding: "utf8", timeout: 20_000, shell: false });
const npmAvailable = npmProbe.status === 0;
const realToolchainFound =
  discovery.status === "available" && typeof nodeExe === "string" && nodeExe.length > 0 && npmAvailable;

if (!realToolchainFound) {
  console.log(
    `SKIP: real Node/npm toolchain unavailable — integration gate NOT passing ` +
      `(node=${discovery.status}${discovery.reason ? `: ${discovery.reason}` : ""}, ` +
      `npm=${npmAvailable ? "ok" : `probe exit ${String(npmProbe.status)}: ${String(npmProbe.stderr ?? "").trim()}`})`,
  );
} else {
  console.log(`[gamos-evidence] node executable: ${nodeExe}`);
  console.log(`[gamos-evidence] node raw version: ${discovery.rawVersion}`);
  console.log(`[gamos-evidence] npm version (PATH probe): ${String(npmProbe.stdout ?? "").trim()}`);
}

function sha256Of(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function httpGetUrl(url: string, timeoutMs = 5_000): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpGet(url, { timeout: timeoutMs }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      });
      response.on("end", () => {
        resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") });
      });
    });
    request.on("timeout", () => {
      request.destroy(new Error(`HTTP GET ${url} timed out after ${timeoutMs}ms`));
    });
    request.on("error", (error) => {
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

function canBind(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createNetServer();
    const finish = (bound: boolean) => {
      server.close();
      resolve(bound);
    };
    server.once("error", () => finish(false));
    server.listen(port, "127.0.0.1", () => finish(true));
  });
}

function tail(text: string, limit = 2000): string {
  return text.length <= limit ? text : text.slice(text.length - limit);
}

describe.skipIf(!realToolchainFound)("babylon-engine plugin real-Node/Vite/Babylon integration", () => {
  let workspace = "";
  let projectRoot = "";
  let lockShaCommitted = "";
  let lockShaAfterCi = "";
  let npmCommand = "";
  let npmArgs: string[] = [];

  beforeAll(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), "gamos-babylon-ws-"));
    projectRoot = path.join(workspace, "babylon-app");
    await cp(FIXTURE_DIR, projectRoot, {
      recursive: true,
      // defensive: never copy local dev pollution from the fixture checkout
      filter: (source) => !/(^|[\\/])node_modules([\\/]|$)/.test(source) && !/(^|[\\/])dist([\\/]|$)/.test(source),
    });
    lockShaCommitted = sha256Of(path.join(projectRoot, "package-lock.json"));

    // The declared dependency fetch: `npm ci` reproduces exactly the committed
    // lockfile (bounded 5 min; the runner's own bounded command executor).
    const plan = await resolvePackageManagerCommand("npm", nodeExe as string);
    if (!plan.ok) {
      throw new Error(`npm resolution failed (${plan.code}): ${plan.reason}`);
    }
    npmCommand = plan.command;
    npmArgs = plan.args;
    const install = await runNodeCommand(npmCommand, [...npmArgs, "ci"], {
      cwd: projectRoot,
      timeoutMs: 300_000,
    });
    if (install.exitStatus !== 0) {
      throw new Error(
        `npm ci failed (exit ${String(install.exitStatus)}): ${tail(install.stderr || install.stdout)}`,
      );
    }
    lockShaAfterCi = sha256Of(path.join(projectRoot, "package-lock.json"));
    console.log(`[gamos-evidence] fixture package-lock.json sha256 (committed): ${lockShaCommitted}`);
    console.log(
      `[gamos-evidence] npm ci: ${install.durationMs}ms, lockfile sha256 after install: ${lockShaAfterCi}`,
    );
    if (lockShaCommitted !== lockShaAfterCi) {
      throw new Error("npm ci modified the committed lockfile — install is not reproducible");
    }
  }, 300_000);

  afterAll(async () => {
    // defensive: stop anything still tracked (a failed test may leave a runtime)
    for (const runtime of listRuntimes()) {
      if (!runtime.stopped) {
        await stopRuntime(runtime.pid);
      }
    }
    if (workspace) {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test(
    "project_inspect reports the node toolchain version, @babylonjs/core dependency, scripts, and vite config",
    async () => {
      const outcome = await projectInspect(nodeExe as string, { projectRoot }, workspace);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.node.rawVersion).toBe(discovery.rawVersion);
      expect(outcome.node.parsed?.major).toBeGreaterThanOrEqual(18);
      expect(outcome.packageManager.name).toBe("npm");
      expect(outcome.packageManager.version ?? "").toMatch(/^\d+\.\d+\.\d+$/);
      expect(outcome.package.name).toBe("babylon-fixture-app");
      expect(outcome.babylon.dependencies).toContainEqual({
        name: "@babylonjs/core",
        version: expect.stringMatching(/\^8\./),
      });
      expect(Object.keys(outcome.scripts)).toEqual(expect.arrayContaining(["dev", "build"]));
      expect(outcome.scripts.dev ?? "").toContain("vite");
      expect(outcome.scripts.build ?? "").toContain("vite build");
      expect(outcome.engines.node).toBe(">=18");
      expect(outcome.viteConfig).toBe(true);
      expect(outcome.nodeModulesPresent).toBe(true);
      console.log(
        `[gamos-evidence] inspect: node=${outcome.node.rawVersion} npm=${outcome.packageManager.version} ` +
          `babylonDeps=[${outcome.babylon.dependencies.map((dep) => `${dep.name}@${dep.version}`).join(", ")}] ` +
          `scripts=${Object.keys(outcome.scripts).join(",")} viteConfig=${outcome.viteConfig}`,
      );
    },
    120_000,
  );

  test(
    "project_inspect of a non-Babylon directory fails closed with not-a-babylon-project",
    async () => {
      const notBabylon = path.join(workspace, "not-babylon");
      await mkdir(notBabylon);
      await writeFile(
        path.join(notBabylon, "package.json"),
        JSON.stringify({ name: "plain-app", private: true, scripts: { dev: "vite" } }),
      );
      const outcome = await projectInspect(nodeExe as string, { projectRoot: notBabylon }, workspace);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe("not-a-babylon-project");
        expect(outcome.reason).toBeTruthy();
        console.log(`[gamos-evidence] negative path: ${outcome.code} — ${outcome.reason}`);
      }
    },
    60_000,
  );

  test(
    "project_build runs the declared build script and verifies the dist/index.html artifact",
    async () => {
      const outcome = await projectBuild(nodeExe as string, { projectRoot }, workspace, { timeoutMs: 300_000 });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.exitStatus).toBe(0);
      expect(outcome.script).toBe("build");
      expect(outcome.packageManager).toBe("npm");
      expect(outcome.installed).toBe(false); // setup's npm ci already provisioned node_modules
      expect(outcome.artifact.path).toBe(path.join(projectRoot, "dist", "index.html"));
      expect(existsSync(outcome.artifact.path)).toBe(true);
      expect(outcome.artifact.bytes).toBeGreaterThan(0);
      expect(outcome.artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(outcome.artifact.sha256).toBe(sha256Of(path.join(projectRoot, "dist", "index.html")));
      expect(outcome.lockfileSha256Before).toBe(lockShaAfterCi);
      expect(outcome.lockfileSha256After).toBe(lockShaAfterCi); // the build must not touch the lockfile
      expect(outcome.buildLogTail.length).toBeGreaterThan(0);
      console.log(
        `[gamos-evidence] vite build: ${outcome.durationMs}ms, dist/index.html ${outcome.artifact.bytes} bytes, sha256=${outcome.artifact.sha256}`,
      );
    },
    300_000,
  );

  test(
    "project_run starts the dev server on a free port, health-checks the real HTML, and stopRuntime frees the port",
    async () => {
      const run = await projectRun(nodeExe as string, { projectRoot }, workspace);
      expect(run.ok).toBe(true);
      if (!run.ok) return;
      expect(run.started).toBe(true);
      expect(run.script).toBe("dev");
      expect(run.packageManager).toBe("npm");
      expect(run.runtimeUrl).toBe(`http://127.0.0.1:${run.port}/`);
      expect(run.healthChecked).toBe(true);
      expect(run.htmlMount).toBe("canvas");
      expect(run.htmlSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(typeof run.pid).toBe("number");

      // independent verification outside the engine's own poller
      const response = await httpGetUrl(run.runtimeUrl);
      expect(response.status).toBe(200);
      expect(response.body).toContain("<canvas");
      expect(response.body).toContain('id="renderCanvas"');
      console.log(
        `[gamos-evidence] runtime: ${run.runtimeUrl} pid=${run.pid} script=${run.script} ` +
          `htmlSha256=${run.htmlSha256} readyIn=${run.readyMs}ms`,
      );

      const stop = await stopRuntime(run.pid);
      expect(stop.ok).toBe(true);
      if (stop.ok) {
        expect(stop.stopped).toBe(true);
        expect(stop.portFreed).toBe(true);
      }
      // the second bind on the freed port must succeed (no stale server)
      expect(await canBind(run.port)).toBe(true);
    },
    120_000,
  );

  test(
    "runNodeCommand with a tiny timeout kills the real build process tree and reports a structured timeout",
    async () => {
      const run = await runNodeCommand(npmCommand, [...npmArgs, "run", "build"], {
        cwd: projectRoot,
        timeoutMs: 50,
      });
      expect(run.timedOut).toBe(true);
      expect(run.killed).toBe(true);
      expect(run.exitStatus === 0).toBe(false);
      expect(run.spawnError).toBeNull();

      const outcome = await projectBuild(nodeExe as string, { projectRoot }, workspace, { timeoutMs: 50 });
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe("timeout");
        expect(outcome.reason).toMatch(/timeout|killed/i);
      }
    },
    120_000,
  );

  test(
    "project_run on an occupied port with strictPort fails closed with port-conflict (no silent retry)",
    async () => {
      const blocker = createNetServer();
      const conflictPort = await new Promise<number>((resolve, reject) => {
        blocker.once("error", reject);
        blocker.listen(0, "127.0.0.1", () => {
          const address = blocker.address();
          resolve(typeof address === "object" && address ? address.port : 0);
        });
      });
      try {
        const outcome = await projectRun(
          nodeExe as string,
          { projectRoot, port: conflictPort },
          workspace,
          { healthDeadlineMs: 30_000 },
        );
        expect(outcome.ok).toBe(false);
        if (!outcome.ok) {
          expect(outcome.code).toBe("port-conflict");
          expect(outcome.reason).toMatch(/already in use|conflict|strictport/i);
          console.log(`[gamos-evidence] port conflict on ${conflictPort}: ${outcome.code} — ${outcome.reason}`);
        }
      } finally {
        await new Promise<void>((resolve) => {
          blocker.close(() => resolve());
        });
      }
    },
    60_000,
  );
});
