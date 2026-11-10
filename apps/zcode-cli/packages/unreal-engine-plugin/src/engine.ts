/**
 * The Unreal typed-operation layer (M4 WP-5) — RED STUB (the registration
 * surface, mirroring the godot engine.ts discipline).
 *
 * The shipped surface (implemented in GREEN): the five `unreal/*` capability
 * operations of the WP-4 records. Every op runs a COMPLETE connector
 * lifecycle — construct from config → connect (loopback-verified HTTP probe)
 * → the typed operation → disconnect (teardown contracts, journal restores,
 * failures surfaced) — exactly as every godot op runs a fresh engine process.
 * Inputs are validated against the frozen typed-operation schemas AND the
 * object-path grammar BEFORE any request is built; mutations are additionally
 * gated by the reviewed allowlists (every write property and every
 * functionName fails closed client-side at 0.1.0); property writes carry the
 * MANDATORY five-part chain (pre-mutation snapshot, typed operation, expected
 * post-state, verified rollback, post-rollback verification against the
 * snapshot — readiness §2.2 U-T3); teardown NEVER touches the externally
 * owned editor (U-T4).
 */

import type { RcEndpoint, ReviewedPropertyEntry } from "./typed-ops.js";
import type { ReviewedFunctionEntry } from "./function-allowlist.js";
import type { RemoteInfoResponse } from "./rc-protocol.js";
import type { DisconnectReport } from "./connector.js";

export interface EngineFailure {
  ok: false;
  code: string;
  message: string;
  details?: unknown;
}

/** Per-op timeout defaults mirroring the registered records' timeout fields. */
export const OP_TIMEOUTS = {
  connectionInspect: 10_000,
  objectInspect: 30_000,
  propertyRead: 30_000,
  propertyWrite: 60_000,
  functionInvoke: 60_000,
  rollback: 60_000,
  teardown: 30_000,
} as const;

export type OpName = keyof typeof OP_TIMEOUTS;

/** The plugin-level configuration every op consumes (MCP server / tests). */
export interface UnrealPluginConfig {
  /** Default endpoint (loopback-validated at construction); omitted ⇒ discovery defaults. */
  endpoint?: RcEndpoint;
  passphrase?: string;
  /** Reviewed allowlists; default = the shipped EMPTY registries (fail-closed). */
  functionAllowlist?: readonly ReviewedFunctionEntry[];
  propertyAllowlist?: readonly ReviewedPropertyEntry[];
  /** Per-op timeout overrides (bounded by the records' maxMs fields). */
  opTimeoutMs?: Partial<Record<OpName, number>>;
}

export interface ConnectionInspectSuccess {
  ok: true;
  editorVersion: string;
  remoteControlVersion: string;
  routes: string[];
  listenerBinding: RemoteInfoResponse["listenerBinding"];
  teardown: DisconnectReport;
}

export interface ObjectInspectSuccess {
  ok: true;
  objectPath: string;
  class: string;
  properties: { name: string; type: string }[];
  outerPath: string;
  teardown: DisconnectReport;
}

export interface PropertyReadSuccess {
  ok: true;
  objectPath: string;
  values: Record<string, unknown>;
  teardown: DisconnectReport;
}

export interface PropertyWriteSuccess {
  ok: true;
  objectPath: string;
  property: string;
  applied: boolean;
  preSnapshot: unknown;
  postState: unknown;
  transactionId: string | null;
  teardown: DisconnectReport;
}

export interface FunctionInvokeSuccess {
  ok: true;
  objectPath: string;
  functionName: string;
  returnValue?: unknown;
  transactionId: string | null;
  teardown: DisconnectReport;
}

export interface RollbackSuccess {
  ok: true;
  objectPath: string;
  property: string;
  restoredTo: unknown;
  postRollbackState: unknown;
  verifiedAgainstSnapshot: boolean;
  teardown: DisconnectReport;
}

const STUB = (what: string): EngineFailure => ({
  ok: false,
  code: "not-implemented",
  message: `WP-5 RED stub: ${what} ships in the GREEN commit`,
});

export async function connectionInspect(
  _config: UnrealPluginConfig,
  _input: unknown,
): Promise<ConnectionInspectSuccess | EngineFailure> {
  return STUB("connectionInspect");
}

export async function objectInspect(
  _config: UnrealPluginConfig,
  _input: unknown,
): Promise<ObjectInspectSuccess | EngineFailure> {
  return STUB("objectInspect");
}

export async function propertyRead(
  _config: UnrealPluginConfig,
  _input: unknown,
): Promise<PropertyReadSuccess | EngineFailure> {
  return STUB("propertyRead");
}

export async function propertyWrite(
  _config: UnrealPluginConfig,
  _input: unknown,
): Promise<PropertyWriteSuccess | EngineFailure> {
  return STUB("propertyWrite");
}

export async function functionInvoke(
  _config: UnrealPluginConfig,
  _input: unknown,
): Promise<FunctionInvokeSuccess | EngineFailure> {
  return STUB("functionInvoke");
}

export async function rollbackToSnapshot(
  _config: UnrealPluginConfig,
  _input: unknown,
): Promise<RollbackSuccess | EngineFailure> {
  return STUB("rollbackToSnapshot");
}
