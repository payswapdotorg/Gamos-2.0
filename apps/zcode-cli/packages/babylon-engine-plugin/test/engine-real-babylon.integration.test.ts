import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { get as httpGet } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { discoverNode } from "../src/discovery.js";
import {
  assetIntegrate,
  listRuntimes,
  projectBuild,
  projectInspect,
  projectRun,
  resolvePackageManagerCommand,
  runNodeCommand,
  stopRuntime,
} from "../src/engine.js";

const FIXTURE_DIR = fileURLToPath(new URL("./fixture/babylon-app", import.meta.url));

/** The committed real-Blender-4.1.1 GLB fixture (a cube named GamosTestCube) — the cross-engine manifest's integrity record. */
const GAMOS_CUBE_GLB = fileURLToPath(new URL("./fixture/gamos-cube.glb", import.meta.url));
const GAMOS_CUBE_GLB_SHA256 = "b8acd9cf2ce3f5e55cc0ae07566e13b2221043ff5b3e27a953905748983bd1f1";

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

/** Binary-safe HTTP GET — the staged GLB must be byte-identical over the wire (never lossily utf8-decoded). */
function httpGetBufferUrl(url: string, timeoutMs = 5_000): Promise<{ status: number; body: Buffer; byteLength: number }> {
  return new Promise((resolve, reject) => {
    const request = httpGet(url, { timeout: timeoutMs }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      });
      response.on("end", () => {
        const body = Buffer.concat(chunks);
        resolve({ status: response.statusCode ?? 0, body, byteLength: body.length });
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
        // Destroy every accepted socket before close(): the bare net server
        // holds the engine health-probe's lingering connection, and
        // server.close() waits for all connections to end — the test would
        // otherwise hang past its own timeout after a correct outcome.
        blocker.closeAllConnections?.();
        await new Promise<void>((resolve) => {
          blocker.close(() => resolve());
          setTimeout(resolve, 2_000).unref?.();
        });
      }
    },
    60_000,
  );

  test(
    "asset_integrate stages the committed Blender GLB, the build bakes the registry, and the dev server serves the asset byte-identically",
    async () => {
      // The declared dependency fetch stays reproducible with the loaders dep present.
      expect(lockShaAfterCi).toBe(lockShaCommitted);

      // The cross-engine manifest's integrity record for the committed fixture.
      expect(existsSync(GAMOS_CUBE_GLB)).toBe(true);
      const fixtureBytes = statSync(GAMOS_CUBE_GLB).size;
      const fixtureSha256 = sha256Of(GAMOS_CUBE_GLB);
      expect(fixtureSha256).toBe(GAMOS_CUBE_GLB_SHA256);

      const outcome = await assetIntegrate(
        {
          projectRoot,
          artifactPath: GAMOS_CUBE_GLB,
          expectedIntegrity: { byteLength: fixtureBytes, sha256: GAMOS_CUBE_GLB_SHA256 },
        },
        workspace,
      );
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.integrated).toBe(true);
      expect(outcome.assetName).toBe("gamos-cube"); // defaults to the artifact filename stem
      expect(outcome.stagedPath).toBe(path.join(projectRoot, "public", "assets", "gamos-cube.glb"));
      expect(outcome.bytes).toBe(fixtureBytes);
      expect(outcome.sha256).toBe(fixtureSha256);
      expect(outcome.registryEntry).toEqual({
        assetName: "gamos-cube",
        file: "gamos-cube.glb",
        sha256: fixtureSha256,
      });
      expect(outcome.registryPath).toBe(path.join(projectRoot, "src", "gamos-assets.json"));

      // Trust but verify: the staged copy hashes identical to the source artifact,
      // and the registry holds exactly the appended entry.
      expect(existsSync(outcome.stagedPath)).toBe(true);
      expect(sha256Of(outcome.stagedPath)).toBe(fixtureSha256);
      expect(JSON.parse(readFileSync(outcome.registryPath, "utf8"))).toEqual({
        schema: "gamos/babylon-assets@1",
        assets: [{ assetName: "gamos-cube", file: "gamos-cube.glb", sha256: fixtureSha256 }],
      });
      console.log(
        `[gamos-evidence] asset_integrate: staged ${outcome.stagedPath} (${outcome.bytes} bytes, ` +
          `sha256=${outcome.sha256}) registry=${outcome.registryPath}`,
      );

      // The registry is baked into the build: vite bundles the JSON import in
      // main.js and copies public/assets into the outDir.
      const build = await projectBuild(nodeExe as string, { projectRoot }, workspace, { timeoutMs: 300_000 });
      expect(build.ok).toBe(true);
      if (!build.ok) return;
      expect(build.exitStatus).toBe(0);
      const distAsset = path.join(projectRoot, "dist", "assets", "gamos-cube.glb");
      expect(existsSync(distAsset)).toBe(true);
      expect(sha256Of(distAsset)).toBe(fixtureSha256);
      console.log(
        `[gamos-evidence] baked build: dist/assets/gamos-cube.glb byte-identical ` +
          `(dist/index.html ${build.artifact.bytes} bytes, sha256=${build.artifact.sha256})`,
      );

      // The running dev server serves the staged asset byte-identically.
      const run = await projectRun(nodeExe as string, { projectRoot }, workspace);
      expect(run.ok).toBe(true);
      if (!run.ok) return;
      const response = await httpGetBufferUrl(`http://127.0.0.1:${run.port}/assets/gamos-cube.glb`);
      expect(response.status).toBe(200);
      expect(response.byteLength).toBe(fixtureBytes);
      expect(createHash("sha256").update(response.body).digest("hex")).toBe(fixtureSha256);
      console.log(
        `[gamos-evidence] runtime asset: HTTP 200 /assets/gamos-cube.glb ${response.byteLength} bytes ` +
          `byte-identical (sha256=${fixtureSha256}) on ${run.runtimeUrl}`,
      );

      const stop = await stopRuntime(run.pid);
      expect(stop.ok).toBe(true);
      if (stop.ok) {
        expect(stop.stopped).toBe(true);
        expect(stop.portFreed).toBe(true);
      }
      expect(await canBind(run.port)).toBe(true);
    },
    300_000,
  );
});
