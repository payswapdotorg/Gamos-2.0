#!/usr/bin/env node
/* eslint-disable max-lines -- M3.5 §11 evidence journey: launch orchestration + CDP client +
   input layer + 7 journey stages in one reproducible script; splitting would hide the
   evidence chain (same pattern as scripts/gamos/m1/m2-ui-journey.mjs). */
/**
 * Gamos M3 — cross-engine end-to-end UI journey (CDP-driven), final-closure
 * handoff §11 (M3.5 / M3-G5).
 *
 * Machinery derived verbatim from scripts/gamos/m2-ui-journey.mjs (CDP core,
 * input layer, permission-dialog engine, app launch, provider configuration,
 * composer submission, session-store evidence readers — the proven Phase B /
 * M1 / M2 infrastructure). The M3 stages on top of it execute the §11 journey
 * through the ORIGINAL ZCode application:
 *
 *   M3J0 app-up          — complete application launches incl. desktop renderer
 *   M3J1 onboarding      — first-run walk (login entry Skip + wizard steps)
 *   M3J2 provider        — custom provider bound to the local deterministic
 *                          endpoint via the real settings surface
 *   M3J3 plugins + plan  — the three engine plugins turned ON through the REAL
 *                          Settings → Plugins toggles; enabled state verified
 *                          on disk; the m3-capability-cli resolves the
 *                          pipeline's typed capabilities through the CENTRAL
 *                          registry AND generates the engine-aware GamePlan
 *                          (buildCrossEngineAssetPlan + parseGamePlan
 *                          validation) — §11 items 1–4 recorded as evidence
 *   M3J4 cross-engine    — THE §11 journey: real .blend workspace bootstrapped
 *                          via the plugin's REVIEWED bridge + the committed
 *                          Babylon fixture; New Task → typed capability →
 *                          PERMISSION DENIAL first (source mutation blocked,
 *                          hashes unchanged) → approved retry → real Blender
 *                          scene_modify + asset_export (GLB to staging with
 *                          manifest ingredients) → the orchestration layer
 *                          persists the gamos/asset-interchange@1 manifest
 *                          through the REAL M3.4 facility (buildExportedManifest
 *                          from the authoritative session-store tool output) →
 *                          the agent READS the manifest through the app's own
 *                          Read tool (the manifest-validate agent-tool pattern)
 *                          → babylon/asset.integrate with the manifest's
 *                          authoritative expectedIntegrity (fail-closed) →
 *                          real vite build → real dev-server run → THE ORIGINAL
 *                          ZCODE BROWSER opens the runtime URL and verifies the
 *                          INTEGRATED Blender-authored asset actually loaded
 *                          (registry-driven loader, meshes + vertices in-guest)
 *                          → project_stop cancellation → port freed
 *   M3J5 Unity negative  — the honest failure path (§11 item 14): asset_import
 *                          surfaces the structured unity-editor-unavailable
 *                          state (no licensed editor — never fabricated)
 *   M3J6 session history — the engine tool invocations + results are recorded
 *                          in the existing session store (SQLite)
 *
 * MODEL ENDPOINT (honesty model — same as M1/M2): a deterministic local
 * Anthropic-Messages endpoint (scripts/gamos/m3-local-model-server.mjs)
 * configured through the app's REAL custom-provider settings surface. The
 * APP side is fully real (provider surface, session turns, streaming parse,
 * tool-use round-trips, MCP plugin dispatch, permission gates, engine
 * execution, the manifest Read through the app's own file tool, artifact
 * evidence, session history); only the model intelligence is scripted.
 * Evidence from this journey must not claim real-LLM authorship. The engine
 * operations themselves are REAL: real Blender, real Node/Vite/Babylon,
 * honest Unity unavailability.
 *
 * Env (PHASEB_* names shared with the M1/M2 journey surface):
 *   PHASEB_MODE         dev | prod | attach (default dev; prod-http on CI)
 *   PHASEB_HOME         isolated home/data base dir (default .phaseb-m3-home;
 *                       MUST be fresh for M3J1's first-run wizard)
 *   M3_BLENDER_PATH     absolute path to a real Blender executable (>=4.1).
 *                       Required for M3J4 — no Blender means an honest stage
 *                       failure, never a mock (directive §8).
 *   M3_CAPABILITY_CLI   path to the esbuild bundle of
 *                       scripts/gamos/m3-capability-cli.ts (default /tmp/m3-capability-cli.mjs)
 *   PHASEB_STAGES       comma list (default all M3J0–M3J6)
 *   PHASEB_MAX_WAIT_MS  per-wait budget (default 240000)
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DESKTOP_DIR = join(REPO_ROOT, "packages", "desktop");

const MODE = process.env.PHASEB_MODE ?? "dev";
const CDP_PORT = Number(process.env.PHASEB_CDP_PORT ?? 9229);
const EVIDENCE_DIR = resolve(REPO_ROOT, process.env.PHASEB_EVIDENCE_DIR ?? "evidence/phase-m3/journey");
const SCREEN_DIR = join(EVIDENCE_DIR, "screenshots");
const DUMP_DIR = join(EVIDENCE_DIR, "dom-dumps");
const PHASEB_HOME = resolve(REPO_ROOT, process.env.PHASEB_HOME ?? ".phaseb-m3-home");
// With HOME/USERPROFILE/ZCODE_DATA_BASE_DIR all redirected to PHASEB_HOME the app's
// default conversation workspace is $PHASEB_HOME/.zcode/workspace/default
// (packages/services/src/paths.ts getConversationWorkspaceDir) — same layout the
// upstream E2E suite uses for its isolated home. The engine MCP servers get this
// as their ZCODE_PROJECT_DIR cwd, so every engine path the journey references
// lives INSIDE this workspace (the plugins' path-safety rules require it).
const TASK_WORKSPACE = resolve(
  process.env.PHASEB_TASK_WORKSPACE ?? join(PHASEB_HOME, ".zcode", "workspace", "default"),
);
const ZCODE_DATA_ROOT = join(PHASEB_HOME, ".zcode");
const PROVIDER_CONFIG_FILE = join(ZCODE_DATA_ROOT, "v2", "provider_config.json");
// Local deterministic endpoint (see the header honesty note). The journey spawns
// the endpoint itself and configures a CUSTOM provider against it through the
// real settings surface. The engine tools it calls are matched against the tool
// list the app actually offers — no fabricated tool names.
const LOCAL_MODEL = /^(1|true|yes)$/i.test(process.env.PHASEB_LOCAL_MODEL ?? "1");
const LOCAL_MODEL_PORT = Number(process.env.M3_LOCAL_MODEL_PORT ?? 4374);
const LOCAL_MODEL_URL = `http://127.0.0.1:${LOCAL_MODEL_PORT}`;
// Clearly-fake marker key: the endpoint performs no authentication.
const LOCAL_MODEL_KEY = "gamos-local-deterministic-endpoint";
const MODEL_ID = process.env.PHASEB_MODEL ?? (LOCAL_MODEL ? "gamos-m3-deterministic-model" : "nvidia/nemotron-3-ultra-550b-a55b:free");
const MAX_WAIT = Number(process.env.PHASEB_MAX_WAIT_MS ?? 240000);
const STAGES = (process.env.PHASEB_STAGES ?? "M3J0,M3J1,M3J2,M3J3,M3J4,M3J5,M3J6").split(",").map((s) => s.trim());
const MANDATORY_STAGES = ["M3J0", "M3J1", "M3J2", "M3J3", "M3J4", "M3J5", "M3J6"];
const APP_NAME = process.env.PHASEB_APP_NAME ?? "GamosM3Journey";
const RUN_TOKEN = `GAMOS-M3-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
// Staged, versioned dev app dir (mirrors the E2E staging pattern). Not a source
// modification — build output staging only.
const STAGED_APP_DIR = resolve(REPO_ROOT, process.env.PHASEB_STAGED_APP_DIR ?? ".phaseb-m3-app");
const APP_VERSION = (() => {
  try { return JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).version ?? "0.0.0"; }
  catch { return "0.0.0"; }
})();
// Real Blender executable for the M3J4 cross-engine leg (directive §8: CI
// provisions the engine with a recorded tarball sha256; the journey never
// installs engines).
const BLENDER_PATH = process.env.M3_BLENDER_PATH ?? process.env.BLENDER_PATH ?? "";
// The committed fixture sources the journey stages into the workspace.
const BLENDER_BRIDGE_DIR = join(REPO_ROOT, "apps", "zcode-cli", "packages", "blender-engine-plugin", "src", "bridge");
const BABYLON_FIXTURE_DIR = join(REPO_ROOT, "apps", "zcode-cli", "packages", "babylon-engine-plugin", "test", "fixture", "babylon-app");
const UNITY_FIXTURE_DIR = join(REPO_ROOT, "apps", "zcode-cli", "packages", "unity-engine-plugin", "test", "fixture", "unity-project");

function stageDesktopOut() {
  const outDir = join(DESKTOP_DIR, "out");
  if (!existsSync(join(outDir, "main", "index.js"))) {
    throw new Error(`desktop main bundle missing (${outDir}/main/index.js) — build the desktop process layer first`);
  }
  rmSync(STAGED_APP_DIR, { recursive: true, force: true });
  mkdirSync(STAGED_APP_DIR, { recursive: true });
  for (const entry of ["main", "host", "preload", "scheduler", "plugin-sandbox", "metadata", "renderer"]) {
    if (existsSync(join(outDir, entry))) {
      cpSync(join(outDir, entry), join(STAGED_APP_DIR, entry), { recursive: true });
    }
  }
  writeFileSync(join(STAGED_APP_DIR, "package.json"), JSON.stringify({
    name: "zcode",
    version: APP_VERSION,
    main: "main/index.js",
    private: true,
  }, null, 2));
  log(`staged versioned dev app dir: ${STAGED_APP_DIR} (version ${APP_VERSION})`);
}

/**
 * Stage the three engine-plugin packages next to the DEV agent bundle
 * (packages/desktop/bundled-agents/<platform>/glm/packages/<name>) so the dev
 * agent's filesystem plugin seed resolves them via entrypointDir +
 * rootCandidates[0] — exactly the node-repl-host dev self-seed precedent
 * (packages/desktop/scripts/stage-agent-bundle.mjs: "与生产包布局对齐：把源码包
 * stage 到 glm/packages/<name>，dev agent 的 entrypointDir + rootCandidates[0]
 * 即可命中"). Build-output staging only (bundled-agents is a gitignored build
 * dir) — no repository source is mutated; the same class of staging as
 * stageDesktopOut. Requires the plugin dists to have been built by
 * scripts/build-desktop-agent-cli.mjs (the declared-mcpServers build rule).
 */
const ENGINE_PLUGIN_PACKAGE_ENTRIES = ["dist", ".zcode-plugin", "package.json", "README.md"];
function stageEnginePluginsForDevAgent() {
  const platformKey = `${process.platform}-${process.arch}`;
  const glmDir = join(DESKTOP_DIR, "bundled-agents", platformKey, "glm");
  const staged = [];
  for (const name of ["unity-engine-plugin", "blender-engine-plugin", "babylon-engine-plugin"]) {
    const source = join(REPO_ROOT, "apps", "zcode-cli", "packages", name);
    const target = join(glmDir, "packages", name);
    if (!existsSync(join(source, "dist", "mcp", "server.js"))) {
      throw new Error(`engine plugin runtime missing: ${join(source, "dist", "mcp", "server.js")} — run scripts/build-desktop-agent-cli.mjs first (the declared-mcpServers build rule)`);
    }
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    for (const entry of ENGINE_PLUGIN_PACKAGE_ENTRIES) {
      const from = join(source, entry);
      if (existsSync(from)) cpSync(from, join(target, entry), { recursive: true });
    }
    staged.push({ plugin: name, stagedPath: join("bundled-agents", platformKey, "glm", "packages", name), runtime: "dist/mcp/server.js" });
  }
  log(`staged engine plugin packages for the dev agent self-seed: ${staged.map((s) => s.plugin).join(", ")}`);
  return staged;
}

const RUN_TS = new Date().toISOString();
mkdirSync(EVIDENCE_DIR, { recursive: true });
mkdirSync(SCREEN_DIR, { recursive: true });
mkdirSync(DUMP_DIR, { recursive: true });
mkdirSync(PHASEB_HOME, { recursive: true });
mkdirSync(TASK_WORKSPACE, { recursive: true });

const LOG_PATH = join(EVIDENCE_DIR, "journey-run.log");
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(" ")}`;
  console.log(line);
  appendFileSync(LOG_PATH, line + "\n");
}

const evidence = {
  script: "scripts/gamos/m2-ui-journey.mjs",
  revision: 1,
  derived_from: "scripts/gamos/m1-ui-journey.mjs (CDP core + input layer + permission engine + launch + provider/composer machinery reused verbatim)",
  run_token: RUN_TOKEN,
  mode: MODE,
  started_at: RUN_TS,
  environment: {
    node: process.version,
    platform: process.platform,
    cdp_port: CDP_PORT,
    model: MODEL_ID,
    provider: "custom (local deterministic anthropic-messages endpoint)",
    local_model_mode: true,
    local_model_endpoint: LOCAL_MODEL_URL,
    local_model_transcript: "m3-local-model-transcript.jsonl (in the evidence dir)",
    local_model_disclosure: "deterministic scripted endpoint standing in for the external LLM — evidence must not claim real-LLM authorship; the ENGINE operations are real",
    blender_path: BLENDER_PATH || null,
    app_home: PHASEB_HOME,
    task_workspace: TASK_WORKSPACE,
    provider_config_file: PROVIDER_CONFIG_FILE,
    input_simulation: "CDP Input.dispatchMouseEvent / Input.insertText / Input.dispatchKeyEvent (no synthetic DOM events)",
  },
  stages: {},
  commands: [],
  failures: [],
};

// The canonical stage id (M3J0–M3J6) the runner is currently executing. Stage
// functions keep recording under their historical internal ids (S0/S1/S2);
// remapping every record onto the canonical id keeps the machine-readable
// verdict aligned with MANDATORY_STAGES (same lesson as M1 run 42121929897).
let activeCanonicalStageId = null;

function recordStage(id, status, detail) {
  const key = activeCanonicalStageId ?? id;
  evidence.stages[key] = { status, detail, at: new Date().toISOString() };
  log(
    `STAGE ${key}${key === id ? "" : ` (via internal id ${id})`}: ${status} — ${
      typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 400)
    }`,
  );
}

function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/* ------------------------------------------------------------------ */
/* Minimal CDP client over the native WebSocket (M1 machinery, verbatim) */
/* ------------------------------------------------------------------ */
class CDPSession {
  constructor(wsUrl, label) {
    this.wsUrl = wsUrl;
    this.label = label;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = [];
    this.closed = false;
  }
  async open() {
    this.ws = new WebSocket(this.wsUrl);
    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${this.label}: ${msg.error.message}`));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const l of this.listeners) l(msg);
      }
    };
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP websocket open timeout")), 15000);
      this.ws.onopen = () => { clearTimeout(timer); resolve(); };
      this.ws.onerror = (e) => { clearTimeout(timer); reject(new Error(`CDP websocket error ${e.message ?? ""}`)); };
    });
    this.ws.onclose = () => { this.closed = true; };
    return this;
  }
  send(method, params = {}) {
    if (this.closed) return Promise.reject(new Error(`${this.label}: session closed`));
    const id = this.nextId++;
    const p = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      // The renderer main thread can be busy executing the module graph for minutes
      // on slow machines; a 60s budget misreads that as failure.
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`${this.label}: timeout waiting ${method}`));
        }
      }, Number(process.env.PHASEB_CDP_TIMEOUT_MS ?? 180000));
    });
    this.ws.send(JSON.stringify({ id, method, params }));
    return p;
  }
  on(fn) { this.listeners.push(fn); }
  close() { try { this.ws.close(); } catch {} }
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

async function cdpTargets() {
  return fetchJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
}

async function waitFor(fn, { timeout = MAX_WAIT, interval = 500, what = "condition" } = {}) {
  const start = Date.now();
  let lastErr;
  while (Date.now() - start < timeout) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`timeout waiting for ${what}${lastErr ? ` (last: ${lastErr.message})` : ""}`);
}

async function mainPageTarget() {
  const list = await cdpTargets();
  const pages = list.filter((t) => t.type === "page" && !/devtools/i.test(t.url));
  // The app's main window loads the bundled renderer (file:// or vite dev URL).
  const app = pages.find((t) => /index\.html|localhost:5174|127\.0\.0\.1:5174/.test(t.url)) ?? pages[0];
  if (!app) throw new Error(`no page target on CDP ${CDP_PORT}: ${JSON.stringify(list).slice(0, 400)}`);
  return app;
}

/* ------------------------------------------------------------------ */
/* Page evaluation helpers                                             */
/* ------------------------------------------------------------------ */
let page; // CDPSession bound to the main window target
const rendererConsole = [];
const rendererRequests = { requested: 0, failed: [] };

