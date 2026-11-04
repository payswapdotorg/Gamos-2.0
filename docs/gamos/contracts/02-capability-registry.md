# Gamos Phase-0 Contract 02 — Capability Registry

- Status: **FROZEN (Phase 0, revision 1)** — hash-protected governance control file
- Owner: Gamos TL
- Revision 1 (GAMOS-AUTH-0003): fail-closed selection (silent registry-order fallback
  REMOVED — architect re-review correction B) and the full execution-safety record
  (provider identity, prerequisites, compatibility, reversibility, idempotency,
  timeout, cancellation, verification).

## 1. Principle

A capability is a **named, versioned, engine-bindable action** the agent can perform
(e.g. `unity/scene.create`, `blender/mesh.export`, `babylon/scene.publish`). The registry
is a **data catalog consumed by the existing agent tool layer** (MCP tools, app plugins,
skills), not a new execution system.

## 2. Registry record (schema `gamos/capability@2`)

```ts
interface CapabilityRecord {
  id: string;                    // "<engine>/<verb>" or "core/<verb>"
  version: string;               // semver of the capability contract
  title: string;
  description: string;
  engineFamily?: "unity" | "blender" | "babylon" | "godot" | "unreal" | "core";
  input: JsonSchema;             // validated before dispatch
  output: JsonSchema;            // validated after execution
  permissions: PermissionSpec[]; // see contract 06
  availability: AvailabilitySpec;// see contract 07 (local/remote/unavailable)
  provenance: ProvenanceRef;     // see contract 09

  // Execution-safety record (revision 1 — all fields REQUIRED):
  provider: {                    // provider identity — who executes this capability
    kind: "engine-binary" | "mcp-server" | "app-plugin" | "agent-tool" | "remote-service";
    identity: string;            // e.g. "blender>=4.1 (discovered executable)" or
                                 //        plugin/mcp server id from provenance
    discoveredVia?: string;      // discovery probe id (contract 04) when engine-binary
  };
  prerequisites: Array<{         // what must hold BEFORE dispatch is attempted
    id: string;                  // e.g. "engine-installed", "display-server", "network"
    description: string;
  }>;
  compatibility: {               // declared compatibility envelope
    engineVersions?: string;     // engine-family version predicate (engine-specific
                                 // grammar per contract 04 revision 1 — NOT universal SemVer)
    runtime?: string;            // host runtime constraints if any
    notes?: string;
  };
  reversibility: {
    kind: "reversible" | "recoverable" | "irreversible";
    notes: string;               // e.g. "scene-entity create: reversible via delete"
  };
  idempotency: {
    repeatable: boolean;         // may the capability be safely re-dispatched?
    dedupeKey?: string;          // input-derived key when repeatable=false
  };
  timeout: {
    defaultMs: number;
    maxMs: number;
  };
  cancellation: {
    supported: boolean;
    semantics: string;           // e.g. "SIGTERM to engine subprocess; partial state
                                 //  is journaled and resumable (contract 05)"
  };
  verification: {                // how success is PROVEN — never assumed
    method: "output-schema" | "artifact-hash" | "filesystem-probe" | "engine-query";
    spec: string;                // JSON path, artifact contract ref (08), or probe id
  };
  artifacts?: ArtifactSpec[];    // see contract 08
}
```

MUST rules:
1. Registry content lives in `packages/gamos-domain` as data (JSON + zod schemas,
   following the repo's zod conventions) and is surfaced to the agent as tool metadata —
   through the **existing MCP/plugin tool registration path** (`mcp__*` namespace verified
   in evidence/phase-b rollouts).
2. Unknown `id` or `version` mismatch MUST fail closed (explicit error).
3. Input/output validation failures MUST surface as tool errors in the conversation,
   never silently dropped.
4. Capability IDs are frozen once published (append-only; breaking change = new version).
5. A record with an incomplete execution-safety block MUST be rejected at registration
   (schema validation is part of publishing, fail closed).
6. Dispatch MUST enforce the declared `timeout` (default; capped at `maxMs`) and honor
   `cancellation` semantics via the existing agent tool-cancellation path (`TaskStop`
   observed in phase-b rollouts).

## 3. Discovery & selection — fail closed (revision 1)

- The registry is read-only for workers; publishing a capability = additive PR reviewed
  by the TL (CODEOWNERS `*` default).
- **There is NO silent registry-order fallback.** The prior revision's
  "invalid preference falls back to registry order, never hard-fails the session"
  behavior is REMOVED. Capability selection during a game task resolves as follows:

  1. Requested capability → validated against the registry view (id + version +
     compatibility + availability).
  2. **Unknown, incompatible or unavailable capability → the step FAILS CLOSED**
     with an explicit, user-facing error carrying: the requested id/version, the
     reason (unknown | version-mismatch | incompatible-with-engine-version |
     unavailable-with-reason per contract 07), and the discovered remediation
     (available alternatives listed as data, never auto-selected).
  3. **Substitutions require explicit disclosure and approval.** A meaningful
     substitution (different capability id, different engine binding, or different
     provider than requested) MUST be surfaced to the user in the conversation with
     the difference disclosed, and MUST proceed only after an explicit approval
     through the existing permission/approval flow (contract 06). The approval
     record names both the requested and the substituted capability.
  4. Only trivially-equivalent resolution (same capability id, version range
     satisfiable by the installed engine) resolves silently.

## 4. Non-goals

No second tool bus: capabilities dispatch through MCP/plugin tool calls the agent already
makes; no new RPC channels; no UI changes to the composer (capabilities appear as context
mentions `/`-commands already supported).
