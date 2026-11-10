/**
 * Unreal Remote Control endpoint discovery (M4 WP-5) — RED STUB.
 *
 * The shipped surface (implemented in GREEN): probe the documented loopback
 * Remote Control HTTP endpoint (GET /remote/info on 127.0.0.1:30010) with a
 * bounded timeout and return HONEST availability —
 *   available   (a running editor answered; the version parsed through the
 *                unreal family grammar `>=5.3`, brand forms
 *                `++UE5+Release-5.3…` accepted; the server-reported listener
 *                binding captured for the loopback verification),
 *   unavailable with exactly one of the recorded reasons
 *                (rc-endpoint-absent | rc-auth-required |
 *                rc-listener-not-loopback | version-unknown — readiness
 *                Deliverable 3 row).
 * No executable is ever spawned: the connector ATTACHES to a running editor
 * (readiness §4.2); discovery probes the endpoint, nothing else.
 */

import type { ListenerBinding } from "./rc-protocol.js";
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
 * else is `version-unknown` (fail closed — never available-by-guess, the
 * parseGodotVersion discipline).
 */
export function parseUnrealEditorVersion(raw: string): { ok: true; version: string } | { ok: false; reason: string } {
  const trimmed = raw.trim();
  if (/^\d+\.\d+(\.\d+)?$/.test(trimmed)) return { ok: true, version: trimmed };
  const brand = /^\+\+UE\d+\+Release-(\d+\.\d+(?:\.\d+)?)/.exec(trimmed);
  if (brand) return { ok: true, version: brand[1] ?? "" };
  return { ok: false, reason: `unparseable Unreal editor version: ${raw}` };
}

/**
 * RED stub — the real probe ships in the WP-5 GREEN commit. Every caller
 * fails with this marker until then (the binding tests pin the behavior).
 */
export function discoverUnrealRcEndpoint(_options: DiscoveryOptions = {}): Promise<UnrealRcDiscovery> {
  return Promise.reject(new Error("WP-5 RED stub: discoverUnrealRcEndpoint ships in the GREEN commit"));
}