async function attachCdp() {
  await waitFor(async () => {
    try { await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/version`); return true; } catch { return false; }
  }, { what: `CDP endpoint :${CDP_PORT}`, timeout: MAX_WAIT });
  const target = await waitFor(async () => {
    try { return await mainPageTarget(); } catch { return false; }
  }, { what: "main window target" });
  page = await new CDPSession(target.webSocketDebuggerUrl, "page").open();
  await page.send("Runtime.enable");
  await page.send("Page.enable");
  await page.send("Log.enable").catch(() => {});
  await page.send("Network.enable").catch(() => {});
  page.on((msg) => {
    if (msg.method === "Runtime.consoleAPICalled") {
      rendererConsole.push({ t: Date.now(), type: msg.params.type, text: (msg.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300) });
    } else if (msg.method === "Runtime.exceptionThrown") {
      rendererConsole.push({ t: Date.now(), type: "exception", text: (msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text ?? "").slice(0, 500) });
    } else if (msg.method === "Log.entryAdded") {
      rendererConsole.push({ t: Date.now(), type: `log:${msg.params.entry.level}`, text: `${msg.params.entry.source}: ${msg.params.entry.text}`.slice(0, 300) });
    } else if (msg.method === "Network.requestWillBeSent") {
      rendererRequests.requested++;
    } else if (msg.method === "Network.loadingFailed") {
      rendererRequests.failed.push(`${msg.params.errorText} blocked=${msg.params.blocked ?? false}`);
    }
  });
  log(`CDP attached: ${target.title} (${target.url.slice(0, 120)})`);
  return target;
}

async function evalJs(expression, { awaitPromise = false } = {}) {
  const r = await page.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise,
  });
  if (r.exceptionDetails) {
    throw new Error(`page eval failed: ${JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails).slice(0, 500)}`);
  }
  return r.result?.value;
}

/**
 * Integrity guard for embedded page-JS (run 42056174710 lesson): a finder string
 * with a SYNTAX error throws inside evalJs on every poll, and caller-side
 * `.catch(() => null)` then silently maps that to "element not found" — the
 * stage reads as a missing surface while the real UI sits open (screenshot
 * proof in that run's S2). Every non-trivial finder is therefore validated at
 * DEFINITION time: a malformed finder must fail LOUDLY, before any stage runs.
 */
function assertPageJs(name, js) {
  try {
    new Function(`return (${js});`);
    return js;
  } catch (e) {
    throw new Error(`embedded page-JS "${name}" does not parse — refusing to run (silent not-found corruption): ${e.message}`);
  }
}

async function screenshot(name) {
  const r = await page.send("Page.captureScreenshot", { format: "png" });
  const path = join(SCREEN_DIR, `${name}.png`);
  writeFileSync(path, Buffer.from(r.data, "base64"));
  evidence.commands.push({ screenshot: name, path: `evidence/phase-m3/journey/screenshots/${name}.png`, at: new Date().toISOString() });
  log(`screenshot: ${name}.png (${Math.round(r.data.length / 1024)}KB)`);
  return path;
}

async function dumpDom(name) {
  const info = await evalJs(`(() => {
    const tids = Array.from(document.querySelectorAll('[data-testid]')).slice(0, 240).map(e => e.dataset.testid);
    const buttons = Array.from(document.querySelectorAll('button')).slice(0, 48).map(b => ({ text: (b.innerText || '').trim().slice(0, 60), tid: b.dataset.testid ?? null, disabled: b.disabled }));
    return { url: location.href, title: document.title, readyState: document.readyState, testIds: tids, buttons };
  })()`);
  writeFileSync(join(DUMP_DIR, `${name}.json`), JSON.stringify(info, null, 1));
  log(`dom-dump: ${name}.json — title="${info?.title}" testids=${info?.testIds?.length ?? 0}`);
  return info;
}

/* ------------------------------------------------------------------ */
/* CDP input layer — REAL user input only (§2.H)                       */
/*                                                                     */
/* Page-side JS only LOCATES elements (scrollIntoView + rect + label). */
/* Clicks/typing are dispatched through the Input domain so Chromium   */
/* performs real hit-testing, focus routing and event synthesis.       */
/* ------------------------------------------------------------------ */
async function pressKey(key, { code, keyCode } = {}) {
  const common = { key, code: code ?? key, windowsVirtualKeyCode: keyCode ?? keyCodeFor(key), nativeVirtualKeyCode: keyCode ?? keyCodeFor(key) };
  // Enter MUST carry text:"\r" so Chromium performs the keypress/char DEFAULT
  // action — implicit FORM SUBMISSION (the browser pane's address bar) depends
  // on it; a bare keyDown only reaches keydown listeners (xterm intercepts those
  // directly, so S5's terminal is unaffected). Run 42056174710 S7 evidence: the
  // address showed https://example.com but navigation never committed and the
  // webview never mounted (empty-state placeholder in the failure screenshot).
  if (key === "Enter") common.text = "\r";
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", ...common });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", ...common });
}
function keyCodeFor(key) {
  return { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39 }[key] ?? 0;
}
async function typeIntoFocused(text) {
  await page.send("Input.insertText", { text });
}

async function cdpClickRect(rect, { settleMs = 80 } = {}) {
  if (!rect || !(rect.w > 0 && rect.h > 0)) throw new Error(`cdpClickRect: invalid rect ${JSON.stringify(rect)}`);
  await new Promise((r) => setTimeout(r, settleMs));
  const x = Math.round(rect.x + rect.w / 2);
  const y = Math.round(rect.y + rect.h / 2);
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  return { x, y };
}

// finder: JS expression (IIFE or arrow) that returns an element; evaluated with
// scrollIntoView + rect measurement so the returned rect is post-scroll.
function rectOf(finderJs) {
  return evalJs(`(() => {
    const el = (${finderJs});
    if (!el || !el.offsetParent && el.getBoundingClientRect().width === 0) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, text: (el.innerText || el.value || '').trim().slice(0, 60), tid: el.dataset?.testid ?? null };
  })()`, { awaitPromise: false });
}

async function clickTid(tid, { timeout = 30000, visible = true } = {}) {
  const rect = await waitFor(async () => {
    const r = await rectOf(`document.querySelector(${JSON.stringify(`[data-testid="${tid}"]`)})`).catch(() => null);
    return r && (!visible || (r.w > 0 && r.h > 0)) ? r : false;
  }, { what: `testid ${tid} (clickable)`, timeout, interval: 400 });
  const clicked = await cdpClickRect(rect);
  log(`cdp-click [${tid}] "${rect.text}" at ${clicked.x},${clicked.y}`);
  return true;
}

async function clickButtonByText(textOrRegex, { timeout = 20000, scope = "document", exact = false } = {}) {
  const pattern = typeof textOrRegex === "string" ? escapeRegExp(textOrRegex) : textOrRegex.source;
  const flags = typeof textOrRegex === "string" ? "i" : textOrRegex.flags;
  const finder = `(() => {
    const re = ${JSON.stringify(pattern)};
    const flags = ${JSON.stringify(flags)};
    const rx = new RegExp(re, flags);
    const els = Array.from(${scope}.querySelectorAll('button, [role="button"], [role="option"], [role="menuitem"]'));
    const el = els.find(b => { const t = (b.innerText || b.textContent || '').trim(); return ${exact ? "t === " + JSON.stringify(typeof textOrRegex === "string" ? textOrRegex : textOrRegex.source) : "rx.test(t)"}; });
    return el ?? null;
  })()`;
  const rect = await waitFor(async () => {
    const r = await rectOf(finder).catch(() => null);
    return r && r.w > 0 && r.h > 0 ? r : false;
  }, { what: `button "${String(textOrRegex)}" (clickable)`, timeout, interval: 400 });
  const clicked = await cdpClickRect(rect);
  log(`cdp-click [text] "${rect.text}" at ${clicked.x},${clicked.y}`);
  return rect.text;
}
function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

async function waitForTid(tid, { timeout = 30000, visible = true } = {}) {
  await waitFor(
    () => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(`[data-testid="${tid}"]`)}); if (!e) return false; const r = e.getBoundingClientRect(); return ${visible ? "r.width > 0 && r.height > 0" : "true"}; })()`),
    { what: `testid ${tid}`, timeout, interval: 400 },
  );
  return true;
}

async function hasTid(tid) {
  return Boolean(await evalJs(`Boolean(document.querySelector(${JSON.stringify(`[data-testid="${tid}"]`)}))`));
}

async function tidText(tid) {
  return (await evalJs(`(document.querySelector(${JSON.stringify(`[data-testid="${tid}"]`)})?.innerText ?? '').slice(0, 400)`)) ?? "";
}

async function tidAttr(tid, attr) {
  return (await evalJs(`document.querySelector(${JSON.stringify(`[data-testid="${tid}"]`)})?.getAttribute(${JSON.stringify(attr)}) ?? null`));
}

/* Focus a text input via a REAL CDP click, then type via Input.insertText. */
async function clickAndType(tid, text, { timeout = 20000, clearFirst = false } = {}) {
  await waitForTid(tid, { timeout });
  const rect = await rectOf(`document.querySelector(${JSON.stringify(`[data-testid="${tid}"]`)})`);
  if (!rect) throw new Error(`input not clickable: ${tid}`);
  await cdpClickRect(rect);
  await new Promise((r) => setTimeout(r, 150));
  if (clearFirst) {
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2 });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2 });
    await pressKey("Backspace");
    await new Promise((r) => setTimeout(r, 120));
  }
  await typeIntoFocused(text);
  await new Promise((r) => setTimeout(r, 250));
  return true;
}

/* ------------------------------------------------------------------ */
/* Permission dialog engine (the REAL Ask-Before-Changes surface)      */
/* Matches the upstream E2E detection contract: a role=listbox with    */
/* aria-label "Permission required"/"需要权限", role=option buttons    */
/* carrying data-permission-option-kind, and a Confirm button.         */
/* ------------------------------------------------------------------ */
const PERMISSION_DIALOG_JS = assertPageJs("permission dialog reader", `(() => {
  const normalize = (v) => (v ?? '').replace(/\\s+/g, ' ').trim();
  const listbox = Array.from(document.querySelectorAll('[role="listbox"]')).find(el => {
    const label = normalize(el.getAttribute('aria-label'));
    return label === 'Permission required' || label === '需要权限';
  });
  if (!listbox) return null;
  const options = Array.from(listbox.querySelectorAll('button[role="option"]')).map(b => {
    const r = b.getBoundingClientRect();
    return { kind: b.dataset.permissionOptionKind ?? null, text: (b.innerText || '').trim().slice(0, 80), selected: b.getAttribute('aria-selected') === 'true', rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
  });
  const confirm = document.querySelector('button[aria-label="Confirm"], button[aria-label="确认"]');
  const confirmRect = confirm ? (() => { const r = confirm.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })() : null;
  const text = (listbox.closest('[role="dialog"], .fixed, body')?.innerText ?? listbox.innerText ?? '').slice(0, 900);
  return { options, confirmDisabled: confirm ? confirm.disabled : null, confirmRect, text };
})()`);

async function readPermissionDialog() {
  return evalJs(PERMISSION_DIALOG_JS).catch(() => null);
}

async function waitForPermissionDialog({ timeout = Math.min(MAX_WAIT, 180000) } = {}) {
  return waitFor(readPermissionDialog, { what: "permission dialog (role=listbox 'Permission required')", timeout, interval: 700 });
}

/**
 * Respond to the open permission dialog by clicking the option matching
 * `kindPrefix` (allowOnce / rejectOnce / …) and then the Confirm button —
 * both via real CDP clicks. Retries until the dialog is dismissed.
 */
async function respondPermission(kindPrefix, { maxAttempts = 4 } = {}) {
  let dialog = await readPermissionDialog();
  if (!dialog) throw new Error("respondPermission: no permission dialog is open");
  const surface = {
    aria_label: "Permission required",
    options: dialog.options.map((o) => ({ kind: o.kind, text: o.text })),
    dialog_text_excerpt: dialog.text.slice(0, 300),
  };
  let confirmedSelection = null; // evidence: the option verified selected at Confirm time
  for (let attempt = 1; attempt <= maxAttempts && dialog; attempt++) {
    const target =
      dialog.options.find((o) => (o.kind ?? "").startsWith(kindPrefix) && o.rect.w > 0) ??
      dialog.options.find((o) => (o.kind ?? "").startsWith(kindPrefix)) ??
      (kindPrefix.startsWith("reject") ? dialog.options.find((o) => (o.kind ?? "").startsWith("reject")) ?? dialog.options[dialog.options.length - 1] : dialog.options[0]);
    if (!target) throw new Error(`respondPermission: no options in dialog: ${JSON.stringify(dialog.options.map((o) => o.kind))}`);
    // Click 1 — on an UNSELECTED row this only SELECTS it (PermissionDialog.tsx:
    // onClick → setSelectedIndex; a second click / Confirm responds). If the row
    // was already selected this responds DIRECTLY and the dialog dismisses.
    await cdpClickRect(target.rect);
    await new Promise((r) => setTimeout(r, 300));
    // SELECTION VERIFICATION before Confirm (run 42068291128 lesson): Confirm
    // submits orderedOptions[selectedIndex] and the DEFAULT selection is
    // "Allow" (useState(0)) — "Full access" (option 3) grants no-further-
    // confirmation. If our click missed the row (stale/shifted rect) or the
    // React state had not committed, a blind Confirm submitted the wrong option
    // and the rejected modification went through. The target option must show
    // aria-selected="true" (re-read, re-click up to 3×) BEFORE Confirm fires.
    let selectionVerified = false;
    for (let verifyTry = 0; verifyTry < 3 && !selectionVerified; verifyTry++) {
      const reread = await readPermissionDialog();
      if (!reread) {
        // Dialog already gone — the click responded directly (already-selected
        // double-click path). Nothing to confirm.
        selectionVerified = true;
        dialog = null;
        break;
      }
      const targetOption = reread.options.find((o) => (o.kind ?? "") === (target.kind ?? ""));
      if (targetOption?.selected) {
        selectionVerified = true;
        confirmedSelection = { kind: targetOption.kind, verified_selected: true, at_attempt: attempt, text: (targetOption.text ?? "").slice(0, 80) };
        dialog = reread; // fresh rects for the Confirm click
        break;
      }
      log(`respondPermission(${kindPrefix}): option not selected yet (attempt ${attempt}, verify ${verifyTry + 1}: selected=${reread.options.map((o) => (o.selected ? "*" : "") + (o.kind ?? "?")).join(",")}) — re-clicking the row`);
      const reRow = reread.options.find((o) => (o.kind ?? "") === (target.kind ?? ""));
      if (reRow?.rect?.w > 0) await cdpClickRect(reRow.rect);
      await new Promise((r) => setTimeout(r, 300));
    }
    if (!selectionVerified) throw new Error(`respondPermission(${kindPrefix}): could not verify the option selection (aria-selected) before Confirm — refusing to click Confirm on an unverified selection`);
    if (dialog?.confirmRect) {
      await cdpClickRect(dialog.confirmRect);
      await new Promise((r) => setTimeout(r, 400));
    }
    dialog = await readPermissionDialog();
  }
  const dismissed = !(await readPermissionDialog());
  if (!dismissed) throw new Error(`respondPermission(${kindPrefix}): dialog still open after ${maxAttempts} attempts`);
  return { surface, dismissed, confirmedSelection };
}

/* ------------------------------------------------------------------ */
/* App launch                                                          */
/* ------------------------------------------------------------------ */
const children = [];
let xvfbChild = null;

