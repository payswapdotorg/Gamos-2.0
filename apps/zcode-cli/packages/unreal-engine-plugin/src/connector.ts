/**
 * The Unreal Remote Control connector (M4 WP-5) — RED STUB.
 *
 * The shipped surface (implemented in GREEN; readiness §4.2 corrected design
 * + §2.2 U-T1..U-T8):
 *   - CONSTRUCTION refuses any non-loopback configured HTTP or WebSocket host
 *     (throws LoopbackOnlyError — fail closed BEFORE any request; `localhost`
 *     is not accepted: a resolvable name proves nothing, U-T1); the
 *     passphrase is validated header-safe (no control characters);
 *   - `connect()` attaches over HTTP: probes GET /remote/info, validates the
 *     pinned response schema, and verifies the server-REPORTED listener
 *     binding is loopback-only on BOTH listeners (non-loopback ⇒
 *     rc-listener-not-loopback, fail closed — a client connecting to
 *     127.0.0.1 proves nothing about server binding, U-T1);
 *   - `connectWs()` opens the separate WebSocket lifecycle (used by event
 *     subscriptions); a wedged editor resolves to rc-timeout, never a hang,
 *     and there is NO auto-reconnect anywhere (U-T6);
 *   - `request()` is typed, per-op-timeout-bounded, single-attempt (401/403 ⇒
 *     rc-auth-required, NEVER a retry storm), and schema-validates responses
 *     (drift ⇒ rc-schema-mismatch, U-T7);
 *   - `disconnect()` stops in-flight requests, closes WebSocket and HTTP
 *     resources, restores ONLY interrupted connector-authorized mutations
 *     from the journal (the U-T3/U-T4 chain), clears state, and SURFACES
 *     every teardown failure — it NEVER terminates the externally owned
 *     editor (process-termination authority exists only for
 *     Gamos-supervisor-owned processes, readiness §2.2 U-T4).
 */

import type { ReviewedFunctionEntry } from "./function-allowlist.js";
import { REVIEWED_FUNCTION_ALLOWLIST } from "./function-allowlist.js";
import type { RcFailure, RemoteInfoResponse, WsServerFrame } from "./rc-protocol.js";
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

/**
 * RED STUB — the real connector ships in the WP-5 GREEN commit. The
 * constructor deliberately does NOT validate anything yet: the binding tests
 * fail against this stub for the missing behavior (loopback refusal at
 * construction, lifecycle, typed requests, teardown contracts).
 */
export class UnrealRcConnector {
  readonly endpoint: RcEndpoint | undefined;
  readonly functionAllowlist: readonly ReviewedFunctionEntry[];
  readonly propertyAllowlist: readonly ReviewedPropertyEntry[];

  constructor(options: ConnectorOptions = {}) {
    this.endpoint = options.endpoint;
    this.functionAllowlist = options.functionAllowlist ?? REVIEWED_FUNCTION_ALLOWLIST;
    this.propertyAllowlist = options.propertyAllowlist ?? REVIEWED_PROPERTY_ALLOWLIST;
  }

  state(): ConnectorState {
    return { connected: false, wsConnected: false, info: null, subscriptions: [] };
  }

  connect(_timeoutMs?: number): Promise<{ ok: true; info: RemoteInfoResponse } | RcFailure> {
    return Promise.resolve({ ok: false, code: "not-implemented", message: "WP-5 RED stub: connect ships in the GREEN commit" });
  }

  remoteInfo(): Promise<{ ok: true; info: RemoteInfoResponse } | RcFailure> {
    return Promise.resolve({ ok: false, code: "not-implemented", message: "WP-5 RED stub: remoteInfo ships in the GREEN commit" });
  }

  connectWs(_timeoutMs?: number): Promise<{ ok: true } | RcFailure> {
    return Promise.resolve({ ok: false, code: "not-implemented", message: "WP-5 RED stub: connectWs ships in the GREEN commit" });
  }

  describe(
    _objectPath: string,
    _timeoutMs?: number,
  ): Promise<{ ok: true; described: { class: string; properties: { name: string; type: string }[]; outerPath: string } } | RcFailure> {
    return Promise.resolve({ ok: false, code: "not-implemented", message: "WP-5 RED stub: describe ships in the GREEN commit" });
  }

  readProperty(
    _objectPath: string,
    _propertyName: string,
    _timeoutMs?: number,
  ): Promise<{ ok: true; value: unknown } | RcFailure> {
    return Promise.resolve({ ok: false, code: "not-implemented", message: "WP-5 RED stub: readProperty ships in the GREEN commit" });
  }

  writeProperty(
    _objectPath: string,
    _propertyName: string,
    _value: unknown,
    _timeoutMs?: number,
  ): Promise<{ ok: true; transactionId: string | null } | RcFailure> {
    return Promise.resolve({ ok: false, code: "not-implemented", message: "WP-5 RED stub: writeProperty ships in the GREEN commit" });
  }

  callFunction(
    _objectPath: string,
    _functionName: string,
    _args: Record<string, unknown>,
    _timeoutMs?: number,
  ): Promise<{ ok: true; returnValue?: unknown; transactionId: string | null } | RcFailure> {
    return Promise.resolve({ ok: false, code: "not-implemented", message: "WP-5 RED stub: callFunction ships in the GREEN commit" });
  }

  subscribe(_eventName: string, _timeoutMs?: number): Promise<{ ok: true; eventName: string } | RcFailure> {
    return Promise.resolve({ ok: false, code: "not-implemented", message: "WP-5 RED stub: subscribe ships in the GREEN commit" });
  }

  unsubscribe(_eventName: string, _timeoutMs?: number): Promise<{ ok: true; eventName: string } | RcFailure> {
    return Promise.resolve({ ok: false, code: "not-implemented", message: "WP-5 RED stub: unsubscribe ships in the GREEN commit" });
  }

  onServerFrame(_listener: (frame: WsServerFrame) => void): void {
    // WP-5 RED stub: event delivery ships in the GREEN commit.
  }

  journal(): readonly JournalEntry[] {
    return [];
  }

  disconnect(_timeoutMs?: number): Promise<DisconnectReport> {
    return Promise.resolve({
      closed: false,
      wsClosed: false,
      inFlightAborted: 0,
      rolledBack: [],
      failures: [{ ok: false, code: "not-implemented", message: "WP-5 RED stub: disconnect ships in the GREEN commit" }],
    });
  }
}
