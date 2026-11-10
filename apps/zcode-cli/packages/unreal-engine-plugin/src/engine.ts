/**
 * The Unreal typed-operation layer (M4 WP-5, GREEN) — the registration
 * surface, mirroring the godot engine.ts discipline. Every op runs a COMPLETE
 * connector lifecycle (construct → connect → the typed operation →
 * disconnect) exactly as every godot op runs a fresh engine process; the
 * teardown report is carried on every success and its failures are never
 * swallowed.
 *
 * Inputs are validated against the frozen typed-operation schemas AND the
 * object-path grammar BEFORE any request is built; mutations are additionally
 * gated by the reviewed allowlists (every write property and every
 * functionName fails closed client-side at 0.1.0 — the shipped registries are
 * EMPTY; contract-tested through injected REVIEW-CLASS entries only).
 * property.write carries the MANDATORY five-part chain (readiness §2.2
 * U-T3): (1) pre-mutation snapshot, (2) the typed operation, (3) the expected
 * post-state verified by engine re-read, (4) verified rollback, (5)
 * post-rollback verification against the snapshot.
 */

import { UnrealRcConnector, type DisconnectReport } from "./connector.js";
import { findReviewedFunction, type ReviewedFunctionEntry } from "./function-allowlist.js";
import { parseUnrealObjectPath } from "./object-paths.js";
import type { RcFailure, RemoteInfoResponse } from "./rc-protocol.js";
import {
  ConnectionInspectInput,
  FunctionInvokeInput,
  ObjectInspectInput,
  PropertyReadInput,
  PropertyWriteInput,
  RollbackToSnapshotInput,
  findReviewedProperty,
  type RcEndpoint,
  type ReviewedPropertyEntry,
} from "./typed-ops.js";
import type { ZodError } from "zod";

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

// ----------------------------------------------------------------- helpers

function invalidInput(error: ZodError): EngineFailure {
  return {
    ok: false,
    code: "invalid-input",
    message: "input failed the frozen typed-operation schema",
    details: { issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) },
  };
}

function objectPathFailure(reason: string): EngineFailure {
  return { ok: false, code: "object-path-invalid", message: `object path rejected by the strict grammar: ${reason}` };
}

function fromRc(failure: RcFailure): EngineFailure {
  return { ok: false, code: failure.code, message: failure.message, details: (failure as { details?: unknown }).details };
}

