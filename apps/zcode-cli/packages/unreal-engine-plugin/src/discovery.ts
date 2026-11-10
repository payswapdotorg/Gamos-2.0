/**
 * Unreal Remote Control endpoint discovery (M4 WP-5, GREEN).
 *
 * Probes the documented loopback Remote Control HTTP endpoint (GET
 * /remote/info on 127.0.0.1:30010 by default) with a bounded timeout and
 * returns HONEST availability (readiness Deliverable 3 row):
 *   available   — a running editor answered; the version parsed through the
 *                 unreal family grammar (numeric 5.3.x and ++UE5+Release-5.3
 *                 brand forms accepted); the server-reported listener
 *                 binding captured for the loopback verification;
 *   unavailable — exactly one recorded reason: rc-endpoint-absent |
 *                 rc-auth-required | rc-listener-not-loopback | version-unknown.
 * No executable is ever spawned: the connector ATTACHES to a running editor
 * (readiness §4.2); discovery probes the endpoint, nothing else. There is
 * exactly ONE probe attempt (never a retry storm, readiness §2.2 U-T2).
 */

import type { ListenerBinding } from "./rc-protocol.js";
import {
  DEFAULT_RC_HTTP_PORT,
  DEFAULT_RC_PASSPHRASE,
  DEFAULT_RC_WS_PORT,
  LOOPBACK_HOST,
  RC_ROUTES,
  RemoteInfoResponseSchema,
  listenerBindingIsLoopbackOnly,
} from "./rc-protocol.js";
import type { RcEndpoint } from "./typed-ops.js";

export type UnrealRcDiscovery =
  | {
      status: "available";
      endpoint: RcEndpoint;
      editorVersion: string;
      listenerBinding: ListenerBinding;
    }
  | {
      status: "unavailable";
      reason: "rc-endpoint-absent" | "rc-auth-required" | "rc-listener-not-loopback" | "version-unknown";
      detail: string;
    };

export interface DiscoveryOptions {
  endpoint?: RcEndpoint;
  /** Transport-compatibility token (U-T2: never authentication). */
  passphrase?: string;
  timeoutMs?: number;
}

export const DISCOVERY_TIMEOUT_MS = 5_000;

/**
 * Parses an Unreal Editor version through the family grammar: numeric
 * `5.3.2` forms and `++UE5+Release-5.3` brand forms are accepted; anything
 * else is unparseable (fail closed — never available-by-guess, the
 * parseGodotVersion discipline).
 */
export function parseUnrealEditorVersion(raw: string): { ok: true; version: string } | { ok: false; reason: string } {
  const trimmed = raw.trim();
  if (/^\d+\.\d+(\.\d+)?$/.test(trimmed)) return { ok: true, version: trimmed };
  const brand = /^\+\+UE\d+\+Release-(\d+\.\d+(?:\.\d+)?)/.exec(trimmed);
  if (brand && (brand[1] ?? "").length > 0) return { ok: true, version: brand[1] ?? "" };
  return { ok: false, reason: `unparseable Unreal editor version: ${raw}` };
}

/** One bounded, single-attempt probe of the loopback Remote Control endpoint. */
export async function discoverUnrealRcEndpoint(options: DiscoveryOptions = {}): Promise<UnrealRcDiscovery> {
  const endpoint: RcEndpoint =
    options.endpoint ?? { host: LOOPBACK_HOST, httpPort: DEFAULT_RC_HTTP_PORT, wsPort: DEFAULT_RC_WS_PORT };
  const timeoutMs = options.timeoutMs ?? DISCOVERY_TIMEOUT_MS;
  const passphrase = options.passphrase ?? DEFAULT_RC_PASSPHRASE;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://${endpoint.host}:${endpoint.httpPort}${RC_ROUTES.info}`, {
      method: "GET",
      headers: { Passphrase: passphrase },
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) {
      return { status: "unavailable", reason: "rc-auth-required", detail: `the endpoint refused the probe (HTTP ${res.status})` };
    }
    if (!res.ok) {
      return { status: "unavailable", reason: "rc-endpoint-absent", detail: `unexpected HTTP ${res.status} from the probe` };
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { status: "unavailable", reason: "version-unknown", detail: "the probe response was not JSON" };
    }
    const parsed = RemoteInfoResponseSchema.safeParse(body);
    if (!parsed.success) {
      return { status: "unavailable", reason: "version-unknown", detail: "the probe response did not match the pinned schema" };
    }
    const version = parseUnrealEditorVersion(parsed.data.editorVersion);
    if (!version.ok) {
      return { status: "unavailable", reason: "version-unknown", detail: version.reason };
    }
    if (!listenerBindingIsLoopbackOnly(parsed.data.listenerBinding)) {
      return { status: "unavailable", reason: "rc-listener-not-loopback", detail: "the server-reported listener binding is not loopback-only" };
    }
    return {
      status: "available",
      endpoint,
      editorVersion: version.version,
      listenerBinding: parsed.data.listenerBinding,
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : String(error);
    if (name === "AbortError" || name === "TimeoutError") {
      return { status: "unavailable", reason: "rc-endpoint-absent", detail: `the probe timed out after ${timeoutMs}ms (single attempt)` };
    }
    return { status: "unavailable", reason: "rc-endpoint-absent", detail: `no Remote Control endpoint answered: ${name}` };
  } finally {
    clearTimeout(timer);
  }
}
