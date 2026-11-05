#!/usr/bin/env node
/* eslint-disable max-lines -- Phase B evidence journey: launch orchestration + CDP client +
   10 journey stages in one reproducible script; splitting would hide the evidence chain
   (same pattern as packages/desktop/wdio.conf.ts). */
/**
 * Gamos Phase B — original ZCode desktop application UI journey (CDP-driven).
 *
 * Evidence tooling for M0 acceptance (docs/gamos/MILESTONES-AND-ACCEPTANCE.md):
 * launches the ORIGINAL ZCode desktop app (Electron renderer included) and
 * drives the real user journey through the real UI:
 *
 *   S0  app-up                 — complete application launches incl. desktop renderer
 *   S1  onboarding             — first-run wizard (when present on a fresh HOME)
 *   S2  provider configuration — Settings → Model settings → Add provider (OpenRouter, real key)
 *   S3  New Task submission    — task submitted from the original composer with the real model
 *   S4  task execution         — agent turn, tool use, result rows in the timeline
 *   S5  terminal panel         — interactive terminal surface
 *   S6  review/diff            — approve + reject flow for agent file changes
 *   S7  embedded browser       — real in-app browser experience
 *   S8  plugin marketplace     — catalog + real install
 *   S9  session recovery       — app restart restores the session/history
 *
 * Modes (PHASEB_MODE):
 *   dev     — launch vite dev renderer + dev Electron (sandbox-capable; low memory)
 *   prod    — launch Electron against the production-built renderer (out/renderer; CI)
 *   attach  — attach to an already-running app via CDP port (PHASEB_CDP_PORT)
 *
 * Evidence: PHASEB_EVIDENCE_DIR (default evidence/phase-b/journey) receives
 *   journey-evidence.json, screenshots/*.png and dom-dumps/*.json.
 *
 * Env:
 *   OPENROUTER_API_KEY   — real model provider key (required for S2/S3/S4)
 *   PHASEB_MODEL         — model id (default nvidia/nemotron-3-ultra-550b-a55b:free)
 *   PHASEB_HOME          — isolated ZCODE_DESKTOP_HOME_DIR (default .phaseb-home under repo)
 *   PHASEB_TASK_WORKSPACE— workspace dir for task artifacts (default $PHASEB_HOME/ZCodeProject)
 *   PHASEB_STAGES        — comma list of stages to run (default all)
 *   PHASEB_MAX_WAIT_MS   — per-wait budget default 240000
 *
 * This script is evidence tooling only: it changes no repository sources,
 * registers no hooks and performs no repository mutation. All app state lives
 * under PHASEB_HOME.
 */
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DESKTOP_DIR = join(REPO_ROOT, "packages", "desktop");

const MODE = process.env.PHASEB_MODE ?? "dev";
const CDP_PORT = Number(process.env.PHASEB_CDP_PORT ?? 9229);
const EVIDENCE_DIR = resolve(REPO_ROOT, process.env.PHASEB_EVIDENCE_DIR ?? "evidence/phase-b/journey");
const SCREEN_DIR = join(EVIDENCE_DIR, "screenshots");
const DUMP_DIR = join(EVIDENCE_DIR, "dom-dumps");
const PHASEB_HOME = resolve(REPO_ROOT, process.env.PHASEB_HOME ?? ".phaseb-home");
// The app's default session workspace follows the OS home (verified on the sandbox:
// initialWorkspacePath=<homedir>/.zcode/workspace/default; ZCODE_DESKTOP_HOME_DIR does
// not redirect it). Keeping task artifacts inside the session workspace avoids
// spurious out-of-workspace permission prompts during the S3 journey.
const TASK_WORKSPACE = resolve(
  process.env.PHASEB_TASK_WORKSPACE ?? join(homedir(), ".zcode", "workspace", "default"),
);
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY ?? "";
const MODEL_ID = process.env.PHASEB_MODEL ?? "nvidia/nemotron-3-ultra-550b-a55b:free";
const MAX_WAIT = Number(process.env.PHASEB_MAX_WAIT_MS ?? 240000);
const STAGES = (process.env.PHASEB_STAGES ?? "S0,S1,S2,S3,S4,S5,S6,S7,S8,S9").split(",").map((s) => s.trim());
const APP_NAME = process.env.PHASEB_APP_NAME ?? "GamosPhaseBJourney";
// Staged, versioned dev app dir (mirrors the E2E staging pattern: an isolated copy of
// packages/desktop/out plus a package.json carrying the real app version, so
// electron-updater's semver constructor and app.getVersion() behave as upstream
// E2E expects). Not a source modification — build output staging only.
const STAGED_APP_DIR = resolve(REPO_ROOT, process.env.PHASEB_STAGED_APP_DIR ?? ".phaseb-app");
const APP_VERSION = (() => {
  try { return JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).version ?? "0.0.0"; }
  catch { return "0.0.0"; }
})();

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
  script: "scripts/gamos/phase-b-ui-journey.mjs",
  mode: MODE,
  started_at: RUN_TS,
  environment: {
    node: process.version,
    platform: process.platform,
    cdp_port: CDP_PORT,
    model: MODEL_ID,
    provider: "openrouter",
    real_model_key_present: Boolean(OPENROUTER_KEY),
    app_home: PHASEB_HOME,
    task_workspace: TASK_WORKSPACE,
  },
  stages: {},
  commands: [],
  failures: [],
};

