/**
 * The pinned Unreal Remote Control wire contract (M4 WP-5) — the documented
 * surface the connector speaks and the mock RC server (test/mock-rc-server.ts,
 * the EDITOR STAND-IN) implements. Readiness §2.2 U-T7: route discovery via
 * `GET /remote/info` (the response lists the actual routes and the server's
 * OWN reported listener binding); the contract tests pin this schema, and any
 * unknown route shape or schema mismatch fails closed (`rc-route-unknown` /
 * `rc-schema-mismatch`) — never a silent parse.
 *
 * Documented facts this module pins (verified via the unreal-rc@0.6.0 README
 * during M4 readiness — Epic's own docs were unreachable):
 *   - the Remote Control web server listens on loopback HTTP 30010 and
 *     WebSocket 30020 by default;
 *   - every request may carry the `Passphrase` header — a TRANSPORT-COMPATIBILITY
 *     token only (some versions require it for some routes even when other
 *     routes work without it); it is NEVER claimed as server-side
 *     authentication (readiness §2.2 U-T2 — the chosen model is the same-user
 *     OS trust boundary plus per-mutation Gamos permission-broker approval);
 *   - property mutation uses access mode `WRITE_TRANSACTION_ACCESS`
 *     (editor Undo History support — NOT universal rollback);
 *   - function invocation uses `generateTransaction: true`;
 *   - the operation surface is call / get / set / describe / searchAssets /
 *     info / event / batch.
 *
 * Real-editor conformance is WP-6's acceptance leg on the maintainer-provided
 * UE5 environment (delivery plan §10): a mock can never pass M4-G2, and this
 * module's pinned shapes fail closed on any drift (`rc-schema-mismatch`).
 */

import { z } from "zod";

/** The documented default loopback Remote Control ports (client-side defaults). */
export const DEFAULT_RC_HTTP_PORT = 30010;
export const DEFAULT_RC_WS_PORT = 30020;

/**
 * The only hosts the connector will ever dial: literal loopback addresses.
 * `localhost` is deliberately NOT accepted — a resolvable name proves nothing
 * about the address it resolves to (readiness §2.2 U-T1: fail closed).
 */
export const LOOPBACK_HOST = "127.0.0.1";
export const LOOPBACK_HOST_V6 = "::1";

/** True only for literal loopback addresses (never hostnames). */
export function isLoopbackLiteralAddress(host: string): boolean {
  return host === LOOPBACK_HOST || host === LOOPBACK_HOST_V6;
}

/**
 * The shipped public transport-compatibility token sent as the `Passphrase`
 * header (route compatibility only — U-T2: never a secret, never claimed as
 * server-side authentication; configurable via the plugin's userConfig
 * `rcPassphrase`).
 */
export const DEFAULT_RC_PASSPHRASE = "no_key";

/** The Remote Control routes this connector speaks (U-T7 route discovery). */
export const RC_ROUTES = {
  info: "/remote/info",
  describe: "/remote/object/describe",
  property: "/remote/property",
  call: "/remote/object/call",
} as const;

/** Documented property access modes (readiness §2.2 U-T3, VERBATIM facts). */
export const PROPERTY_ACCESS_MODE = {
  read: "READ_ACCESS",
  writeTransaction: "WRITE_TRANSACTION_ACCESS",
} as const;

/** The structured RC-layer failure taxonomy (readiness §4.2, VERBATIM). */
export type RcFailureCode =
  | "rc-unreachable"
  | "rc-auth-required"
  | "rc-listener-not-loopback"
  | "rc-route-unknown"
  | "rc-schema-mismatch"
  | "rc-timeout"
  | "rc-transaction-failed";

export interface RcFailure {
  ok: false;
  code: RcFailureCode | string;
  message: string;
  details?: unknown;
}

// ---------------------------------------------------------------------------
// Pinned response schemas (the contract tests pin these — U-T7)
// ---------------------------------------------------------------------------

export const ListenerBindingSchema = z.object({
  httpBindAddress: z.string().min(1),
  httpPort: z.number().int().min(1).max(65535),
  wsBindAddress: z.string().min(1),
  wsPort: z.number().int().min(1).max(65535),
});
export type ListenerBinding = z.infer<typeof ListenerBindingSchema>;

export const RemoteInfoResponseSchema = z.object({
  editorVersion: z.string().min(1),
  remoteControlVersion: z.string().min(1),
  routes: z.array(z.string().min(1)),
  listenerBinding: ListenerBindingSchema,
});
export type RemoteInfoResponse = z.infer<typeof RemoteInfoResponseSchema>;

export const DescribePropertySchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
});
export const DescribeResponseSchema = z.object({
  class: z.string().min(1),
  properties: z.array(DescribePropertySchema),
  outerPath: z.string().min(1),
});
export type DescribeResponse = z.infer<typeof DescribeResponseSchema>;

export const PropertyReadResponseSchema = z.object({
  value: z.unknown(),
});
export type PropertyReadResponse = z.infer<typeof PropertyReadResponseSchema>;

export const PropertyWriteResponseSchema = z.object({
  transactionId: z.string().min(1).nullable(),
});
export type PropertyWriteResponse = z.infer<typeof PropertyWriteResponseSchema>;

export const CallResponseSchema = z.object({
  returnValue: z.unknown().optional(),
  transactionId: z.string().min(1).nullable().optional(),
});
export type CallResponse = z.infer<typeof CallResponseSchema>;

// ---------------------------------------------------------------------------
// WebSocket event frames (lifecycle contracts only — U-T4/U-T6)
// ---------------------------------------------------------------------------

/** Client → server frames. */
export const WsClientFrameSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("subscribe"), eventName: z.string().min(1).max(128) }),
  z.object({ type: z.literal("unsubscribe"), eventName: z.string().min(1).max(128) }),
]);
export type WsClientFrame = z.infer<typeof WsClientFrameSchema>;

/** Server → client frames. */
export const WsServerFrameSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("subscribed"), eventName: z.string().min(1).max(128) }),
  z.object({ type: z.literal("unsubscribed"), eventName: z.string().min(1).max(128) }),
  z.object({ type: z.literal("event"), eventName: z.string().min(1).max(128), payload: z.unknown() }),
]);
export type WsServerFrame = z.infer<typeof WsServerFrameSchema>;

/**
 * Loopback-only verification of a server-REPORTED listener binding (U-T1):
 * the binding in the `/remote/info` response is the server's own report of
 * what it actually bound — NOT the client's requested address. Any non-
 * loopback bind address on either listener ⇒ fail closed
 * (`rc-listener-not-loopback`).
 */
export function listenerBindingIsLoopbackOnly(binding: ListenerBinding): boolean {
  return isLoopbackLiteralAddress(binding.httpBindAddress) && isLoopbackLiteralAddress(binding.wsBindAddress);
}
