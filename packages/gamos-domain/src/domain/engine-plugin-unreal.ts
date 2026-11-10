/**
 * The canonical M4 Unreal engine capability records (M4 WP-4, Worker B) —
 * contract 03 §2 registration data (`gamos/capability@2` records for the
 * `unreal` family), implemented VERBATIM from the field-level contract
 * docs/gamos/M4-CAPABILITY-CONTRACTS.md §3 (authored at
 * M4_ENGINE_PLUGIN_SOURCE_COMMIT; see engine-plugin-shared.ts).
 *
 * Extracted into its own module per the WP-1 max-lines precedent
 * (engine-plugin-godot.ts); engine-plugin.ts remains the REGISTRATION surface
 * (ENGINE_PLUGIN_CAPABILITIES spreads this array and the unreal-engine meta
 * lives there, so every declared id resolves through the same single registry
 * — contract 03 rule 1).
 *
 * All records: engineFamily "unreal", family-grammar compatibility ">=5.3",
 * mcpProvider("unreal-engine"). The connector ATTACHES to a RUNNING editor —
 * no executable is spawned by the plugin (readiness §4.2); cancellation stops
 * in-flight requests and closes the HTTP/WebSocket clients but NEVER
 * terminates the externally owned editor (readiness §2.2 U-T4). Honest
 * availability (conditional on the two real prerequisites — the sandbox has
 * no Unreal Editor, and no record fabricates availability), honest
 * reversibility (mutations recoverable until the real UE journey demonstrates
 * the five-part chain — shared contract rule 5), and verification specs that
 * name the engine-side re-read / inspected-listener proof — never an exit
 * code alone (rule 8).
 */

import type { CapabilityRecord } from "./capability-registry.js";
import {
  m4EnginePluginProvenance,
  mcpProvider,
  networkRcEndpointPermission,
  engineGuiPermission,
} from "./engine-plugin-shared.js";

/**
 * Unreal capabilities (M4 WP-4, Worker B) — the five records of the M4.3
 * capability registration, implemented VERBATIM from the field-level contract
 * docs/gamos/M4-CAPABILITY-CONTRACTS.md §3 (authored at
 * M4_ENGINE_PLUGIN_SOURCE_COMMIT). All records: engineFamily "unreal",
 * family-grammar compatibility ">=5.3", mcpProvider("unreal-engine"),
 * conditional availability on the two real prerequisites, and cancellation
 * that NEVER touches the editor itself.
 */