async function ensureDisplay() {
  const display = process.env.DISPLAY ?? ":99";
  const displayOk = await new Promise((r) => {
    const net = import("node:net");
    net.then(({ connect }) => {
      const host = display.startsWith("unix:") ? "/tmp/.X11-unix/X" + display.replace(/[^\d]/g, "") : `/tmp/.X11-unix/X${display.replace(":", "")}`;
      const sock = connect(host, () => { sock.destroy(); r(true); });
      sock.on("error", () => r(false));
    });
  });
  if (displayOk) { process.env.DISPLAY = display; return display; }
  const xvfbBin = process.env.XVFB_BIN ?? "Xvfb";
  xvfbChild = spawnChild("xvfb", xvfbBin, [display, "-screen", "0", "1680x1050x24", "-nolisten", "tcp"], { stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((r) => setTimeout(r, 1500));
  process.env.DISPLAY = display;
  log(`Xvfb started on ${display}`);
  return display;
}
function spawnChild(name, command, args, opts) {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
  const out = [];
  const record = (chunk) => {
    const text = chunk.toString();
    out.push(text);
    if (out.join("").length > 40000) out.splice(0, out.length / 2);
    for (const line of text.split("\n")) if (line.trim()) log(`[${name}] ${line.slice(0, 300)}`);
  };
  child.stdout.on("data", record);
  child.stderr.on("data", record);
  child.lastOutput = () => out.join("");
  children.push(child);
  return child;
}

async function probeHttp(url) {
  return new Promise((r) => {
    const req = httpRequest(url, { method: "HEAD", timeout: 1500 }, (res) => { res.resume(); r(true); });
    req.on("timeout", () => { req.destroy(); r(false); });
    req.on("error", () => r(false));
    req.end();
  });
}

let _viteChild = null;
let _electronChild = null;

// Read-only built-in provider baseline injected into the staged app, exactly the
// upstream E2E pattern (packages/desktop/wdio.conf.ts:246-253, 4592-4593): the
// staged Electron app only carries main/host/renderer products and no repo-level
// config/provider; if the Host derives the bundled config from app.getAppPath(),
// the resolved path lands two levels above the staged dir (outside the repo),
// every model/provider view then fails with "Bundled 与 Active ZCode Built-in
// Release 均不可用", and S2+ cascade-fail (CI run 41987983424 evidence). The
// env override is the upstream-sanctioned way to point the app at the same
// read-only baseline file the production build embeds.
const ZCODE_BUILTIN_PROVIDER_CONFIG_BASELINE = join(
  REPO_ROOT, "config", "provider", "zcode-builtin.json",
);

// Upstream-isolation env (packages/desktop/wdio.conf.ts): HOME, USERPROFILE,
// ZCODE_DATA_BASE_DIR and ZCODE_DESKTOP_HOME_DIR all point at PHASEB_HOME.
function electronEnv(extra = {}) {
  return {
    ...process.env,
    HOME: PHASEB_HOME,
    USERPROFILE: PHASEB_HOME,
    ZCODE_DATA_BASE_DIR: PHASEB_HOME,
    ZCODE_DESKTOP_HOME_DIR: PHASEB_HOME,
    ZCODE_DESKTOP_APPLICATION_NAME: APP_NAME,
    ZCODE_DESKTOP_USER_DATA_DIR: join(PHASEB_HOME, "user-data"),
    ZCODE_DESKTOP_SESSION_DATA_DIR: join(PHASEB_HOME, "user-data", "session"),
    ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: ZCODE_BUILTIN_PROVIDER_CONFIG_BASELINE,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
    ...extra,
  };
}

async function launchDev() {
  // 1. vite dev renderer (port 5174)
  _viteChild = spawnChild("vite", process.execPath, [
    join(REPO_ROOT, "node_modules", "vite", "bin", "vite.js"), "dev", "--port", "5174", "--strictPort",
  ], { cwd: DESKTOP_DIR });
  const viteUrls = ["http://localhost:5174", "http://127.0.0.1:5174", "http://[::1]:5174"];
  const viteUrl = await waitFor(async () => {
    for (const url of viteUrls) {
      if (await probeHttp(url).catch(() => false)) return url;
    }
    return false;
  }, { what: "vite dev renderer", timeout: 120000 });
  log(`vite dev renderer ready on ${viteUrl}`);
  evidence.commands.push({ cmd: "vite dev --port 5174 (renderer, packages/desktop)", at: new Date().toISOString() });

  // 2. Electron dev app (staged, versioned out/ copy; renderer = vite dev server)
  const electronBin = join(REPO_ROOT, "node_modules", ".bin", "electron");
  _electronChild = spawnChild("electron", electronBin, [STAGED_APP_DIR, "--no-sandbox", "--disable-gpu"], {
    cwd: DESKTOP_DIR, env: electronEnv({ ELECTRON_RENDERER_URL: viteUrl }),
  });
  evidence.commands.push({
    cmd: `electron ${STAGED_APP_DIR} --no-sandbox --disable-gpu (ELECTRON_RENDERER_URL=${viteUrl}; HOME=ZCODE_DATA_BASE_DIR=${PHASEB_HOME})`,
    at: new Date().toISOString(),
  });
}

async function launchProd() {
  const rendererIndex = join(STAGED_APP_DIR, "renderer", "index.html");
  if (!existsSync(rendererIndex)) {
    throw new Error(`production renderer missing: ${rendererIndex} — run the desktop production build first`);
  }
  const electronBin = join(REPO_ROOT, "node_modules", ".bin", "electron");
  // --enable-unsafe-swiftshader: software WebGL for headless/Xvfb environments
  // (run-14 lesson: the Babylon runtime needs a WebGL context; without the flag
  // Chromium returns null under Xvfb — verified: WEBGL-NULL vs WEBGL-OK with
  // the flag. A no-op on real-GPU CI runners).
  _electronChild = spawnChild("electron", electronBin, [STAGED_APP_DIR, "--no-sandbox", "--enable-unsafe-swiftshader"], {
    cwd: DESKTOP_DIR, env: electronEnv({ NODE_ENV: "production" }),
  });
  evidence.commands.push({ cmd: `electron ${STAGED_APP_DIR} --no-sandbox --enable-unsafe-swiftshader (production renderer; HOME=ZCODE_DATA_BASE_DIR=${PHASEB_HOME})`, at: new Date().toISOString() });
}

/* ------------------------------------------------------------------ */
/* prod-http mode: the SAME prebuilt production renderer bundle, served */
/* over a localhost static HTTP server instead of file://.             */
/*                                                                     */
/* WHY (sandbox lesson, 2026-11-07): on this 2-core/4GB sandbox the    */
/* Chromium network service throttles the file:// protocol's parallel  */
/* request fan-out — ~91% of the renderer's ~319 asset requests fail   */
/* with net::ERR_FAILED per load (reproduced with a MINIMAL Electron   */
/* BrowserWindow loading the identical index.html, so it is            */
/* environment-level, not app-level; GH-hosted CI runners with bigger  */
/* resources load the same bundle over file:// without the throttle).  */
/* The app's own unpackaged renderer mechanism (ELECTRON_RENDERER_URL) */
/* is the sanctioned way to point it at an http origin: the identical  */
/* staged production bundle is served byte-for-byte from               */
/* STAGED_APP_DIR/renderer; only the URL origin changes. Every UI      */
/* interaction, engine operation and MCP dispatch in the journey is    */
/* unaffected. The mode is recorded honestly in the evidence           */
/* environment block; CI runs PHASEB_MODE=prod (file://) on runners   */
/* where the throttle does not occur.                                  */
/* ------------------------------------------------------------------ */
let _rendererServer = null;

const RENDERER_MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

function startRendererStaticServer(rootDir, port) {
  const server = createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
    let relative = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
    relative = normalize(relative).replace(/^(\.\.[/\\])+/, "");
    const filePath = join(rootDir, relative);
    if (!filePath.startsWith(rootDir + sep) && filePath !== rootDir) {
      res.writeHead(403); res.end("forbidden"); return;
    }
    let st;
    try { st = statSync(filePath); } catch { st = null; }
    if (!st || !st.isFile()) { res.writeHead(404, { "content-type": "text/plain" }); res.end("not found"); return; }
    const headers = { "content-type": RENDERER_MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream", "content-length": st.size, "cache-control": "no-store" };
    res.writeHead(200, headers);
    createReadStream(filePath).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

async function launchProdHttp() {
  const rendererIndex = join(STAGED_APP_DIR, "renderer", "index.html");
  if (!existsSync(rendererIndex)) {
    throw new Error(`production renderer missing: ${rendererIndex} — run the desktop production build first`);
  }
  const port = Number(process.env.PHASEB_RENDERER_HTTP_PORT ?? 5174);
  _rendererServer = await startRendererStaticServer(join(STAGED_APP_DIR, "renderer"), port);
  const base = `http://127.0.0.1:${port}`;
  await waitFor(() => probeHttp(`${base}/index.html`).catch(() => false), { what: `renderer static server ${base}`, timeout: 30000 });
  log(`renderer static server ready: ${base} (serving the staged PRODUCTION bundle; file:// throttle workaround — see the launchProdHttp docblock)`);
  evidence.environment.renderer_origin = `${base} (prod-http mode: identical staged production bundle served over localhost http — the sandbox's Chromium file:// request throttle breaks the file:// load; CI uses file:// prod mode)`;
  const electronBin = join(REPO_ROOT, "node_modules", ".bin", "electron");
  // --enable-unsafe-swiftshader: software WebGL for headless/Xvfb environments
  // (see launchProd's comment — the Babylon runtime needs a working WebGL context).
  _electronChild = spawnChild("electron", electronBin, [STAGED_APP_DIR, "--no-sandbox", "--enable-unsafe-swiftshader"], {
    cwd: DESKTOP_DIR, env: electronEnv({ NODE_ENV: "production", ELECTRON_RENDERER_URL: base }),
  });
  evidence.commands.push({ cmd: `electron ${STAGED_APP_DIR} --no-sandbox --enable-unsafe-swiftshader (prod-http renderer at ${base}; HOME=ZCODE_DATA_BASE_DIR=${PHASEB_HOME})`, at: new Date().toISOString() });
}

async function stopApp() {
  for (const child of children) {
    try { child.kill("SIGTERM"); } catch {}
  }
  await new Promise((r) => setTimeout(r, 1500));
  for (const child of children) {
    try { child.kill("SIGKILL"); } catch {}
  }
  try { xvfbChild?.kill("SIGKILL"); } catch {}
  try { _rendererServer?.close(); } catch {}
  _rendererServer = null;
}

/* ------------------------------------------------------------------ */
/* Shared journey state                                                */
/* ------------------------------------------------------------------ */
const journey = {
  sessionIds: [],        // v4 session ids created through the composer
  openRouterProviderId: null, // custom provider id (local deterministic endpoint)
  providerSavedOnDisk: null,
  browserGuestUrl: null, // the Babylon runtime URL verified in the ZCode Browser
};

const MAIN_PANE = "v4-session-pane-workspace-main";

async function paneSessionId() {
  return (await evalJs(`document.querySelector(${JSON.stringify(`[data-testid="${MAIN_PANE}"]`)})?.dataset?.sessionId ?? null`)) ?? null;
}

async function timelineState() {
  return evalJs(`(() => {
    const pane = document.querySelector(${JSON.stringify(`[data-testid="${MAIN_PANE}"]`)});
    const rows = Array.from(document.querySelectorAll('[data-testid^="v4-row"]'));
    const stop = Array.from(document.querySelectorAll('[data-testid="v4-stop"]')).some(e => e.offsetParent !== null);
    const timeline = (document.querySelector('[data-testid="v4-timeline"]')?.innerText ?? '').slice(0, 2500);
    const errorBanner = document.querySelector('[data-testid="chat-error-banner"]');
    const bannerSignature = errorBanner
      ? { code: errorBanner.getAttribute('data-error-code') ?? '', text: (errorBanner.innerText ?? '').slice(0, 200) }
      : null;
    return { rows: rows.length, canStop: stop, timeline, paneSessionId: pane?.dataset?.sessionId ?? null, errorBanner: Boolean(errorBanner), bannerSignature };
  })()`);
}

/** True when the mounted banner is the SAME one that was already present before
 *  a resubmission (same data-error-code + text) — i.e. a stale remnant of the
 *  turn that already failed, not evidence about the resubmitted turn. */
function isStaleBanner(state, staleBanner) {
  if (!staleBanner || !state?.bannerSignature) return false;
  return state.bannerSignature.code === staleBanner.code && state.bannerSignature.text === staleBanner.text;
}

/**
 * Dismisses the failed turn's chat-error-banner the way a real user does before
 * retrying. The app keeps control.lastError as a projection fact, but the
 * dismiss records the error fingerprint so the SAME error no longer renders —
 * after this, a mounted banner is unambiguously a NEW failure of the
 * resubmitted turn (run 42114111080: the same-signature rate-limit banner stayed
 * mounted and made the retry's error state unreadable).
 */
async function dismissErrorBanner() {
  try {
    const rect = await rectOf(`(() => { const b = document.querySelector('[data-testid="chat-error-banner"]'); if (!b) return null; return b.querySelector('button[aria-label="Dismiss error"]') ?? null; })()`).catch(() => null);
    if (rect && rect.w > 0) {
      await cdpClickRect(rect);
      await new Promise((r) => setTimeout(r, 400));
      log("dismissed the failed turn's error banner (real-user dismiss before retry)");
      return true;
    }
  } catch {
    // fall through to the not-found path
  }
  log("error banner dismiss button not found — continuing (the stale-banner grace covers it)");
  return false;
}

/**
 * Wait for the current agent turn to complete (upstream semantics:
 * sessionId !== "draft", no stop button, rows present) while responding to any
 * permission dialogs that appear. respondKind selects the response used for
 * dialogs that surface DURING the wait: "allowOnce" for tasks the user is
 * approving, "rejectOnce" for the reject verification (subsequent retries of
 * the rejected modification must also be rejected, otherwise the journey
 * itself would apply the rejected change on a retry).
 *
 * staleBanner: the chat-error-banner signature captured BEFORE a resubmission
 * (run 42109892985: the retry verdict fired 96ms after sendConversationCommandV4
 * OK — before the new turn's stop button could render, the OLD banner was read
 * as a second failure and the retry was never actually waited on). A banner
 * matching the pre-resubmission signature is treated as a stale remnant for a
 * STARTUP GRACE window only: if the same-signature banner stays mounted with no
 * running turn for longer than the grace, the resubmitted turn has failed with
 * the SAME error (run 42114111080: free-models-per-day quota exhausted — the
 * retry failed identically) and the wait reports turnFailed.
 *
 * A mounted banner (any signature) also BLOCKS the completion verdict: an
 * error banner + no stop button is an error state, never a completed turn
 * (run 42114111080's completion branch fired 6s after the rate-limited retry
 * died with its banner still mounted — completed=true, artifact=false).
 */
const STALE_BANNER_GRACE_MS = 15000;

async function waitForTurnCompletion({ timeout = MAX_WAIT, autoApprove = true, respondKind = "allowOnce", approvals = [], staleBanner = null } = {}) {
  const start = Date.now();
  let sawToolUse = false;
  let last = null;
  let idleSince = null;
  let bannerSince = null;
  let staleBannerLogged = false;
  while (Date.now() - start < timeout) {
    last = await timelineState().catch(() => null);
    if (!last) { await new Promise((r) => setTimeout(r, 1500)); continue; }
    if (/write|read|edit|terminal|bash|tool/i.test(last.timeline)) sawToolUse = true;
    if (autoApprove) {
      const dialog = await readPermissionDialog();
      if (dialog) {
        const res = await respondPermission(respondKind).catch((e) => ({ error: e.message }));
        approvals.push({ at: new Date().toISOString(), kind: respondKind, result: res.error ?? "dismissed", surface: res.surface ?? null });
        log(`auto-respond permission (${respondKind}): ${res.error ?? "dismissed"}`);
        continue;
      }
    }
    const running = last.canStop;
    const sessionLive = last.rows > 0 && last.paneSessionId && last.paneSessionId !== "draft";
    const inErrorState = !running && last.errorBanner && sessionLive;
    const bannerIsStale = isStaleBanner(last, staleBanner);
    if (inErrorState && !bannerIsStale) {
      // The turn FAILED (a banner the caller has not seen before, no stop button):
      // report it so callers can resubmit exactly like a real user instead of
      // idling to the full timeout (run 42104260632: free-tier model request
      // failed, banner surfaced, 5 minutes of dead waiting).
      return { completed: false, turnFailed: true, ...last, sawToolUse, approvals };
    }
    if (inErrorState && bannerIsStale) {
      if (bannerSince === null) bannerSince = Date.now();
      if (!staleBannerLogged) {
        staleBannerLogged = true;
        log(`stale error banner from the previously failed turn still mounted (code=${JSON.stringify(staleBanner.code)}) — allowing a ${STALE_BANNER_GRACE_MS}ms startup grace before reading it as the resubmitted turn's own failure`);
      }
      if (Date.now() - bannerSince > STALE_BANNER_GRACE_MS) {
        log(`same-signature error banner persisted ${Date.now() - bannerSince}ms with no running turn — the resubmitted turn failed with the SAME error`);
        return { completed: false, turnFailed: true, bannerSameSignature: true, ...last, sawToolUse, approvals };
      }
      idleSince = null;
    } else if (!running && !last.errorBanner && sessionLive) {
      // Completion requires NO mounted banner: not-running + banner is an error
      // state (see docblock — run 42114111080).
      if (idleSince === null) idleSince = Date.now();
      // require ~6s of stability so a between-tools gap isn't read as completion
      if (Date.now() - idleSince > 6000) {
        return { completed: true, ...last, sawToolUse, approvals };
      }
    } else {
      idleSince = null;
      bannerSince = null;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return { completed: false, ...last, sawToolUse, approvals, timeout: true };
}

async function stageS0() {
  const target = await attachCdp();
  let lastDiag = null;
  // Under-sandboxes: vite dev transforms 2000+ modules slowly; Chromium can exhaust
  // its per-process request budget on the first pass. Reloading hits vite's warm
  // in-memory transform cache and reliably completes the module graph.
  let reloads = 0;
  // M2 sandbox lesson: on 2-core/4GB boxes Chromium exhausts its per-process
  // request budget (net::ERR_INSUFFICIENT_RESOURCES) on the FIRST vite dev
  // module-graph pass, and each reload only advances as far as the vite
  // transform cache has warmed — more retries with longer waits are needed
  // than the M1 CI default (the same documented mechanism, tuned for slow
  // boxes; GH runners complete within the M1 defaults).
  const maxReloads = Number(process.env.PHASEB_S0_RELOADS ?? 10);
  const reloadWaitMs = Number(process.env.PHASEB_S0_RELOAD_WAIT_MS ?? 20000);
  await waitFor(async () => {
    const state = await evalJs(`(() => ({ ready: document.readyState, url: location.href, tidCount: document.querySelectorAll('[data-testid]').length, bodyLen: (document.body?.innerText ?? '').length }))()`).catch(() => null);
    lastDiag = state;
    if (!state) return false;
    const sidebar = await hasTid("sidebar");
    const onboarding = await hasTid("onboarding-page");
    // A fresh HOME with a healthy provider registry opens the first-run LOGIN
    // entry (Root's provider-availability guard) instead of the workspace — that
    // is a fully-rendered app surface too (handled by S1's login-entry walk),
    // not a launch failure.
    const loginEntry = await hasTid("login-use-api-key-button");
    if (sidebar || onboarding || loginEntry || (state.bodyLen > 500 && state.ready === "complete")) return true;
    if (state.ready === "complete" && state.bodyLen === 0 && reloads < maxReloads) {
      reloads++;
      log(`S0: renderer blank (tidCount=0) — reloading page (attempt ${reloads}/${maxReloads})`);
      await page.send("Page.reload", { ignoreCache: false }).catch(() => {});
      await new Promise((r) => setTimeout(r, reloadWaitMs));
    }
    return false;
  }, { what: "workspace DOM (sidebar/onboarding/first-run login entry)", timeout: MAX_WAIT, interval: 5000 });
  await screenshot("S0-app-up");
  await dumpDom("S0-app-up");
  const launchUrl = target.url;
  const s0Surface = (await hasTid("login-use-api-key-button")) ? "first-run login entry (WelcomeScreen — walked by S1)"
    : (await hasTid("onboarding-page")) ? "first-run onboarding wizard"
    : "workspace";
  recordStage("S0", "pass", {
    window: "main BrowserWindow over CDP",
    launch_url: launchUrl.slice(0, 220),
    app_title: target.title,
    renderer: MODE === "prod" ? "production bundle (out/renderer)" : "vite dev server",
    surface: s0Surface,
    diag: lastDiag,
  });
}

async function handleFirstRunLoginEntryIfPresent() {
  const loginEntry = await waitFor(async () => {
    if (await hasTid("login-use-api-key-button")) return "login";
    if (await hasTid("onboarding-page")) return "onboarding";
    if (await hasTid("sidebar")) return "workspace";
    return false;
  }, { what: "first-run surface (login entry / onboarding / workspace)", timeout: 90000 });
  if (loginEntry !== "login") return { shown: false, surface: loginEntry };
  await screenshot("S1-login-entry");
  await dumpDom("S1-login-entry");
  await clickTid("login-use-api-key-button", { timeout: 20000 });
  await waitForTid("login-api-key-skip-button", { timeout: 20000 });
  await screenshot("S1-login-api-key-form");
  await clickTid("login-api-key-skip-button", { timeout: 20000 });
  // The skip records the provider-family choice and completes the welcome
  // screen; the first-run onboarding wizard then appears.
  await waitFor(async () => Boolean(await hasTid("onboarding-page")) || Boolean(await hasTid("sidebar")), { what: "onboarding (or workspace) after login skip", timeout: 45000 });
  return { shown: true, action: "login-use-api-key-button → login-api-key-skip-button (Skip: no credential written; OpenRouter configured in S2)", skipped_at: new Date().toISOString() };
}

async function stageS1() {
  // 0. First-run login entry (only present on a fresh HOME with no user and no
  // usable provider — the app's real first screen once the provider registry
  // is healthy). Walked with real CDP clicks; the Skip there is the login
  // screen's own sanctioned action, distinct from onboarding step skipping.
  const loginEntry = await handleFirstRunLoginEntryIfPresent();
  const present = await waitFor(async () => {
    if (await hasTid("onboarding-page")) return true;
    if (await hasTid("sidebar")) return "workspace";
    return false;
  }, { what: "onboarding page or workspace", timeout: 60000 });
  if (present !== true) {
    throw new Error("onboarding did not appear on this HOME — S1 requires a fresh PHASEB_HOME (first-run wizard)");
  }
  await screenshot("S1-onboarding-start");
  const steps = [];
  // Step 0 — occupation. Default "developer" is preselected; we still explicitly
  // click the "Software / Data / AI" card so the selection is a real user action.
  await waitFor(async () => Boolean(await rectOf(`(() => { const page0 = document.querySelector('[data-testid="onboarding-page"]'); if (!page0) return null; return Array.from(page0.querySelectorAll('button')).find(b => /software\\s*\\/\\s*data\\s*\\/\\s*ai/i.test((b.innerText || '').trim())); })()`).catch(() => null)), { what: "occupation card (Software / Data / AI)", timeout: 30000 });
  const occupation = await clickButtonByText(/software\s*\/\s*data\s*\/\s*ai/i, { scope: `document.querySelector('[data-testid="onboarding-page"]')`, timeout: 30000 });
  steps.push({ step: 0, name: "occupation", action: "selected card", value: occupation });
  await new Promise((r) => setTimeout(r, 400));
  await clickButtonByText(/^(next|continue|下一步|继续)$/i, { scope: `document.querySelector('[data-testid="onboarding-page"]')`, timeout: 20000 });
  steps.push({ step: 0, name: "occupation", action: "advanced", value: "Next" });
  await screenshot("S1-onboarding-step-1");
  // Step 1 — UI mode: select "Coding mode".
  await waitFor(async () => Boolean(await rectOf(`(() => { const page0 = document.querySelector('[data-testid="onboarding-page"]'); if (!page0) return null; return Array.from(page0.querySelectorAll('button')).find(b => /^coding mode$/i.test((b.innerText || '').trim().split('\\n')[0])); })()`).catch(() => null)), { what: "Coding mode card", timeout: 30000 });
  const mode = await clickButtonByText(/^coding mode/i, { scope: `document.querySelector('[data-testid="onboarding-page"]')`, timeout: 20000 });
  steps.push({ step: 1, name: "ui-mode", action: "selected card", value: mode });
  await new Promise((r) => setTimeout(r, 400));
  await clickButtonByText(/^(next|continue|下一步|继续)$/i, { scope: `document.querySelector('[data-testid="onboarding-page"]')`, timeout: 20000 });
  steps.push({ step: 1, name: "ui-mode", action: "advanced", value: "Next" });
  await screenshot("S1-onboarding-step-2");
  // Step 2 — preferences: keep defaults, finish via "Get started".
  const started = await clickButtonByText(/^(get started|start|开始使用)$/i, { scope: `document.querySelector('[data-testid="onboarding-page"]')`, timeout: 30000 });
  steps.push({ step: 2, name: "preferences", action: "finished wizard", value: started });
  await new Promise((r) => setTimeout(r, 1500));
  const finished = await waitFor(async () => (await hasTid("onboarding-page")) ? false : Boolean(await hasTid("sidebar")), { what: "workspace sidebar after onboarding", timeout: 45000 }).catch(() => false);
  await screenshot("S1-onboarding-done");
  await dumpDom("S1-onboarding-done");
  if (!finished) throw new Error("onboarding finished click did not reach the workspace sidebar");
  recordStage("S1", "pass", {
    first_run_login_entry: loginEntry,
    steps,
    skip_used: false,
    back_used: false,
    note: "first-run login entry (Use API key → Skip) walked when present (the app's real fresh-HOME screen; no credential written there — OpenRouter is configured in S2); wizard then walked step-by-step via real CDP clicks; no Skip/Back used inside the wizard; defaults kept on the preferences step",
  });
}

function readProviderRules() {
  // On-disk shape (packages/provider-node/src/provider-config-file-codec.ts,
  // packages/provider/src/config/rule-data-schema.ts):
  // { schemaVersion, config: { providerConfigRules: { providerRules: [ { providerId,
  //   templateId, providerName, config: { access: { apiKey }, api: { baseUrl } } } ] } } }
  try {
    const doc = JSON.parse(readFileSync(PROVIDER_CONFIG_FILE, "utf8"));
    const rules = doc?.config?.providerConfigRules?.providerRules;
    return Array.isArray(rules) ? rules : [];
  } catch {
    return [];
  }
}

function findModelOnDisk(providerId, modelId) {
  // Personal model rules on disk (rule-data-schema.ts personalModelConfigRules):
  // config.personalModelConfigRules.providerModelRules / manualProviderModelRules
  // entries carry { providerId, modelId, config }. Return a truthy descriptor only
  // when the model id is actually persisted; also verify the raw string content
  // so an unexpected storage shape is still detected.
  try {
    const raw = readFileSync(PROVIDER_CONFIG_FILE, "utf8");
    if (!raw.includes(modelId)) return false;
    const doc = JSON.parse(raw);
    const personal = doc?.config?.personalModelConfigRules;
    const inProviderRules = (personal?.providerModelRules ?? []).some((r) => r.providerId === providerId && r.modelId === modelId);
    const inManualRules = (personal?.manualProviderModelRules ?? []).some((r) => r.providerId === providerId && r.modelId === modelId);
    return {
      raw_string_present: true,
      provider_model_rules: inProviderRules,
      manual_provider_model_rules: inManualRules,
      location: inProviderRules
        ? "config.personalModelConfigRules.providerModelRules"
        : inManualRules
          ? "config.personalModelConfigRules.manualProviderModelRules"
          : "other (raw model id string present in provider_config.json)",
    };
  } catch {
    return false;
  }
}

let localModelServerChild = null;

async function startLocalModelServer() {
  const serverPath = join(REPO_ROOT, "scripts", "gamos", "m3-local-model-server.mjs");
  if (!existsSync(serverPath)) throw new Error(`local model server script missing: ${serverPath}`);
  const transcriptPath = join(EVIDENCE_DIR, "m3-local-model-transcript.jsonl");
  localModelServerChild = spawn(process.execPath, [serverPath], {
    env: { ...process.env, M3_LOCAL_MODEL_PORT: String(LOCAL_MODEL_PORT), M2_LOCAL_MODEL_TRANSCRIPT: transcriptPath },
    stdio: ["ignore", "pipe", "pipe"],
  });
  // Deliberately NOT pushed onto `children`: MJ9 restarts the app via stopApp()
  // and the endpoint must survive that restart (post-restart sidecar calls and
  // any resumed turns still need a live model endpoint). It is terminated in
  // main()'s finally and in the fatal handler instead.
  localModelServerChild.stdout.on("data", (d) => { for (const line of String(d).split("\n")) if (line.trim()) log(`[local-model] ${line.trim()}`); });
  localModelServerChild.stderr.on("data", (d) => { for (const line of String(d).split("\n")) if (line.trim()) log(`[local-model:err] ${line.trim()}`); });
  localModelServerChild.on("exit", (code, signal) => log(`[local-model] endpoint exited (code=${code} signal=${signal})`));
  await waitFor(() => new Promise((resolve) => {
    const req = httpRequest({ host: "127.0.0.1", port: LOCAL_MODEL_PORT, path: "/healthz", method: "GET", timeout: 2000 }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => resolve(body.includes('"ok":true')));
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
    // http.request does not send anything until end() — without this the probe
    // hangs until the socket timeout on every attempt (run 42298353106: the
    // endpoint was listening but every healthz probe timed out).
    req.end();
  }), { what: `local deterministic model endpoint healthz (${LOCAL_MODEL_URL})`, timeout: 30000 });
  log(`local deterministic model endpoint ready: ${LOCAL_MODEL_URL} (transcript: ${transcriptPath})`);
  journey.localModelEndpoint = { url: LOCAL_MODEL_URL, transcript: transcriptPath, pid: localModelServerChild.pid };
}

function stopLocalModelServer() {
  if (!localModelServerChild) return;
  try { localModelServerChild.kill("SIGTERM"); } catch { /* already gone */ }
  localModelServerChild = null;
}

/** Pin the custom provider's API format to anthropic-messages through the real
 * format selector (trigger → item), mirroring the upstream helper's read-then-click
 * semantics (personal-provider-settings.ts): a custom provider left on a wrong
 * protocol default would send requests the local endpoint never answers. */
async function ensureAnthropicMessagesApiFormat() {
  const triggerTid = "model-provider-api-format-trigger";
  const itemTid = "model-provider-api-format-item-anthropic-messages";
  await clickTid(triggerTid, { timeout: 20000 });
  await waitForTid(itemTid, { timeout: 20000 });
  const state = await evalJs(`document.querySelector('[data-testid="${itemTid}"]')?.getAttribute('data-state') ?? null`).catch(() => null);
  if (state === "checked") {
    log("api format already anthropic-messages — closing the menu without changes");
    await pressKey("Escape").catch(() => {});
  } else {
    await clickTid(itemTid, { timeout: 20000 });
    await new Promise((r) => setTimeout(r, 800));
    await pressKey("Escape").catch(() => {});
  }
  await new Promise((r) => setTimeout(r, 400));
}

async function stageS2LocalProvider() {
  await waitForTid("sidebar");
  await clickTid("task-settings-button", { timeout: 30000 });
  await waitForTid("settings-page", { timeout: 30000 });
  await screenshot("S2-local-settings-open");
  await clickTid("settings-section-nav-modelProvider", { timeout: 30000 });
  await waitForTid("model-provider-add-provider-button", { timeout: 30000 });
  await screenshot("S2-local-model-settings");
  const idsBefore = new Set(readProviderRules().map((r) => r.providerId).filter(Boolean));
  await clickTid("model-provider-add-provider-button", { timeout: 30000 });
  await waitForTid("model-provider-template-picker", { timeout: 20000 });
  await screenshot("S2-local-add-provider");
  // The template picker's CUSTOM entry (ProviderTemplatePicker.tsx renders it
  // natively — testid model-provider-template-item-custom).
  await waitForTid("model-provider-template-item-custom", { timeout: 20000 });
  await clickTid("model-provider-template-item-custom", { timeout: 20000 });
  const providerId = await waitFor(() => {
    const appeared = readProviderRules().map((r) => r.providerId).find((id) => id && !idsBefore.has(id));
    return appeared ?? false;
  }, { what: "new custom provider in provider_config.json", timeout: 30000 });
  journey.openRouterProviderId = providerId;
  await new Promise((r) => setTimeout(r, 800));
  await clickTid(`model-provider-nav-item-custom:${providerId}`, { timeout: 30000 });
  await waitForTid("model-provider-base-url-input", { timeout: 30000 });
  await screenshot("S2-local-provider-detail");
  // Base URL: the deterministic local endpoint. Per-field blur commits (the
  // upstream helper semantics). clearFirst guards against any prefilled value.
  await clickAndType("model-provider-base-url-input", LOCAL_MODEL_URL, { timeout: 20000, clearFirst: true });
  await pressKey("Tab");
  await new Promise((r) => setTimeout(r, 600));
  // API key: a clearly-fake local marker (the endpoint performs no auth). The
  // blur submits the connection draft.
  await clickAndType("model-provider-api-key-input", LOCAL_MODEL_KEY, { timeout: 20000, clearFirst: true });
  await pressKey("Tab");
  await new Promise((r) => setTimeout(r, 1200));
  // API format: the endpoint speaks the Anthropic Messages protocol.
  await ensureAnthropicMessagesApiFormat();
  // Verify the persisted provider ON DISK (the same standard as the openrouter
  // path): base URL + anthropic-messages + the marker key.
  const saved = await waitFor(() => {
    const rule = readProviderRules().find((r) => r.providerId === providerId);
    if (!rule) return false;
    const api = rule.config?.api ?? {};
    const key = rule.config?.access?.apiKey ?? null;
    if (api.baseUrl !== LOCAL_MODEL_URL || api.type !== "anthropic-messages" || key !== LOCAL_MODEL_KEY) return false;
    return { baseUrl: api.baseUrl, apiType: api.type, key: true, keySource: "personal overlay" };
  }, { what: "custom provider saved (local endpoint base URL + anthropic-messages + key)", timeout: 30000 }).catch((e) => {
    const rule = readProviderRules().find((r) => r.providerId === providerId);
    e.message = `${e.message}; on-disk rule: ${JSON.stringify(rule ? { api: rule.config?.api, access: { apiKeyPresent: Boolean(rule.config?.access?.apiKey) } } : null)?.slice(0, 600)}`;
    throw e;
  });
  journey.providerSavedOnDisk = saved;
  await screenshot("S2-local-provider-saved");
}

async function stageS2() {
  // The M2 journey always runs against the local deterministic endpoint (the
  // directive §9 model-endpoint honesty model); a real external provider is
  // not wired in this journey.
  if (!LOCAL_MODEL) throw new Error("PHASEB_LOCAL_MODEL=0 is not supported by the M2 journey — the engine journeys run against the local deterministic endpoint only (disclosed in every evidence artifact)");
  await stageS2LocalProvider();
  await stageS2SharedAddModel();
}

async function stageS2SharedAddModel() {
  const providerId = journey.openRouterProviderId;
  if (!providerId) throw new Error("S2 internal error: no provider id recorded by the provider-configuration step");
  // Add the FREE-tier model to the provider through the settings page's own
  // "Add model" flow (the upstream E2E path —
  // packages/desktop/test/e2e/helpers/upstream-provider.ts addUpstreamProviderModel):
  // the openrouter template's default catalog is paid-tier, and the journey's
  // OpenRouter key holds ~10 credits — a paid default model (minimax m3.1-flash)
  // gets every real request rejected with 402 "requires more credits" (run
  // 42042926675 agent-log evidence), so no task can run. The free-tier model
  // (verified present in the live OpenRouter catalog: 12 :free models incl.
  // nvidia/nemotron-3-ultra-550b-a55b:free) is added explicitly like a real user
  // would. The add-model button opens either the model metadata dialog
  // (role=dialog with a Model ID input + Save, disabled while the catalog
  // max-output query runs) or an inline model input row.
  let addedModelVia = null;
  // Existing inline model rows BEFORE the click: a genuinely NEW inline row can
  // only appear at the NEXT index (upstream addUpstreamProviderModel keys the
  // inline input off testId(TID_MODEL_PROVIDER_MODEL_INPUT,
  // String(provider.models.length))). A PREFIX match instead hits an EXISTING
  // model's row and silently edits it rather than adding the new model (run
  // 42049966765 evidence: the free model never reached provider_config.json and
  // the composer menu kept listing only the paid template catalog — S3/S4/S6/S9
  // then cascade-failed). The detection below also POLLS for the dialog (Radix
  // mount + resolution timing) instead of one-shot probing at a fixed delay.
  const inlineRowsBefore = await evalJs(`Array.from(document.querySelectorAll('[data-testid^="model-provider-model-input-"]')).map(e => e.dataset.testid)`);
  const nextInlineIndex = inlineRowsBefore.length;
  await clickTid("model-provider-add-model-button", { timeout: 20000 });
  // The finder below once carried a paren imbalance (''…)).trim()) that made the
  // page-eval throw on EVERY poll while .catch(()=>null) silently mapped the
  // syntax error to "dialog not found" — the add-model surface then fell through
  // to a bogus path and the free-tier model never persisted (runs 42049966765 /
  // 42056174710 evidence: the dialog sat OPEN while the poll reported nothing;
  // screenshot proof). Two hardening changes: (1) strategy 1 targets the metadata
  // dialog's OWN identity row (data-model-identity-row is rendered exclusively
  // by ProviderModelMetadataDialog) before any [role=dialog] scanning; (2) the
  // finder is syntax-checked at startup via assertPageJs (below) so this class of
  // silent failure can never masquerade as a missing element again.
  const DIALOG_INPUT_JS = assertPageJs("add-model dialog input finder", `(() => {
    const identity = document.querySelector('[data-model-identity-row] input');
    if (identity) return identity;
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"]'));
    for (const dialog of dialogs) {
      const inputs = Array.from(dialog.querySelectorAll('input'));
      const byLabel = inputs.find(i => /^(模型\\s*id|model\\s*id)$/i.test(((i.closest('label')?.textContent) ?? (i.parentElement?.querySelector('label')?.textContent) ?? i.getAttribute('placeholder') ?? '').trim()));
      if (byLabel) return byLabel;
      const fallback = inputs.find(i => i.getAttribute('inputmode') !== 'numeric' && !i.readOnly && i.type !== 'checkbox' && i.type !== 'radio');
      if (fallback) return fallback;
    }
    return null;
  })()`);
  const NEW_INLINE_JS = `document.querySelector('[data-testid="model-provider-model-input-${nextInlineIndex}"]')`;
  let which = null;
  for (let addAttempt = 1; addAttempt <= 2 && !which; addAttempt++) {
    if (addAttempt > 1) {
      // Guard against a swallowed first click: dismiss any stray overlay first
      // (Escape closes a Radix dialog/modal), then click Add model once more.
      await pressKey("Escape").catch(() => {});
      await new Promise((r) => setTimeout(r, 800));
      log("add-model surface not found on the first attempt — clicking model-provider-add-model-button again");
      await clickTid("model-provider-add-model-button", { timeout: 20000 });
    }
    which = await waitFor(async () => {
      const dialogInput = await rectOf(DIALOG_INPUT_JS).catch(() => null);
      if (dialogInput && dialogInput.w > 0) return { kind: "dialog", input: dialogInput };
      const inline = await rectOf(NEW_INLINE_JS).catch(() => null);
      if (inline && inline.w > 0) return { kind: "inline", input: inline };
      return false;
    }, { what: "add-model surface (metadata dialog or a genuinely NEW inline row at the next index)", timeout: 20000 }).catch(() => null);
  }
  if (!which) throw new Error("neither the model metadata dialog nor a genuinely new inline model row appeared after model-provider-add-model-button (2 attempts)");
  if (which.kind === "dialog") {
    await cdpClickRect(which.input);
    await new Promise((r) => setTimeout(r, 200));
    await typeIntoFocused(MODEL_ID);
    await new Promise((r) => setTimeout(r, 600));
    const SAVE_BTN_JS = assertPageJs("add-model Save button finder", `(() => {
        const dialog = document.querySelector('[role="dialog"]');
        if (!dialog) return null;
        const btn = Array.from(dialog.querySelectorAll('button')).find(b => /^(保存|save).*/i.test((b.innerText ?? '').replace(/\\s+/g, ' ').trim()));
        return btn && !btn.disabled && !dialog.querySelector('[role="status"]') ? btn : null;
      })()`);
    const saveBtn = await waitFor(async () => {
      const r = await rectOf(SAVE_BTN_JS).catch(() => null);
      return r && r.w > 0 ? r : false;
    }, { what: "model metadata dialog Save button (enabled after the catalog query)", timeout: 45000 });
    await cdpClickRect(saveBtn);
    await waitFor(async () => {
      const closed = await evalJs(`(() => { const d = document.querySelector('[role="dialog"]'); return !d || !d.querySelector('input'); })()`).catch(() => false);
      return closed;
    }, { what: "model metadata dialog closed after Save", timeout: 30000 });
    addedModelVia = "model metadata dialog (Model ID + Save)";
  } else {
    await cdpClickRect(which.input);
    await new Promise((r) => setTimeout(r, 200));
    await typeIntoFocused(MODEL_ID);
    // Commit via blur (Tab) — the upstream setInputValueByTestIdDom semantics
    // (input + change + blur). Enter is NOT pressed on the inline row: it is not
    // the documented inline commit path and can mis-trigger the metadata dialog.
    await pressKey("Tab");
    await new Promise((r) => setTimeout(r, 1500));
    addedModelVia = `inline model input row ${nextInlineIndex} (+ blur commit)`;
  }
  // REAL verification: the added model must reach the provider config ON DISK.
  // A closed dialog / blurred row is UI state, not persistence — poll the file's
  // personal model rules for the model id and FAIL S2 if it never lands (this is
  // exactly what the previous revision missed: S2 recorded pass while the model
  // had never been persisted, cascading into S3/S4/S6/S9 failures).
  const modelOnDisk = await waitFor(() => findModelOnDisk(providerId, MODEL_ID), { what: `model ${MODEL_ID} persisted to provider_config.json`, timeout: 60000 });
  journey.freeModelOnDisk = modelOnDisk;
  await screenshot("S2-model-added");
  // Back to the workspace.
  await clickTid("settings-back-button", { timeout: 20000 });
  await waitForTid("v4-composer-input", { timeout: 30000 });
  recordStage("S2", "pass", {
    nav: LOCAL_MODEL
      ? "task-settings-button → settings-section-nav-modelProvider → add-provider → template custom (local deterministic endpoint)"
      : "task-settings-button → settings-section-nav-modelProvider → add-provider → template openrouter",
    provider_id: providerId,
    template: LOCAL_MODEL ? "custom" : "openrouter",
    persisted_to: PROVIDER_CONFIG_FILE,
    base_url_verified: journey.providerSavedOnDisk?.baseUrl ?? journey.providerSavedOnDisk?.baseURL ?? null,
    base_url_source: journey.providerSavedOnDisk?.baseURLSource ?? journey.providerSavedOnDisk?.keySource ?? null,
    api_key_persisted: true,
    ...(LOCAL_MODEL ? {
      api_type_verified: journey.providerSavedOnDisk?.apiType ?? null,
      local_model_endpoint: LOCAL_MODEL_URL,
      local_model_note: "deterministic local Anthropic-Messages endpoint (maintainer directive: no OpenRouter budget — the free tier's 50 requests/day provably cannot carry the journey, run 42235226375). Provider, key, model and every model turn go through the app's REAL provider/chat surfaces; the model intelligence behind the endpoint is scripted — evidence must not claim real-LLM authorship.",
    } : {
      free_tier_model_added: { model: MODEL_ID, via: addedModelVia, reason: "template catalog is paid-tier; the key's ~10 credits cannot afford paid models (402 evidence) — the free-tier model is required for real tasks", on_disk_verified: journey.freeModelOnDisk },
    }),
    note: LOCAL_MODEL
      ? "clearly-fake marker key entered via CDP Input.insertText into the real model-provider-api-key-input; persistence verified on disk"
      : "API key entered via CDP Input.insertText into the real model-provider-api-key-input; persistence verified on disk (key never logged)",
  });
}

async function ensureDraftBoundToDefaultWorkspace() {
  // Fresh apps open in a "Select project" state: the composer is unbound. With a
  // HEALTHY provider registry the model/mode controls render anyway (run
  // 42042926675 evidence: the unbound composer shows the model trigger; the send
  // path binds the session to the default conversation workspace from the launch
  // URL's initialWorkspacePath). Mirror the upstream E2E flow
  // (startDraftFromProject) to bind through the sidebar's default project row
  // when that row exists, but treat the binding as BEST-EFFORT: a fresh empty
  // default workspace has no project row yet (the sidebar's Projects section is
  // empty until a task exists — run 42042926675 S3 evidence), and blocking on it
  // would fail the journey on a state the original app handles by creating the
  // task in the default conversation workspace on send.
  const already = await evalJs(`(() => {
    const trigger = document.querySelector('[data-testid="composer-workspace-trigger"]');
    const pane = document.querySelector('[data-testid="v4-session-pane-workspace-main"]');
    const text = (trigger?.innerText ?? '').trim();
    return { bound: !/select project/i.test(text), triggerText: text.slice(0, 60), sessionId: pane?.dataset?.sessionId ?? null };
  })()`).catch(() => null);
  if (already?.bound) return { ...already, via: "already bound" };
  log(`draft binding: composer unbound ("${already?.triggerText ?? "?"}") — trying the default project row (best-effort)`);
  const section = await waitFor(async () => {
    const r = await rectOf(`document.querySelector('[data-project-id][data-project-name="default"]')`).catch(() => null);
    return r && r.w > 0 ? r : false;
  }, { what: "default project section", timeout: 15000 }).catch(() => null);
  if (!section) {
    log("draft binding: no default project row on this fresh HOME — proceeding with the launch-URL default conversation workspace (the send path binds the session there)");
    return { bound: false, via: "launch-URL initialWorkspacePath (default conversation workspace; no sidebar project row on a fresh HOME)" };
  }
  // Real hover over the project row (reveals the hover action area).
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.round(section.x + section.w / 2), y: Math.round(section.y + Math.min(section.h / 2, 24)) });
  await new Promise((r) => setTimeout(r, 500));
  const createBtn = await waitFor(async () => {
    const r = await rectOf(`document.querySelector('[data-project-id][data-project-name="default"] [data-testid="virtual-project-create-task"]')`).catch(() => null);
    return r && r.w > 0 ? r : false;
  }, { what: "virtual-project-create-task in the default project", timeout: 20000 }).catch(() => null);
  if (!createBtn) {
    return { bound: false, via: "launch-URL initialWorkspacePath (create-task action not reachable)" };
  }
  await cdpClickRect(createBtn);
  await waitFor(async () => evalJs(`(() => {
    const pane = document.querySelector('[data-testid="v4-session-pane-workspace-main"]');
    const trigger = document.querySelector('[data-testid="composer-workspace-trigger"]');
    const input = document.querySelector('[data-testid="v4-composer-input"]');
    const text = (trigger?.innerText ?? '').trim();
    return pane?.dataset?.sessionId === 'draft' && Boolean(input) && !/select project/i.test(text);
  })()`).catch(() => false), { what: "main pane draft bound to the default workspace", timeout: 45000 }).catch(() => false);
  return { bound: true, via: "virtual-project-create-task (sidebar default project)" };
}
async function selectModelInComposer() {
  // Bind the composer to the default workspace first (fresh apps open in a
  // "Select project" state where the model/mode controls do not render).
  const binding = await ensureDraftBoundToDefaultWorkspace();
  await waitForTid("chat-model-select-trigger", { timeout: 45000 });
  const before = await tidText("chat-model-select-trigger");
  // Open the composer model picker (chat-model-select-trigger) and select MODEL_ID
  // from the personal provider's group (registry-provider:<id>), like a real user.
  // With an empty/absent catalog the trigger is the "Manage models" variant that
  // opens provider settings instead — detect that, go back, and retry.
  let menuOpened = false;
  for (let attempt = 1; attempt <= 4 && !menuOpened; attempt++) {
    await clickTid("chat-model-select-trigger", { timeout: 20000 });
    await new Promise((r) => setTimeout(r, 600));
    if (await hasTid("settings-page")) {
      log(`model picker attempt ${attempt}: trigger opened provider settings (catalog not ready) — going back and retrying`);
      if (await hasTid("settings-back-button")) await clickTid("settings-back-button", { timeout: 15000 });
      await waitForTid("v4-composer-input", { timeout: 30000 });
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    menuOpened = await waitFor(
      async () => Boolean(await evalJs(`Boolean(document.querySelector('[data-testid^="chat-model-select-item-"]'))`)),
      { what: "model menu items", timeout: 20000 },
    ).then(() => true).catch(() => false);
    if (!menuOpened) {
      await pressKey("Escape").catch(() => {});
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  if (!menuOpened) throw new Error("model menu did not open with items after provider configuration");
  // The menu lists the provider's live model catalog; wait for the provider group
  // (or any model item) to appear.
  const groupTid = `chat-model-select-group-registry-provider:${journey.openRouterProviderId}`;
  await waitFor(async () => (await hasTid(groupTid)) || (await evalJs(`Boolean(document.querySelector('[data-testid^="chat-model-select-item-"]'))`)), { what: `model menu group ${groupTid} (or any model item)`, timeout: 60000 });
  // Find the item whose text matches the configured model (items display the raw
  // model id). Run 42042926675 showed the default selection falls back to the
  // template's first enabled model (minimax/minimax-m3.1-flash, a PAID model) —
  // with the journey's ~10-credit key OpenRouter then rejects the request with
  // 402 "requires more credits ... requested up to 524288 tokens". The FREE-tier
  // model is therefore REQUIRED: prefer the configured PHASEB_MODEL, then any
  // ":free" item from the provider's live catalog.
  const modelFragment = MODEL_ID.split("/").pop() ?? MODEL_ID;
  const MODEL_ITEM_JS = assertPageJs("composer model item finder", `(() => {
      const items = Array.from(document.querySelectorAll('[data-testid^="chat-model-select-item-"]'));
      const visible = items.filter(i => (i.innerText || '').trim());
      // Match the model id in the DISPLAYED name OR in the item testid: personal
      // provider items carry the URL-encoded model id inside their testid
      // (chat-model-select-item-custom:<provider>:<encoded-id>) and the raw id is
      // the display name — matching both keeps the finder robust to presentation
      // differences (run 42049966765: items existed but only by testid shape).
      const modelId = ${JSON.stringify(MODEL_ID)};
      const encoded = encodeURIComponent(modelId);
      const matches = (i) => {
        const lowerText = (i.innerText || '').toLowerCase();
        const tid = i.dataset.testid ?? '';
        let decodedTid = tid;
        try { decodedTid = decodeURIComponent(tid); } catch {}
        return lowerText.includes(${JSON.stringify(modelFragment.toLowerCase())})
          || (i.innerText || '').includes(':free')
          || decodedTid.includes(modelId)
          || tid.includes(encoded);
      };
      return visible.find(matches) ?? null;
    })()`);
  const item = await waitFor(async () => {
    const r = await rectOf(MODEL_ITEM_JS).catch(() => null);
    return r && r.w > 0 ? r : false;
  }, { what: `model item containing "${modelFragment}" (or a :free catalog model)`, timeout: 60000 });
  await cdpClickRect(item);
  await new Promise((r) => setTimeout(r, 800));
  await pressKey("Escape");
  await new Promise((r) => setTimeout(r, 400));
  const after = await tidText("chat-model-select-trigger");
  const modelConfigAttrs = await evalJs(`(() => { const e = document.querySelector('[data-testid="v4-model-config"]'); if (!e) return null; const o = {}; for (const a of e.getAttributeNames()) o[a] = e.getAttribute(a)?.slice(0, 120); return o; })()`);
  return { draft_binding: binding, before: before.slice(0, 120), after: after.slice(0, 200), clickedItem: item.text, modelConfigAttrs };
}

async function submitComposerTask(taskText, screenshotPrefix) {
  await waitForTid("v4-composer-input", { timeout: 30000 });
  await screenshot(`${screenshotPrefix}-composer`);
  const rect = await rectOf(`document.querySelector('[data-testid="v4-composer-input"]')`);
  await cdpClickRect(rect);
  await new Promise((r) => setTimeout(r, 200));
  await typeIntoFocused(taskText);
  await new Promise((r) => setTimeout(r, 500));
  await screenshot(`${screenshotPrefix}-typed`);
  // Send via the real send button (wait until it is enabled).
  await waitFor(async () => {
    const r = await rectOf(`(() => { const b = document.querySelector('[data-testid="v4-composer-send"]'); return b && !b.disabled ? b : null; })()`).catch(() => null);
    return r && r.w > 0 ? r : false;
  }, { what: "composer send button enabled", timeout: 30000 });
  await clickTid("v4-composer-send", { timeout: 15000 });
}

// Dirs that never hold the agent session store (GPU/browser caches, crash
// dumps, dependency trees) — skipped by both the DB search and the diagnostic
// listing below.
const DB_SEARCH_SKIP_DIRS = /^(cache.*|caches.*|gpucache|code_cache|dawn_cache|crash|node_modules|\.git)$/i;

function findSessionStoreDb() {
  // Locate the agent session-store SQLite DB for this journey.
  //
  // Canonical CLI default: {HOME}/.zcode/cli/db/db.sqlite
  // (apps/zcode-cli/packages/contracts config DefaultRuntimeConfig.storage.sessionDbPath
  // "~/.zcode/cli/db/db.sqlite", resolved against the journey HOME that
  // electronEnv injects). That path is checked directly first. The walk below
  // is a defensive fallback for relocated stores (per-workspace v2 stores,
  // wal/shm siblings beside a stale-mtime main file) — CI cleans PHASEB_HOME
  // before the journey, so everything found under it belongs to this run and
  // no mtime window is applied (run 42121929897 attempt 2: the walk missed the
  // store even though the timeline proved a live dwfrun-* had been journaled).
  const direct = join(PHASEB_HOME, ".zcode", "cli", "db", "db.sqlite");
  if (existsSync(direct)) return direct;
  const roots = [join(PHASEB_HOME, ".zcode"), PHASEB_HOME];
  const candidates = [];
  const seenDirs = new Set();
  const walk = (dir, depth) => {
    if (seenDirs.has(dir)) return;
    seenDirs.add(dir);
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth > 0 && !DB_SEARCH_SKIP_DIRS.test(entry.name)) walk(p, depth - 1);
      } else if (/\.(db|sqlite|sqlite3)$/i.test(entry.name)) {
        candidates.push(p);
      }
    }
  };
  for (const root of roots) walk(root, 6);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    // Prefer the canonical session-store location, then the most recently
    // touched file (WAL mode can leave the main file's mtime stale; recency is
    // only a tie-breaker, never a filter).
    const rank = (p) => (p.includes(`${sep}cli${sep}db${sep}`) ? 0 : 1);
    const rankDelta = rank(a) - rank(b);
    if (rankDelta !== 0) return rankDelta;
    const mt = (p) => { try { return statSync(p).mtimeMs; } catch { return 0; } };
    return mt(b) - mt(a);
  });
  return candidates[0] ?? null;
}

/** Diagnostic listing of every db/sqlite-like file under the journey home, plus
 *  the .zcode top-level layout — embedded in the stage detail when the store is
 *  not found, so a miss pinpoints the actual on-disk state instead of failing
 *  opaquely. */
function journeyHomeDbDiagnostic() {
  const lines = [];
  const seenDirs = new Set();
  const walk = (dir, depth, prefix) => {
    if (seenDirs.has(dir) || lines.length >= 80) return;
    seenDirs.add(dir);
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth === 6) lines.push(`${prefix}/${entry.name}/`);
        if (depth > 0 && !DB_SEARCH_SKIP_DIRS.test(entry.name)) walk(p, depth - 1, `${prefix}/${entry.name}`);
      } else if (/\.(db|sqlite|sqlite3|json|jsonl)$/i.test(entry.name) || /-wal$|-shm$/i.test(entry.name)) {
        let meta = "";
        try { const st = statSync(p); meta = ` ${st.size}b`; } catch { /* ignore */ }
        lines.push(`${prefix}/${entry.name}${meta}`);
      }
    }
  };
  walk(join(PHASEB_HOME, ".zcode"), 6, ".zcode");
  walk(PHASEB_HOME, 1, "~");
  return lines.length ? lines.join(" | ") : "no db/sqlite-like files anywhere under the journey home";
}