/** JSON-value deep equality (the wire payloads are JSON-safe by construction). */
function jsonDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => jsonDeepEqual(item, b[index]));
  }
  const aKeys = Object.keys(a as Record<string, unknown>).sort();
  const bKeys = Object.keys(b as Record<string, unknown>).sort();
  if (aKeys.length !== bKeys.length || aKeys.some((key, index) => key !== bKeys[index])) return false;
  return aKeys.every((key) =>
    jsonDeepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

/**
 * Runs one complete connector lifecycle: construct from the resolved config →
 * connect (loopback-verified attach) → the operation → disconnect (teardown
 * contracts; the report is returned so callers surface it honestly).
 */
async function withLifecycle<TSuccess extends { ok: true }>(
  config: UnrealPluginConfig,
  endpointOverride: RcEndpoint | undefined,
  work: (connector: UnrealRcConnector) => Promise<TSuccess | EngineFailure>,
): Promise<{ outcome: TSuccess | EngineFailure; teardown: DisconnectReport | null }> {
  const connector = new UnrealRcConnector({
    endpoint: endpointOverride ?? config.endpoint,
    passphrase: config.passphrase,
    functionAllowlist: config.functionAllowlist,
    propertyAllowlist: config.propertyAllowlist,
  });
  const attachTimeout = config.opTimeoutMs?.connectionInspect ?? OP_TIMEOUTS.connectionInspect;
  const attached = await connector.connect(attachTimeout);
  if (!attached.ok) {
    return { outcome: fromRc(attached), teardown: null };
  }
  let outcome: TSuccess | EngineFailure;
  outcome = await work(connector);
  const teardown = await connector.disconnect(config.opTimeoutMs?.teardown ?? OP_TIMEOUTS.teardown);
  return { outcome, teardown };
}

const EMPTY_TEARDOWN: DisconnectReport = { closed: true, wsClosed: true, inFlightAborted: 0, rolledBack: [], failures: [] };

// ---------------------------------------------- unreal/connection.inspect

export async function connectionInspect(
  config: UnrealPluginConfig,
  input: unknown,
): Promise<ConnectionInspectSuccess | EngineFailure> {
  const parsed = ConnectionInspectInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { outcome, teardown } = await withLifecycle<
    Omit<ConnectionInspectSuccess, "teardown">
  >(config, parsed.data.endpoint, async (connector) => {
    const info = await connector.remoteInfo();
    if (!info.ok) return fromRc(info);
    return {
      ok: true as const,
      editorVersion: info.info.editorVersion,
      remoteControlVersion: info.info.remoteControlVersion,
      routes: info.info.routes,
      listenerBinding: info.info.listenerBinding,
    };
  });
  if (!outcome.ok) return outcome;
  return { ...outcome, teardown: teardown ?? EMPTY_TEARDOWN };
}

// ------------------------------------------------ unreal/object.inspect

export async function objectInspect(
  config: UnrealPluginConfig,
  input: unknown,
): Promise<ObjectInspectSuccess | EngineFailure> {
  const parsed = ObjectInspectInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const grammar = parseUnrealObjectPath(parsed.data.objectPath);
  if (!grammar.ok) return objectPathFailure(grammar.reason);
  const timeoutMs = config.opTimeoutMs?.objectInspect ?? OP_TIMEOUTS.objectInspect;
  const { outcome, teardown } = await withLifecycle<Omit<ObjectInspectSuccess, "teardown">>(config, undefined, async (connector) => {
    const described = await connector.describe(parsed.data.objectPath, timeoutMs);
    if (!described.ok) return fromRc(described);
    return {
      ok: true as const,
      objectPath: parsed.data.objectPath,
      class: described.described.class,
      properties: described.described.properties,
      outerPath: described.described.outerPath,
    };
  });
  if (!outcome.ok) return outcome;
  return { ...outcome, teardown: teardown ?? EMPTY_TEARDOWN };
}

// ------------------------------------------------- unreal/property.read

export async function propertyRead(
  config: UnrealPluginConfig,
  input: unknown,
): Promise<PropertyReadSuccess | EngineFailure> {
  const parsed = PropertyReadInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const grammar = parseUnrealObjectPath(parsed.data.objectPath);
  if (!grammar.ok) return objectPathFailure(grammar.reason);
  const timeoutMs = config.opTimeoutMs?.propertyRead ?? OP_TIMEOUTS.propertyRead;
  const { outcome, teardown } = await withLifecycle<Omit<PropertyReadSuccess, "teardown">>(config, undefined, async (connector) => {
    const values: Record<string, unknown> = {};
    for (const propertyName of parsed.data.propertyNames) {
      const read = await connector.readProperty(parsed.data.objectPath, propertyName, timeoutMs);
      if (!read.ok) return fromRc(read);
      values[propertyName] = read.value;
    }
    return { ok: true as const, objectPath: parsed.data.objectPath, values };
  });
  if (!outcome.ok) return outcome;
  return { ...outcome, teardown: teardown ?? EMPTY_TEARDOWN };
}

// ------------------------------------------------ unreal/property.write

export async function propertyWrite(
  config: UnrealPluginConfig,
  input: unknown,
): Promise<PropertyWriteSuccess | EngineFailure> {
  const parsed = PropertyWriteInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const grammar = parseUnrealObjectPath(parsed.data.objectPath);
  if (!grammar.ok) return objectPathFailure(grammar.reason);

  // The reviewed mutation allowlist — refused BEFORE any request is built
  // (the shipped registry is EMPTY at 0.1.0; every write fails closed).
  const allowlist = config.propertyAllowlist ?? [];
  const reviewed = findReviewedProperty(allowlist, parsed.data.property, parsed.data.objectPath);
  if (!reviewed) {
    return {
      ok: false,
      code: "property-not-allowlisted",
      message: `property ${JSON.stringify(parsed.data.property)} has no reviewed allowlist entry for this object path — refused client-side before any request (readiness §4.2 operation allowlist)`,
    };
  }
  const valueCheck = reviewed.valueSchema.safeParse(parsed.data.value);
  if (!valueCheck.success) {
    return {
      ok: false,
      code: "invalid-input",
      message: "the value failed the reviewed property's registered value schema (refused before any request)",
    };
  }

  const timeoutMs = config.opTimeoutMs?.propertyWrite ?? OP_TIMEOUTS.propertyWrite;
  const { outcome, teardown } = await withLifecycle<Omit<PropertyWriteSuccess, "teardown">>(config, undefined, async (connector) => {
    // (1) The pre-mutation snapshot — engine re-read, never a cached mirror.
    const pre = await connector.readProperty(parsed.data.objectPath, parsed.data.property, timeoutMs);
    if (!pre.ok) return fromRc(pre);

    // expectPreState comparison BEFORE the write request is built.
    if (parsed.data.expectPreState !== undefined && !jsonDeepEqual(pre.value, parsed.data.expectPreState)) {
      return {
        ok: false,
        code: "precondition-failed",
        message: "the live pre-mutation state does not match expectPreState — the write is refused before any request is built",
        details: { livePreState: pre.value, expectPreState: parsed.data.expectPreState },
      };
    }

    // (2) The typed operation — setProperty with WRITE_TRANSACTION_ACCESS
    //     and generateTransaction (editor Undo History support, NOT
    //     universal rollback). The connector journals the applied mutation.
    const written = await connector.writeProperty(
      parsed.data.objectPath,
      parsed.data.property,
      parsed.data.value,
      timeoutMs,
      pre.value,
    );
    if (!written.ok) return fromRc(written);

    // (3) The expected post-state, verified by engine re-read (never an
    //     exit code or an API ack alone).
    const post = await connector.readProperty(parsed.data.objectPath, parsed.data.property, timeoutMs);
    if (!post.ok) {
      // The chain is interrupted: the journal entry REMAINS so the op's own
      // teardown restores the pre-snapshot (the U-T4 discipline).
      return fromRc(post);
    }
    if (!jsonDeepEqual(post.value, parsed.data.expectPostState)) {
      // (4)+(5) The write was NOT taken (or was overridden): verified
      // rollback + post-rollback verification against the snapshot, then
      // fail closed.
      const restore = await connector.writeProperty(
        parsed.data.objectPath,
        parsed.data.property,
        pre.value,
        timeoutMs,
        post.value,
      );
      let rollbackRestored = false;
      if (restore.ok) {
        const verify = await connector.readProperty(parsed.data.objectPath, parsed.data.property, timeoutMs);
        rollbackRestored = verify.ok && jsonDeepEqual(verify.value, pre.value);
      }
      connector.settleJournal(parsed.data.objectPath, parsed.data.property);
      return {
        ok: false,
        code: "rc-transaction-failed",
        message:
          "the post-mutation re-read did not match expectPostState — the write is NOT verified; the rollback chain ran and the failure is reported honestly",
        details: {
          appliedTransactionId: written.transactionId,
          livePostState: post.value,
          expectPostState: parsed.data.expectPostState,
          rollbackRestored,
        },
      };
    }

    // The five-part chain's parts 1–3 completed and verified: the intended
    // write stands (the journal entry is settled — teardown never undoes a
    // verified, authorized mutation; rollback remains an explicit op).
    connector.settleJournal(parsed.data.objectPath, parsed.data.property);
    return {
      ok: true as const,
      objectPath: parsed.data.objectPath,
      property: parsed.data.property,
      applied: true,
      preSnapshot: pre.value,
      postState: post.value,
      transactionId: written.transactionId,
    };
  });
  if (!outcome.ok) return outcome;
  return { ...outcome, teardown: teardown ?? EMPTY_TEARDOWN };
}

// ---------------------------------------------- unreal/function.invoke

export async function functionInvoke(
  config: UnrealPluginConfig,
  input: unknown,
): Promise<FunctionInvokeSuccess | EngineFailure> {
  const parsed = FunctionInvokeInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const grammar = parseUnrealObjectPath(parsed.data.objectPath);
  if (!grammar.ok) return objectPathFailure(grammar.reason);

  // The reviewed per-function allowlist — the WP-4 record's verbatim
  // discipline: EMPTY at 1.0.0, every functionName fails closed client-side
  // BEFORE any request is built (a GENERIC call is FORBIDDEN by design).
  const allowlist = config.functionAllowlist ?? [];
  const reviewed = findReviewedFunction(allowlist, parsed.data.functionName, parsed.data.objectPath);
  if (!reviewed) {
    return {
      ok: false,
      code: "function-not-allowlisted",
      message: `functionName ${JSON.stringify(parsed.data.functionName)} has no reviewed per-function allowlist entry for this object path — refused client-side before any request (the reviewed allowlist is EMPTY at 1.0.0; a generic function.call is FORBIDDEN by design, readiness §4.2)`,
    };
  }
  const argsCheck = reviewed.argumentSchema.safeParse(parsed.data.arguments);
  if (!argsCheck.success) {
    return {
      ok: false,
      code: "invalid-input",
      message: "the arguments failed the reviewed function's registered argument schema (refused before any request)",
    };
  }

  const timeoutMs = config.opTimeoutMs?.functionInvoke ?? OP_TIMEOUTS.functionInvoke;
  const { outcome, teardown } = await withLifecycle<Omit<FunctionInvokeSuccess, "teardown">>(config, undefined, async (connector) => {
    const called = await connector.callFunction(parsed.data.objectPath, parsed.data.functionName, parsed.data.arguments, timeoutMs);
    if (!called.ok) return fromRc(called);
    return {
      ok: true as const,
      objectPath: parsed.data.objectPath,
      functionName: parsed.data.functionName,
      returnValue: called.returnValue,
      transactionId: called.transactionId,
    };
  });
  if (!outcome.ok) return outcome;
  return { ...outcome, teardown: teardown ?? EMPTY_TEARDOWN };
}

// ------------------------------------------- rollback (the chain's 4–5)

export async function rollbackToSnapshot(
  config: UnrealPluginConfig,
  input: unknown,
): Promise<RollbackSuccess | EngineFailure> {
  const parsed = RollbackToSnapshotInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const grammar = parseUnrealObjectPath(parsed.data.objectPath);
  if (!grammar.ok) return objectPathFailure(grammar.reason);

  // Rollbacks are restores of previously AUTHORIZED writes — the same
  // reviewed property allowlist governs them.
  const allowlist = config.propertyAllowlist ?? [];
  const reviewed = findReviewedProperty(allowlist, parsed.data.property, parsed.data.objectPath);
  if (!reviewed) {
    return {
      ok: false,
      code: "property-not-allowlisted",
      message: `property ${JSON.stringify(parsed.data.property)} has no reviewed allowlist entry — the rollback is refused client-side before any request`,
    };
  }

  const timeoutMs = config.opTimeoutMs?.rollback ?? OP_TIMEOUTS.rollback;
  const { outcome, teardown } = await withLifecycle<Omit<RollbackSuccess, "teardown">>(config, undefined, async (connector) => {
    // (4) The verified rollback: restore the snapshot value.
    const restore = await connector.writeProperty(
      parsed.data.objectPath,
      parsed.data.property,
      parsed.data.preSnapshot,
      timeoutMs,
    );
    if (!restore.ok) return fromRc(restore);
    // (5) Post-rollback verification against the SNAPSHOT (never an API ack).
    const verify = await connector.readProperty(parsed.data.objectPath, parsed.data.property, timeoutMs);
    if (!verify.ok) return fromRc(verify);
    const verified = jsonDeepEqual(verify.value, parsed.data.preSnapshot);
    connector.settleJournal(parsed.data.objectPath, parsed.data.property);
    return {
      ok: true as const,
      objectPath: parsed.data.objectPath,
      property: parsed.data.property,
      restoredTo: parsed.data.preSnapshot,
      postRollbackState: verify.value,
      verifiedAgainstSnapshot: verified,
    };
  });
  if (!outcome.ok) return outcome;
  return { ...outcome, teardown: teardown ?? EMPTY_TEARDOWN };
}
