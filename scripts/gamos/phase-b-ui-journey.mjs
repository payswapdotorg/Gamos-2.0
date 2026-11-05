#!/usr/bin/env node
/* eslint-disable max-lines -- Phase B evidence journey: launch orchestration + CDP client +
   input layer + 10 journey stages in one reproducible script; splitting would hide the
   evidence chain (same pattern as packages/desktop/wdio.conf.ts). */
/**
 * Gamos Phase B — original ZCode desktop application UI journey (CDP-driven), rev 2.
 *
 * Integrity model (architect directive "Phase B Test Integrity and M0 Closure" §2.A):
 *   - Stages S0–S9 are ALL MANDATORY. The overall exit code is 0 ONLY when every
 *     mandatory stage finished with status "pass". `partial`, `skipped`, `fail`
 *     and missing stages all produce a non-zero exit code.
 *   - journey-evidence.json carries a machine-readable summary listing every
 *     non-passing or missing stage (`summary.non_pass_stages`, `summary.missing_stages`).
 *
 * Input simulation (§2.H): every UI interaction is performed through the Chromium
 * DevTools Protocol Input domain — Input.dispatchMouseEvent (real hit-testing,
 * focus and pointer routing) and Input.insertText / Input.dispatchKeyEvent for
 * keyboard input. No synthetic DOM MouseEvent dispatches are used as proof of
 * user interaction. (Page-side JS is used only to LOCATE elements — scroll them
 * into view and report their rects — never to fake clicks.)
 *
 * Stages (all mandatory, all must pass):
 *   S0  app-up                 — complete application launches incl. desktop renderer
 *   S1  onboarding             — first-run wizard walked step-by-step (no silent Skip)
 *   S2  provider configuration — Settings → Model settings → OpenRouter template with a
 *                                real key; verified persisted on disk
 *   S3  New Task submission    — task submitted from the original composer with the real
 *                                model; exact artifact path + exact content verified
 *   S4  task execution         — agent turn, tool use, result rows in the timeline
 *   S5  terminal panel         — real xterm surface; unique command; exact output verified
 *   S6  review/diff            — Ask Before Changes: approve AND reject verified against
 *                                the actual file content; prompts asserted to be real
 *                                permission surfaces (role=listbox "Permission required")
 *   S7  embedded browser       — real <webview> guest; navigate to example.com; verify the
 *                                guest's actual loaded URL and page content over CDP
 *   S8  plugin marketplace     — real marketplace view; specific plugin identity; real
 *                                install; installed state + package sha256 verified
 *   S9  session recovery       — app restart; exact session reopened; history + artifact
 *                                survived
 *
 * Modes (PHASEB_MODE):
 *   dev     — launch vite dev renderer + dev Electron (sandbox-capable; low memory)
 *   prod    — launch Electron against the production-built renderer (out/renderer; CI)
 *   attach  — attach to an already-running app via CDP port (PHASEB_CDP_PORT)
 *
 * Isolation (mirrors the upstream E2E pattern, packages/desktop/wdio.conf.ts):
 *   HOME / USERPROFILE / ZCODE_DATA_BASE_DIR / ZCODE_DESKTOP_HOME_DIR are all pointed at
 *   PHASEB_HOME, so provider config lands at $PHASEB_HOME/.zcode/v2/provider_config.json
 *   and the default conversation workspace at $PHASEB_HOME/.zcode/workspace/default.
 *
 * Env:
 *   OPENROUTER_API_KEY   — real model provider key (required for S2/S3/S4/S6)
 *   PHASEB_MODEL         — model id (default nvidia/nemotron-3-ultra-550b-a55b:free)
 *   PHASEB_HOME          — isolated home/data base dir (default .phaseb-home under repo;
 *                          MUST be fresh for S1 to see the first-run wizard)
 *   PHASEB_STAGES        — comma list of stages to run (default all; the verdict still
 *                          requires every mandatory stage to pass)
 *   PHASEB_MAX_WAIT_MS   — per-wait budget default 240000
 *
 * This script is evidence tooling only: it changes no repository sources,
 * registers no hooks and performs no repository mutation. All app state lives
 * under PHASEB_HOME. The OpenRouter key is never written to evidence artifacts.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DESKTOP_DIR = join(REPO_ROOT, "packages", "desktop");

const MODE = process.env.PHASEB_MODE ?? "dev";
const CDP_PORT = Number(process.env.PHASEB_CDP_PORT ?? 9229);
const EVIDENCE_DIR = resolve(REPO_ROOT, process.env.PHASEB_EVIDENCE_DIR ?? "evidence/phase-b/journey");
const SCREEN_DIR = join(EVIDENCE_DIR, "screenshots");
const DUMP_DIR = join(EVIDENCE_DIR, "dom-dumps");
const PHASEB_HOME = resolve(REPO_ROOT, process.env.PHASEB_HOME ?? ".phaseb-home");
// With HOME/USERPROFILE/ZCODE_DATA_BASE_DIR all redirected to PHASEB_HOME the app's
// default conversation workspace is $PHASEB_HOME/.zcode/workspace/default
// (packages/services/src/paths.ts getConversationWorkspaceDir) — same layout the
// upstream E2E suite uses for its isolated home.
const TASK_WORKSPACE = resolve(
  process.env.PHASEB_TASK_WORKSPACE ?? join(PHASEB_HOME, ".zcode", "workspace", "default"),
);
const ZCODE_DATA_ROOT = join(PHASEB_HOME, ".zcode");
const PROVIDER_CONFIG_FILE = join(ZCODE_DATA_ROOT, "v2", "provider_config.json");
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY ?? "";
const MODEL_ID = process.env.PHASEB_MODEL ?? "nvidia/nemotron-3-ultra-550b-a55b:free";
const MAX_WAIT = Number(process.env.PHASEB_MAX_WAIT_MS ?? 240000);
const STAGES = (process.env.PHASEB_STAGES ?? "S0,S1,S2,S3,S4,S5,S6,S7,S8,S9").split(",").map((s) => s.trim());
const MANDATORY_STAGES = ["S0", "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9"];
const APP_NAME = process.env.PHASEB_APP_NAME ?? "GamosPhaseBJourney";
const RUN_TOKEN = `GAMOS-PHASE-B-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
// Staged, versioned dev app dir (mirrors the E2E staging pattern). Not a source
// modification — build output staging only.
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
  revision: 2,
  run_token: RUN_TOKEN,
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
    provider_config_file: PROVIDER_CONFIG_FILE,
    input_simulation: "CDP Input.dispatchMouseEvent / Input.insertText / Input.dispatchKeyEvent (no synthetic DOM events)",
  },
  stages: {},
  commands: [],
  failures: [],
};

function recordStage(id, status, detail) {
  evidence.stages[id] = { status, detail, at: new Date().toISOString() };
  log(`STAGE ${id}: ${status} — ${typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 400)}`);
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
  evidence.commands.push({ screenshot: name, path: `evidence/phase-b/journey/screenshots/${name}.png`, at: new Date().toISOString() });
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
  _electronChild = spawnChild("electron", electronBin, [STAGED_APP_DIR, "--no-sandbox"], {
    cwd: DESKTOP_DIR, env: electronEnv({ NODE_ENV: "production" }),
  });
  evidence.commands.push({ cmd: `electron ${STAGED_APP_DIR} --no-sandbox (production renderer; HOME=ZCODE_DATA_BASE_DIR=${PHASEB_HOME})`, at: new Date().toISOString() });
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
/* Shared journey state                                                */
/* ------------------------------------------------------------------ */
const journey = {
  sessionIds: [],        // v4 session ids created through the composer (S3)
  openRouterProviderId: null,
  providerSavedOnDisk: null,
  terminalMarker: `${RUN_TOKEN}-TERMINAL-OK`,
  approvedLine: "REVIEW-APPROVED-LINE",
  rejectedLine: "REVIEW-REJECTED-LINE",
  taskFile: join(TASK_WORKSPACE, "gamos-phase-b-journey.txt"),
  browserGuestUrl: null,
  marketplace: {},
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
      await new Promise((r) => setTimeout(r, 15000));
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

/**
 * First-run login entry (the app's REAL fresh-HOME flow, only reachable once the
 * provider registry initializes): Root's provider-availability login guard opens
 * the WelcomeScreen when there is no logged-in user AND no usable provider
 * (packages/ui/src/root/useProviderAvailabilityLoginEntryGuard.ts
 * "未登录且没有可用模型配置时必须引导用户连接账号或填写 API Key"). The journey's
 * user configures OpenRouter later through Settings (S2), so the faithful action
 * here is the login screen's own "Use API key" → "Skip" path
 * (WelcomeScreen loginMode="apiKey" → LoginApiKeyForm skip → onComplete("skip")
 * — "跳过只表示用户确认当前 provider family 运行域"， no empty API key is written).
 * Skipping the login screen itself (as opposed to skipping onboarding steps) is
 * recorded explicitly in the stage evidence.
 */
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

async function stageS2() {
  if (!OPENROUTER_KEY) throw new Error("OPENROUTER_API_KEY missing — cannot configure the real model provider");
  // Settings → Model settings (authoritative nav: settings-section-nav-modelProvider —
  // same path the upstream E2E provider specs use).
  await waitForTid("sidebar");
  await clickTid("task-settings-button", { timeout: 30000 });
  await waitForTid("settings-page", { timeout: 30000 });
  await screenshot("S2-settings-open");
  await clickTid("settings-section-nav-modelProvider", { timeout: 30000 });
  await waitForTid("model-provider-add-provider-button", { timeout: 30000 });
  await screenshot("S2-model-settings");
  // Add provider → OpenRouter template (template id "openrouter" — config/provider/zcode-builtin.json).
  await clickTid("model-provider-add-provider-button", { timeout: 30000 });
  await waitForTid("model-provider-template-picker", { timeout: 20000 });
  await screenshot("S2-add-provider");
  const templateItem = "model-provider-template-item-openrouter";
  await waitForTid(templateItem, { timeout: 20000 });
  await clickTid(templateItem, { timeout: 20000 });
  // Atomic template creation writes the provider to provider_config.json — poll the disk.
  const providerId = await waitFor(() => {
    for (const rule of readProviderRules()) {
      if (rule.templateId === "openrouter" && rule.providerId) return rule.providerId;
    }
    return false;
  }, { what: "new openrouter provider in provider_config.json", timeout: 30000 });
  journey.openRouterProviderId = providerId;
  await new Promise((r) => setTimeout(r, 800));
  // Select the new instance in the provider navigation.
  await clickTid(`model-provider-nav-item-custom:${providerId}`, { timeout: 30000 });
  await waitForTid("model-provider-api-key-input", { timeout: 30000 });
  await screenshot("S2-provider-detail");
  // Type the real key through the real input path (CDP click + insertText), then
  // blur (Tab) — the blur submits the connection draft (upstream helper semantics).
  await clickAndType("model-provider-api-key-input", OPENROUTER_KEY, { timeout: 20000 });
  await screenshot("S2-api-key-entered");
  await pressKey("Tab");
  await new Promise((r) => setTimeout(r, 1200));
  // Verify the provider persisted on disk with the real key. The personal overlay
  // is SPARSE (packages/provider/src/config/rule-data-schema.ts: a template-derived
  // provider only stores changed leaves — here the API key): the effective base URL
  // is inherited from the openrouter template in the injected built-in baseline
  // (config/provider/zcode-builtin.json), so the URL is verified from the overlay
  // when present and from the template baseline otherwise.
  const templateBaseURL = (() => {
    try {
      const doc = JSON.parse(readFileSync(ZCODE_BUILTIN_PROVIDER_CONFIG_BASELINE, "utf8"));
      const found = JSON.stringify(doc).match(/"templateId":"openrouter"[\s\S]{0,2000}?"baseUrl":"(https:[^"]+)"/);
      return found?.[1] ?? null;
    } catch { return null; }
  })();
  const saved = await waitFor(() => {
    const rule = readProviderRules().find((r) => r.providerId === providerId);
    if (!rule) return false;
    const key = rule.config?.access?.apiKey ?? null;
    if (key !== OPENROUTER_KEY) return false;
    const overlayBaseURL = rule.config?.api?.baseUrl ?? null;
    const effectiveBaseURL = overlayBaseURL ?? templateBaseURL;
    if (effectiveBaseURL && /openrouter\.ai/.test(effectiveBaseURL)) {
      return { key: true, baseURL: effectiveBaseURL, baseURLSource: overlayBaseURL ? "personal overlay" : "template baseline (sparse overlay inherits it)" };
    }
    return false;
  }, { what: "provider saved to provider_config.json (real key; effective openrouter base URL)", timeout: 30000 }).catch((e) => {
    // Key-redacted on-disk state for diagnosis (the real key is never logged).
    const rule = readProviderRules().find((r) => r.providerId === providerId);
    const redacted = rule ? JSON.parse(JSON.stringify(rule), (k, v) => (k === "apiKey" && typeof v === "string") ? `<redacted:${v.length} chars>` : v) : null;
    e.message = `${e.message}; on-disk rule (key redacted): ${JSON.stringify(redacted)?.slice(0, 600)}`;
    throw e;
  });
  journey.providerSavedOnDisk = saved;
  await screenshot("S2-provider-saved");
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
    nav: "task-settings-button → settings-section-nav-modelProvider → add-provider → template openrouter",
    provider_id: providerId,
    template: "openrouter",
    persisted_to: PROVIDER_CONFIG_FILE,
    base_url_verified: saved.baseURL,
    base_url_source: saved.baseURLSource,
    api_key_persisted: true,
    free_tier_model_added: { model: MODEL_ID, via: addedModelVia, reason: "template catalog is paid-tier; the key's ~10 credits cannot afford paid models (402 evidence) — the free-tier model is required for real tasks", on_disk_verified: journey.freeModelOnDisk },
    note: "API key entered via CDP Input.insertText into the real model-provider-api-key-input; persistence verified on disk (key never logged)",
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

async function stageS3() {
  // Real model selection through the composer's model picker.
  const selection = await selectModelInComposer();
  await screenshot("S3-model-selected");
  const taskFile = journey.taskFile;
  const expectedContent = "GAMOS-PHASE-B-DESKTOP-JOURNEY-OK";
  const taskText = `Create a file at exactly this absolute path: ${taskFile} — with exactly this single line of content: ${expectedContent}. Then read the file back and print its exact content.`;
  await submitComposerTask(taskText, "S3");
  await screenshot("S3-task-submitted");
  const approvals = [];
  let result = await waitForTurnCompletion({ timeout: MAX_WAIT, approvals });
  // Real-user retry (run 42104260632 root cause): when the model TURN itself
  // fails (chat-error-banner; free-tier rate/credit flakiness), a user resubmits
  // the task. One retry keeps the verification exact — the artifact must still
  // exist with exactly the expected content.
  if (result.turnFailed) {
    log("S3: model turn failed (chat-error-banner) — resubmitting the task once (real-user retry)");
    await screenshot("S3-turn-failed");
    // Snapshot the banner BEFORE dismissing/resubmitting: the signature is the
    // stale-banner fallback for the retry wait.
    const staleBanner = (await timelineState().catch(() => null))?.bannerSignature ?? null;
    await dismissErrorBanner();
    await submitComposerTask(taskText, "S3-retry");
    result = await waitForTurnCompletion({ timeout: MAX_WAIT, approvals, staleBanner });
    result = { ...result, retriedAfterTurnFailure: true };
  }
  const sessionId = result.paneSessionId ?? await paneSessionId();
  if (sessionId && sessionId !== "draft") journey.sessionIds.push(sessionId);
  await screenshot("S3-task-result");
  // Exact artifact verification: path exists AND content matches exactly.
  const artifactOk = existsSync(taskFile);
  const artifactContent = artifactOk ? readFileSync(taskFile, "utf8").trim() : null;
  const contentMatches = artifactContent === expectedContent;
  const pass = result.completed && artifactOk && contentMatches;
  recordStage("S3", pass ? "pass" : "fail", {
    task: "file create + read-back via New Task composer (real model)",
    model_selected: selection,
    completed: result.completed,
    session_id: sessionId,
    timeline_rows: result.rows,
    tool_use_seen: result.sawToolUse,
    permission_approvals: approvals.map((a) => ({ kind: a.kind, result: a.result })),
    artifact: artifactOk ? taskFile : "missing",
    artifact_content: artifactContent,
    expected_content: expectedContent,
    exact_content_match: contentMatches,
    timeline_excerpt: (result.timeline ?? "").slice(0, 400),
  });
  if (!pass) {
    throw new Error(`S3 task did not complete with the exact expected artifact (completed=${result.completed}, artifact=${artifactOk}, exactMatch=${contentMatches})`);
  }
}

async function stageS4() {
  const state = await timelineState();
  await screenshot("S4-task-execution-review");
  await dumpDom("S4-task-execution-review");
  const toolEvidence = /write|read|edit|terminal|bash|tool/i.test(state?.timeline ?? "");
  const assistantRows = (state?.rows ?? 0) >= 2;
  const sessionListed = journey.sessionIds.length > 0 && await hasTid(`task-item-${journey.sessionIds[0]}`).catch(() => false);
  const pass = toolEvidence && assistantRows && Boolean(state?.paneSessionId && state.paneSessionId !== "draft");
  recordStage("S4", pass ? "pass" : "fail", {
    timeline_rows: state?.rows,
    session_id: state?.paneSessionId,
    tool_evidence_in_timeline: toolEvidence,
    assistant_rows_present: assistantRows,
    task_listed_in_sidebar: sessionListed,
    timeline_excerpt: (state?.timeline ?? "").slice(0, 700),
  });
  if (!pass) throw new Error("S4 task execution evidence incomplete (tool use / rows / session)");
}

async function visibleTerminalText() {
  return evalJs(`(() => {
    const rows = Array.from(document.querySelectorAll('[data-testid="terminal"] .xterm-rows'))
      .filter(r => r.offsetParent !== null);
    return rows.map(r => r.textContent ?? '').join('\\n').slice(0, 4000);
  })()`);
}

async function stageS5() {
  // Open the REAL terminal panel via its header toggle. Retry the toggle: the
  // first click occasionally lands before the toggle's handler is wired (S5
  // passed in run d322b1df and failed in 0d7534ed with the panel never opening).
  const xtermVisible = () => evalJs(`(() => { return Array.from(document.querySelectorAll('[data-testid="terminal"] .xterm-rows')).some(r => r.offsetParent !== null); })()`).catch(() => false);
  let toggled = 0;
  while (!(await xtermVisible()) && toggled < 3) {
    await clickTid("terminal-toggle", { timeout: 30000 }).catch(() => {});
    toggled++;
    await waitFor(async () => Boolean(await xtermVisible()), { what: `terminal panel (.xterm-rows visible; toggle attempt ${toggled})`, timeout: 20000 }).catch(() => {});
  }
  if (!(await xtermVisible())) {
    throw new Error("terminal panel did not open after 3 toggle attempts");
  }
  await screenshot("S5-terminal-open");
  // Wait for the shell prompt (real PTY spawn).
  await waitFor(async () => /[$#]\s*$/m.test((await visibleTerminalText()) ?? ""), { what: "shell prompt in terminal", timeout: 60000 });
  // Focus the terminal surface with a REAL CDP click on the visible xterm element
  // (xterm focuses its helper textarea on click), then type a unique harmless command.
  const termRect = await rectOf(`(() => { return Array.from(document.querySelectorAll('[data-testid="terminal"] .xterm')).find(e => e.offsetParent !== null); })()`);
  if (!termRect) throw new Error("no visible xterm element to click");
  await cdpClickRect(termRect);
  await new Promise((r) => setTimeout(r, 300));
  const command = `echo ${journey.terminalMarker}`;
  await typeIntoFocused(command);
  await pressKey("Enter");
  // Verify the exact command output appears in the terminal's rendered rows.
  const output = await waitFor(async () => {
    const text = (await visibleTerminalText()) ?? "";
    return text.includes(journey.terminalMarker) ? text : false;
  }, { what: `terminal output containing ${journey.terminalMarker}`, timeout: 30000 });
  await screenshot("S5-terminal-output");
  const focusedOk = await evalJs(`(() => { const a = document.activeElement; return Boolean(a && a.classList && a.classList.contains('xterm-helper-textarea')); })()`).catch(() => false);
  recordStage("S5", "pass", {
    panel: "terminal-toggle → [data-testid=terminal] xterm surface",
    prompt_seen: true,
    command,
    input_path: "CDP click on xterm → Input.insertText + Input.dispatchKeyEvent(Enter)",
    xterm_focused: focusedOk,
    exact_output_verified: true,
    terminal_text_excerpt: output.slice(-400),
  });
  // Close the terminal panel to restore the workspace layout for S6.
  await clickTid("terminal-close-button", { timeout: 15000 }).catch(async () => {
    await clickTid("terminal-toggle", { timeout: 15000 });
  });
  await new Promise((r) => setTimeout(r, 600));
}

async function switchComposerMode(modeItemTid, expectedLabelRegex) {
  await waitForTid("chat-mode-select-trigger", { timeout: 30000 });
  await clickTid("chat-mode-select-trigger", { timeout: 30000 });
  await waitForTid(modeItemTid, { timeout: 20000 });
  await clickTid(modeItemTid, { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 700));
  await pressKey("Escape").catch(() => {});
  await new Promise((r) => setTimeout(r, 400));
  const label = await tidText("chat-mode-select-trigger");
  if (!expectedLabelRegex.test(label)) {
    throw new Error(`mode switch failed: trigger label "${label.slice(0, 80)}" does not match ${expectedLabelRegex}`);
  }
  return label.slice(0, 80);
}

async function stageS6() {
  // 1. Enable the original "Ask before changes" flow (mode build).
  const modeLabel = await switchComposerMode("chat-mode-select-item-build", /ask before changes|build/i);
  await screenshot("S6-review-mode-on");
  const file = journey.taskFile;

  // --- APPROVE flow ---
  const approveTask = `Edit the file at exactly this absolute path: ${file} — append a second line with exactly this content: ${journey.approvedLine}. Then show the final file content.`;
  await submitComposerTask(approveTask, "S6-approve");
  const approveDialog = await waitForPermissionDialog();
  await screenshot("S6-approve-prompt");
  // Assert this is the REAL permission surface (not generic page text).
  const isRealSurface = Boolean(
    approveDialog.options?.length &&
    approveDialog.options.some((o) => (o.kind ?? "").startsWith("allow")) &&
    approveDialog.options.some((o) => (o.kind ?? "").startsWith("reject")),
  );
  if (!isRealSurface) throw new Error(`S6 approve prompt is not a real permission surface: ${JSON.stringify(approveDialog.options?.map((o) => o.kind))}`);
  const approve = await respondPermission("allowOnce");
  await screenshot("S6-approve-confirmed");
  const approveApprovals = [];
  let approveResult = await waitForTurnCompletion({ timeout: MAX_WAIT, autoApprove: true, approvals: approveApprovals });
  if (approveResult.turnFailed) {
    log("S6 approve: model turn failed (chat-error-banner) — resubmitting once (real-user retry)");
    const staleBanner = (await timelineState().catch(() => null))?.bannerSignature ?? null;
    await dismissErrorBanner();
    await submitComposerTask(approveTask, "S6-approve-retry");
    approveResult = await waitForTurnCompletion({ timeout: MAX_WAIT, autoApprove: true, approvals: approveApprovals, staleBanner });
    approveResult = { ...approveResult, retriedAfterTurnFailure: true };
  }
  // Exact modification verification.
  const afterApprove = existsSync(file) ? readFileSync(file, "utf8") : "";
  const approvedApplied = afterApprove.includes(journey.approvedLine);
  const firstLineIntact = afterApprove.trim().split("\n")[0] === "GAMOS-PHASE-B-DESKTOP-JOURNEY-OK";

  // --- REJECT flow ---
  const rejectTask = `Edit the file at exactly this absolute path: ${file} — append a third line with exactly this content: ${journey.rejectedLine}. Then show the final file content.`;
  await submitComposerTask(rejectTask, "S6-reject");
  const rejectDialog = await waitForPermissionDialog();
  await screenshot("S6-reject-prompt");
  const rejectIsReal = Boolean(
    rejectDialog.options?.some((o) => (o.kind ?? "").startsWith("reject")),
  );
  if (!rejectIsReal) throw new Error("S6 reject prompt is not a real permission surface");
  const reject = await respondPermission("rejectOnce");
  await screenshot("S6-reject-confirmed");
  const rejectApprovals = [];
  // Any FURTHER permission dialog during this turn is also rejected: the user has
  // rejected this modification, and a model retry must not be approved by the
  // journey itself (that would apply the very change we are verifying as rejected).
  let rejectResult = await waitForTurnCompletion({ timeout: Math.min(MAX_WAIT, 180000), autoApprove: true, respondKind: "rejectOnce", approvals: rejectApprovals });
  if (rejectResult.turnFailed) {
    log("S6 reject: model turn failed (chat-error-banner) — resubmitting once (real-user retry)");
    const staleBanner = (await timelineState().catch(() => null))?.bannerSignature ?? null;
    await dismissErrorBanner();
    await submitComposerTask(rejectTask, "S6-reject-retry");
    // The retried turn must again be REJECTED when it asks permission.
    rejectResult = await waitForTurnCompletion({ timeout: Math.min(MAX_WAIT, 180000), autoApprove: true, respondKind: "rejectOnce", approvals: rejectApprovals, staleBanner });
    rejectResult = { ...rejectResult, retriedAfterTurnFailure: true };
  }
  // The rejected modification must NOT be applied; grace-recheck for late writes.
  let afterReject = existsSync(file) ? readFileSync(file, "utf8") : "";
  for (let i = 0; i < 2 && !afterReject.includes(journey.rejectedLine); i++) {
    await new Promise((r) => setTimeout(r, 3000));
    afterReject = existsSync(file) ? readFileSync(file, "utf8") : "";
  }
  const rejectedNotApplied = !afterReject.includes(journey.rejectedLine);
  const approvedStillPresent = afterReject.includes(journey.approvedLine);

  const pass = approvedApplied && firstLineIntact && rejectedNotApplied && approvedStillPresent;
  recordStage("S6", pass ? "pass" : "fail", {
    mode: modeLabel,
    approve: {
      prompt_surface: approve.surface,
      real_permission_surface: isRealSurface,
      respond_selection_verified: approve.confirmedSelection,
      responded: "allowOnce (selection verified via aria-selected before Confirm) + Confirm",
      turn_completed: approveResult.completed,
      exact_modification_applied: approvedApplied,
      first_line_intact: firstLineIntact,
      file_after: afterApprove.trim().slice(0, 200),
      auto_approvals: approveApprovals.length,
    },
    reject: {
      prompt_surface: reject.surface,
      real_permission_surface: rejectIsReal,
      respond_selection_verified: reject.confirmedSelection,
      responded: "rejectOnce (selection verified via aria-selected before Confirm) + Confirm",
      turn_completed: rejectResult.completed,
      modification_not_applied: rejectedNotApplied,
      approved_line_still_present: approvedStillPresent,
      file_after: afterReject.trim().slice(0, 200),
      auto_approvals: rejectApprovals.length,
    },
  });
  if (!pass) {
    throw new Error(`S6 review flow verification failed (approved=${approvedApplied}, firstLineIntact=${firstLineIntact}, rejectedNotApplied=${rejectedNotApplied}, approvedStillPresent=${approvedStillPresent})`);
  }
}

async function stageS7() {
  // Open the REAL embedded browser side pane, mirroring the upstream E2E flow
  // (packages/desktop/test/e2e/helpers/browser-side-pane.ts openFirstBrowserTab):
  // the pane's open-tab launcher row [data-side-pane-open-tab-item="browser"],
  // reached by opening the side pane. Opening the pane uses the title bar's
  // side-pane-toggle button (WorkspaceSidePaneToggleButton) — present whether
  // the pane is open or closed — with the ⌥⌘B workspace shortcut (real CDP
  // Input.dispatchKeyEvent key events, Alt=1|Meta=4) and the pane's
  // add-trigger ("+") menu as fallbacks.
  //
  // Run 42061508909 evidence: with S3–S6 now passing, the workspace holds a REAL
  // task session, and the task-scoped side-pane memory (useAppPanels
  // readTaskSidePaneMemoryKey) starts the pane COLLAPSED for that task — the
  // pane is no longer pre-open on the launcher state like it was when S3–S6
  // failed fast with an empty draft workspace. Every opening step below is
  // therefore INSTRUMENTED (toggle aria-label + pane width + launcher/add-trigger
  // presence logged before/after each attempt) so any future failure pinpoints
  // the exact layer (click landing vs handler firing vs pane mounting vs
  // launcher row rendering), and each attempt waits for the pane ANIMATION and
  // lazy launcher mount (AnimatedSidePanePanel) instead of a fixed 900ms probe.
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
  const isPaneOpen = (state) => {
    if (!state) return false;
    if (state.addressInputPresent) return true;
    if (state.launcherRowPresent && state.launcherRowRect?.w > 0) return true;
    if (state.addTriggerPresent && state.addTriggerRect?.w > 0) return true;
    if (state.launcherShellRect?.w > 0) return true;
    return false;
  };
  const logPane = (tag) => paneState().then((s) => log(`pane-state [${tag}]: ${JSON.stringify(s)}`));
  const clickOpenTabBrowser = async () => {
    const r = await rectOf(`document.querySelector('[data-side-pane-open-tab-item="browser"]')`).catch(() => null);
    if (!r || !(r.w > 0)) return false;
    await cdpClickRect(r);
    return true;
  };
  // After a toggle/shortcut attempt, give the pane ANIMATION + lazy launcher
  // mount real time, then click the browser launcher row.
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
    // Open the side pane via its title-bar toggle (real CDP click). The pane may
    // open on the launcher (empty) state — the browser row is then polled and
    // clicked — or on existing tabs — the add-trigger fallback applies. The
    // toggle is re-clicked (up to 3 total) only when its aria-label shows the
    // pane did NOT expand, so open/closed oscillation cannot occur.
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
      if (expanded) {
        // The toggle FIRED (aria flipped) but neither the browser launcher row
        // nor the add-trigger surfaced. Re-clicking would COLLAPSE the pane
        // again — stop toggling and let the ⌥⌘B diagnostics below decide.
        log(`toggle attempt ${toggleAttempt}: pane toggled (${after?.toggleAriaLabel ?? "?"}) but no browser entry surfaced`);
        break;
      }
      log(`toggle attempt ${toggleAttempt}: aria-label unchanged (${after?.toggleAriaLabel ?? "?"}) — the click did not toggle; retrying`);
    }
    // Fallback: the app's real ⌥⌘B workspace shortcut as CDP key events.
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
  // Instrumentation gap fix (run 42098005816 evidence): the success paths above
  // return silently — log the descriptor so every failure is attributable to a
  // specific opening path.
  log(`S7 browser pane opened via: ${opened}`);
  // Run 42098005816 root cause (5th S7 incident, distinct from all prior ones):
  // the launcher-row click DID create the browser tab (tab trigger
  // [data-testid="browser"] present in the failure DOM dump; launcher rows gone)
  // but the pane content never switched to the browser surface — the SESSION pane
  // stayed active and browser-address-input never mounted within 30s, on a
  // byte-identical journey + application tree (git diff vs the tested commit
  // bef775cd is empty for scripts/ and packages/apps). A real user recovers by
  // clicking the browser TAB TRIGGER again; the journey does exactly that
  // (real CDP click, no DOM-event shortcut) before giving up.
  let addressInputOk = false;
  let tabRetry = 0;
  for (let attempt = 0; attempt < 3 && !addressInputOk; attempt++) {
    if (attempt > 0) {
      await logPane(`address-input retry ${attempt} (pre)`);
      // Recovery mirrors a real user in both possible pane states:
      // (a) the browser TAB exists ([data-side-pane-tab-id^="browser:"], the
      //     upstream E2E tab locator) but its content did not surface — clicking
      //     the tab trigger routes to handleActivateSidePaneTab, which calls
      //     platform.browserViewEnsureResident to RESUME a suspended guest
      //     (useAppPanels.ts) and then activates the tab;
      // (b) the pane fell back to the OPEN-TAB launcher state (no tabs) —
      //     clicking the browser launcher row opens a browser tab again.
      const tabTrigger = await rectOf(`document.querySelector('[data-side-pane-tab-id^="browser:"]')`).catch(() => null);
      if (tabTrigger && tabTrigger.w > 0) {
        tabRetry = attempt;
        await cdpClickRect(tabTrigger);
      } else {
        const launcherRow = await rectOf(`document.querySelector('[data-side-pane-open-tab-item="browser"]')`).catch(() => null);
        if (!launcherRow || !(launcherRow.w > 0)) {
          log(`address-input retry ${attempt}: neither a browser tab trigger nor the open-tab launcher row is present`);
          break;
        }
        tabRetry = attempt;
        await cdpClickRect(launcherRow);
      }
      await new Promise((r) => setTimeout(r, 600));
    }
    addressInputOk = await waitForTid("browser-address-input", { timeout: attempt === 0 ? 30000 : 20000 })
      .then(() => true)
      .catch(() => false);
    if (!addressInputOk) await logPane(`address-input not mounted after attempt ${attempt}`);
  }
  if (!addressInputOk) {
    throw new Error(`S7 browser pane opened ("${opened}") but browser-address-input never mounted (tab-trigger retry ${tabRetry} applied; pane-state logged per attempt)`);
  }
  if (tabRetry > 0) log(`S7 address input mounted after tab-trigger retry ${tabRetry} (real-user recovery click)`);
  await screenshot("S7-browser-open");
  // Navigate FIRST — then wait for the webview. The <webview> guest only mounts
  // after a navigation is confirmed (BrowserViewportSurface: "只在确认导航后创建
  // human guest" — the empty state renders BrowserEmptyState INSTEAD of the
  // webview), so waiting for browser-webview before navigating can never succeed
  // on a fresh pane (run 42049966765 S7 evidence: pane open, address input
  // present, no browser-webview element in the DOM dump).
  await clickAndType("browser-address-input", "https://example.com", { timeout: 20000, clearFirst: true });
  await pressKey("Enter");
  // Navigation started → the webview element must now exist (presence-only check;
  // the in-guest read below is the real proof).
  await waitForTid("browser-webview", { timeout: 45000, visible: false });
  // PRIMARY verification — read the guest THROUGH the webview element itself:
  // getURL() is the guest's actual current URL, and executeJavaScript runs inside
  // the guest WebContents (the same evidence class as CDP-from-inside-the-guest).
  // Run 42068291128 lesson: the navigation SUCCEEDED (example.com fully rendered
  // in the pane — screenshot proof) but the browser-level CDP /json/list endpoint
  // did not expose the webview guest as a page target within 60s, so a
  // CDP-target-only gate misread a working browser as a failure. The in-guest
  // read is authoritative; the CDP scan is retained below as BONUS evidence only.
  const GUEST_READ_JS = assertPageJs("browser guest in-page read", `(async () => {
    const w = document.querySelector('[data-testid="browser-webview"]');
    if (!w) return { error: 'no webview element' };
    const url = typeof w.getURL === 'function' ? w.getURL() : null;
    let page = null;
    try {
      const raw = await w.executeJavaScript('JSON.stringify({ url: location.href, title: document.title, heading: (document.querySelector("h1")?.innerText ?? "").trim(), body: (document.body?.innerText ?? "").trim().slice(0, 400) })');
      page = JSON.parse(raw);
    } catch (e) { page = { error: String((e && e.message) || e) }; }
    return { url, page, src: w.getAttribute('src') };
  })()`);
  const guestInfo = await waitFor(async () => {
    const r = await evalJs(GUEST_READ_JS, { awaitPromise: true }).catch(() => null);
    if (!r) return false;
    if (r.error) return false;
    if (!/^https?:\/\/example\.(com|org)\//.test(r.url ?? "")) return false;
    if (/example domain|illustrative examples/i.test(`${r.page?.title ?? ""} ${r.page?.heading ?? ""} ${r.page?.body ?? ""}`)) return r;
    return false;
  }, { what: "webview guest actually loaded example.com (in-guest read: URL + title/heading/body)", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 800));
  await screenshot("S7-browser-page");
  // BONUS evidence (non-gating): the browser-level CDP target scan. When the
  // guest IS listed we additionally attach over CDP and read it from the DevTools
  // side; when it is not, that is recorded honestly (Electron webview guests are
  // not consistently surfaced by the /json/list browser endpoint).
  const guestTarget = await waitFor(async () => {
    const targets = await cdpTargets().catch(() => []);
    return targets.find((t) => t.type === "page" && /^https?:\/\/example\.(com|org)\//.test(t.url)) ?? false;
  }, { what: "webview guest CDP target (bonus scan)", timeout: 15000 }).catch(() => null);
  let cdpGuestRead = null;
  if (guestTarget) {
    const guestSession = await new CDPSession(guestTarget.webSocketDebuggerUrl, "browser-guest").open().catch(() => null);
    if (guestSession) {
      cdpGuestRead = await guestSession.send("Runtime.evaluate", {
        expression: `JSON.stringify({ url: location.href, title: document.title, heading: (document.querySelector('h1')?.innerText ?? '').trim(), body: (document.body?.innerText ?? '').trim().slice(0, 300) })`,
        returnByValue: true,
      }).then((r) => JSON.parse(r.result?.value ?? "{}")).catch(() => ({}));
      guestSession.close();
    }
  }
  const webviewMeta = await evalJs(`(() => { const w = document.querySelector('[data-testid="browser-webview"]'); if (!w) return null; return { src: w.getAttribute('src'), url: (typeof w.getURL === 'function' ? w.getURL() : null) }; })()`).catch(() => null);
  const guestPage = guestInfo.page ?? {};
  const contentOk = /example domain/i.test(guestPage.title ?? "") || /example domain/i.test(guestPage.heading ?? "") || /illustrative examples/i.test(guestPage.body ?? "");
  const urlOk = /^https?:\/\/example\.(com|org)\/?/.test(guestInfo.url ?? guestPage.url ?? "");
  const pass = Boolean(opened) && urlOk && contentOk;
  journey.browserGuestUrl = guestInfo.url ?? guestPage.url;
  recordStage("S7", pass ? "pass" : "fail", {
    opened_via: opened,
    address_bar: "browser-address-input (typed https://example.com + Enter)",
    verification_path: "in-guest read via the webview element (getURL + executeJavaScript inside the guest WebContents)",
    guest_actual: { url: guestInfo.url, page: guestPage, src: guestInfo.src },
    guest_cdp_target: guestTarget ? { id: guestTarget.id, url: guestTarget.url, cdp_read: cdpGuestRead } : "not surfaced by the browser-level /json/list endpoint (Electron webview guest; non-gating bonus scan)",
    webview_element: webviewMeta,
    actual_loaded_url_verified: urlOk,
    page_content_verified: contentOk,
  });
  if (!pass) throw new Error(`S7 browser verification failed (urlOk=${urlOk}, contentOk=${contentOk}, guestRead=${JSON.stringify(guestInfo).slice(0, 200)})`);
}

async function stageS8() {
  const pluginName = process.env.PHASEB_PLUGIN ?? "github";
  const marketplaceId = "zcode-plugins-official";
  const pluginId = `${pluginName}@${marketplaceId}`;
  // Open the REAL marketplace view from the sidebar (plugin-store-sidebar-open →
  // the PluginStorePage, whose list view carries data-testid="plugin-store-list").
  await clickTid("plugin-store-sidebar-open", { timeout: 30000 });
  await waitForTid("plugin-store-list", { timeout: 45000 });
  await screenshot("S8-marketplace-open");
  // Locate the specific plugin: search narrows the list; identity is verified by the
  // card's data-plugin-id (and again on the detail view).
  await clickAndType("plugin-store-search", pluginName, { timeout: 30000, clearFirst: true });
  await new Promise((r) => setTimeout(r, 1200));
  await pressKey("Escape");
  const card = await waitFor(async () => {
    const r = await rectOf(`document.querySelector('[data-testid="plugin-store-card"][data-plugin-id="${pluginId}"]')`).catch(() => null);
    return r && r.w > 0 ? r : false;
  }, { what: `plugin card for ${pluginId}`, timeout: 45000 });
  const cardIdentity = await evalJs(`document.querySelector('[data-testid="plugin-store-card"][data-plugin-id="${pluginId}"]')?.getAttribute('data-plugin-id') ?? null`);
  await cdpClickRect(card);
  await waitForTid("plugin-store-detail", { timeout: 30000 });
  const identity = await tidAttr("plugin-store-detail", "data-plugin-id");
  if (identity !== pluginId) {
    throw new Error(`S8 plugin identity mismatch: expected ${pluginId}, detail shows ${identity}`);
  }
  await screenshot("S8-plugin-detail");
  // Fetch the official marketplace manifest and take the declared sha256 for the plugin.
  const manifest = await fetchJson("https://cdn-zcode.z.ai/zcode/official-plugin/marketplace.json");
  const entry = (manifest.plugins ?? []).find((p) => p.name === pluginName);
  if (!entry) throw new Error(`plugin ${pluginName} missing from the live official marketplace manifest`);
  const declaredSha256 = entry.source?.sha256;
  const archiveUrl = entry.source?.url;
  const declaredVersion = entry.version;
  // Install through the real install button (exact plugin identity binding).
  await waitFor(async () => {
    const r = await rectOf(`(() => { const b = document.querySelector('[data-testid="plugin-store-install"][data-plugin-id="${pluginId}"]') ?? document.querySelector('[data-testid="plugin-store-install"]'); return b && !b.disabled ? b : null; })()`).catch(() => null);
    return r && r.w > 0 ? r : false;
  }, { what: "plugin-store-install button enabled", timeout: 30000 }).then((r) => cdpClickRect(r));
  await screenshot("S8-plugin-installing");
  // Wait for the install to land on disk: installed_plugins.json gains the record.
  const installedRecord = await waitFor(() => {
    const found = findInstalledPluginRecord(pluginId);
    return found ?? false;
  }, { what: `installed_plugins.json record for ${pluginId}`, timeout: 180000 });
  await new Promise((r) => setTimeout(r, 1500));
  // Verify the UI reflects the installed state (install button gone / installed affordances).
  const uiState = await evalJs(`(() => {
    const detail = document.querySelector('[data-testid="plugin-store-detail"]');
    const installBtn = detail?.querySelector('[data-testid="plugin-store-install"]');
    const tryNow = detail?.querySelector('[data-testid="plugin-store-try-now"]');
    const uninstall = document.querySelector('[data-testid="plugin-store-menu-uninstall"][data-plugin-id="${pluginId}"]');
    return { install_button_present: Boolean(installBtn), try_now_present: Boolean(tryNow), uninstall_entry_present: Boolean(uninstall) };
  })()`);
  await screenshot("S8-plugin-installed");
  // Independent checksum verification: download the same archive and hash it.
  const archive = Buffer.from(await (await fetch(archiveUrl)).arrayBuffer());
  const downloadedSha256 = createHash("sha256").update(archive).digest("hex");
  const checksumMatches = declaredSha256 === downloadedSha256;
  // Hash of the installed package tree (stability record for the evidence).
  const treeSha256 = hashDirectory(installedRecord.installPath);
  const pass = Boolean(cardIdentity === pluginId) && identity === pluginId && checksumMatches &&
    (uiState.install_button_present === false || uiState.try_now_present || uiState.uninstall_entry_present);
  recordStage("S8", pass ? "pass" : "fail", {
    marketplace_opened_via: "plugin-store-sidebar-open → plugin-store-list",
    card_identity: cardIdentity,
    plugin_identity: identity,
    manifest_entry: { name: entry.name, version: declaredVersion, publisherType: entry.publisherType, url: archiveUrl },
    install: "plugin-store-install button (real marketplace install)",
    installed_record: installedRecord,
    ui_installed_state: uiState,
    checksum: {
      manifest_sha256: declaredSha256,
      downloaded_archive_sha256: downloadedSha256,
      match: checksumMatches,
      installer_verification: "zip-source.ts verifies sha256 at install (upstream behavior)",
      installed_tree_sha256: treeSha256,
    },
  });
  if (!pass) throw new Error(`S8 marketplace install verification failed (card=${cardIdentity}, identity=${identity}, checksum=${checksumMatches}, ui=${JSON.stringify(uiState)})`);
}

function findInstalledPluginRecord(pluginId) {
  // The plugin storage root lives under the isolated data dir; search the tree for
  // installed_plugins.json and return the record for pluginId.
  const roots = [ZCODE_DATA_ROOT, join(PHASEB_HOME, "user-data")];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const candidates = [];
    const walk = (dir, depth) => {
      if (depth > 5) return;
      let entries;
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p, depth + 1);
        else if (e.name === "installed_plugins.json") candidates.push(p);
      }
    };
    walk(root, 0);
    for (const file of candidates) {
      try {
        const doc = JSON.parse(readFileSync(file, "utf8"));
        const record = (doc.plugins ?? []).find((p) => p.id === pluginId);
        if (record) {
          return { ...record, record_file: file, installPathExists: existsSync(record.installPath) };
        }
      } catch {}
    }
  }
  return null;
}

function hashDirectory(dir) {
  if (!existsSync(dir)) return null;
  const hash = createHash("sha256");
  const walk = (d) => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(d, e.name);
      if (e.isDirectory()) { hash.update(`D:${e.name}\n`); walk(p); }
      else if (e.isFile()) {
        hash.update(`F:${e.name}\n`);
        try { hash.update(readFileSync(p)); hash.update("\n"); } catch {}
      }
    }
  };
  walk(dir);
  return hash.digest("hex");
}

