/**
 * Typed diagnostics produced by `validate` (see `validate.ts`).
 *
 * Codes are stable identifiers (`GAMEIR/E###` errors, `GAMEIR/W###`
 * warnings) so downstream tooling can filter on them without parsing
 * messages.
 *
 * Pure module.
 */

import type { NodeId } from "./nodes.js";
import type { GameIRDocument } from "./document.js";

/** Severity of a {@link Diagnostic}. */
export type DiagnosticSeverity = "error" | "warning";

/** Stable diagnostic code. */
export type DiagnosticCode = `GAMEIR/${string}`;

/** A single structural finding about a GameIR document. */
export type Diagnostic = {
  readonly severity: DiagnosticSeverity;
  readonly code: DiagnosticCode;
  readonly message: string;
  /** JSON-path-ish location, e.g. `nodes[3].state`. */
  readonly path: string;
  /** Node the finding is about, when attributable. */
  readonly nodeId?: NodeId;
};

/** Successful validation: the narrowed, structurally valid document. */
export type ValidationOk = {
  readonly ok: true;
  readonly document: GameIRDocument;
  /** Warnings found during validation (empty when none). Never errors. */
  readonly diagnostics: readonly Diagnostic[];
};

/** Failed validation: every diagnostic found, errors and warnings. */
export type ValidationFail = {
  readonly ok: false;
  readonly diagnostics: readonly Diagnostic[];
};

/** Result of {@link validate}. */
export type ValidationResult = ValidationOk | ValidationFail;

/** Constructs an error diagnostic. */
export function error(code: DiagnosticCode, message: string, path: string, nodeId?: NodeId): Diagnostic {
  return { severity: "error", code, message, path, ...(nodeId === undefined ? {} : { nodeId }) };
}

/** Constructs a warning diagnostic. */
export function warning(code: DiagnosticCode, message: string, path: string, nodeId?: NodeId): Diagnostic {
  return { severity: "warning", code, message, path, ...(nodeId === undefined ? {} : { nodeId }) };
}

/** Returns true when at least one diagnostic has error severity. */
export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}