/* ------------------------------------------------------------------ */
/* M3 journey stages (M3J3–M3J6) — final-closure handoff §11           */
/* ------------------------------------------------------------------ */

const ENGINE_PLUGIN_IDS = [
  "blender-engine@zcode-plugins-official",
  "babylon-engine@zcode-plugins-official",
  "unity-engine@zcode-plugins-official",
];

const M3_WORKSPACES = {
  blender: join(TASK_WORKSPACE, "gamos-m3-blender"),
  babylon: join(TASK_WORKSPACE, "gamos-m3-babylon-app"),
  unity: join(TASK_WORKSPACE, "gamos-m3-unity-project"),
};

const M3_EVIDENCE = {
  capabilityResolution: null,
  plan: null,
  crossEngine: {
    denial: null,
    savedBlendSha256: null,
    exportArtifact: null,
    manifest: null,
    integration: null,
    babylon: null,
    cancellation: null,
  },
  unity: { honestUnavailable: null },
  sessionDbPath: null,
};

/** Find every JSON file under the journey home whose content carries an
 *  enabledPlugins record, and report the engine plugins' effective state.
 *  The agent CLI's user config (`~/.zcode/cli/config.json`, HOME-redirected
 *  under the journey home) persists the shape
 *  `{ plugins: { enabledPlugins: { "<plugin>@<marketplace>": true } } }`
 *  (apps/zcode-cli/packages/adapters/src/config/file-config.adapter.ts
 *  updatePluginEnabledInFileConfig → resolvePluginConfigPath user scope);
 *  legacy/other shapes are tolerated as fallbacks. */