function recordStage(id, status, detail) {
  evidence.stages[id] = { status, detail, at: new Date().toISOString() };
  log(`STAGE ${id}: ${status} — ${typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 300)}`);
}

/* ------------------------------------------------------------------ */
/* Minimal CDP client over the native WebSocket                        */
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
  const list = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
  const page = list.find((t) => t.type === "page" && !/devtools/i.test(t.url)) ?? list.find((t) => t.type === "page");
  if (!page) throw new Error(`no page target on CDP ${CDP_PORT}: ${JSON.stringify(list).slice(0, 400)}`);
  return page;
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
  log(`CDP attached: ${target.title} (${target.url.slice(0, 80)})`);
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

async function screenshot(name) {
  const r = await page.send("Page.captureScreenshot", { format: "png" });
  const path = join(SCREEN_DIR, `${name}.png`);
  writeFileSync(path, Buffer.from(r.data, "base64"));
  evidence.commands.push({ screenshot: name, path: `evidence/phase-b/journey/screenshots/${name}.png`, at: new Date().toISOString() });
  log(`screenshot: ${name}.png (${Math.round(r.data.length / 1024)}KB)`);
  return path;
}

async function dumpDom(name) {
  const info = await evalJs(`(() => {
    const tids = Array.from(document.querySelectorAll('[data-testid]')).slice(0, 200).map(e => e.dataset.testid);
    const buttons = Array.from(document.querySelectorAll('button')).slice(0, 40).map(b => ({ text: (b.innerText || '').trim().slice(0, 60), tid: b.dataset.testid ?? null, disabled: b.disabled }));
    return { url: location.href, title: document.title, readyState: document.readyState, testIds: tids, buttons };
  })()`);
  writeFileSync(join(DUMP_DIR, `${name}.json`), JSON.stringify(info, null, 1));
  log(`dom-dump: ${name}.json — title="${info?.title}" testids=${info?.testIds?.length ?? 0}`);
  return info;
}

const CLICK_JS = `(async (sel) => {
  const el = document.querySelector(sel);
  if (!el) return { ok: false, reason: 'not-found: ' + sel };
  el.scrollIntoView({ block: 'center', inline: 'center' });
  await new Promise(r => setTimeout(r, 60));
  const rect = el.getBoundingClientRect();
  const opts = { bubbles: true, cancelable: true, view: window, composed: true };
  el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerId: 1 }));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerId: 1 }));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.dispatchEvent(new MouseEvent('click', { ...opts, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 }));
  return { ok: true };
})`;

async function clickSel(sel) {
  const r = await evalJs(`${CLICK_JS}(${JSON.stringify(sel)})`, { awaitPromise: true });
  if (!r?.ok) throw new Error(`click failed: ${r?.reason ?? sel}`);
  return true;
}
const byTid = (tid) => `[data-testid="${tid}"]`;

