/**
 * The Unreal Remote Control connector (M4 WP-5, GREEN) — readiness §4.2
 * corrected design + §2.2 U-T1..U-T8, contract-tested by test/connector.test.ts
 * and test/engine-harden.test.ts against the in-repo mock RC server (an
 * EDITOR STAND-IN; protocol contracts ONLY — a mock can never pass M4-G2).
 *
 *   - CONSTRUCTION refuses any non-loopback configured host (throws
 *     LoopbackOnlyError — fail closed BEFORE any request; `localhost` is not
 *     accepted: a resolvable name proves nothing, U-T1) and validates the
 *     passphrase header-safe (no control characters).
 *   - `connect()` attaches over HTTP: probes GET /remote/info, validates the
 *     pinned response schema (drift ⇒ rc-schema-mismatch, U-T7), and verifies
 *     the server-REPORTED listener binding is loopback-only on BOTH listeners
 *     (non-loopback ⇒ rc-listener-not-loopback, U-T1 — a client connecting to
 *     127.0.0.1 proves nothing about server binding).
 *   - `connectWs()` opens the separate WebSocket lifecycle (event
 *     subscriptions); a dropped socket is SURFACED and NEVER auto-reconnected
 *     (U-T6 — the harness owns lifecycle); a wedged editor resolves to
 *     rc-timeout, never a hang.
 *   - Requests are typed, per-op-timeout-bounded, SINGLE-attempt (401/403 ⇒
 *     rc-auth-required, never a retry storm, U-T2) with the Passphrase header
 *     sent as an opaque transport-compatibility token only.
 *   - `writeProperty()` performs its own pre-read and journals the applied
 *     mutation; `applyRestore()` performs journal/rollback restores without
 *     re-journaling; `settleJournal()` clears entries whose chain completed.
 *   - `disconnect()` aborts in-flight requests (counted and surfaced), closes
 *     WebSocket and HTTP resources, restores ONLY interrupted
 *     connector-authorized mutations from the journal (the U-T3/U-T4 chain),
 *     clears state, and SURFACES every teardown failure — it NEVER terminates
 *     the externally owned editor (this module imports no process-control
 *     API at all; process-termination authority exists only for
 *     Gamos-supervisor-owned processes, readiness §2.2 U-T4).
 */

import { WebSocket } from "ws";
import type { ReviewedFunctionEntry } from "./function-allowlist.js";
import { REVIEWED_FUNCTION_ALLOWLIST } from "./function-allowlist.js";
import {
  DEFAULT_RC_HTTP_PORT,
  DEFAULT_RC_PASSPHRASE,
  DEFAULT_RC_WS_PORT,
  LOOPBACK_HOST,
  PROPERTY_ACCESS_MODE,
  RC_ROUTES,
  DescribeResponseSchema,
  RemoteInfoResponseSchema,
  WsServerFrameSchema,
  isLoopbackLiteralAddress,
  listenerBindingIsLoopbackOnly,
  type RcFailure,
  type RemoteInfoResponse,
  type WsServerFrame,
} from "./rc-protocol.js";
import type { ReviewedPropertyEntry, RcEndpoint } from "./typed-ops.js";
import { REVIEWED_PROPERTY_ALLOWLIST } from "./typed-ops.js";

/** Thrown at construction for any non-loopback configured host (U-T1). */
export class LoopbackOnlyError extends Error {
  constructor(host: string) {
    super(`the Unreal connector is loopback-only: refusing configured host ${JSON.stringify(host)} (readiness §2.2 U-T1)`);
    this.name = "LoopbackOnlyError";
  }
}

/** Thrown at construction for a header-unsafe passphrase (injection guard). */
export class UnsafePassphraseError extends Error {
  constructor() {
    super("the configured RC passphrase contains control characters (header-injection guard, readiness §2.2)");
    this.name = "UnsafePassphraseError";
  }
}

export interface ConnectorOptions {
  endpoint?: RcEndpoint;
  passphrase?: string;
  functionAllowlist?: readonly ReviewedFunctionEntry[];
  propertyAllowlist?: readonly ReviewedPropertyEntry[];
}

export interface DisconnectReport {
  closed: boolean;
  wsClosed: boolean;
  inFlightAborted: number;
  rolledBack: { objectPath: string; property: string; restored: boolean }[];
  failures: RcFailure[];
}

export interface ConnectorState {
  connected: boolean;
  wsConnected: boolean;
  info: RemoteInfoResponse | null;
  subscriptions: string[];
}

/** The mutation journal entry: an applied-but-unverified connector write. */
export interface JournalEntry {
  objectPath: string;
  property: string;
  previousValue: unknown;
}