function findEnginePluginsEnabledOnDisk() {
  const files = [];
  const seenDirs = new Set();
  const walk = (dir, depth) => {
    if (seenDirs.has(dir) || depth < 0) return;
    seenDirs.add(dir);
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!DB_SEARCH_SKIP_DIRS.test(entry.name)) walk(p, depth - 1);
      } else if (/\.json$/i.test(entry.name)) {
        try {
          const raw = readFileSync(p, "utf8");
          if (raw.includes("enabledPlugins")) {
            const doc = JSON.parse(raw);
            const enabled =
              doc?.plugins?.enabledPlugins ??
              doc?.config?.plugins?.enabledPlugins ??
              doc?.enabledPlugins ?? null;
            if (enabled && typeof enabled === "object") {
              files.push({ path: p, enabledPlugins: enabled });
            }
          }
        } catch { /* unparsable — skip */ }
      }
    }
  };
  walk(join(PHASEB_HOME, ".zcode"), 6);
  if (files.length === 0) walk(PHASEB_HOME, 2);
  const states = ENGINE_PLUGIN_IDS.map((id) => ({
    pluginId: id,
    enabled: files.some((f) => f.enabledPlugins[id] === true),
  }));
  return {
    files: files.map((f) => f.path),
    states,
    allEnabled: states.every((s) => s.enabled),
  };
}

/**
 * Run the bundled m3-capability-cli in PLAN mode: registry resolution of the
 * cross-engine pipeline's typed capabilities (§11 items 1–2) + the
 * engine-aware GamePlan generation through the REAL M3.3 facility
 * (buildCrossEngineAssetPlan, validated through parseGamePlan — §11 items
 * 3–4). The emitted op inputs (staging artifact, manifest path, target
 * project root) are the orchestration record the M3J4 turns execute.
 */
function runM3CapabilityPlanCli() {
  const cliPath = process.env.M3_CAPABILITY_CLI ?? "/tmp/m3-capability-cli.mjs";
  if (!existsSync(cliPath)) throw new Error(`M3 capability CLI not found at ${cliPath} (set M3_CAPABILITY_CLI)`);
  const stdout = spawnSync(process.execPath, [cliPath], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      GAMOS_M3_WORKSPACE_ROOT: TASK_WORKSPACE,
      GAMOS_M3_PLAN_ID: "gamos-m3-cross-engine",
    },
  });
  if (stdout.status !== 0) {
    throw new Error(`M3 capability CLI (plan mode) failed (exit ${stdout.status}): ${String(stdout.stderr ?? stdout.stdout).slice(0, 500)}`);
  }
  return JSON.parse(stdout.stdout);
}

/**
 * Run the bundled m3-capability-cli in BUILD-MANIFEST mode: the pipeline-side
 * manifest persist (§7 step 6) through the REAL M3.4 facility
 * (buildExportedManifest, fail-closed). The export record comes from the
 * AUTHORITATIVE session-store tool output (never the timeline scrape).
 */
