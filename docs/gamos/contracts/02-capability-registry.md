# Gamos Phase-0 Contract 02 — Capability Registry

- Status: **FROZEN (Phase 0)** — hash-protected governance control file
- Owner: Gamos TL

## 1. Principle

A capability is a **named, versioned, engine-bindable action** the agent can perform
(e.g. `unity/scene.create`, `blender/mesh.export`, `babylon/scene.publish`). The registry
is a **data catalog consumed by the existing agent tool layer** (MCP tools, app plugins,
skills), not a new execution system.

## 2. Registry record (schema `gamos/capability@1`)

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

## 3. Discovery & selection

- The registry is read-only for workers; publishing a capability = additive PR reviewed
  by the TL (CODEOWNERS `*` default).
- Capability selection during a game task uses the **existing model-selection-style
  resolution**: requested → validate against registry view → bind (mirrors
  `resolveInitialModelSelection` semantics: invalid preference falls back to registry
  order, never hard-fails the session).

## 4. Non-goals

No second tool bus: capabilities dispatch through MCP/plugin tool calls the agent already
makes; no new RPC channels; no UI changes to the composer (capabilities appear as context
mentions `/`-commands already supported).