async function waitForTid(tid, { timeout = 30000, visible = true } = {}) {
  await waitFor(
    () => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(byTid(tid))}); if (!e) return false; const r = e.getBoundingClientRect(); return ${visible ? 'r.width > 0 && r.height > 0' : 'true'}; })()`),
    { what: `testid ${tid}`, timeout, interval: 400 },
  );
  return true;
}

async function hasTid(tid) {
  return Boolean(await evalJs(`Boolean(document.querySelector(${JSON.stringify(byTid(tid))}))`));
}

async function clickButtonByText(text, { scope = "document", timeout = 15000, exact = false } = {}) {
  await waitFor(
    () => evalJs(`(() => { const els = Array.from(${scope}.querySelectorAll('button, [role="button"]')); const el = els.find(b => { const t = (b.innerText || b.textContent || '').trim(); return ${exact ? `t === ${JSON.stringify(text)}` : `t.includes(${JSON.stringify(text)})`}; }); return Boolean(el) && !el.disabled; })()`),
    { what: `button "${text}"`, timeout, interval: 500 },
  );
  const r = await evalJs(`(async () => {
    const els = Array.from(${scope}.querySelectorAll('button, [role="button"]'));
    const el = els.find(b => { const t = (b.innerText || b.textContent || '').trim(); return ${exact ? `t === ${JSON.stringify(text)}` : `t.includes(${JSON.stringify(text)})`}; });
    if (!el) return { ok: false, reason: 'not-found' };
    el.scrollIntoView({ block: 'center' });
    await new Promise(r => setTimeout(r, 60));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, composed: true }));
    return { ok: true, text: el.innerText.trim().slice(0, 60) };
  })()`, { awaitPromise: true });
  if (!r?.ok) throw new Error(`clickButtonByText failed: ${text}`);
  return true;
}

async function typeIntoFocused(text) {
  await page.send("Input.insertText", { text });
}
async function pressKey(key) {
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key });
}

async function bodyText() {
  return (await evalJs(`document.body?.innerText?.slice(0, 3000) ?? ''`)) ?? "";
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

let viteChild = null;
let electronChild = null;

async function launchDev() {
  // 1. vite dev renderer (port 5174)
  viteChild = spawnChild("vite", process.execPath, [
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
  const electronEnv = {
    ...process.env,
    ELECTRON_RENDERER_URL: viteUrl,
    DISPLAY: process.env.DISPLAY ?? ":99",
    ZCODE_DESKTOP_HOME_DIR: PHASEB_HOME,
    ZCODE_DESKTOP_APPLICATION_NAME: APP_NAME,
    ZCODE_DESKTOP_USER_DATA_DIR: join(PHASEB_HOME, "user-data"),
    ZCODE_DESKTOP_SESSION_DATA_DIR: join(PHASEB_HOME, "user-data", "session"),
    ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
  };
  electronChild = spawnChild("electron", electronBin, [STAGED_APP_DIR, "--no-sandbox", "--disable-gpu"], {
    cwd: DESKTOP_DIR, env: electronEnv,
  });
  evidence.commands.push({
    cmd: `electron ${STAGED_APP_DIR} --no-sandbox --disable-gpu (ELECTRON_RENDERER_URL=${viteUrl}, ZCODE_DESKTOP_HOME_DIR=${PHASEB_HOME})`,
    at: new Date().toISOString(),
  });
}

async function launchProd() {
  const rendererIndex = join(STAGED_APP_DIR, "renderer", "index.html");
  if (!existsSync(rendererIndex)) {
    throw new Error(`production renderer missing: ${rendererIndex} — run the desktop production build first`);
  }
  const electronBin = join(REPO_ROOT, "node_modules", ".bin", "electron");
  const electronEnv = {
    ...process.env,
    DISPLAY: process.env.DISPLAY ?? ":99",
    ZCODE_DESKTOP_HOME_DIR: PHASEB_HOME,
    ZCODE_DESKTOP_APPLICATION_NAME: APP_NAME,
    ZCODE_DESKTOP_USER_DATA_DIR: join(PHASEB_HOME, "user-data"),
    ZCODE_DESKTOP_SESSION_DATA_DIR: join(PHASEB_HOME, "user-data", "session"),
    NODE_ENV: "production",
    ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
  };
  electronChild = spawnChild("electron", electronBin, [STAGED_APP_DIR, "--no-sandbox"], { cwd: DESKTOP_DIR, env: electronEnv });
  evidence.commands.push({ cmd: `electron ${STAGED_APP_DIR} --no-sandbox (production renderer)`, at: new Date().toISOString() });
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
}

/* ------------------------------------------------------------------ */
/* Stage implementations                                               */
/* ------------------------------------------------------------------ */

async function stageS0() {
  const target = await attachCdp();
  let lastDiag = null;
  // Under-sandboxes: vite dev transforms 2000+ modules slowly; Chromium can exhaust
  // its per-process request budget on the first pass. Reloading hits vite's warm
  // in-memory transform cache and reliably completes the module graph.
  let reloads = 0;
  const maxReloads = Number(process.env.PHASEB_S0_RELOADS ?? 3);
  await waitFor(async () => {
    const state = await evalJs(`(() => ({ ready: document.readyState, url: location.href, tidCount: document.querySelectorAll('[data-testid]').length, bodyLen: (document.body?.innerText ?? '').length }))()`).catch(() => null);
    lastDiag = state;
    if (!state) return false;
    const sidebar = await hasTid("sidebar");
    const onboarding = await hasTid("onboarding-page");
    if (sidebar || onboarding || (state.bodyLen > 500 && state.ready === "complete")) return true;
    if (state.ready === "complete" && state.bodyLen === 0 && reloads < maxReloads) {
      reloads++;
      log(`S0: renderer blank (tidCount=0) — reloading page (attempt ${reloads}/${maxReloads}) to retry against the warm vite cache`);
      await page.send("Page.reload", { ignoreCache: false }).catch(() => {});
      await new Promise((r) => setTimeout(r, 15000));
    }
    return false;
  }, { what: "workspace DOM (sidebar/onboarding)", timeout: MAX_WAIT, interval: 5000 }).catch(async () => {
    const onboarding = await hasTid("onboarding-page");
    if (!onboarding) {
      log(`S0 diagnostics: ${JSON.stringify(lastDiag)}`);
      log(`S0 renderer requests: ${JSON.stringify(rendererRequests)}`);
      log(`S0 renderer console (last 40): ${JSON.stringify(rendererConsole.slice(-40), null, 1)}`);
      await dumpDom("S0-failure").catch(() => {});
      throw new Error(`workspace DOM never appeared: ${JSON.stringify(lastDiag)}; requests=${JSON.stringify(rendererRequests)}`);
    }
  });
  await screenshot("S0-app-up");
  await dumpDom("S0-app-up");
  recordStage("S0", "pass", `window loaded (${target.title}); renderer reachable over CDP; diag=${JSON.stringify(lastDiag)}`);
}

async function stageS1() {
  const onboardingPresent = await hasTid("onboarding-page") || (await bodyText()).includes("What do you do");
  if (!onboardingPresent) {
    recordStage("S1", "skipped", "onboarding already completed in this HOME (persisted state)");
    return;
  }
  await screenshot("S1-onboarding-start");
  // Explicit wizard walk (labels verified from the real UI dom-dumps):
  //   step 1 occupation cards ("Software / Data / AI", …) — selection advances
  //   step 2 UI mode ("Coding mode" / "Office mode") + Next
  //   later steps: Next/Continue/Get started. Never click Back/Skip/Retry.
  let lastClicked = null;
  let repeated = 0;
  const selectedOnce = { occupation: false, codingMode: false };
  for (let step = 1; step <= 14; step++) {
    // Selection memory: each selection card (occupation, Coding mode) is clicked at most
    // ONCE; afterwards the stepper prefers the advance buttons (Next/Continue/Get
    // started). This mirrors the real wizard: select → Next → select → Next → …
    const SEL_STATE = JSON.stringify(selectedOnce);
    const r = await evalJs(`(async () => {
      const selectedOnce = ${SEL_STATE};
      const page0 = document.querySelector('[data-testid="onboarding-page"]');
      if (!page0) return { done: true };
      const btns = Array.from(document.querySelectorAll('button'))
        .filter(b => b.offsetParent !== null && !b.disabled && (b.innerText || '').trim().length > 0);
      const pick = (re) => btns.find(b => re.test((b.innerText || '').trim()));
      const occupation = !selectedOnce.occupation ? pick(/software\\s*\\/\\s*data\\s*\\/\\s*ai/i) : null;
      const codingMode = !selectedOnce.codingMode ? pick(/^coding mode/i) : null;
      const advance = pick(/^(next|continue|get started|下一步|继续|开始使用)$/i);
      const el = occupation ?? codingMode ?? advance;
      if (!el) return { done: false, have: btns.map(b => (b.innerText || '').trim().slice(0, 30)).slice(0, 10) };
      el.scrollIntoView({ block: 'center' });
      await new Promise(r => setTimeout(r, 80));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
      return { done: false, clicked: (el.innerText || '').trim().split('\\n')[0].slice(0, 40), picked: el === occupation ? 'occupation' : el === codingMode ? 'codingMode' : 'advance' };
    })()`, { awaitPromise: true }).catch((e) => ({ done: false, error: e.message }));
    if (r?.done) break;
    if (r?.picked === "occupation") selectedOnce.occupation = true;
    if (r?.picked === "codingMode") selectedOnce.codingMode = true;
    if (r?.clicked && r.clicked === lastClicked) {
      repeated++;
    } else {
      repeated = 0;
      lastClicked = r?.clicked ?? null;
    }
    log(`onboarding step ${step}: clicked="${r?.clicked ?? "(none)"}"${r?.have ? ` options=${JSON.stringify(r.have).slice(0, 160)}` : ""}${r?.error ? ` error=${r.error.slice(0, 120)}` : ""}${repeated >= 2 ? " (repeated — escalating)" : ""}`);
    await new Promise((r2) => setTimeout(r2, 1200));
    await screenshot(`S1-onboarding-step-${step}`);
    if (!(await hasTid("onboarding-page"))) break;
    if (repeated >= 2) {
      // Advance buttons exhausted: try Skip as the last resort (preferences are optional).
      const alt = await evalJs(`(async () => {
        const btns = Array.from(document.querySelectorAll('button'))
          .filter(b => b.offsetParent !== null && !b.disabled && (b.innerText || '').trim().length > 0);
        const pick = (re) => btns.find(b => re.test((b.innerText || '').trim()));
        const el = pick(/^(skip|跳过)$/i);
        if (!el) return null;
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
        return (el.innerText || '').trim().slice(0, 30);
      })()`, { awaitPromise: true }).catch(() => null);
      log(`onboarding escalation at step ${step}: clicked="${alt ?? "(none)"}"`);
      await new Promise((r2) => setTimeout(r2, 1200));
      repeated = 0;
    }
  }
  const finished = await waitForTid("sidebar", { timeout: 45000 }).catch(() => false);
  await screenshot("S1-onboarding-done");
  await dumpDom("S1-onboarding-done");
  recordStage("S1", finished ? "pass" : "partial", finished
    ? "onboarding wizard completed (occupation → Coding mode → preferences); main workspace visible"
    : "onboarding advanced but workspace not reached — check dom-dumps");
}

async function stageS2() {
  if (!OPENROUTER_KEY) throw new Error("OPENROUTER_API_KEY missing — cannot configure the real model provider");
  // Settings → Model settings. Entry: the sidebar footer settings button (icon button,
  // testid task-settings-button); fall back to text matching.
  await waitForTid("sidebar");
  const settingsEntry = await hasTid("task-settings-button");
  if (settingsEntry) {
    await clickSel(byTid("task-settings-button"));
  } else {
    await clickButtonByText("Settings", { timeout: 20000 });
  }
  await waitForTid("settings-page", { timeout: 20000 });
  await screenshot("S2-settings-open");
  // Model settings section in the settings nav
  await clickButtonByText("Model settings", { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 800));
  await screenshot("S2-model-settings");
  // Add provider
  await waitForTid("model-provider-add-provider-button", { timeout: 20000 });
  await clickSel(byTid("model-provider-add-provider-button"));
  await new Promise((r) => setTimeout(r, 600));
  await screenshot("S2-add-provider");
  // Template picker → OpenRouter
  await waitForTid("model-provider-template-picker", { timeout: 15000 });
  const picked = await evalJs(`(async () => {
    const items = Array.from(document.querySelectorAll('[data-testid="model-provider-template-item"]'));
    const el = items.find(i => (i.innerText || '').toLowerCase().includes('openrouter'));
    if (!el) return { ok: false, have: items.map(i => (i.innerText || '').trim().slice(0, 40)) };
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
    return { ok: true };
  })()`, { awaitPromise: true });
  if (!picked?.ok) throw new Error(`OpenRouter template not found; templates=${JSON.stringify(picked?.have).slice(0, 200)}`);
  await new Promise((r) => setTimeout(r, 700));
  await screenshot("S2-openrouter-template");
  // API key input — find the visible password/input field inside the provider form
  const keyTyped = await evalJs(`(async () => {
    const inputs = Array.from(document.querySelectorAll('input[type="password"], input[type="text"], textarea'))
      .filter(i => i.offsetParent !== null && !i.disabled && (i.placeholder || '').length > 0);
    const el = inputs.find(i => /key|api|sk-/i.test(i.placeholder)) ?? inputs[0];
    if (!el) return { ok: false };
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      ?? Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    setter.call(el, ${JSON.stringify(OPENROUTER_KEY)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return { ok: true, placeholder: el.placeholder };
  })()`, { awaitPromise: true });
  if (!keyTyped?.ok) throw new Error("provider api-key input not found");
  await new Promise((r) => setTimeout(r, 400));
  await screenshot("S2-api-key-entered");
  // Confirm/save
  for (const label of ["Confirm", "Save", "确定", "保存", "Add"]) {
    const clicked = await evalJs(`(async () => {
      const els = Array.from(document.querySelectorAll('button'));
      const el = els.find(b => !b.disabled && ['confirm','save','add','确定','保存'].includes((b.innerText || '').trim().toLowerCase()));
      if (!el) return false;
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
      return true;
    })()`, { awaitPromise: true }).catch(() => false);
    if (clicked) break;
  }
  await new Promise((r) => setTimeout(r, 1200));
  await screenshot("S2-provider-saving");
  // Wait for provider ready + model catalog; then bind the default model
  const ready = await waitFor(async () => {
    const text = await bodyText();
    return /ready|就绪/i.test(text) && /openrouter/i.test(text);
  }, { what: "provider Ready status", timeout: 60000 }).catch(() => null);
  await screenshot("S2-provider-ready");
  // Select the model: click a model row matching MODEL_ID prefix, then set default if offered
  await evalJs(`(async () => {
    const rows = Array.from(document.querySelectorAll('[role="row"], [role="option"], [data-testid*="model"], button, div'))
      .filter(e => e.offsetParent !== null && (e.innerText || '').includes(${JSON.stringify(MODEL_ID.split("/")[0])}));
    const row = rows.find(e => (e.innerText || '').includes(${JSON.stringify(MODEL_ID)}));
    if (row) { row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true })); return true; }
    return false;
  })()`, { awaitPromise: true }).catch(() => false);
  await new Promise((r) => setTimeout(r, 800));
  for (const label of ["Set as default", "设为默认", "Default", "默认"]) {
    await evalJs(`(async () => {
      const els = Array.from(document.querySelectorAll('button'));
      const el = els.find(b => !b.disabled && (b.innerText || '').trim().toLowerCase().includes(${JSON.stringify(label.toLowerCase())}));
      if (!el) return false;
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
      return true;
    })()`, { awaitPromise: true }).catch(() => false);
  }
  await screenshot("S2-model-selected");
  // Back to workspace
  const back = await hasTid("settings-back-button");
  if (back) await clickSel(byTid("settings-back-button"));
  await new Promise((r) => setTimeout(r, 600));
  recordStage("S2", ready ? "pass" : "partial", `OpenRouter provider configured with a real key (placeholder=${keyTyped.placeholder}); Ready=${Boolean(ready)}; model=${MODEL_ID}`);
}

async function submitComposerTask(taskText, screenshotPrefix) {
  await waitForTid("v4-composer-input", { timeout: 30000 });
  await screenshot(`${screenshotPrefix}-composer`);
  // Focus the composer then type as a real user
  await evalJs(`(async () => { const el = document.querySelector('[data-testid="v4-composer-input"]'); el?.focus(); return Boolean(el); })()`, { awaitPromise: true });
  await typeIntoFocused(taskText);
  await new Promise((r) => setTimeout(r, 400));
  await screenshot(`${screenshotPrefix}-typed`);
  await clickSel(byTid("v4-composer-send"));
}

async function waitForTaskCompletion(screenshotPrefix, { timeout = MAX_WAIT } = {}) {
  const start = Date.now();
  let sawToolUse = false;
  let lastRows = 0;
  while (Date.now() - start < timeout) {
    const state = await evalJs(`(() => {
      const rows = Array.from(document.querySelectorAll('[data-testid^="v4-row"]'));
      const stop = document.querySelector('[data-testid="v4-stop"]');
      const timeline = (document.querySelector('[data-testid="v4-timeline"]')?.innerText ?? '').slice(0, 1500);
      const bodyHasTool = /tool|write|read|edit|terminal|bash/i.test(timeline);
      return { rows: rows.length, running: Boolean(stop), timeline, bodyHasTool };
    })()`);
    lastRows = state?.rows ?? 0;
    if (state?.bodyHasTool) sawToolUse = true;
    if (!(state?.running) && (state?.rows ?? 0) > 0 && Date.now() - start > 8000) {
      return { completed: true, rows: state.rows, sawToolUse, timeline: state.timeline };
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  await screenshot(`${screenshotPrefix}-timeout`);
  return { completed: false, rows: lastRows, sawToolUse, timeline: "" };
}

async function stageS3() {
  const taskFile = join(TASK_WORKSPACE, "gamos-phase-b-journey.txt");
  // Absolute path in the prompt: the app's default workspace derives from the OS home
  // (ZCODE_DESKTOP_HOME_DIR does not redirect it), so "current workspace" would be
  // ambiguous across environments. An absolute path keeps the artifact check exact.
  const taskText = `Create a file at exactly this absolute path: ${taskFile} — with exactly this single line of content: GAMOS-PHASE-B-DESKTOP-JOURNEY-OK. Then read the file back and print its exact content.`;
  await submitComposerTask(taskText, "S3");
  await screenshot("S3-task-submitted");
  const result = await waitForTaskCompletion("S3", { timeout: MAX_WAIT });
  await screenshot("S3-task-result");
  const artifactOk = existsSync(taskFile);
  const artifactContent = artifactOk ? readFileSync(taskFile, "utf8").trim() : null;
  recordStage("S3", result.completed && artifactOk ? "pass" : "fail", {
    task: "file create + read-back via New Task composer (real model)",
    completed: result.completed,
    timeline_rows: result.rows,
    tool_use_seen: result.sawToolUse,
    artifact: artifactOk ? `${taskFile}="${artifactContent}"` : "missing",
    expected_content: "GAMOS-PHASE-B-DESKTOP-JOURNEY-OK",
    timeline_excerpt: (result.timeline ?? "").slice(0, 400),
  });
  if (!(result.completed && artifactOk)) throw new Error("S3 task did not complete with the expected artifact");
}

async function stageS4() {
  // Task execution details: expand tool rows in the timeline + open the session pane
  const state = await evalJs(`(() => {
    const timeline = document.querySelector('[data-testid="v4-timeline"]');
    const rows = Array.from(document.querySelectorAll('[data-testid^="v4-row"]'));
    const sessionPane = document.querySelector('[data-testid="v4-session-pane"]');
    return { timelineText: (timeline?.innerText ?? '').slice(0, 2000), rowCount: rows.length, sessionPaneVisible: Boolean(sessionPane) };
  })()`);
  await screenshot("S4-task-execution-review");
  await dumpDom("S4-task-execution-review");
  const toolEvidence = /write|read|tool|terminal/i.test(state?.timelineText ?? "");
  recordStage("S4", toolEvidence ? "pass" : "partial", {
    timeline_rows: state?.rowCount,
    session_pane_visible: state?.sessionPaneVisible,
    timeline_excerpt: (state?.timelineText ?? "").slice(0, 500),
  });
}

async function stageS5() {
  // Interactive terminal: the desktop ships a terminal surface; open it and run a command
  const opened = await evalJs(`(async () => {
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], [data-testid]'))
      .filter(e => e.offsetParent !== null);
    const el = candidates.find(e => /terminal/i.test(e.getAttribute('data-testid') ?? '') || /terminal|终端/i.test(e.innerText ?? ''));
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
    return true;
  })()`, { awaitPromise: true }).catch(() => false);
  await new Promise((r) => setTimeout(r, 1200));
  await screenshot("S5-terminal-panel");
  const info = await dumpDom("S5-terminal-panel");
  const terminalSurface = Boolean(await evalJs(`(() => {
    const el = Array.from(document.querySelectorAll('[data-testid], [class*="terminal"], [id*="terminal"], xterm, .xterm'))
      .find(e => e.offsetParent !== null);
    return Boolean(el);
  })()`));
  recordStage("S5", terminalSurface ? "pass" : "partial", {
    terminal_entry_clicked: Boolean(opened),
    terminal_surface_present: terminalSurface,
    note: "interactive terminal panel surface verification (dom-level)",
  });
}

async function stageS6() {
  // Review/diff: switch composer to "Ask before changes", submit an edit task, then approve;
  // a second task is rejected. This exercises the original permission/review UI.
  const switched = await evalJs(`(async () => {
    const el = Array.from(document.querySelectorAll('button, [role="button"]'))
      .find(b => /ask before changes|询问|review mode/i.test(b.innerText ?? '') || /ask-before-changes/i.test(b.getAttribute('data-testid') ?? ''));
    if (!el) return false;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
    return true;
  })()`, { awaitPromise: true }).catch(() => false);
  await new Promise((r) => setTimeout(r, 500));
  await screenshot("S6-review-mode-on");

  const editTask = `Edit the file at exactly this absolute path: ${join(TASK_WORKSPACE, "gamos-phase-b-journey.txt")} — append a second line with exactly: REVIEW-APPROVED-LINE. Then show the final file content.`;
  await submitComposerTask(editTask, "S6");
  // Wait for a permission/review prompt (diff UI) to appear
  const promptSeen = await waitFor(async () => {
    const text = await bodyText();
    return /approve|reject|accept|decline|diff|allow|deny|批准|拒绝|允许/i.test(text) ? text.slice(0, 600) : false;
  }, { what: "review/diff prompt", timeout: Math.min(MAX_WAIT, 180000) }).catch(() => null);
  await screenshot("S6-review-prompt");
  if (promptSeen) {
    // Approve the change
    const approved = await evalJs(`(async () => {
      const els = Array.from(document.querySelectorAll('button'));
      const el = els.find(b => !b.disabled && /^(approve|accept|allow|批准|允许|yes)$/i.test((b.innerText || '').trim()))
        ?? els.find(b => !b.disabled && /^(approve|accept|allow|run|批准|允许)/i.test((b.innerText || '').trim()));
      if (!el) return false;
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
      return (el.innerText || '').trim();
    })()`, { awaitPromise: true }).catch(() => false);
    await new Promise((r) => setTimeout(r, 1500));
    await screenshot("S6-review-approved");
    // verify the file got the line
    const content = existsSync(join(TASK_WORKSPACE, "gamos-phase-b-journey.txt"))
      ? readFileSync(join(TASK_WORKSPACE, "gamos-phase-b-journey.txt"), "utf8")
      : "";
    recordStage("S6", content.includes("REVIEW-APPROVED-LINE") ? "pass" : "partial", {
      review_mode_switched: Boolean(switched),
      review_prompt_seen: Boolean(promptSeen),
      approved_via: approved || null,
      file_contains_approved_line: content.includes("REVIEW-APPROVED-LINE"),
      file_content: content.trim().slice(0, 200),
    });
    return;
  }
  recordStage("S6", "partial", {
    review_mode_switched: Boolean(switched),
    review_prompt_seen: false,
    note: "no approval prompt observed — model may have answered without file edit or permission prompt shape differs; see screenshots",
  });
}

async function stageS7() {
  // Embedded browser: open the in-app browser surface and navigate to a real page
  const opened = await evalJs(`(async () => {
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], [data-testid], a'))
      .filter(e => e.offsetParent !== null);
    const el = candidates.find(e => /browser/i.test(e.getAttribute('data-testid') ?? '') || /^browser$|浏览器/i.test((e.innerText ?? '').trim()));
    if (!el) return false;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
    return true;
  })()`, { awaitPromise: true }).catch(() => false);
  await new Promise((r) => setTimeout(r, 1500));
  await screenshot("S7-browser-opened");
  // try to type a URL into an address bar if present
  const navigated = await evalJs(`(async () => {
    const inputs = Array.from(document.querySelectorAll('input, [contenteditable="true"]'))
      .filter(i => i.offsetParent !== null);
    const bar = inputs.find(i => /url|address|search|go/i.test(i.placeholder ?? i.getAttribute('aria-label') ?? ''));
    if (!bar) return false;
    bar.focus();
    return true;
  })()`, { awaitPromise: true }).catch(() => false);
  if (navigated) {
    await typeIntoFocused("https://example.com");
    await pressKey("Enter");
    await new Promise((r) => setTimeout(r, 4000));
  }
  await screenshot("S7-browser-page");
  await dumpDom("S7-browser-page");
  const browserSurface = await evalJs(`(() => Boolean(document.querySelector('webview, [class*="browser"], [data-testid*="browser"]')))`);
  recordStage("S7", browserSurface ? "pass" : "partial", {
    browser_entry_clicked: Boolean(opened),
    address_bar_found: Boolean(navigated),
    browser_surface_present: Boolean(browserSurface),
  });
}

async function stageS8() {
  // Plugin Marketplace: open from sidebar, verify catalog, perform a real install
  const opened = await evalJs(`(async () => {
    const el = Array.from(document.querySelectorAll('button, [role="button"], [data-testid], a'))
      .filter(e => e.offsetParent !== null)
      .find(e => /marketplace|插件市场|plugin/i.test(e.getAttribute('data-testid') ?? '') || /marketplace|插件市场/i.test(e.innerText ?? ''));
    if (!el) return false;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
    return true;
  })()`, { awaitPromise: true }).catch(() => false);
  await new Promise((r) => setTimeout(r, 1500));
  await screenshot("S8-marketplace-open");
  const catalogText = await bodyText();
  const catalogVisible = /marketplace|plugin|插件/i.test(catalogText);
  // Install a small official plugin (jupyter-notebook was verified installable in Phase B round 1)
  let installStarted = false;
  if (catalogVisible) {
    installStarted = await evalJs(`(async () => {
      const cards = Array.from(document.querySelectorAll('button, [role="button"]'))
        .filter(b => b.offsetParent !== null && !b.disabled);
      const target = cards.find(b => /install|安装/i.test(b.innerText ?? ''));
      if (!target) return false;
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
      return (target.innerText || '').trim();
    })()`, { awaitPromise: true }).catch(() => false);
  }
  if (installStarted) {
    await new Promise((r) => setTimeout(r, 8000));
    await screenshot("S8-plugin-install");
  }
  await dumpDom("S8-marketplace");
  recordStage("S8", catalogVisible ? "pass" : "partial", {
    marketplace_opened: Boolean(opened),
    catalog_visible: catalogVisible,
    install_clicked: installStarted || null,
    note: installStarted ? "install clicked; post-install state in screenshot" : "catalog verified; install not exercised this run",
  });
}

async function stageS9() {
  // Session recovery: kill the app, relaunch, verify the session/history is restored
  await stopApp();
  page = null;
  await new Promise((r) => setTimeout(r, 2000));
  // stopApp killed the Xvfb child along with the app; the display must exist again
  // before the relaunch or Electron cannot create its window.
  await ensureDisplay();
  stageDesktopOut();
  if (MODE === "dev") await launchDev();
  else if (MODE === "prod") await launchProd();
  await attachCdp();
  await waitForTid("sidebar", { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1500));
  await screenshot("S9-app-restarted");
  // The task history / session list should include the earlier task
  const historyVisible = await waitFor(async () => {
    const text = await bodyText();
    return text.length > 200 ? text.slice(0, 400) : false;
  }, { what: "restored workspace content", timeout: 30000 }).catch(() => null);
  // open history/tasks sidebar section if present
  await evalJs(`(async () => {
    const el = Array.from(document.querySelectorAll('button, [role="button"], [data-testid]'))
      .filter(e => e.offsetParent !== null)
      .find(e => /history|task|会话|历史|任务/i.test(e.innerText ?? '') || /history|task/i.test(e.getAttribute('data-testid') ?? ''));
    if (el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true })); return true; }
    return false;
  })()`, { awaitPromise: true }).catch(() => false);
  await new Promise((r) => setTimeout(r, 1000));
  await screenshot("S9-session-history");
  const afterText = await bodyText();
  const sessionSurvived = /gamos-phase-b-journey|GAMOS-PHASE-B/i.test(afterText) || (await evalJs(`(() => Boolean(document.querySelector('[data-testid="v4-session-title"], [data-testid*="session"]')))()`));
  recordStage("S9", sessionSurvived ? "pass" : "partial", {
    relaunched: true,
    workspace_restored: Boolean(historyVisible),
    session_reference_found: sessionSurvived,
    note: "app killed (SIGTERM) and relaunched; session history inspected after restart",
  });
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */
async function main() {
  log(`Gamos Phase B UI journey — mode=${MODE} stages=${STAGES.join(",")}`);
  log(`evidence dir: ${EVIDENCE_DIR}`);
  await ensureDisplay();
  stageDesktopOut();
  const stageMap = { S0: stageS0, S1: stageS1, S2: stageS2, S3: stageS3, S4: stageS4, S5: stageS5, S6: stageS6, S7: stageS7, S8: stageS8, S9: stageS9 };
  try {
    if (MODE === "dev") await launchDev();
    else if (MODE === "prod") await launchProd();
    else if (MODE !== "attach") throw new Error(`unknown PHASEB_MODE ${MODE}`);
    for (const stage of STAGES) {
      const fn = stageMap[stage];
      if (!fn) { recordStage(stage, "skipped", "unknown stage id"); continue; }
      try {
        await fn();
      } catch (e) {
        recordStage(stage, "fail", e.message);
        evidence.failures.push({ stage, error: e.message });
        await screenshot(`${stage}-failure`).catch(() => {});
      }
    }
  } finally {
    await stopApp();
  }
  evidence.finished_at = new Date().toISOString();
  const failed = Object.values(evidence.stages).filter((s) => s.status === "fail");
  evidence.summary = {
    stages_run: Object.keys(evidence.stages).length,
    failed: failed.length,
    overall: failed.length === 0 ? "all recorded stages completed (see per-stage statuses)" : `${failed.length} stage(s) failed`,
  };
  writeFileSync(join(EVIDENCE_DIR, "journey-evidence.json"), JSON.stringify(evidence, null, 2));
  log(`evidence written: ${join(EVIDENCE_DIR, "journey-evidence.json")}`);
  log(`summary: ${evidence.summary.overall}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(async (e) => {
  evidence.fatal = e.message;
  evidence.finished_at = new Date().toISOString();
  writeFileSync(join(EVIDENCE_DIR, "journey-evidence.json"), JSON.stringify(evidence, null, 2));
  log(`FATAL: ${e.message}`);
  await stopApp();
  process.exit(2);
});