function runM3ManifestBuildCli(exportResultPath, manifestPath, exportedAt) {
  const cliPath = process.env.M3_CAPABILITY_CLI ?? "/tmp/m3-capability-cli.mjs";
  if (!existsSync(cliPath)) throw new Error(`M3 capability CLI not found at ${cliPath} (set M3_CAPABILITY_CLI)`);
  const stdout = spawnSync(process.execPath, [cliPath, "build-manifest",
    "--export-result", exportResultPath,
    "--manifest-output", manifestPath,
    "--plan-id", "gamos-m3-cross-engine",
    "--blend-file", join(M3_WORKSPACES.blender, "scene.blend"),
    "--project-identity", "gamos-m3-blender",
    "--created-at", exportedAt,
  ], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (stdout.status !== 0) {
    throw new Error(`M3 capability CLI (build-manifest mode) failed (exit ${stdout.status}): ${String(stdout.stderr ?? stdout.stdout).slice(0, 600)}`);
  }
  return JSON.parse(stdout.stdout);
}

/** M3J3 — enable the three engine plugins through the REAL Settings → Plugins
 *  toggles and verify the enabled state on disk; record the registry's
 *  capability resolution (the provenance-backed context the tasks will use). */
async function stageM3J3() {
  await waitForTid("sidebar");
  await clickTid("task-settings-button", { timeout: 30000 });
  await waitForTid("settings-page", { timeout: 30000 });
  await screenshot("M3J3-settings-open");
  await clickTid("settings-section-nav-plugin", { timeout: 30000 });
  // The plugins management list takes a moment to resolve the seeded catalog.
  const toggled = [];
  for (const pluginId of ENGINE_PLUGIN_IDS) {
    const switchJs = `document.querySelector('[data-testid="plugin-settings-enabled-switch"][data-plugin-id="${pluginId}"]')`;
    const row = await waitFor(async () => {
      const r = await rectOf(`document.querySelector('[data-testid="plugin-settings-plugin-row"][data-plugin-id="${pluginId}"]')`).catch(() => null);
      return r && r.w > 0 ? r : false;
    }, { what: `plugin settings row for ${pluginId}`, timeout: 60000 });
    const switchState = async () => evalJs(`(() => { const s = ${switchJs}; if (!s) return null; return { state: s.getAttribute('data-state'), checked: s.getAttribute('aria-checked'), disabled: s.hasAttribute('disabled') }; })()`).catch(() => null);
    const before = await waitFor(switchState, { what: `enabled switch state for ${pluginId}`, timeout: 30000 });
    if (before?.state === "checked") {
      toggled.push({ pluginId, action: "already-enabled", rowText: row.text });
      continue;
    }
    const sw = await rectOf(`(() => ${switchJs})()`);
    await cdpClickRect(sw);
    const after = await waitFor(async () => (await switchState())?.state === "checked", { what: `${pluginId} switch flipped to checked`, timeout: 30000 });
    toggled.push({ pluginId, action: "toggled-on-via-real-settings-ui", before, after, rowText: row.text });
    await screenshot(`M3J3-${pluginId.split("@")[0]}-enabled`);
    await new Promise((r) => setTimeout(r, 1200));
  }
  await screenshot("M3J3-all-engine-plugins-enabled");
  // On-disk verification: the enabled state must be persisted, not just UI state.
  const disk = await waitFor(() => {
    const state = findEnginePluginsEnabledOnDisk();
    return state.allEnabled ? state : false;
  }, { what: "engine plugins enabled on disk (enabledPlugins record)", timeout: 45000 });
  // Registry capability resolution + engine-aware GamePlan generation
  // (provenance-backed, §11 items 1–4) through the bundled m3-capability-cli.
  const capabilities = runM3CapabilityPlanCli();
  M3_EVIDENCE.capabilityResolution = capabilities;
  const capabilityPath = join(EVIDENCE_DIR, "m3-capability-plan.json");
  writeFileSync(capabilityPath, JSON.stringify(capabilities, null, 2));
  M3_EVIDENCE.plan = capabilities.plan;
  const registryOk =
    capabilities.verdict === "ok" &&
    capabilities.registryRecords >= 13 &&
    capabilities.plan?.validatedByParseGamePlan === true &&
    Array.isArray(capabilities.plan?.steps) &&
    capabilities.plan.steps.length === 5;
  // RESTART the app so the SESSION AGENT process picks up the freshly-enabled
  // engine plugins (sandbox lesson 2026-11-07: the agent resolves its plugin
  // MCP servers from the config snapshot at process start; the desktop host
  // starts the agent at app launch — BEFORE these toggles — so the engine MCP
  // servers never join the session's tool list and the model is never offered
  // the engine tools; observed as engine_tools_offered=0 in the endpoint
  // transcript). A restart is the real user's sanctioned apply action (the
  // same M1 MJ8 restart machinery: stopApp → restore display → restage →
  // relaunch → re-attach → handle any first-run login entry).
  await stopApp();
  page = null;
  await new Promise((r) => setTimeout(r, 2000));
  await ensureDisplay();
  stageDesktopOut();
  stageEnginePluginsForDevAgent();
  if (MODE === "dev") await launchDev();
  else if (MODE === "prod") await launchProd();
  else if (MODE === "prod-http") await launchProdHttp();
  else throw new Error(`unknown PHASEB_MODE ${MODE} at the M3J3 restart`);
  await attachCdp();
  await handleFirstRunLoginEntryIfPresent().catch(() => {});
  // Sidebar wait with the S0-style blank-renderer recovery (run-12 lesson:
  // the relaunched renderer occasionally comes up blank on this slow box —
  // a bounded reload loop completes the static module graph, exactly the
  // stageS0 mechanism).
  let restartReloads = 0;
  const maxRestartReloads = Number(process.env.PHASEB_S0_RELOADS ?? 10);
  await waitFor(async () => {
    if (await hasTid("sidebar")) return true;
    const state = await evalJs(`(() => ({ ready: document.readyState, bodyLen: (document.body?.innerText ?? '').length }))()`).catch(() => null);
    if (state?.ready === "complete" && state.bodyLen === 0 && restartReloads < maxRestartReloads) {
      restartReloads++;
      log(`M3J3 restart: renderer blank — reloading (attempt ${restartReloads}/${maxRestartReloads})`);
      await page.send("Page.reload", { ignoreCache: false }).catch(() => {});
      await new Promise((r) => setTimeout(r, 15000));
    }
    return false;
  }, { what: "sidebar after the M3J3 app restart (with blank-renderer reload recovery)", timeout: 120000, interval: 5000 });
  await waitForTid("sidebar", { timeout: 90000 });
  await new Promise((r) => setTimeout(r, 1500));
  await screenshot("M3J3-app-restarted-with-engine-plugins");
  const pass = toggled.length === ENGINE_PLUGIN_IDS.length && disk.allEnabled && registryOk;
  recordStage("M3J3", pass ? "pass" : "fail", {
    task: "the three engine plugins enabled through the REAL Settings → Plugins toggles; enabled state persisted; registry capability resolution recorded; app restarted so the session agent resolves the engine plugin MCP servers",
    toggled,
    enabled_on_disk: disk,
    app_restart: {
      why: "the agent process resolves plugin MCP servers from its startup config snapshot; enabling plugins mid-run does not add their MCP tools to the already-running agent — a restart is the real user's apply action",
      relaunched_mode: MODE,
      sidebar_after_restart: true,
    },
    registry_resolution: {
      verdict: capabilities.verdict,
      records: capabilities.registryRecords,
      resolved_ids: capabilities.capabilities.filter((c) => c.resolved).map((c) => c.id),
      honest_unresolved: capabilities.capabilities.filter((c) => !c.resolved).map((c) => ({ id: c.id, error: c.error })),
      engine_plugin_source_commit: capabilities.enginePluginSourceCommit,
      shipped_plugins: capabilities.shippedPlugins.map((p) => ({ pluginId: p.pluginId, engineFamily: p.engineFamily })),
      engine_aware_plan: {
        planId: capabilities.plan?.planId,
        planSha256: capabilities.plan?.planSha256,
        stepCount: capabilities.plan?.stepCount,
        steps: (capabilities.plan?.steps ?? []).map((s) => ({ stepId: s.stepId, capabilityId: s.capabilityId, dependsOn: s.dependsOn })),
        resourceClaimCount: capabilities.plan?.resourceClaimCount,
        validatedByParseGamePlan: capabilities.plan?.validatedByParseGamePlan,
        conflictGate: capabilities.plan?.conflictGate,
      },
      evidence: capabilityPath,
    },
  });
  if (!pass) throw new Error(`M3J3 engine-plugin enabling failed (toggled=${toggled.length}/3, onDisk=${disk.allEnabled}, registryOk=${registryOk})`);
}

/** Bootstrap a real .blend through the plugin's REVIEWED bridge (save_empty.py),
 *  exactly the invocation the plugin's engine layer uses (argument array, no
 *  shell). Fixture preparation only — the journey's ENGINE operations all go
 *  through the app's MCP plugin path. */
function bootstrapBlendWorkspace() {
  if (!BLENDER_PATH || !existsSync(BLENDER_PATH)) {
    throw new Error(`M3J4 requires a real Blender executable (M3_BLENDER_PATH) — got ${JSON.stringify(BLENDER_PATH)}. Directive §8: no engine means an honest stage failure, never a mock.`);
  }
  const ws = M3_WORKSPACES.blender;
  mkdirSync(ws, { recursive: true });
  const blendFile = join(ws, "scene.blend");
  const inputPath = join(ws, ".bootstrap-input.json");
  const reportPath = join(ws, ".bootstrap-report.json");
  writeFileSync(inputPath, JSON.stringify({ outputPath: blendFile }));
  const bridge = join(BLENDER_BRIDGE_DIR, "save_empty.py");
  if (!existsSync(bridge)) throw new Error(`blender bridge template missing: ${bridge}`);
  const proc = spawnSync(BLENDER_PATH, ["-b", "--factory-startup", "--python", bridge, "--", inputPath, reportPath], {
    encoding: "utf8",
    timeout: 240000,
    maxBuffer: 32 * 1024 * 1024,
  });
  const versionProbe = spawnSync(BLENDER_PATH, ["--version"], { encoding: "utf8", timeout: 60000 });
  const rawVersion = /Blender\s+(\d+\.\d+\.\d+)/.exec(versionProbe.stdout ?? "")?.[1] ?? "(unparsed)";
  if (proc.status !== 0 || !existsSync(blendFile)) {
    throw new Error(`blend bootstrap failed (exit ${proc.status}): ${String(proc.stderr ?? proc.stdout).slice(0, 500)}`);
  }
  const sha = sha256File(blendFile);
  log(`M3J4 bootstrap: ${blendFile} (${statSync(blendFile).size} bytes, sha256=${sha}, blender ${rawVersion})`);
  return { blendFile, baselineSha256: sha, rawVersion, bootstrapExit: proc.status };
}

/** M3J4 — THE §11 cross-engine pipeline journey leg: the natural-language
 *  request moves a real Blender-authored asset into the running Babylon
 *  experience through the app's typed-capability path. Legs: permission
 *  DENIAL first (source mutation blocked, hashes unchanged) → approved
 *  scene_modify + asset_export (GLB to staging with manifest ingredients) →
 *  the orchestration layer persists the interchange manifest through the
 *  REAL M3.4 facility → the agent READS the manifest (the app's own Read
 *  tool) and integrates with the manifest's authoritative expectedIntegrity
 *  → real vite build → real dev-server run → THE ORIGINAL ZCODE BROWSER
 *  verifies the integrated asset actually loaded → project_stop
 *  cancellation → port freed. */
async function stageM3J4() {
  const boot = bootstrapBlendWorkspace();
  const fixture = stageBabylonFixtureWorkspace();
  // The plan-derived op inputs (the orchestration record from M3J3's CLI):
  // staging artifact + manifest live under <workspace>/staging.
  const stagingDir = join(TASK_WORKSPACE, "staging");
  // Re-runnability: a stale artifact from an interrupted prior run must never
  // fake this run's evidence — the staging dir starts empty (the export leg
  // is the ONLY writer this run; the denial leg asserts its absence).
  rmSync(stagingDir, { recursive: true, force: true });
  const exportOutput = join(stagingDir, "gamos-asset.glb");
  const manifestPath = `${exportOutput}.manifest.json`;
  const assetName = "gamos-asset";

  // Select the configured model in the composer FIRST (the same M1/M2 walk:
  // the send button stays disabled without a model selection on a fresh session).
  const modelSelection = await selectModelInComposer();
  journey.m3ModelSelection = modelSelection;
  const taskText = [
    "Add a cube named GamosM3Cube to this Blender scene, save it, then export the scene as a glTF binary asset for cross-engine use.",
    "",
    "GAMOS-M3-CROSS-ENGINE-TASK",
    JSON.stringify({ blendFile: boot.blendFile, exportOutput }, null, 1),
    "",
    "Use the blender-engine plugin's typed scene_modify and asset_export tools (typed operations only — no arbitrary Python). Modify with save=true, then export with format GLTF to the declared output path.",
  ].join("\n");

  // --- Leg 1: PERMISSION DENIAL — the source mutation must be blocked. ---
  await submitComposerTask(taskText, "M3J4-deny");
  const denialApprovals = [];
  const denialResult = await waitForTurnCompletion({ timeout: MAX_WAIT, autoApprove: true, respondKind: "rejectOnce", approvals: denialApprovals });
  const denialTimeline = denialResult.timeline ?? "";
  await screenshot("M3J4-denied-turn");
  const blendUnchanged = sha256File(boot.blendFile) === boot.baselineSha256;
  const exportAbsent = !existsSync(exportOutput) && !existsSync(manifestPath);
  const denialTextSeen = /NOT performed|denied|rejected/i.test(denialTimeline);
  M3_EVIDENCE.crossEngine.denial = {
    approvals: denialApprovals.map((a) => ({ kind: a.kind, result: a.result })),
    blend_sha256_unchanged: blendUnchanged,
    export_artifact_absent: exportAbsent,
    denial_summary_seen: denialTextSeen,
    timeline_excerpt: denialTimeline.slice(0, 600),
  };
  const denialPass = denialResult.completed && denialApprovals.some((a) => String(a.result).includes("rejected") || a.kind === "rejectOnce") && blendUnchanged && exportAbsent;
  if (!denialPass) {
    recordStage("M3J4", "fail", {
      task: "cross-engine §11 leg (denial path)",
      denial: M3_EVIDENCE.crossEngine.denial,
      reason: "the permission denial did not block the engine mutation (hash changed, artifact produced, or turn incomplete)",
    });
    throw new Error("M3J4 denial leg failed — the permission gate did not block the native engine mutation (see stage detail)");
  }
  log("M3J4 denial leg verified: source mutation blocked at the permission gate (hash unchanged, no staging artifact)");

  // --- Leg 2: APPROVED execution — the real source prep + GLB export. ---
  const approvedApprovals = [];
  let result = await (async () => {
    await submitComposerTask(taskText, "M3J4-approve");
    return waitForTurnCompletion({ timeout: MAX_WAIT, autoApprove: true, respondKind: "allowOnce", approvals: approvedApprovals });
  })();
  if (result.turnFailed) {
    log("M3J4: approved turn failed (chat-error-banner) — resubmitting once (real-user retry)");
    await screenshot("M3J4-approved-turn-failed");
    await dismissErrorBanner();
    await submitComposerTask(taskText, "M3J4-approve-retry");
    result = await waitForTurnCompletion({ timeout: MAX_WAIT, autoApprove: true, respondKind: "allowOnce", approvals: approvedApprovals });
  }
  const timeline = result.timeline ?? "";
  await screenshot("M3J4-approved-turn");
  // --- Real-artifact verification (the engine's own proof, re-verified) ---
  const blendChanged = sha256File(boot.blendFile) !== boot.baselineSha256;
  const exportExists = existsSync(exportOutput) && statSync(exportOutput).size > 0;
  const exportSha256 = exportExists ? sha256File(exportOutput) : null;
  const exportBytes = exportExists ? statSync(exportOutput).size : 0;
  const savedBlendSha256 = sha256File(boot.blendFile);
  // AUTHORITATIVE dispatch proof — the session store's part rows for the two
  // engine tools (the timeline UI does not render full tool-result JSON).
  M3_EVIDENCE.sessionDbPath = M3_EVIDENCE.sessionDbPath ?? findSessionStoreDb();
  const blenderParts = (await readEngineToolParts(["scene_modify", "asset_export"])) ?? {};
  const modifyPart = (blenderParts["scene_modify"] ?? []).find((p) => p.state?.status === "completed") ?? null;
  const exportPart = (blenderParts["asset_export"] ?? []).find((p) => p.state?.status === "completed") ?? null;
  const modifyOutput = toolPartOutput(modifyPart);
  const exportOutput_ = toolPartOutput(exportPart);
  const exportDispatchOk = Boolean(modifyPart) && Boolean(exportPart);
  if (result.paneSessionId && result.paneSessionId !== "draft") journey.sessionIds.push(result.paneSessionId);
  M3_EVIDENCE.crossEngine.savedBlendSha256 = savedBlendSha256;
  M3_EVIDENCE.crossEngine.exportArtifact = { path: exportOutput, bytes: exportBytes, sha256: exportSha256 };
  const exportLegPass = result.completed && blendChanged && exportExists && exportDispatchOk;
  if (!exportLegPass) {
    recordStage("M3J4", "fail", {
      task: "cross-engine §11 leg (approved export)",
      reason: `completed=${result.completed} blendChanged=${blendChanged} export=${exportExists} dispatch=${exportDispatchOk}`,
      modify_output: modifyOutput,
      export_output: exportOutput_,
      timeline_excerpt: timeline.slice(0, 800),
    });
    throw new Error(`M3J4 approved export leg failed (completed=${result.completed}, blendChanged=${blendChanged}, export=${exportExists}/${exportDispatchOk})`);
  }
  log(`M3J4 export leg verified: GLB staged (${exportBytes} bytes, sha256=${exportSha256})`);

  // --- The pipeline-side manifest persist (the ORCHESTRATION-LAYER role —
  //     same disclosure class as the .blend bootstrap: the REAL committed
  //     facility runs on the AUTHORITATIVE session-store tool output; the
  //     in-app turns did and will do the engine work). §7 step 6 / §10. ---
  const exportResultFile = join(EVIDENCE_DIR, "m3-asset-export-result.json");
  writeFileSync(exportResultFile, JSON.stringify(exportOutput_, null, 2));
  const exportedAt = new Date().toISOString();
  const manifestBuild = runM3ManifestBuildCli(exportResultFile, manifestPath, exportedAt);
  const manifestExists = existsSync(manifestPath);
  const manifestSha256 = manifestExists ? sha256File(manifestPath) : null;
  const manifestDoc = manifestExists ? JSON.parse(readFileSync(manifestPath, "utf8")) : null;
  const manifestArtifactRecord = manifestDoc?.artifact ?? null;
  const manifestStatusExported = manifestDoc?.status === "exported";
  const manifestIntegrityMatchesArtifact =
    manifestArtifactRecord !== null &&
    manifestArtifactRecord.sha256 === exportSha256 &&
    manifestArtifactRecord.byteLength === exportBytes;
  M3_EVIDENCE.crossEngine.manifest = {
    path: manifestPath,
    sha256: manifestSha256,
    status: manifestDoc?.status ?? null,
    manifestId: manifestDoc?.manifestId ?? null,
    artifact: manifestArtifactRecord,
    builtFrom: "the authoritative session-store asset_export part output, through buildExportedManifest (the M3.4 fail-closed facility)",
    build_evidence: manifestBuild,
  };
  if (!manifestExists || !manifestStatusExported || !manifestIntegrityMatchesArtifact) {
    recordStage("M3J4", "fail", {
      task: "cross-engine §11 leg (manifest persist)",
      reason: `manifest exists=${manifestExists} status=${manifestDoc?.status} integrityMatch=${manifestIntegrityMatchesArtifact}`,
      manifest_build: manifestBuild,
    });
    throw new Error("M3J4 manifest persist failed — the interchange manifest was not built/validated from the real export record");
  }
  log(`M3J4 manifest persisted: ${manifestPath} (status exported, artifact integrity matches the staged GLB, sha256=${manifestSha256})`);

  // --- Leg 3: manifest validation + Babylon integration (in-app). The agent
  //     READS the manifest through the app's own Read tool (the
  //     manifest-validate agent-tool pattern) and passes the manifest's
  //     artifact record as expectedIntegrity — the typed op verifies the
  //     artifact hash fail-closed. ---
  const integrateTaskText = [
    "Validate the cross-engine interchange manifest for the exported asset, then integrate the asset into the Babylon project.",
    "",
    "GAMOS-M3-INTEGRATE-TASK",
    JSON.stringify({ manifestPath, projectRoot: fixture.projectRoot, artifactPath: exportOutput, assetName }, null, 1),
    "",
    "First Read the manifest file to validate its exported status and artifact integrity record, then use the babylon-engine plugin's typed asset_integrate tool with that record as expectedIntegrity.",
  ].join("\n");
  const integrateApprovals = [];
  let integrateResult = await (async () => {
    await submitComposerTask(integrateTaskText, "M3J4-integrate");
    return waitForTurnCompletion({ timeout: MAX_WAIT * 2, autoApprove: true, respondKind: "allowOnce", approvals: integrateApprovals });
  })();
  if (integrateResult.turnFailed) {
    log("M3J4 integrate: turn failed (chat-error-banner) — resubmitting once (real-user retry)");
    await screenshot("M3J4-integrate-turn-failed");
    await dismissErrorBanner();
    await submitComposerTask(integrateTaskText, "M3J4-integrate-retry");
    integrateResult = await waitForTurnCompletion({ timeout: MAX_WAIT * 2, autoApprove: true, respondKind: "allowOnce", approvals: integrateApprovals });
  }
  await screenshot("M3J4-integrate-turn");
  if (integrateResult.paneSessionId && integrateResult.paneSessionId !== "draft") journey.sessionIds.push(integrateResult.paneSessionId);
  // AUTHORITATIVE evidence: the Read part (the manifest the agent actually
  // read) + the asset_integrate part (registry entry + staged file).
  const integrateParts = (await readEngineToolParts(["asset_integrate", "Read"])) ?? {};
  const integratePart = (integrateParts["asset_integrate"] ?? []).find((p) => p.state?.status === "completed") ?? null;
  const integrateOutput = toolPartOutput(integratePart);
  const readParts = integrateParts["Read"] ?? [];
  const manifestReadPart = readParts.find((p) => String(p.state?.input?.file_path ?? "").includes("staging")) ?? readParts[readParts.length - 1] ?? null;
  const stagedAssetPath = join(fixture.projectRoot, "public", "assets", `${assetName}.glb`);
  const stagedAssetExists = existsSync(stagedAssetPath);
  const stagedAssetSha256 = stagedAssetExists ? sha256File(stagedAssetPath) : null;
  const registryPath = join(fixture.projectRoot, "src", "gamos-assets.json");
  const registryDoc = existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, "utf8")) : null;
  const registryEntry = (registryDoc?.assets ?? []).find((a) => a.assetName === assetName) ?? null;
  const registryCarriesHash = registryEntry?.sha256 === exportSha256;
  const stagedMatchesExport = stagedAssetExists && stagedAssetSha256 === exportSha256;
  M3_EVIDENCE.crossEngine.integration = {
    turn_completed: integrateResult.completed,
    manifest_read_part: manifestReadPart ? { tool: manifestReadPart.tool, input: manifestReadPart.state?.input } : null,
    integrate_output: integrateOutput,
    staged_asset: { path: stagedAssetPath, exists: stagedAssetExists, sha256: stagedAssetSha256, matches_export: stagedMatchesExport },
    registry: { path: registryPath, entry: registryEntry, carries_export_hash: registryCarriesHash },
  };
  const integratePass = integrateResult.completed && Boolean(integratePart) && stagedMatchesExport && registryCarriesHash;
  if (!integratePass) {
    recordStage("M3J4", "fail", {
      task: "cross-engine §11 leg (manifest validation + integration)",
      reason: `completed=${integrateResult.completed} integratePart=${Boolean(integratePart)} stagedMatchesExport=${stagedMatchesExport} registryCarriesHash=${registryCarriesHash}`,
      integration: M3_EVIDENCE.crossEngine.integration,
    });
    throw new Error(`M3J4 integrate leg failed (completed=${integrateResult.completed}, dispatch=${Boolean(integratePart)}, staged=${stagedMatchesExport}, registry=${registryCarriesHash})`);
  }
  log("M3J4 integrate leg verified: hash-verified GLB staged into public/assets + the committed registry entry carries the export hash");

  // --- Leg 4: build + run the integrated Babylon project (real toolchain). ---
  const babylonTaskText = [
    "Build this Babylon.js project and run its dev server so I can view it in the browser.",
    "",
    "GAMOS-M3-BABYLON-TASK",
    JSON.stringify({ projectRoot: fixture.projectRoot }, null, 1),
    "",
    "Use the babylon-engine plugin's typed project_build and project_run tools. Build first, then start the dev server and report its runtime URL.",
  ].join("\n");
  const runApprovals = [];
  let runResult = await (async () => {
    await submitComposerTask(babylonTaskText, "M3J4-run");
    return waitForTurnCompletion({ timeout: MAX_WAIT * 2, autoApprove: true, respondKind: "allowOnce", approvals: runApprovals });
  })();
  if (runResult.turnFailed) {
    log("M3J4 run: turn failed (chat-error-banner) — resubmitting once (real-user retry)");
    await screenshot("M3J4-run-turn-failed");
    await dismissErrorBanner();
    await submitComposerTask(babylonTaskText, "M3J4-run-retry");
    runResult = await waitForTurnCompletion({ timeout: MAX_WAIT * 2, autoApprove: true, respondKind: "allowOnce", approvals: runApprovals });
  }
  await screenshot("M3J4-run-turn");
  if (runResult.paneSessionId && runResult.paneSessionId !== "draft") journey.sessionIds.push(runResult.paneSessionId);
  const engineParts = (await readEngineToolParts(["project_build", "project_run"])) ?? {};
  const buildPart = (engineParts["project_build"] ?? []).find((p) => p.state?.status === "completed") ?? null;
  const buildOutput = toolPartOutput(buildPart);
  const runPart = (engineParts["project_run"] ?? []).find((p) => p.state?.status === "completed") ?? null;
  const runOutput = toolPartOutput(runPart);
  const runtimeUrl = runOutput?.runtimeUrl ?? null;
  const runtimePid = runOutput?.pid ?? null;
  const distIndex = join(fixture.projectRoot, "dist", "index.html");
  const distExists = existsSync(distIndex);
  const distSha256 = distExists ? sha256File(distIndex) : null;
  M3_EVIDENCE.crossEngine.babylon = { runtimeUrl, runtimePid, distSha256, build_output: buildOutput, run_output: runOutput };
  const buildRunPass = runResult.completed && distExists && Boolean(runtimeUrl) && Boolean(buildPart) && Boolean(runPart);
  if (!buildRunPass) {
    recordStage("M3J4", "fail", {
      task: "cross-engine §11 leg (build + run)",
      reason: `completed=${runResult.completed} dist=${distExists} url=${runtimeUrl} buildPart=${Boolean(buildPart)} runPart=${Boolean(runPart)}`,
      build_output: buildOutput,
      run_output: runOutput,
    });
    throw new Error(`M3J4 build/run leg failed (dist=${distExists}, url=${Boolean(runtimeUrl)})`);
  }
  log(`M3J4 build/run leg verified: dist sha256=${distSha256}, runtime ${runtimeUrl} (pid ${runtimePid})`);

  // --- THE ORIGINAL ZCODE BROWSER verification of the running experience
  //     with the INTEGRATED asset (the M3-G2 clause: a real Blender asset
  //     consumed by a real Babylon project, verified in the running Browser). ---
  const browser = await verifyBabylonRuntimeInZcodeBrowser(runtimeUrl);

  // --- Leg 5: cancellation through the plugin's typed stop surface. ---
  const stopTaskText = [
    "Stop the Babylon dev server now.",
    "",
    "GAMOS-M3-BABYLON-STOP",
    JSON.stringify({ pid: runtimePid }, null, 1),
    "",
    "Use the babylon-engine plugin's project_stop tool with the runtime pid.",
  ].join("\n");
  const stopApprovals = [];
  let stopResult = null;
  let stopSubmitted = false;
  if (runtimePid) {
    await submitComposerTask(stopTaskText, "M3J4-stop");
    stopSubmitted = true;
    stopResult = await waitForTurnCompletion({ timeout: MAX_WAIT, autoApprove: true, respondKind: "allowOnce", approvals: stopApprovals });
    await screenshot("M3J4-stop-result");
  }
  const urlStillServing = await probeHttp(runtimeUrl).catch(() => false);
  const stopVerified = stopSubmitted && stopResult?.completed && !urlStillServing;
  M3_EVIDENCE.crossEngine.cancellation = {
    stop_submitted: stopSubmitted,
    stop_turn_completed: stopResult?.completed ?? null,
    runtime_url_dead_after_stop: !urlStillServing,
    stop_verified: stopVerified,
  };

  const pass = exportLegPass && integratePass && buildRunPass && browser.pass && (stopVerified || !stopSubmitted && !runtimePid);
  recordStage("M3J4", pass ? "pass" : "fail", {
    task: "cross-engine §11 journey leg — composer → typed capability → permission (DENIAL then APPROVAL) → real Blender modify+GLB export → manifest persist (M3.4 facility) → in-app manifest Read + hash-verified asset_integrate → real vite build + dev-server run → ZCODE BROWSER verification of the integrated asset → project_stop cancellation",
    model_selected: { after: journey.m3ModelSelection?.after ?? null, clickedItem: journey.m3ModelSelection?.clickedItem ?? null },
    blender: { executable: BLENDER_PATH, rawVersion: boot.rawVersion },
    workspaces: { blender: M3_WORKSPACES.blender, babylon: M3_WORKSPACES.babylon, staging: stagingDir },
    denial_leg: M3_EVIDENCE.crossEngine.denial,
    export_leg: {
      turn_completed: result.completed,
      retried_after_turn_failure: Boolean(result.retriedAfterTurnFailure),
      permission_approvals: approvedApprovals.map((a) => ({ kind: a.kind, result: a.result })),
      baseline_blend_sha256: boot.baselineSha256,
      saved_blend_sha256: savedBlendSha256,
      blend_mutated: blendChanged,
      export_artifact: { path: exportOutput, bytes: exportBytes, sha256: exportSha256 },
      session_store_dispatch: {
        modify: modifyPart ? { status: modifyPart.state?.status, output: modifyOutput } : null,
        asset_export: exportPart ? { status: exportPart.state?.status, output: exportOutput_ } : null,
      },
      session_id: result.paneSessionId,
    },
    manifest_leg: M3_EVIDENCE.crossEngine.manifest,
    integrate_leg: {
      turn_completed: integrateResult.completed,
      permission_approvals: integrateApprovals.map((a) => ({ kind: a.kind, result: a.result })),
      manifest_read_through_app_read_tool: Boolean(manifestReadPart),
      integrate_output: integrateOutput,
      staged_asset: M3_EVIDENCE.crossEngine.integration.staged_asset,
      registry: M3_EVIDENCE.crossEngine.integration.registry,
      session_id: integrateResult.paneSessionId,
    },
    build_run_leg: {
      turn_completed: runResult.completed,
      permission_approvals: runApprovals.map((a) => ({ kind: a.kind, result: a.result })),
      dist: { path: distIndex, sha256: distSha256 },
      runtime: { url: runtimeUrl, pid: runtimePid },
      build_output: buildOutput,
      run_output: runOutput,
      session_id: runResult.paneSessionId,
    },
    browser_verification: browser.detail,
    cancellation: M3_EVIDENCE.crossEngine.cancellation,
    fixture: { projectRoot: fixture.projectRoot, lockfileSha256: fixture.lockfileSha256, committedFixture: BABYLON_FIXTURE_DIR, npm_ci_prepared: fixture.npmCiPrepared },
    honest_notes: [
      "the .blend bootstrap used the plugin's committed reviewed bridge (save_empty.py) as fixture preparation; every engine operation in the turns themselves ran through the app's MCP plugin path with real Blender",
      "the interchange manifest was persisted by the journey's ORCHESTRATION layer through the REAL M3.4 facility (buildExportedManifest) from the AUTHORITATIVE session-store asset_export output — the same disclosure class as the .blend bootstrap; the in-app manifest VALIDATION (the Read + the fail-closed expectedIntegrity check inside asset_integrate) is fully real",
      "the npm ci pre-staging is fixture preparation only (4GB cgroup); the in-turn project_build runs the REAL vite build and project_run starts the REAL dev server",
    ],
  });
  if (!pass) throw new Error(`M3J4 cross-engine pipeline leg failed (export=${exportLegPass}, integrate=${integratePass}, buildRun=${buildRunPass}, browser=${browser.pass}, stop=${stopVerified})`);
}
/** Copy the committed Babylon fixture project into the journey workspace. */
function stageBabylonFixtureWorkspace() {
  if (!existsSync(join(BABYLON_FIXTURE_DIR, "package.json"))) {
    throw new Error(`Babylon fixture project missing: ${BABYLON_FIXTURE_DIR}`);
  }
  rmSync(M3_WORKSPACES.babylon, { recursive: true, force: true });
  cpSync(BABYLON_FIXTURE_DIR, M3_WORKSPACES.babylon, { recursive: true });
  const lockSha = sha256File(join(M3_WORKSPACES.babylon, "package-lock.json"));
  // Fixture preparation (same disclosure class as the M3J4 .blend bootstrap):
  // a reproducible `npm ci` against the COMMITTED lockfile, run BEFORE the
  // turn so the in-turn memory profile is the real vite build + dev-server +
  // browser verification (the plugin's own integration suite covers the
  // in-turn install path; on this 4GB sandbox the npm-ci + renderer together
  // exceed the cgroup and the renderer gets OOM-killed mid-journey —
  // run-8 evidence: CDP "Internal error" during the M2J5-era journey leg). The install itself is
  // REAL and hash-recorded; the build/run inside the turn is unchanged.
  const npmCi = spawnSync("npm", ["ci", "--no-audit", "--no-fund"], {
    cwd: M3_WORKSPACES.babylon,
    encoding: "utf8",
    timeout: 600000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (npmCi.status !== 0) {
    throw new Error(`babylon fixture npm ci failed (exit ${npmCi.status}): ${String(npmCi.stderr ?? npmCi.stdout).slice(0, 400)}`);
  }
  const installedSha = sha256File(join(M3_WORKSPACES.babylon, "package-lock.json"));
  log(`M3J4 fixture staged: ${M3_WORKSPACES.babylon} (committed fixture, lockfile sha256=${lockSha}; npm ci OK — dependencies pre-installed for the in-turn build/run)`);
  return { projectRoot: M3_WORKSPACES.babylon, lockfileSha256: lockSha, preinstalledLockfileSha256: installedSha, npmCiPrepared: true };
}

/** Authoritative engine-tool evidence reader: the session store's `part` rows
 *  carry the COMPLETE tool outputs (input + output + status). The timeline UI
 *  is virtualized and its scrape capped at 2500 chars from the TOP — older
 *  rows only (run-10 lesson: the Blender task text hid the Babylon/Unity
 *  turns' results). Every engine-stage assertion reads the store instead. */
async function readEngineToolParts(patterns) {
  const dbPath = M3_EVIDENCE.sessionDbPath ?? findSessionStoreDb();
  if (!dbPath) return null;
  const { DatabaseSync } = await import("node:sqlite");
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return null;
  }
  try {
    const out = {};
    for (const pattern of patterns) {
      const rows = db.prepare("SELECT data FROM part WHERE data LIKE ? ORDER BY rowid ASC").all(`%${pattern}%`);
      out[pattern] = rows
        .map((r) => { try { return JSON.parse(String(r.data)); } catch { return null; } })
        .filter((p) => p && typeof p.tool === "string" && p.tool.includes(pattern));
    }
    return out;
  } finally {
    db.close();
  }
}

/** Open the ORIGINAL ZCode embedded browser (side pane <webview>) and verify
 *  the running Babylon experience WITH the integrated cross-engine asset:
 *  actual loaded URL, real rendered content (canvas + __GAMOS_BABYLON_READY__
 *  + __GAMOS_BABYLON_ASSETS_READY__), the INTEGRATED Blender-authored asset
 *  actually loaded through the registry-driven glTF loader (mesh names +
 *  vertices, no import error), and a live-behavior assertion (render loop
 *  producing frames, scene graph present). Machinery derived from the proven
 *  phase-b S7 walk (same open-tab launcher → toggle → ⌥⌘B fallbacks;
 *  navigate-then-wait-webview ordering; in-guest read as the authoritative
 *  proof). */
async function verifyBabylonRuntimeInZcodeBrowser(runtimeUrl) {
  const PANE_STATE_JS = assertPageJs("side pane state probe", `(() => {
    const toggle = document.querySelector('[data-testid="side-pane-toggle"]');
    const launcherRow = document.querySelector('[data-side-pane-open-tab-item="browser"]');
    const addTrigger = document.querySelector('[data-side-pane-add-trigger]');
    const addressInput = document.querySelector('[data-testid="browser-address-input"]');
    const paneHost = document.querySelector('.side-pane-open-tab-shell');
    const browserTabTrigger = document.querySelector('[data-side-pane-tab-id^="browser:"]');
    const activeTab = document.querySelector('[data-side-pane-tab-id][data-state="active"]');
    const launcherRows = Array.from(document.querySelectorAll('[data-side-pane-open-tab-item]')).map(e => e.getAttribute('data-side-pane-open-tab-item'));
    const visibleRect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
    return {
      toggleAriaLabel: toggle?.getAttribute('aria-label') ?? null,
      launcherRowPresent: Boolean(launcherRow),
      launcherRowRect: visibleRect(launcherRow),
      launcherRowIds: launcherRows,
      addTriggerPresent: Boolean(addTrigger),
      addTriggerRect: visibleRect(addTrigger),
      addressInputPresent: Boolean(addressInput),
      browserTabTriggerPresent: Boolean(browserTabTrigger),
      browserTabTriggerId: browserTabTrigger?.getAttribute('data-side-pane-tab-id') ?? null,
      activeTabId: activeTab?.getAttribute('data-side-pane-tab-id') ?? null,
      launcherShellRect: visibleRect(paneHost),
    };
  })()`);
  const paneState = async () => evalJs(PANE_STATE_JS).catch(() => null);
  const logPane = (tag) => paneState().then((s) => log(`pane-state [${tag}]: ${JSON.stringify(s)}`));
  const clickOpenTabBrowser = async () => {
    const r = await rectOf(`document.querySelector('[data-side-pane-open-tab-item="browser"]')`).catch(() => null);
    if (!r || !(r.w > 0)) return false;
    await cdpClickRect(r);
    return true;
  };
  const waitLauncherAndClick = async (timeoutMs) => {
    const found = await waitFor(async () => {
      const r = await rectOf(`document.querySelector('[data-side-pane-open-tab-item="browser"]')`).catch(() => null);
      return r && r.w > 0 ? r : false;
    }, { what: "browser launcher row in the opened side pane", timeout: timeoutMs }).catch(() => null);
    if (!found) return false;
    await cdpClickRect(found);
    return true;
  };
  const clickAddTriggerBrowser = async () => {
    const add = await rectOf(`document.querySelector('[data-side-pane-add-trigger]')`).catch(() => null);
    if (!add || !(add.w > 0)) return false;
    await cdpClickRect(add);
    await new Promise((r) => setTimeout(r, 700));
    const item = await rectOf(`(() => { const items = Array.from(document.querySelectorAll('[data-side-pane-open-tab-item="browser"], [role="menuitem"]')); return items.find(el => /browser|浏览器/i.test(el.innerText || '') && el.getBoundingClientRect().width > 0) ?? null; })()`).catch(() => null);
    if (item && item.w > 0) { await cdpClickRect(item); return true; }
    return false;
  };
  const opened = await (async () => {
    await logPane("initial");
    if (await clickOpenTabBrowser()) return "side-pane open-tab launcher row (browser)";
    for (let toggleAttempt = 1; toggleAttempt <= 3; toggleAttempt++) {
      const before = await paneState();
      const toggle = await rectOf(`document.querySelector('[data-testid="side-pane-toggle"]')`).catch(() => null);
      if (!toggle || !(toggle.w > 0)) { log(`toggle attempt ${toggleAttempt}: side-pane-toggle not clickable`); break; }
      await cdpClickRect(toggle);
      if (await waitLauncherAndClick(12000)) return `side-pane-toggle (attempt ${toggleAttempt}) → open-tab launcher row (browser)`;
      if (await clickAddTriggerBrowser()) return `side-pane-toggle (attempt ${toggleAttempt}) → add-trigger → open-tab menu → browser item`;
      await logPane(`after toggle attempt ${toggleAttempt}`);
      const after = await paneState();
      const expanded = Boolean(before && after && after.toggleAriaLabel !== before.toggleAriaLabel);
      if (expanded) break;
    }
    for (let i = 0; i < 4; i++) {
      await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "b", code: "KeyB", windowsVirtualKeyCode: 66, nativeVirtualKeyCode: 66, modifiers: 5 });
      await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "b", code: "KeyB", windowsVirtualKeyCode: 66, nativeVirtualKeyCode: 66, modifiers: 5 });
      if (await waitLauncherAndClick(9000)) return `⌥⌘B CDP shortcut → open-tab launcher row (browser) (attempt ${i + 1})`;
      if (await clickAddTriggerBrowser()) return `⌥⌘B CDP shortcut (attempt ${i + 1}) → add-trigger → open-tab menu → browser item`;
      await logPane(`after ⌥⌘B attempt ${i + 1}`);
      await new Promise((r) => setTimeout(r, 800));
    }
    await logPane("all fallbacks exhausted");
    return null;
  })();
  if (!opened) throw new Error("no browser entry found to open the embedded browser pane (launcher row, side-pane-toggle, ⌥⌘B shortcut, add-trigger fallbacks all exhausted — see pane-state logs)");
  log(`M3J4 browser pane opened via: ${opened}`);
  let addressInputOk = false;
  for (let attempt = 0; attempt < 3 && !addressInputOk; attempt++) {
    if (attempt > 0) {
      await logPane(`address-input retry ${attempt} (pre)`);
      const tabTrigger = await rectOf(`document.querySelector('[data-side-pane-tab-id^="browser:"]')`).catch(() => null);
      if (tabTrigger && tabTrigger.w > 0) {
        await cdpClickRect(tabTrigger);
      } else {
        const launcherRow = await rectOf(`document.querySelector('[data-side-pane-open-tab-item="browser"]')`).catch(() => null);
        if (!launcherRow || !(launcherRow.w > 0)) break;
        await cdpClickRect(launcherRow);
      }
      await new Promise((r) => setTimeout(r, 600));
    }
    addressInputOk = await waitForTid("browser-address-input", { timeout: attempt === 0 ? 30000 : 20000 })
      .then(() => true)
      .catch(() => false);
    if (!addressInputOk) await logPane(`address-input not mounted after attempt ${attempt}`);
  }
  if (!addressInputOk) throw new Error(`M3J4 browser pane opened ("${opened}") but browser-address-input never mounted (see pane-state logs)`);
  await screenshot("M3J4-browser-open");
  // Navigate FIRST — then wait for the webview (the guest only mounts after a
  // confirmed navigation; the phase-b S7 lesson).
  // Pre-navigation probe: the runtime URL must still be serving (the dev
  // server keeps running after project_run; an early death is an honest
  // failure with a clear reason, not a browser-integration failure).
  const runtimeServing = await probeHttp(runtimeUrl).catch(() => false);
  log(`M3J4 browser navigation: runtime URL ${runtimeUrl} serving=${runtimeServing}`);
  if (!runtimeServing) {
    throw new Error(`M3J4: the Babylon runtime URL ${runtimeUrl} is not serving before browser navigation — the dev server died after project_run (see the project_run tool output in the session store)`);
  }
  await clickAndType("browser-address-input", runtimeUrl, { timeout: 20000, clearFirst: true });
  await pressKey("Enter");
  await waitForTid("browser-webview", { timeout: 45000, visible: false });
  // PRIMARY verification — read the guest THROUGH the webview element itself:
  // getURL() is the guest's actual current URL; executeJavaScript runs INSIDE
  // the guest WebContents. This is the ZCode Browser looking at the REAL
  // running Babylon experience.
  let guestDebugClock = null;
  const GUEST_READ_JS = assertPageJs("babylon guest in-page read", `(async () => {
    const w = document.querySelector('[data-testid="browser-webview"]');
    if (!w) return { error: 'no webview element' };
    const url = typeof w.getURL === 'function' ? w.getURL() : null;
    let page = null;
    try {
      const raw = await w.executeJavaScript('JSON.stringify({ url: location.href, title: document.title, canvasPresent: Boolean(document.getElementById("renderCanvas")), ready: window.__GAMOS_BABYLON_READY__ === true, meshes: (window.__GAMOS_BABYLON_SCENE__ ? window.__GAMOS_BABYLON_SCENE__.meshes.length : null), assetsReady: window.__GAMOS_BABYLON_ASSETS_READY__ === true, assetsError: window.__GAMOS_BABYLON_ASSET_ERROR__ ?? null, assetsLoaded: (window.__GAMOS_BABYLON_ASSETS__ ? window.__GAMOS_BABYLON_ASSETS__.loaded : null), body: (document.body?.innerText ?? "").trim().slice(0, 200) })');
      page = JSON.parse(raw);
    } catch (e) { page = { error: String((e && e.message) || e) }; }
    return { url, page, src: w.getAttribute('src') };
  })()`);
  const guest = await waitFor(async () => {
    const r = await evalJs(GUEST_READ_JS, { awaitPromise: true }).catch(() => null);
    if (guestDebugClock === null) guestDebugClock = Date.now();
    if (Date.now() - guestDebugClock > 20000) {
      guestDebugClock = Date.now();
      log(`M3J4 guest-read diagnostics: ${JSON.stringify(r).slice(0, 400)}`);
    }
    if (!r || r.error) return false;
    if (!/^http:\/\/127\.0\.0\.1:\d+\//.test(r.url ?? "")) return false;
    if (r.page?.ready !== true) return false;
    if (r.page?.canvasPresent !== true) return false;
    if (r.page?.assetsReady !== true) return false;
    return r;
  }, { what: `webview guest actually running the Babylon experience with the integrated asset loaded (in-guest read: URL + canvas + __GAMOS_BABYLON_READY__ + __GAMOS_BABYLON_ASSETS_READY__)`, timeout: 300000, interval: 4000 });
  await new Promise((r) => setTimeout(r, 1200));
  await screenshot("M3J4-babylon-runtime-in-zcode-browser");
  // LIVE-BEHAVIOR assertion: the render loop must be producing frames
  // (fps > 0 across two samples — a static DOM cannot fake this) and the
  // scene graph must be live (mesh present).
  const BEHAVIOR_JS = assertPageJs("babylon live behavior read", `(async () => {
    const w = document.querySelector('[data-testid="browser-webview"]');
    if (!w) return { error: 'no webview element' };
    try {
      const raw = await w.executeJavaScript('JSON.stringify((() => { const e = window.__GAMOS_BABYLON_ENGINE__; const s = window.__GAMOS_BABYLON_SCENE__; const a = window.__GAMOS_BABYLON_ASSETS__; return { enginePresent: Boolean(e), scenePresent: Boolean(s), fps1: e && typeof e.getFps === "function" ? Math.round(e.getFps() * 10) / 10 : null, meshCount: s && Array.isArray(s.meshes) ? s.meshes.length : null, assetsReady: window.__GAMOS_BABYLON_ASSETS_READY__ === true, assetsError: window.__GAMOS_BABYLON_ASSET_ERROR__ ?? null, integratedAsset: a && Array.isArray(a.loaded) && a.loaded.length > 0 ? a.loaded[0] : null, canvasSize: (() => { const c = document.getElementById("renderCanvas"); return c ? [c.width, c.height] : null; })() }; })())');
      return JSON.parse(raw);
    } catch (e) { return { error: String((e && e.message) || e) }; }
  })()`);
  const behavior1 = await evalJs(BEHAVIOR_JS, { awaitPromise: true }).catch(() => null);
  await new Promise((r) => setTimeout(r, 2500));
  const behavior2 = await evalJs(BEHAVIOR_JS, { awaitPromise: true }).catch(() => null);
  const fpsLive = Number(behavior1?.fps1) > 0 || Number(behavior2?.fps1) > 0;
  const meshLive = Number(behavior1?.meshCount) >= 1 || Number(behavior2?.meshCount) >= 1;
  const readyFlag = guest.page?.ready === true;
  const titleOk = /babylon/i.test(guest.page?.title ?? "");
  const urlOk = /^http:\/\/127\.0\.0\.1:\d+\//.test(guest.url ?? "");
  const canvasOk = guest.page?.canvasPresent === true;
  // LIVE behavior: the engine handle must be present AND producing frames
  // (fps > 0 — only a live render loop reports that), with a live scene graph.
  const behaviorOk = Boolean(behavior1?.enginePresent) && fpsLive && meshLive;
  // THE M3-G2 CLAUSE: the INTEGRATED Blender-authored asset must actually be
  // consumed by the running experience — the registry-driven loader imported
  // it (loaded entry with mesh names), the import settled with no error, and
  // the imported mesh graph carries real vertices (a static DOM cannot fake
  // a glTF mesh import).
  const integratedLoaded = (guest.page?.assetsLoaded ?? []).find((a) => a?.assetName === "gamos-asset") ?? null;
  const behaviorIntegrated = behavior1?.integratedAsset ?? behavior2?.integratedAsset ?? null;
  const integratedAssetSeen = integratedLoaded ?? behaviorIntegrated;
  const integratedAssetOk =
    Boolean(integratedAssetSeen) &&
    Array.isArray(integratedAssetSeen.meshNames) &&
    integratedAssetSeen.meshNames.length > 0 &&
    Number(integratedAssetSeen.vertices) > 0;
  const assetsReadyFlag = guest.page?.assetsReady === true || behavior1?.assetsReady === true || behavior2?.assetsReady === true;
  const noAssetError = !(guest.page?.assetsError ?? behavior1?.assetsError ?? behavior2?.assetsError);
  const detail = {
    opened_via: opened,
    guest_url: guest.url,
    page: guest.page,
    behavior_samples: [behavior1, behavior2],
    assertions: {
      url_matches_runtime: urlOk,
      canvas_present: canvasOk,
      babylon_ready_flag: readyFlag,
      title_is_fixture: titleOk,
      live_render_or_scene: behaviorOk,
      integrated_asset_loaded: integratedAssetOk,
      integrated_assets_ready: assetsReadyFlag,
      integrated_asset_no_error: noAssetError,
    },
    integrated_asset: integratedAssetSeen,
    honest_note: "in-guest reads through the ZCode Browser's own webview element (executeJavaScript inside the guest WebContents) — the authoritative proof class from the proven phase-b S7 walk; the integrated-asset assertions read the fixture's registry-driven loader state (__GAMOS_BABYLON_ASSETS__/__GAMOS_BABYLON_ASSETS_READY__/__GAMOS_BABYLON_ASSET_ERROR__)",
  };
  M3_EVIDENCE.crossEngine.babylonBrowser = detail;
  const pass = urlOk && canvasOk && readyFlag && behaviorOk && integratedAssetOk && assetsReadyFlag && noAssetError;
  return { pass, detail };
}