export const unrealCapabilities: readonly CapabilityRecord[] = [
  {
    id: "unreal/connection.inspect",
    version: "1.0.0",
    title: "Inspect Unreal Remote Control connection",
    description:
      "Typed, read-only probe of the discovered editor's Remote Control endpoint (GET /remote/info): editor version, Remote Control version, routes and the INSPECTED listener binding — the actual server-side binding, never the requested client address (a client connecting to 127.0.0.1 proves nothing about server binding — readiness §2.2 U-T1/U-T2).",
    engineFamily: "unreal",
    input: {
      type: "object",
      properties: {
        endpoint: {
          type: "string",
          description: "Optional loopback endpoint override; defaults to the discovered loopback Remote Control endpoint.",
        },
      },
    },
    output: {
      type: "object",
      properties: {
        editorVersion: { type: "string" },
        remoteControlVersion: { type: "string" },
        routes: { type: "array", items: { type: "string" } },
        listenerBinding: {
          type: "object",
          description: "The INSPECTED actual HTTP/WS listening addresses, ports and sockets — not the requested client address.",
        },
      },
      required: ["editorVersion", "remoteControlVersion", "routes", "listenerBinding"],
    },
    permissions: [networkRcEndpointPermission],
    availability: {
      state: "conditional",
      reason:
        "requires a discovered running Unreal Editor with Remote Control enabled on a VERIFIED loopback-only listener (HTTP 30010 / WS 30020) and the same-user OS trust boundary acknowledged",
      prerequisites: ["unreal-editor-discovered", "rc-listener-verified-loopback"],
    },
    provenance: m4EnginePluginProvenance("apps/zcode-cli/packages/unreal-engine-plugin", "WP-4"),
    provider: mcpProvider("unreal-engine"),
    prerequisites: [
      {
        id: "unreal-editor-discovered",
        description: "a running Unreal Editor (>=5.3) discovered via contract 04 machine-local discovery with an available Remote Control endpoint",
      },
      {
        id: "rc-listener-verified-loopback",
        description:
          "actual HTTP and WebSocket listening addresses, ports and sockets INSPECTED and confirmed loopback-only; LAN unreachability negative-tested (a client connecting to 127.0.0.1 proves nothing about server binding — readiness §2.2 U-T1)",
      },
    ],
    compatibility: {
      engineVersions: ">=5.3",
      runtime: "Unreal Editor 5.3+ with Remote Control plugin enabled (family grammar; ++UE5+Release-5.3 brand forms accepted)",
      notes: "connector attaches to a RUNNING editor — no executable is spawned by the plugin (readiness §4.2)",
    },
    reversibility: { kind: "reversible", notes: "read-only probe — no mutation" },
    idempotency: { repeatable: true },
    timeout: { defaultMs: 10000, maxMs: 30000 },
    cancellation: {
      supported: true,
      semantics: "in-flight requests and event subscriptions stopped, WebSocket and HTTP clients closed — NEVER the editor itself (readiness §2.2 U-T4)",
    },
    verification: {
      method: "output-schema",
      spec: "the response MUST come from the real RC `/remote/info` route of the discovered editor; the output carries the INSPECTED listener binding, not the requested client address",
    },
  },
  {
    id: "unreal/object.inspect",
    version: "1.0.0",
    title: "Inspect Unreal object (typed describe)",
    description:
      "Typed, read-only describe of a live-editor object through the running editor's Remote Control: the object path grammar is validated BEFORE any request is built, and the describe response (class, properties, outer path) comes from the real editor for the exact validated path.",
    engineFamily: "unreal",
    input: {
      type: "object",
      properties: {
        objectPath: {
          type: "string",
          description:
            "The validated Unreal object path (path grammar validated client-side BEFORE any request is built — invalid paths fail closed without a network round-trip).",
        },
      },
      required: ["objectPath"],
    },
    output: {
      type: "object",
      properties: {
        class: { type: "string" },
        properties: { type: "array", items: { type: "object" } },
        outerPath: { type: "string" },
      },
      required: ["class", "properties", "outerPath"],
    },
    permissions: [networkRcEndpointPermission],
    availability: {
      state: "conditional",
      reason:
        "requires a discovered running Unreal Editor with Remote Control enabled on a VERIFIED loopback-only listener (HTTP 30010 / WS 30020) and the same-user OS trust boundary acknowledged",
      prerequisites: ["unreal-editor-discovered", "rc-listener-verified-loopback"],
    },
    provenance: m4EnginePluginProvenance("apps/zcode-cli/packages/unreal-engine-plugin", "WP-4"),
    provider: mcpProvider("unreal-engine"),
    prerequisites: [
      {
        id: "unreal-editor-discovered",
        description: "a running Unreal Editor (>=5.3) discovered via contract 04 machine-local discovery with an available Remote Control endpoint",
      },
      {
        id: "rc-listener-verified-loopback",
        description:
          "actual HTTP and WebSocket listening addresses, ports and sockets INSPECTED and confirmed loopback-only; LAN unreachability negative-tested (a client connecting to 127.0.0.1 proves nothing about server binding — readiness §2.2 U-T1)",
      },
    ],
    compatibility: {
      engineVersions: ">=5.3",
      runtime: "Unreal Editor 5.3+ with Remote Control plugin enabled (family grammar; ++UE5+Release-5.3 brand forms accepted)",
      notes: "connector attaches to a RUNNING editor — no executable is spawned by the plugin (readiness §4.2)",
    },
    reversibility: { kind: "reversible", notes: "read-only — no mutation" },
    idempotency: { repeatable: true },
    timeout: { defaultMs: 30000, maxMs: 120000 },
    cancellation: {
      supported: true,
      semantics: "in-flight requests and event subscriptions stopped, WebSocket and HTTP clients closed — NEVER the editor itself (readiness §2.2 U-T4)",
    },
    verification: {
      method: "output-schema",
      spec: "describe response from the real editor for the exact validated object path; invalid paths fail closed client-side (G3 invalid-object-path challenge)",
    },
  },
  {
    id: "unreal/property.read",
    version: "1.0.0",
    title: "Read Unreal object properties (typed)",
    description:
      "Typed, read-only property read for an allowlisted set of property names on a validated object path through the running editor's Remote Control (getProperty with READ_ACCESS): the values come from the real editor, never from a cached mirror.",
    engineFamily: "unreal",
    input: {
      type: "object",
      properties: {
        objectPath: {
          type: "string",
          description: "The validated Unreal object path (grammar validated BEFORE any request is built).",
        },
        propertyNames: {
          type: "array",
          items: { type: "string" },
          description: "Allowlisted property names to read on the object.",
        },
      },
      required: ["objectPath", "propertyNames"],
    },
    output: {
      type: "object",
      properties: {
        values: {
          type: "object",
          description: "A map of the requested (allowlisted) property names to their live editor values.",
        },
      },
      required: ["values"],
    },
    permissions: [networkRcEndpointPermission],
    availability: {
      state: "conditional",
      reason:
        "requires a discovered running Unreal Editor with Remote Control enabled on a VERIFIED loopback-only listener (HTTP 30010 / WS 30020) and the same-user OS trust boundary acknowledged",
      prerequisites: ["unreal-editor-discovered", "rc-listener-verified-loopback"],
    },
    provenance: m4EnginePluginProvenance("apps/zcode-cli/packages/unreal-engine-plugin", "WP-4"),
    provider: mcpProvider("unreal-engine"),
    prerequisites: [
      {
        id: "unreal-editor-discovered",
        description: "a running Unreal Editor (>=5.3) discovered via contract 04 machine-local discovery with an available Remote Control endpoint",
      },
      {
        id: "rc-listener-verified-loopback",
        description:
          "actual HTTP and WebSocket listening addresses, ports and sockets INSPECTED and confirmed loopback-only; LAN unreachability negative-tested (a client connecting to 127.0.0.1 proves nothing about server binding — readiness §2.2 U-T1)",
      },
    ],
    compatibility: {
      engineVersions: ">=5.3",
      runtime: "Unreal Editor 5.3+ with Remote Control plugin enabled (family grammar; ++UE5+Release-5.3 brand forms accepted)",
      notes: "connector attaches to a RUNNING editor — no executable is spawned by the plugin (readiness §4.2)",
    },
    reversibility: { kind: "reversible", notes: "read-only — no mutation" },
    idempotency: { repeatable: true },
    timeout: { defaultMs: 30000, maxMs: 120000 },
    cancellation: {
      supported: true,
      semantics: "in-flight requests and event subscriptions stopped, WebSocket and HTTP clients closed — NEVER the editor itself (readiness §2.2 U-T4)",
    },
    verification: {
      method: "output-schema",
      spec: "getProperty (`READ_ACCESS`) responses from the real editor for validated paths/property names",
    },
  },
  {
    id: "unreal/property.write",
    version: "1.0.0",
    title: "Write Unreal object property (allowlisted live-editor mutation)",
    description:
      "Allowlisted live-editor property mutation through the running editor's Remote Control: a schema-validated typed write (setProperty with WRITE_TRANSACTION_ACCESS) with the expected pre/post states declared up front and the post-mutation state re-read from the editor. Mutation approval is REQUIRED for every write through the existing ZCode permission broker — no exceptions (handoff §6).",
    engineFamily: "unreal",
    input: {
      type: "object",
      properties: {
        objectPath: {
          type: "string",
          description: "The validated Unreal object path (grammar validated BEFORE any request is built).",
        },
        property: {
          type: "string",
          description: "The allowlisted property name to write.",
        },
        value: {
          description: "The schema-validated value to write (JSON-safe, validated against the property's registered schema).",
        },
        expectPreState: {
          description:
            "Optional expected pre-mutation state; when present it is compared against the pre-snapshot before the write is issued.",
        },
        expectPostState: {
          description: "The expected post-mutation state; the re-read post-state MUST match it for the write to be verified.",
        },
      },
      required: ["objectPath", "property", "value", "expectPostState"],
    },
    output: {
      type: "object",
      properties: {
        applied: { type: "boolean" },
        preSnapshot: {
          type: "object",
          description: "The pre-mutation snapshot (part one of the mandatory five-part chain).",
        },
        postState: {
          type: "object",
          description: "The re-read post-mutation state (verified against expectPostState).",
        },
        transactionId: {
          type: "string",
          description: "The editor transaction id when the write was issued with a transaction (Undo History support — NOT universal rollback).",
        },
      },
      required: ["applied", "preSnapshot", "postState"],
    },
    permissions: [networkRcEndpointPermission, engineGuiPermission],
    availability: {
      state: "conditional",
      reason:
        "requires a discovered running Unreal Editor with Remote Control enabled on a VERIFIED loopback-only listener (HTTP 30010 / WS 30020) and the same-user OS trust boundary acknowledged",
      prerequisites: ["unreal-editor-discovered", "rc-listener-verified-loopback"],
    },
    provenance: m4EnginePluginProvenance("apps/zcode-cli/packages/unreal-engine-plugin", "WP-4"),
    provider: mcpProvider("unreal-engine"),
    prerequisites: [
      {
        id: "unreal-editor-discovered",
        description: "a running Unreal Editor (>=5.3) discovered via contract 04 machine-local discovery with an available Remote Control endpoint",
      },
      {
        id: "rc-listener-verified-loopback",
        description:
          "actual HTTP and WebSocket listening addresses, ports and sockets INSPECTED and confirmed loopback-only; LAN unreachability negative-tested (a client connecting to 127.0.0.1 proves nothing about server binding — readiness §2.2 U-T1)",
      },
    ],
    compatibility: {
      engineVersions: ">=5.3",
      runtime: "Unreal Editor 5.3+ with Remote Control plugin enabled (family grammar; ++UE5+Release-5.3 brand forms accepted)",
      notes: "connector attaches to a RUNNING editor — no executable is spawned by the plugin (readiness §4.2)",
    },
    reversibility: {
      kind: "recoverable",
      notes:
        "setProperty with WRITE_TRANSACTION_ACCESS (editor Undo History support, NOT universal rollback); the five-part chain is MANDATORY: pre-mutation snapshot, typed operation, expected post-state, verified rollback (undo transaction or snapshot restore), post-rollback verification against the snapshot; upgrade to reversible ONLY after the real UE journey demonstrates the full chain — never on promise (readiness §2.2 U-T3)",
    },
    idempotency: { repeatable: true, dedupeKey: "endpoint+objectPath+property+value-hash" },
    timeout: { defaultMs: 60000, maxMs: 300000 },
    cancellation: {
      supported: true,
      semantics: "in-flight requests and event subscriptions stopped, WebSocket and HTTP clients closed — NEVER the editor itself (readiness §2.2 U-T4)",
    },
    verification: {
      method: "engine-query",
      spec: "post-mutation state re-read from the editor (`unreal/property.read`) and compared against expectPostState; rollback verified by re-read against the pre-snapshot",
    },
  },
  {
    id: "unreal/function.invoke",
    version: "1.0.0",
    title: "Invoke allowlisted Unreal Editor function (typed, per-function)",
    description:
      "Individually allowlisted typed invocation against the running editor's Remote Control (PUT /remote/object/call with generateTransaction: true): the functionName MUST be a member of the REVIEWED per-function allowlist — validated client-side BEFORE any request is built. Unrestricted remote Python execution, remote console-command execution and arbitrary function execution are DISABLED (readiness §4.2). The reviewed allowlist is EMPTY at 1.0.0: no function has passed review yet, so every functionName fails closed client-side until an entry lands with its own reviewed argument schema — each added function is a record version bump (the append-only encoding this line pins), and a GENERIC unrestricted function.call capability is FORBIDDEN by design.",
    engineFamily: "unreal",
    input: {
      type: "object",
      properties: {
        objectPath: {
          type: "string",
          description: "The validated Unreal object path (grammar validated BEFORE any request is built).",
        },
        functionName: {
          type: "string",
          description:
            "Member of the reviewed per-function allowlist — EMPTY at 1.0.0; every name fails closed client-side until a reviewed entry is added with its own argument schema.",
        },
        arguments: {
          type: "object",
          description:
            "Schema-validated against the named function's registered argument schema (no reviewed function exists at 1.0.0 — validation fails closed).",
        },
      },
      required: ["objectPath", "functionName", "arguments"],
    },
    output: {
      type: "object",
      properties: {
        returnValue: {
          description: "The function's return value when the reviewed function produces one.",
        },
        transactionId: {
          type: "string",
          description: "The editor transaction id when the invocation was issued with generateTransaction: true.",
        },
      },
    },
    permissions: [networkRcEndpointPermission, engineGuiPermission],
    availability: {
      state: "conditional",
      reason:
        "requires a discovered running Unreal Editor with Remote Control enabled on a VERIFIED loopback-only listener (HTTP 30010 / WS 30020) and the same-user OS trust boundary acknowledged",
      prerequisites: ["unreal-editor-discovered", "rc-listener-verified-loopback"],
    },
    provenance: m4EnginePluginProvenance("apps/zcode-cli/packages/unreal-engine-plugin", "WP-4"),
    provider: mcpProvider("unreal-engine"),
    prerequisites: [
      {
        id: "unreal-editor-discovered",
        description: "a running Unreal Editor (>=5.3) discovered via contract 04 machine-local discovery with an available Remote Control endpoint",
      },
      {
        id: "rc-listener-verified-loopback",
        description:
          "actual HTTP and WebSocket listening addresses, ports and sockets INSPECTED and confirmed loopback-only; LAN unreachability negative-tested (a client connecting to 127.0.0.1 proves nothing about server binding — readiness §2.2 U-T1)",
      },
    ],
    compatibility: {
      engineVersions: ">=5.3",
      runtime: "Unreal Editor 5.3+ with Remote Control plugin enabled (family grammar; ++UE5+Release-5.3 brand forms accepted)",
      notes: "connector attaches to a RUNNING editor — no executable is spawned by the plugin (readiness §4.2)",
    },
    reversibility: {
      kind: "recoverable",
      notes:
        "PUT /remote/object/call with generateTransaction: true (editor Undo History support, NOT universal rollback); the same five-part chain as property.write is MANDATORY: pre-mutation snapshot, typed invocation, expected post-state, verified rollback (undo transaction or snapshot restore), post-rollback verification against the snapshot; upgrade to reversible ONLY after the real UE journey demonstrates the full chain per reviewed function — never on promise (readiness §2.2 U-T3)",
    },
    idempotency: { repeatable: false },
    timeout: { defaultMs: 60000, maxMs: 300000 },
    cancellation: {
      supported: true,
      semantics: "in-flight requests and event subscriptions stopped, WebSocket and HTTP clients closed — NEVER the editor itself (readiness §2.2 U-T4)",
    },
    verification: {
      method: "engine-query",
      spec: "post-invocation state re-read; rollback verified against the pre-snapshot",
    },
  },
];