interface PendingAck {
  resolve: (frame: WsServerFrame) => void;
  reject: (failure: RcFailure) => void;
  timer: ReturnType<typeof setTimeout>;
}

const WS_CLOSE_TIMEOUT_MS = 5_000;

export class UnrealRcConnector {
  readonly endpoint: RcEndpoint;
  readonly functionAllowlist: readonly ReviewedFunctionEntry[];
  readonly propertyAllowlist: readonly ReviewedPropertyEntry[];
  private readonly httpBase: string;
  private readonly wsUrl: string;
  private readonly passphrase: string;
  private connected = false;
  private ws: WebSocket | null = null;
  private wsConnected = false;
  private info: RemoteInfoResponse | null = null;
  private subscriptions = new Set<string>();
  private frameListeners: ((frame: WsServerFrame) => void)[] = [];
  private pendingAcks = new Map<string, PendingAck>();
  private inFlight = new Set<AbortController>();
  private journalEntries: JournalEntry[] = [];
  private tearingDown = false;

  constructor(options: ConnectorOptions = {}) {
    const endpoint: RcEndpoint =
      options.endpoint ?? { host: LOOPBACK_HOST, httpPort: DEFAULT_RC_HTTP_PORT, wsPort: DEFAULT_RC_WS_PORT };
    // U-T1: fail closed BEFORE any request — literal loopback only.
    if (!isLoopbackLiteralAddress(endpoint.host)) {
      throw new LoopbackOnlyError(endpoint.host);
    }
    const passphrase = options.passphrase ?? DEFAULT_RC_PASSPHRASE;
    if (/[\x00-\x1F\x7F]/.test(passphrase)) {
      throw new UnsafePassphraseError();
    }
    this.endpoint = endpoint;
    this.functionAllowlist = options.functionAllowlist ?? REVIEWED_FUNCTION_ALLOWLIST;
    this.propertyAllowlist = options.propertyAllowlist ?? REVIEWED_PROPERTY_ALLOWLIST;
    this.httpBase = `http://${endpoint.host}:${endpoint.httpPort}`;
    this.wsUrl = `ws://${endpoint.host}:${endpoint.wsPort}/`;
    this.passphrase = passphrase;
  }

  state(): ConnectorState {
    return {
      connected: this.connected,
      wsConnected: this.wsConnected,
      info: this.info,
      subscriptions: [...this.subscriptions],
    };
  }

  // ------------------------------------------------------------------ HTTP