/** M3J5 — the Unity §11 honest-failure leg (item 14): the typed asset_import
 *  attempt on the real cross-engine artifact surfaces the structured
 *  unity-editor-unavailable state — the licensed-editor prerequisite is
 *  external and never fabricated (directive §8; M3-G1 stays blocked). */
async function stageM3J5() {
  // Stage the committed Unity project fixture into the workspace.
  if (!existsSync(join(UNITY_FIXTURE_DIR, "ProjectSettings", "ProjectVersion.txt"))) {
    throw new Error(`Unity fixture project missing: ${UNITY_FIXTURE_DIR}`);
  }
  rmSync(M3_WORKSPACES.unity, { recursive: true, force: true });
  cpSync(UNITY_FIXTURE_DIR, M3_WORKSPACES.unity, { recursive: true });
  // The cross-engine artifact from the M3J4 export leg (the GLB the Unity
  // import leg would stage under Assets/ on a licensed runner).
  const stagingArtifact = join(TASK_WORKSPACE, "staging", "gamos-asset.glb");
  if (!existsSync(stagingArtifact)) {
    throw new Error(`M3J5 requires the M3J4 export artifact (${stagingArtifact}) — the Unity negative leg runs against the REAL cross-engine artifact`);
  }

  const taskText = [
    "Import this cross-engine GLB asset into the Unity project.",
    "",
    "GAMOS-M3-UNITY-TASK",
    JSON.stringify({ projectRoot: M3_WORKSPACES.unity, artifactPath: stagingArtifact }, null, 1),
    "",
    "Use the unity-engine plugin's typed asset_import tool to stage the artifact under Assets/ and import it through the real Unity Editor.",
  ].join("\n");

  const approvals = [];
  let result = await (async () => {
    await submitComposerTask(taskText, "M3J5");
    return waitForTurnCompletion({ timeout: MAX_WAIT, autoApprove: true, respondKind: "allowOnce", approvals });
  })();
  if (result.turnFailed) {
    log("M3J5: turn failed (chat-error-banner) — resubmitting once (real-user retry)");
    await screenshot("M3J5-turn-failed");
    await dismissErrorBanner();
    await submitComposerTask(taskText, "M3J5-retry");
    result = await waitForTurnCompletion({ timeout: MAX_WAIT, autoApprove: true, respondKind: "allowOnce", approvals });
  }
  const timeline = result.timeline ?? "";
  await screenshot("M3J5-turn-result");
  if (result.paneSessionId && result.paneSessionId !== "draft") journey.sessionIds.push(result.paneSessionId);

  // AUTHORITATIVE assertions — session-store part rows. The asset_import
  // result must either surface the structured honest-unavailable state (no
  // licensed editor on this machine — the staged evidence carried in the
  // failure) OR the real imported success shape (a licensed runner).
  const unityParts = (await readEngineToolParts(["asset_import", "unity_asset_import"])) ?? {};
  const importPart = (unityParts["asset_import"] ?? []).find((p) => String(p.tool).includes("unity-engine")) ?? (unityParts["asset_import"] ?? [])[0] ?? null;
  const importOutput = toolPartOutput(importPart);
  const importState = importPart?.state ?? null;
  const importText = JSON.stringify(importState ?? {});
  M3_EVIDENCE.sessionDbPath = M3_EVIDENCE.sessionDbPath ?? findSessionStoreDb();
  // The honest unavailable state: the engine reports the missing licensed
  // editor explicitly (a licensed runner would instead perform the REAL
  // import — both outcomes are acceptable; anything else fails the stage).
  const honestUnavailable =
    /unity-editor-unavailable/i.test(importText) ||
    (Boolean(importOutput) && importOutput.ok === false && /unavailable|license/i.test(JSON.stringify(importOutput)));
  const realImport =
    Boolean(importOutput) &&
    importOutput.ok === true &&
    importOutput.imported === true &&
    typeof importOutput.guid === "string" &&
    importOutput.guid.length > 0;
  const negativePathSeen = honestUnavailable || realImport;
  M3_EVIDENCE.unity.honestUnavailable = honestUnavailable;
  const pass = result.completed && negativePathSeen;
  recordStage("M3J5", pass ? "pass" : "fail", {
    task: "Unity §11 honest-failure leg — the typed asset_import attempt on the REAL cross-engine artifact surfaces the structured editor-unavailable state (the meaningful failure path, §11 item 14)",
    fixture: { projectRoot: M3_WORKSPACES.unity, committedFixture: UNITY_FIXTURE_DIR, artifact: stagingArtifact },
    outcome: honestUnavailable ? "honest-unavailable (no licensed Unity Editor on this machine — never fabricated)" : realImport ? "real-import (licensed editor present)" : "neither",
    turn: {
      completed: result.completed,
      retried_after_turn_failure: Boolean(result.retriedAfterTurnFailure),
      permission_approvals: approvals.map((a) => ({ kind: a.kind, result: a.result })),
      session_id: result.paneSessionId,
    },
    honest_unavailable_seen: honestUnavailable,
    session_store_evidence: {
      asset_import: importPart ? { status: importPart.state?.status, output: importOutput, error: importPart.state?.error ?? null } : null,
    },
    timeline_excerpt: timeline.slice(0, 800),
    gate_note: "M3-G1 remains NOT PASSING while the editor prerequisite is external — this stage proves the honest failure path (§11 item 14), not a passing Unity integration gate",
  });
  if (!pass) throw new Error(`M3J5 Unity leg failed (completed=${result.completed}, negative=${negativePathSeen})`);
}