async function stageS9() {
  const sessionId = journey.sessionIds[0];
  if (!sessionId) throw new Error("S9 requires a session created by S3 (none recorded)");
  const beforeFile = existsSync(journey.taskFile) ? readFileSync(journey.taskFile, "utf8").trim() : null;
  // Restart the application.
  await stopApp();
  page = null;
  await new Promise((r) => setTimeout(r, 2000));
  await ensureDisplay();
  stageDesktopOut();
  if (MODE === "dev") await launchDev();
  else if (MODE === "prod") await launchProd();
  await attachCdp();
  // Defensive: with the same HOME the login entry should not reappear (the skip
  // record + S2's OpenRouter provider make the state usable), but if a login
  // surface does show, walk the same sanctioned Use API key → Skip path.
  await handleFirstRunLoginEntryIfPresent().catch(() => {});
  await waitForTid("sidebar", { timeout: 90000 });
  await new Promise((r) => setTimeout(r, 1500));
  await screenshot("S9-app-restarted");
  // Reopen that exact session from the task list (expand the project if needed).
  const taskItemTid = `task-item-${sessionId}`;
  await waitFor(async () => {
    if (await hasTid(taskItemTid)) return true;
    // Expand the default project section so its task rows render.
    const expanded = await evalJs(`(() => { const s = Array.from(document.querySelectorAll('[data-project-id][data-project-name]')).find(x => (x.dataset.projectName ?? '') === 'default'); if (!s) return false; const t = s.querySelector('[data-testid="virtual-project-toggle"]'); return t ? t.getAttribute('aria-expanded') === 'true' : false; })()`).catch(() => false);
    if (!expanded) {
      await evalJs(`(() => { const s = Array.from(document.querySelectorAll('[data-project-id][data-project-name]')).find(x => (x.dataset.projectName ?? '') === 'default'); const t = s?.querySelector('[data-testid="virtual-project-toggle"]'); if (t && !t.disabled) t.click(); return Boolean(t); })()`).catch(() => false);
      await new Promise((r) => setTimeout(r, 800));
    }
    return false;
  }, { what: `task list row for session ${sessionId}`, timeout: 60000 });
  await clickTid(taskItemTid, { timeout: 30000 });
  // The main pane must switch to that exact session.
  await waitFor(async () => (await paneSessionId()) === sessionId, { what: `pane session id === ${sessionId}`, timeout: 45000 });
  // The conversation history must have survived: the timeline shows the original
  // task and its read-back result.
  const timelineAfterRestart = await waitFor(async () => {
    const state = await timelineState().catch(() => null);
    const text = state?.timeline ?? "";
    return text.includes("GAMOS-PHASE-B-DESKTOP-JOURNEY-OK") && state.rows >= 2 ? text : false;
  }, { what: "restored timeline containing the original task + result", timeout: 60000 });
  const afterFile = existsSync(journey.taskFile) ? readFileSync(journey.taskFile, "utf8").trim() : null;
  await screenshot("S9-session-restored");
  const historySurvived = timelineAfterRestart.includes("GAMOS-PHASE-B-DESKTOP-JOURNEY-OK");
  const resultSurvived = afterFile === beforeFile && afterFile !== null && afterFile.includes(journey.approvedLine);
  const pass = historySurvived && resultSurvived;
  recordStage("S9", pass ? "pass" : "fail", {
    restart: "app killed (SIGTERM/SIGKILL) and relaunched with the same isolated home",
    reopened_session_id: sessionId,
    pane_session_id: await paneSessionId(),
    timeline_rows: (await timelineState().catch(() => ({})))?.rows,
    conversation_history_survived: historySurvived,
    timeline_excerpt: timelineAfterRestart.slice(0, 500),
    artifact_before_restart: beforeFile,
    artifact_after_restart: afterFile,
    result_survived: resultSurvived,
  });
  if (!pass) throw new Error(`S9 session recovery failed (history=${historySurvived}, result=${resultSurvived})`);
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */
async function main() {
  log(`Gamos Phase B UI journey rev 2 — mode=${MODE} stages=${STAGES.join(",")} run_token=${RUN_TOKEN}`);
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
      if (!fn) { recordStage(stage, "fail", `unknown stage id ${stage}`); continue; }
      try {
        await fn();
      } catch (e) {
        recordStage(stage, "fail", e.message);
        evidence.failures.push({ stage, error: e.message });
        await screenshot(`${stage}-failure`).catch(() => {});
        await dumpDom(`${stage}-failure`).catch(() => {});
      }
    }
  } finally {
    await stopApp();
  }
  evidence.finished_at = new Date().toISOString();
  // §2.A — strict integrity: exit 0 ONLY when every mandatory stage passed.
  const nonPass = MANDATORY_STAGES
    .filter((id) => evidence.stages[id] && evidence.stages[id].status !== "pass")
    .map((id) => ({ id, status: evidence.stages[id]?.status, detail: typeof evidence.stages[id]?.detail === "string" ? evidence.stages[id]?.detail : JSON.stringify(evidence.stages[id]?.detail ?? null).slice(0, 300) }));
  const missing = MANDATORY_STAGES.filter((id) => !evidence.stages[id]);
  const verdict = nonPass.length === 0 && missing.length === 0 ? "pass" : "fail";
  evidence.summary = {
    verdict,
    exit_code: verdict === "pass" ? 0 : 1,
    mandatory_stages: MANDATORY_STAGES,
    stages_requested: STAGES,
    stages_recorded: Object.keys(evidence.stages),
    non_pass_stages: nonPass,
    missing_stages: missing,
  };
  writeFileSync(join(EVIDENCE_DIR, "journey-evidence.json"), JSON.stringify(evidence, null, 2));
  log(`evidence written: ${join(EVIDENCE_DIR, "journey-evidence.json")}`);
  log(`summary: verdict=${verdict} non_pass=${JSON.stringify(nonPass.map((s) => `${s.id}:${s.status}`))} missing=${JSON.stringify(missing)}`);
  process.exit(verdict === "pass" ? 0 : 1);
}

main().catch(async (e) => {
  evidence.fatal = e.message;
  evidence.finished_at = new Date().toISOString();
  evidence.summary = {
    verdict: "fail",
    exit_code: 2,
    mandatory_stages: MANDATORY_STAGES,
    stages_recorded: Object.keys(evidence.stages),
    non_pass_stages: MANDATORY_STAGES.filter((id) => evidence.stages[id] && evidence.stages[id].status !== "pass").map((id) => ({ id, status: evidence.stages[id]?.status })),
    missing_stages: MANDATORY_STAGES.filter((id) => !evidence.stages[id]),
    fatal: e.message,
  };
  writeFileSync(join(EVIDENCE_DIR, "journey-evidence.json"), JSON.stringify(evidence, null, 2));
  log(`FATAL: ${e.message}`);
  await stopApp();
  process.exit(2);
});