  private async rawRequest(
    route: string,
    method: "GET" | "PUT",
    body: unknown,
    timeoutMs: number,
  ): Promise<{ ok: true; status: number; body: unknown } | RcFailure> {
    if (!this.connected && route !== RC_ROUTES.info) {
      return { ok: false, code: "rc-unreachable", message: "the connector is not attached (connect() first)" };
    }
    const controller = new AbortController();
    this.inFlight.add(controller);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.httpBase}${route}`, {
        method,
        headers: {
          "content-type": "application/json",
          // U-T2: an opaque transport-compatibility token — never claimed as
          // server-side authentication.
          Passphrase: this.passphrase,
        },
        body: method === "PUT" ? JSON.stringify(body ?? {}) : undefined,
        signal: controller.signal,
      });
      if (res.status === 401 || res.status === 403) {
        return { ok: false, code: "rc-auth-required", message: `the editor refused the request (HTTP ${res.status}) — no retry` };
      }
      if (res.status === 404) {
        let reason = "unknown route";
        try {
          const errorBody = (await res.json()) as { error?: string };
          if (errorBody.error === "unknown-object") reason = "unknown-object";
          else if (errorBody.error === "unknown-function") reason = "unknown-function";
        } catch {
          // fall through with the generic reason
        }
        if (reason === "unknown-object") {
          return { ok: false, code: "object-not-found", message: "the editor reports no such object for the validated path" };
        }
        if (reason === "unknown-function") {
          return { ok: false, code: "function-not-found", message: "the editor reports no such function on the object" };
        }
        return { ok: false, code: "rc-route-unknown", message: `the editor reports an unknown route (${route})` };
      }
      if (!res.ok) {
        return { ok: false, code: "rc-route-unknown", message: `unexpected HTTP ${res.status} from ${route}` };
      }
      let parsed: unknown;
      try {
        parsed = await res.json();
      } catch {
        return { ok: false, code: "rc-schema-mismatch", message: `the response from ${route} was not JSON` };
      }
      return { ok: true, status: res.status, body: parsed };
    } catch (error) {
      const name = error instanceof Error ? error.name : String(error);
      if (name === "AbortError" || name === "TimeoutError") {
        return {
          ok: false,
          code: "rc-timeout",
          message: this.tearingDown
            ? "the request was aborted during teardown (surfaced, never swallowed)"
            : `the request exceeded its bounded time (${timeoutMs}ms) — single attempt, no retry`,
        };
      }
      return { ok: false, code: "rc-unreachable", message: `the Remote Control endpoint is unreachable: ${name}` };
    } finally {
      clearTimeout(timer);
      this.inFlight.delete(controller);
    }
  }

  async connect(timeoutMs = 10_000): Promise<{ ok: true; info: RemoteInfoResponse } | RcFailure> {
    if (this.connected) {
      return { ok: true, info: this.info as RemoteInfoResponse };
    }
    const res = await this.rawRequest(RC_ROUTES.info, "GET", undefined, timeoutMs);
    if (!res.ok) return res;
    const parsed = RemoteInfoResponseSchema.safeParse(res.body);
    if (!parsed.success) {
      return {
        ok: false,
        code: "rc-schema-mismatch",
        message: "the /remote/info response did not match the pinned schema (fail closed, U-T7)",
        details: { issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
      };
    }
    // U-T1: the server-REPORTED binding is the authority — verify BOTH listeners.
    if (!listenerBindingIsLoopbackOnly(parsed.data.listenerBinding)) {
      return {
        ok: false,
        code: "rc-listener-not-loopback",
        message:
          "the editor-reported listener binding is not loopback-only (fail closed — a client connecting to 127.0.0.1 proves nothing about server binding, readiness §2.2 U-T1)",
        details: { listenerBinding: parsed.data.listenerBinding },
      };
    }
    this.info = parsed.data;
    this.connected = true;
    return { ok: true, info: parsed.data };
  }

  async remoteInfo(): Promise<{ ok: true; info: RemoteInfoResponse } | RcFailure> {
    if (!this.connected) {
      return { ok: false, code: "rc-unreachable", message: "the connector is not attached (connect() first)" };
    }
    return { ok: true, info: this.info as RemoteInfoResponse };
  }

  async describe(
    objectPath: string,
    timeoutMs = 30_000,
  ): Promise<{ ok: true; described: { class: string; properties: { name: string; type: string }[]; outerPath: string } } | RcFailure> {
    const res = await this.rawRequest(RC_ROUTES.describe, "PUT", { objectPath }, timeoutMs);
    if (!res.ok) return res;
    const parsed = DescribeResponseSchema.safeParse(res.body);
    if (!parsed.success) {
      return { ok: false, code: "rc-schema-mismatch", message: "the describe response did not match the pinned schema (fail closed, U-T7)" };
    }
    return { ok: true, described: parsed.data };
  }

  async readProperty(objectPath: string, propertyName: string, timeoutMs = 30_000): Promise<{ ok: true; value: unknown } | RcFailure> {
    const res = await this.rawRequest(
      RC_ROUTES.property,
      "PUT",
      { objectPath, propertyName, accessMode: PROPERTY_ACCESS_MODE.read },
      timeoutMs,
    );
    if (!res.ok) return res;
    const body = res.body as { value?: unknown };
    if (typeof body !== "object" || body === null || !("value" in body)) {
      return { ok: false, code: "rc-schema-mismatch", message: "the property-read response did not match the pinned schema (fail closed, U-T7)" };
    }
    return { ok: true, value: body.value };
  }

  async writeProperty(
    objectPath: string,
    propertyName: string,
    value: unknown,
    timeoutMs = 60_000,
    knownPreSnapshot?: unknown,
  ): Promise<{ ok: true; transactionId: string | null; preSnapshot: unknown } | RcFailure> {
    // The connector's own pre-read: every applied mutation is journaled with
    // its previous value (the U-T3/U-T4 chain's part one).
    let preSnapshot = knownPreSnapshot;
    if (preSnapshot === undefined) {
      const pre = await this.readProperty(objectPath, propertyName, timeoutMs);
      if (!pre.ok) return pre;
      preSnapshot = pre.value;
    }
    const res = await this.rawRequest(
      RC_ROUTES.property,
      "PUT",
      {
        objectPath,
        propertyName,
        propertyValue: value,
        accessMode: PROPERTY_ACCESS_MODE.writeTransaction,
        generateTransaction: true,
      },
      timeoutMs,
    );
    if (!res.ok) return res;
    const body = res.body as { transactionId?: string | null };
    if (typeof body !== "object" || body === null || !("transactionId" in body)) {
      return { ok: false, code: "rc-schema-mismatch", message: "the property-write response did not match the pinned schema (fail closed, U-T7)" };
    }
    this.journalEntries.push({ objectPath, property: propertyName, previousValue: preSnapshot });
    return { ok: true, transactionId: body.transactionId ?? null, preSnapshot };
  }

  async callFunction(
    objectPath: string,
    functionName: string,
    args: Record<string, unknown>,
    timeoutMs = 60_000,
  ): Promise<{ ok: true; returnValue?: unknown; transactionId: string | null } | RcFailure> {
    const res = await this.rawRequest(
      RC_ROUTES.call,
      "PUT",
      { objectPath, functionName, arguments: args, generateTransaction: true },
      timeoutMs,
    );
    if (!res.ok) return res;
    const body = res.body as { returnValue?: unknown; transactionId?: string | null };
    if (typeof body !== "object" || body === null) {
      return { ok: false, code: "rc-schema-mismatch", message: "the call response did not match the pinned schema (fail closed, U-T7)" };
    }
    return { ok: true, returnValue: body.returnValue, transactionId: body.transactionId ?? null };
  }

  // ------------------------------------------------------------------- WS

  async connectWs(timeoutMs = 10_000): Promise<{ ok: true } | RcFailure> {
    if (this.wsConnected) return { ok: true };
    if (!this.connected) {
      return { ok: false, code: "rc-unreachable", message: "the connector is not attached (connect() first)" };
    }
    return new Promise<{ ok: true } | RcFailure>((resolve) => {
      const ws = new WebSocket(this.wsUrl);
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try {
            ws.terminate();
          } catch {
            // already closing
          }
          resolve({ ok: false, code: "rc-timeout", message: `the WebSocket attach exceeded its bounded time (${timeoutMs}ms)` });
        }
      }, timeoutMs);
      ws.on("open", () => {
        this.ws = ws;
        this.wsConnected = true;
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({ ok: true });
        }
      });
      ws.on("message", (data) => {
        this.dispatchServerFrame(String(data));
      });
      // U-T6: a dropped or failed socket is SURFACED and never reconnected here.
      const surfaceDrop = () => {
        this.wsConnected = false;
        if (this.ws === ws) this.ws = null;
        for (const [key, pending] of this.pendingAcks) {
          clearTimeout(pending.timer);
          this.pendingAcks.delete(key);
          pending.reject({ ok: false, code: "rc-unreachable", message: `the WebSocket lifecycle dropped while awaiting ${key}` });
        }
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({ ok: false, code: "rc-unreachable", message: "the WebSocket attach failed or dropped (surfaced, no auto-reconnect)" });
        }
      };
      ws.on("close", surfaceDrop);
      ws.on("error", surfaceDrop);
    });
  }

  private dispatchServerFrame(raw: string): void {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      return;
    }
    const parsed = WsServerFrameSchema.safeParse(parsedJson);
    if (!parsed.success) return;
    const frame = parsed.data;
    if (frame.type === "subscribed" || frame.type === "unsubscribed") {
      const key = `${frame.type}:${frame.eventName}`;
      const pending = this.pendingAcks.get(key);
      if (pending) {
        this.pendingAcks.delete(key);
        clearTimeout(pending.timer);
        pending.resolve(frame);
        return;
      }
    }
    for (const listener of this.frameListeners) listener(frame);
  }

  async subscribe(eventName: string, timeoutMs = 10_000): Promise<{ ok: true; eventName: string } | RcFailure> {
    if (!this.wsConnected || !this.ws) {
      return { ok: false, code: "rc-unreachable", message: "the WebSocket lifecycle is not open (connectWs() first — no auto-connect)" };
    }
    const socket = this.ws;
    return new Promise<{ ok: true; eventName: string } | RcFailure>((resolve) => {
      const key = `subscribed:${eventName}`;
      const timer = setTimeout(() => {
        this.pendingAcks.delete(key);
        resolve({ ok: false, code: "rc-timeout", message: `the subscription ack exceeded its bounded time (${timeoutMs}ms)` });
      }, timeoutMs);
      this.pendingAcks.set(key, {
        resolve: () => {
          this.subscriptions.add(eventName);
          resolve({ ok: true, eventName });
        },
        reject: (failure) => resolve(failure),
        timer,
      });
      socket.send(JSON.stringify({ type: "subscribe", eventName }));
    });
  }

  async unsubscribe(eventName: string, timeoutMs = 10_000): Promise<{ ok: true; eventName: string } | RcFailure> {
    if (!this.wsConnected || !this.ws) {
      return { ok: false, code: "rc-unreachable", message: "the WebSocket lifecycle is not open" };
    }
    const socket = this.ws;
    return new Promise<{ ok: true; eventName: string } | RcFailure>((resolve) => {
      const key = `unsubscribed:${eventName}`;
      const timer = setTimeout(() => {
        this.pendingAcks.delete(key);
        resolve({ ok: false, code: "rc-timeout", message: `the unsubscribe ack exceeded its bounded time (${timeoutMs}ms)` });
      }, timeoutMs);
      this.pendingAcks.set(key, {
        resolve: () => {
          this.subscriptions.delete(eventName);
          resolve({ ok: true, eventName });
        },
        reject: (failure) => resolve(failure),
        timer,
      });
      socket.send(JSON.stringify({ type: "unsubscribe", eventName }));
    });
  }

  onServerFrame(listener: (frame: WsServerFrame) => void): void {
    this.frameListeners.push(listener);
  }

  // -------------------------------------------------------------- journal

  journal(): readonly JournalEntry[] {
    return [...this.journalEntries];
  }

  /** Clears the journal entries whose five-part chain COMPLETED (verified). */
  settleJournal(objectPath: string, property: string): void {
    this.journalEntries = this.journalEntries.filter(
      (entry) => !(entry.objectPath === objectPath && entry.property === property),
    );
  }

  /**
   * A restore write WITHOUT journaling (the rollback/teardown compensating
   * operation — restoring a previous value is not a new authorized mutation).
   */
  private async applyRestore(
    objectPath: string,
    propertyName: string,
    value: unknown,
    timeoutMs: number,
  ): Promise<{ ok: true } | RcFailure> {
    const res = await this.rawRequest(
      RC_ROUTES.property,
      "PUT",
      {
        objectPath,
        propertyName,
        propertyValue: value,
        accessMode: PROPERTY_ACCESS_MODE.writeTransaction,
        generateTransaction: true,
      },
      timeoutMs,
    );
    if (!res.ok) return res;
    return { ok: true };
  }

  // -------------------------------------------------------------- teardown

  async disconnect(timeoutMs = 30_000): Promise<DisconnectReport> {
    const failures: RcFailure[] = [];
    const rolledBack: { objectPath: string; property: string; restored: boolean }[] = [];
    this.tearingDown = true;

    // 1. Abort every in-flight request (counted — never swallowed).
    let inFlightAborted = 0;
    if (this.inFlight.size > 0) {
      inFlightAborted = this.inFlight.size;
      for (const controller of [...this.inFlight]) controller.abort();
      failures.push({
        ok: false,
        code: "rc-timeout",
        message: `${inFlightAborted} in-flight request(s) aborted during teardown (surfaced)`,
      });
    }

    // 2. Restore ONLY interrupted connector-authorized mutations (U-T4: only
    //    the connector's own journaled writes; completed chains were settled).
    for (const entry of [...this.journalEntries]) {
      try {
        const restore = await this.applyRestore(entry.objectPath, entry.property, entry.previousValue, timeoutMs);
        rolledBack.push({ objectPath: entry.objectPath, property: entry.property, restored: restore.ok });
        if (!restore.ok) failures.push(restore);
      } catch (error) {
        rolledBack.push({ objectPath: entry.objectPath, property: entry.property, restored: false });
        failures.push({ ok: false, code: "rc-transaction-failed", message: `journal restore threw: ${String(error)}` });
      }
    }
    this.journalEntries = [];

    // 3. Close the WebSocket lifecycle with a bounded close handshake.
    let wsClosed = true;
    if (this.ws) {
      wsClosed = await new Promise<boolean>((resolve) => {
        const ws = this.ws;
        if (!ws) {
          resolve(true);
          return;
        }
        const timer = setTimeout(() => {
          try {
            ws.terminate();
          } catch {
            // already closed
          }
          resolve(false);
        }, WS_CLOSE_TIMEOUT_MS);
        ws.once("close", () => {
          clearTimeout(timer);
          resolve(true);
        });
        try {
          ws.close();
        } catch {
          clearTimeout(timer);
          resolve(false);
        }
      });
      if (!wsClosed) {
        failures.push({ ok: false, code: "rc-unreachable", message: "the WebSocket close handshake did not complete within its bound" });
      }
    }

    // 4. Clear all state.
    this.tearingDown = false;
    this.connected = false;
    this.wsConnected = false;
    this.ws = null;
    this.info = null;
    this.subscriptions.clear();
    this.frameListeners = [];
    for (const [, pending] of this.pendingAcks) {
      clearTimeout(pending.timer);
      pending.reject({ ok: false, code: "rc-unreachable", message: "the connector tore down while awaiting a WebSocket ack" });
    }
    this.pendingAcks.clear();

    return { closed: true, wsClosed, inFlightAborted, rolledBack, failures };
  }
}