/** M3J6 — the engine tool invocations and results are recorded in the EXISTING
 *  session store (SQLite). The v4 session store is the authoritative history. */
async function stageM3J6() {
  const dbPath = findSessionStoreDb();
  if (!dbPath) throw new Error(`M3J6 session-store SQLite DB not found under the journey home; journey-home db diagnostic: ${journeyHomeDbDiagnostic()}`);
  M3_EVIDENCE.sessionDbPath = dbPath;
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(dbPath, { readOnly: true });
  let engineToolRecords = [];
  let sessionRows = [];
  let tables = [];
  try {
    tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => String(r.name));
    // Sessions created by the journey legs.
    for (const sid of journey.sessionIds) {
      try {
        const rows = db.prepare("SELECT * FROM session WHERE id = ?").all(sid);
        sessionRows.push({ sessionId: sid, present: rows.length > 0 });
      } catch {
        // table name may differ; fall back to a content search below
        sessionRows.push({ sessionId: sid, present: "unknown-schema" });
      }
    }
    // Content search: any table with a TEXT column holding the engine tool names.
    for (const table of tables) {
      if (/dwf/i.test(table)) continue;
      let cols;
      try { cols = db.prepare(`PRAGMA table_info(${table})`).all(); } catch { continue; }
      const textCols = cols.filter((c) => /TEXT|VARCHAR/i.test(String(c.type ?? "")) || String(c.type ?? "") === "").map((c) => String(c.name));
      for (const col of textCols) {
        for (const marker of ["mcp__plugin_blender-engine", "mcp__plugin_babylon-engine", "mcp__plugin_unity-engine", "GamosM3Cube", "asset_export", "asset_integrate", "asset_import", "gamos-asset", "unity-editor-unavailable"]) {
          try {
            const n = db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${col} LIKE ?`).get(`%${marker}%`).n;
            if (n > 0) engineToolRecords.push({ table, col, marker, rows: n });
          } catch { /* column not searchable — skip */ }
        }
      }
    }
  } finally {
    db.close();
  }
  const markers = new Set(engineToolRecords.map((r) => r.marker));
  const blenderRecorded = markers.has("mcp__plugin_blender-engine") || markers.has("GamosM3Cube");
  const babylonRecorded = markers.has("mcp__plugin_babylon-engine") || markers.has("asset_integrate");
  const unityRecorded = markers.has("mcp__plugin_unity-engine") || markers.has("unity-editor-unavailable");
  const crossEnginePipelineRecorded = markers.has("asset_export") && markers.has("asset_integrate");
  const sessionsPresent = journey.sessionIds.length > 0 && sessionRows.every((s) => s.present === true || s.present === "unknown-schema");
  const evidencePath = join(EVIDENCE_DIR, "m3-session-store.json");
  writeFileSync(evidencePath, JSON.stringify({ db_path: dbPath, tables, session_rows: sessionRows, engine_tool_records: engineToolRecords, checked_at: new Date().toISOString() }, null, 2));
  const pass = blenderRecorded && babylonRecorded && unityRecorded && crossEnginePipelineRecorded && sessionsPresent;
  recordStage("M3J6", pass ? "pass" : "fail", {
    task: "engine tool invocations + results recorded in the existing session store",
    db_path: dbPath,
    sessions: sessionRows,
    engine_tool_markers_found: [...markers],
    blender_recorded: blenderRecorded,
    babylon_recorded: babylonRecorded,
    unity_recorded: unityRecorded,
    cross_engine_pipeline_recorded: crossEnginePipelineRecorded,
    evidence: evidencePath,
  });
  if (!pass) throw new Error(`M3J6 session store missing engine records (blender=${blenderRecorded}, babylon=${babylonRecorded}, unity=${unityRecorded}, pipeline=${crossEnginePipelineRecorded}, sessions=${JSON.stringify(sessionRows)})`);
}

/* ------------------------------------------------------------------ */
/* M3 main                                                             */
/* ------------------------------------------------------------------ */

const M3_STAGE_MAP = {
  M3J0: stageS0, // app + CDP + rendered workspace surface (phase-b/M1/M2 walk)
  M3J1: stageS1, // first-run login entry walk (Skip — provider configured in M3J2)
  M3J2: stageS2, // local deterministic endpoint provider via the real settings surface
  M3J3: stageM3J3, // engine plugins enabled + registry resolution + the engine-aware GamePlan (§11 1–4)
  M3J4: stageM3J4, // THE §11 cross-engine pipeline (denial → export → manifest → integrate → build/run → Browser → stop)
  M3J5: stageM3J5, // Unity honest-failure leg (asset_import surfaces the structured unavailable state)
  M3J6: stageM3J6, // session-store history verification
};

// The prior chunk's summary block (chunked-run continuity — see main()).
let priorM3 = null;

async function main() {
  log(`Gamos M3 UI journey — mode=${MODE} stages=${STAGES.join(",")} run_token=${RUN_TOKEN}`);
  log(`evidence dir: ${EVIDENCE_DIR}`);
  // Chunked-run evidence continuity: the sandbox bash budget (10 min/call) is
  // shorter than a full journey run, so the journey is executed in stage
  // chunks against the SAME persisted PHASEB_HOME (provider config, enabled
  // plugins, session store all live on disk). This merge loads the previous
  // chunk's recorded stages so the final verdict covers every mandatory
  // stage exactly once — each stage's detail carries its own run token and
  // timestamps (honest: stage rows are only recorded by the run that
  // executed them; this merge never fabricates a stage row).
  const evidenceFilePath = join(EVIDENCE_DIR, "m3-journey-evidence.json");
  try {
    if (existsSync(evidenceFilePath)) {
      const prior = JSON.parse(readFileSync(evidenceFilePath, "utf8"));
      if (prior && typeof prior === "object" && prior.stages && typeof prior.stages === "object") {
        const mergedCount = Object.keys(prior.stages).length;
        for (const [id, detail] of Object.entries(prior.stages)) {
          if (!evidence.stages[id]) evidence.stages[id] = detail;
        }
        if (Array.isArray(prior.failures)) {
          for (const f of prior.failures) {
            if (!evidence.failures.some((x) => x.stage === f.stage && x.error === f.error)) evidence.failures.push(f);
          }
        }
        if (prior.m3 && typeof prior.m3 === "object") priorM3 = prior.m3;
        log(`evidence continuity: merged ${mergedCount} prior stage rows from ${evidenceFilePath}`);
      }
    }
  } catch (e) {
    log(`evidence continuity: no readable prior evidence (${e.message}) — starting fresh`);
  }
  if (!BLENDER_PATH) {
    log("WARNING: M3_BLENDER_PATH is not set — M3J4 will fail honestly (directive §8: no engine means an honest stage failure, never a mock)");
  }
  await ensureDisplay();
  stageDesktopOut();
  evidence.environment.enginePluginDevStaging = stageEnginePluginsForDevAgent();
  if (LOCAL_MODEL) await startLocalModelServer();
  try {
    if (MODE === "dev") await launchDev();
    else if (MODE === "prod") await launchProd();
    else if (MODE === "prod-http") await launchProdHttp();
    else if (MODE !== "attach") throw new Error(`unknown PHASEB_MODE ${MODE}`);
    for (const stage of STAGES) {
      const fn = M3_STAGE_MAP[stage];
      if (!fn) { recordStage(stage, "fail", `unknown M3 stage id ${stage}`); continue; }
      activeCanonicalStageId = stage;
      try {
        await fn();
      } catch (e) {
        // A stage that already recorded its own (rich) failure detail keeps it —
        // the runner must not overwrite it with the bare error message (same
        // lesson as M1 run 42225436307).
        if (!evidence.stages[stage]) recordStage(stage, "fail", e.message);
        evidence.failures.push({ stage, error: e.message });
        await screenshot(`${stage}-failure`).catch(() => {});
        await dumpDom(`${stage}-failure`).catch(() => {});
      } finally {
        activeCanonicalStageId = null;
      }
    }
  } finally {
    await stopApp();
    stopLocalModelServer();
  }
  evidence.finished_at = new Date().toISOString();
  const nonPass = MANDATORY_STAGES
    .filter((id) => evidence.stages[id] && evidence.stages[id].status !== "pass")
    .map((id) => ({ id, status: evidence.stages[id]?.status, detail: typeof evidence.stages[id]?.detail === "string" ? evidence.stages[id]?.detail : JSON.stringify(evidence.stages[id]?.detail ?? null).slice(0, 300) }));
  const missing = MANDATORY_STAGES.filter((id) => !evidence.stages[id]);
  const verdict = nonPass.length === 0 && missing.length === 0 ? "pass" : "fail";
  evidence.m3 = {
    cross_engine_journey: {
      denial_blocked_mutation: M3_EVIDENCE.crossEngine.denial?.blend_sha256_unchanged ?? null,
      saved_blend_sha256: M3_EVIDENCE.crossEngine.savedBlendSha256,
      export_artifact: M3_EVIDENCE.crossEngine.exportArtifact,
      interchange_manifest: M3_EVIDENCE.crossEngine.manifest
        ? { path: M3_EVIDENCE.crossEngine.manifest.path, sha256: M3_EVIDENCE.crossEngine.manifest.sha256, status: M3_EVIDENCE.crossEngine.manifest.status, artifact: M3_EVIDENCE.crossEngine.manifest.artifact }
        : null,
      integration: M3_EVIDENCE.crossEngine.integration
        ? { staged_asset: M3_EVIDENCE.crossEngine.integration.staged_asset, registry: M3_EVIDENCE.crossEngine.integration.registry }
        : null,
      babylon_runtime: {
        runtime_url: M3_EVIDENCE.crossEngine.babylon?.runtimeUrl ?? null,
        runtime_pid: M3_EVIDENCE.crossEngine.babylon?.runtimePid ?? null,
        dist_sha256: M3_EVIDENCE.crossEngine.babylon?.distSha256 ?? null,
      },
      browser_verified_integrated_asset: M3_EVIDENCE.crossEngine.babylonBrowser?.assertions ?? null,
      cancellation: M3_EVIDENCE.crossEngine.cancellation,
    },
    engine_aware_plan: M3_EVIDENCE.plan
      ? { planId: M3_EVIDENCE.plan.planId, planSha256: M3_EVIDENCE.plan.planSha256, stepCount: M3_EVIDENCE.plan.stepCount, validatedByParseGamePlan: M3_EVIDENCE.plan.validatedByParseGamePlan }
      : null,
    unity: {
      honest_unavailable: M3_EVIDENCE.unity.honestUnavailable,
      note: "M3-G1 stays NOT PASSING while the licensed editor prerequisite is external",
    },
    capability_resolution: M3_EVIDENCE.capabilityResolution
      ? { verdict: M3_EVIDENCE.capabilityResolution.verdict, records: M3_EVIDENCE.capabilityResolution.registryRecords, engine_plugin_source_commit: M3_EVIDENCE.capabilityResolution.enginePluginSourceCommit }
      : null,
    session_db_path: M3_EVIDENCE.sessionDbPath,
  };
  // Chunked-run continuity: fill null summary fields from the prior chunk's
  // m3 block (e.g. the final chunk M3J5+M3J6 did not re-run the pipeline —
  // its evidence lives in the merged stage rows and the prior summary).
  if (priorM3) {
    const fill = (target, prior) => {
      if (!target || typeof target !== "object" || !prior || typeof prior !== "object") return;
      for (const [key, priorValue] of Object.entries(prior)) {
        const current = target[key];
        const currentEmpty = current === null || current === undefined ||
          (typeof current === "object" && current !== null && Object.values(current).every((v) => v === null || v === undefined));
        if (currentEmpty && priorValue !== null && priorValue !== undefined) {
          if (typeof priorValue === "object" && priorValue !== null && !Array.isArray(priorValue) && typeof current === "object" && current !== null) {
            fill(current, priorValue);
          } else {
            target[key] = priorValue;
          }
        }
      }
    };
    fill(evidence.m3, priorM3);
  }
  evidence.summary = {
    verdict,
    exit_code: verdict === "pass" ? 0 : 1,
    mandatory_stages: MANDATORY_STAGES,
    stages_requested: STAGES,
    stages_recorded: Object.keys(evidence.stages),
    non_pass_stages: nonPass,
    missing_stages: missing,
  };
  writeFileSync(evidenceFilePath, JSON.stringify(evidence, null, 2));
  log(`evidence written: ${evidenceFilePath}`);
  log(`summary: verdict=${verdict} non_pass=${JSON.stringify(nonPass.map((s) => `${s.id}:${s.status}`))} missing=${JSON.stringify(missing)}`);
  process.exit(verdict === "pass" ? 0 : 1);
}

main().catch(async (e) => {
  evidence.fatal = e.message;
  evidence.finished_at = new Date().toISOString();
  evidence.summary = { verdict: "fail", exit_code: 2, mandatory_stages: MANDATORY_STAGES, fatal: e.message, stages_recorded: Object.keys(evidence.stages) };
  writeFileSync(join(EVIDENCE_DIR, "m3-journey-evidence.json"), JSON.stringify(evidence, null, 2));
  log(`FATAL: ${e.message}`);
  await stopApp();
  stopLocalModelServer();
  process.exit(2);
});
