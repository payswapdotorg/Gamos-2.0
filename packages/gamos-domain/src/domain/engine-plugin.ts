/**
 * Engine-plugin capability metadata — contract 03 §2 (`gamos/engine-plugin@2`)
 * and the canonical M2.4 capability records for the Unity, Blender and
 * Babylon engine plugins (directive M2 §3/§5, Worker B + TL).
 *
 * The metadata module is pure data + validation (the domain package stays
 * pure): it validates the frozen EnginePluginMeta shape, enforces the
 * family-grammar version predicates (contract 04 §4 — never universal
 * SemVer), and fail-closes when a plugin declares a capability id that does
 * not resolve to a complete `gamos/capability@2` record (contract 03 rule 1).
 *
 * The capability records below are APPEND-ONLY data: once published, an id
 * never changes meaning; breaking semantics require a new version
 * (directive M2 §5 M2.4).
 */

import type { EngineFamily } from "./game-concept.js";
import type { CapabilityRecord, JsonSchemaSpec, PermissionSpec, AvailabilitySpec } from "./capability-registry.js";
import { registerCapability } from "./capability-registry.js";
import { evaluateVersionPredicate, parseUnityVersion, parseBlenderVersion, parseBabylonToolchainVersion, parseGodotVersion, parseUnrealVersion } from "./discovery/engine-versions.js";
import type { ProvenanceRef } from "./provenance.js";
import { validateProvenanceRef, PROVENANCE_SCHEMA_ID } from "./provenance.js";

/** Contract 03 §2 — the engine plugin manifest extension. */
export interface EnginePluginExecutable {
  readonly kind: "cli" | "batch" | "server";
  readonly command: string;
  readonly args?: readonly string[];
}

export interface EnginePluginMeta {
  readonly pluginId: string;
  readonly engineFamily: EngineFamily;
  /** Engine-family version predicate in that family's grammar (contract 04 §4). */
  readonly engineVersions: string;
  /** How to reach a local engine/editor headlessly (resolved via contract 04 discovery). */
  readonly executable?: EnginePluginExecutable;
  /** Capability ids declared — every one must resolve to a complete registry record. */
  readonly capabilities: readonly string[];
  readonly headlessSupport: "full" | "partial" | "none";
  readonly requiresDisplayServer: boolean;
  /** Canonical provenance (contract 09 §4, `gamos/provenance@2`, with surfaces). */
  readonly provenance: ProvenanceRef;
}

export type EnginePluginMetaValidation =
  | { ok: true; meta: EnginePluginMeta }
  | { ok: false; field: string; reason: string };

const ENGINE_FAMILIES: readonly string[] = ["unity", "blender", "babylon", "godot", "unreal", "core"];
const HEADLESS_SUPPORT_VALUES: readonly string[] = ["full", "partial", "none"];
const CAPABILITY_ID_PATTERN = /^[a-z0-9-]+(\/[a-z0-9.-]+)+$/;

/** Fully-parsed sample versions per family, used to grammar-check predicates. */
const GRAMMAR_PROBES: Partial<Record<EngineFamily, { raw: string; ok: boolean; [key: string]: unknown }>> = {
  unity: parseUnityVersion("6000.0.23f1") as unknown as { raw: string; ok: boolean },
  blender: parseBlenderVersion("blender 4.1.1") as unknown as { raw: string; ok: boolean },
  babylon: parseBabylonToolchainVersion("24.14.0") as unknown as { raw: string; ok: boolean },
  godot: parseGodotVersion("4.2.1.stable.official.abc") as unknown as { raw: string; ok: boolean },
  unreal: parseUnrealVersion("5.3.2-1234567") as unknown as { raw: string; ok: boolean },
};

/** Validates that an engineVersions predicate is legal in the FAMILY grammar (contract 03 rule 2). */
export function validateEngineVersionsPredicate(family: EngineFamily, predicate: string): boolean {
  const probe = GRAMMAR_PROBES[family];
  if (!probe) return false;
  // A well-formed family predicate must evaluate deterministically against a
  // fully-parsed version — "unknown" means the predicate failed the family grammar.
  return evaluateVersionPredicate(family, predicate, probe as never) !== "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates an EnginePluginMeta (contract 03 §2). When `registry` is provided,
 * every declared capability id must resolve to a record in it; when omitted,
 * the validator fail-closes on declared ids (it must never silently accept
 * unresolvable declarations — contract 03 rule 1).
 */
export function validateEnginePluginMeta(
  input: unknown,
  registry?: ReadonlyMap<string, CapabilityRecord>,
): EnginePluginMetaValidation {
  if (!isRecord(input)) {
    return { ok: false, field: "enginePluginMeta", reason: "must be a non-null object (contract 03 §2, gamos/engine-plugin@2)" };
  }

  const pluginId = input.pluginId;
  if (typeof pluginId !== "string" || pluginId.length === 0) {
    return { ok: false, field: "enginePluginMeta.pluginId", reason: "must be a non-empty plugin id string" };
  }

  const engineFamily = input.engineFamily;
  if (typeof engineFamily !== "string" || !ENGINE_FAMILIES.includes(engineFamily) || engineFamily === "core") {
    return { ok: false, field: "enginePluginMeta.engineFamily", reason: `must be one of unity|blender|babylon|godot|unreal (contract 03 §2)` };
  }

  const engineVersions = input.engineVersions;
  if (typeof engineVersions !== "string" || engineVersions.length === 0) {
    return { ok: false, field: "enginePluginMeta.engineVersions", reason: "must be a non-empty engine-family version predicate (contract 04 §4 grammar)" };
  }
  if (!validateEngineVersionsPredicate(engineFamily as EngineFamily, engineVersions)) {
    return {
      ok: false,
      field: "enginePluginMeta.engineVersions",
      reason: `"${engineVersions}" is not a legal ${engineFamily} family-grammar predicate — engine compatibility must use the engine-family grammar, NOT universal SemVer (contract 03 rule 2 / contract 04 §4)`,
    };
  }

  const executable = input.executable;
  if (executable !== undefined) {
    if (!isRecord(executable)) {
      return { ok: false, field: "enginePluginMeta.executable", reason: "must be an object when present (contract 03 §2)" };
    }
    if (executable.kind !== "cli" && executable.kind !== "batch" && executable.kind !== "server") {
      return { ok: false, field: "enginePluginMeta.executable.kind", reason: 'must be "cli" | "batch" | "server"' };
    }
    if (typeof executable.command !== "string" || executable.command.length === 0) {
      return { ok: false, field: "enginePluginMeta.executable.command", reason: "must be a non-empty command (resolved via contract 04 machine-local discovery)" };
    }
    if (executable.args !== undefined) {
      if (!Array.isArray(executable.args) || !executable.args.every((a) => typeof a === "string")) {
        return { ok: false, field: "enginePluginMeta.executable.args", reason: "must be an array of strings when present" };
      }
    }
  }

  const capabilities = input.capabilities;
  if (!Array.isArray(capabilities) || capabilities.length === 0) {
    return { ok: false, field: "enginePluginMeta.capabilities", reason: "must be a non-empty array of declared capability ids (contract 03 §2)" };
  }
  for (const id of capabilities) {
    if (typeof id !== "string" || !CAPABILITY_ID_PATTERN.test(id)) {
      return { ok: false, field: "enginePluginMeta.capabilities", reason: `declared capability id ${JSON.stringify(id)} is malformed ("<engine>/<verb>")` };
    }
    // Contract 03 rule 1: every declared id MUST resolve to a complete
    // gamos/capability@2 record — or registration fails closed.
    if (registry === undefined || ![...registry.values()].some((record) => record.id === id)) {
      return {
        ok: false,
        field: "enginePluginMeta.capabilities",
        reason: `declared capability id ${JSON.stringify(id)} does not resolve to a complete registry record${registry === undefined ? " (no registry provided — unresolvable declarations fail closed)" : ""} (contract 03 rule 1)`,
      };
    }
  }

  const headlessSupport = input.headlessSupport;
  if (typeof headlessSupport !== "string" || !HEADLESS_SUPPORT_VALUES.includes(headlessSupport)) {
    return { ok: false, field: "enginePluginMeta.headlessSupport", reason: 'must be "full" | "partial" | "none"' };
  }

  const requiresDisplayServer = input.requiresDisplayServer;
  if (typeof requiresDisplayServer !== "boolean") {
    return { ok: false, field: "enginePluginMeta.requiresDisplayServer", reason: "must be a boolean (true → availability degrades off-desktop, contract 07)" };
  }

  const provenance = input.provenance;
  const canonical = validateProvenanceRef(provenance);
  if (!canonical.ok) {
    return {
      ok: false,
      field: `enginePluginMeta.${canonical.field}`,
      reason: `${canonical.reason} — engine-plugin provenance must be canonical ${PROVENANCE_SCHEMA_ID} with surfaces (contract 03 §2 / 09 §4)`,
    };
  }

  return {
    ok: true,
    meta: input as unknown as EnginePluginMeta,
  };
}

// ---------------------------------------------------------------------------
// Canonical M2.4 capability records (append-only once published).
// ---------------------------------------------------------------------------

/** Shared canonical provenance for the three first-party engine plugins. */
const enginePluginProvenance = (path: string): ProvenanceRef => ({
  publisher: "gamos-tl",
  source: {
    type: "repository",
    repo: "payswapdotorg/Gamos-2.0",
    commitSha: "9a5f17f7".repeat(5), // replaced by the shipping commit's sha at integration time
    path,
  },
  surfaces: ["mcp"],
  reviewedBy: "gamos-tl",
  reviewRef: "M2 engine plugin integration (TL-reviewed)",
});

const mcpProvider = (pluginId: string) => ({
  kind: "mcp-server" as const,
  identity: `plugin:${pluginId}:engine`,
  discoveredVia: "zcode-plugin-lifecycle (installed_plugins.json + marketplace cache)",
});

const readOnlyCommandPermission: PermissionSpec = {
  kind: "command-execution",
  scope: "read-only",
  rationale: "read-only filesystem probes of the declared project/workspace",
};

const engineHeadlessPermission: PermissionSpec = {
  kind: "engine-headless",
  scope: "declared-workspace",
  rationale: "typed engine operation through the real engine executable in headless/batch mode (existing permission-gated agent execution)",
};

const fileWritePermission: PermissionSpec = {
  kind: "filesystem-write",
  scope: "declared-workspace",
  rationale: "the typed operation persists engine files (scene/project/artifact) inside the declared workspace",
};

const networkLocalPermission: PermissionSpec = {
  kind: "network-access",
  scope: "loopback",
  rationale: "the runtime bridge starts a local dev server on a loopback port",
};

/** Unity capabilities (M2.1, Worker A). */
const unityCapabilities: readonly CapabilityRecord[] = [
  {
    id: "unity/project.inspect",
    version: "1.0.0",
    title: "Inspect Unity project",
    description: "Typed, read-only inspection of a real Unity project: project version (ProjectVersion.txt), structure and supported capabilities.",
    engineFamily: "unity",
    input: { type: "object", properties: { projectRoot: { type: "string" } }, required: ["projectRoot"] },
    output: {
      type: "object",
      properties: { projectVersion: { type: "string" }, structure: { type: "object" }, capabilities: { type: "array" } },
      required: ["projectVersion"],
    },
    permissions: [readOnlyCommandPermission],
    availability: { state: "conditional", reason: "requires a real Unity project root; engine availability is separate (contract 07)", prerequisites: ["unity-project-root"] },
    provenance: enginePluginProvenance("apps/zcode-cli/packages/unity-engine-plugin"),
    provider: mcpProvider("unity-engine"),
    prerequisites: [{ id: "unity-project-root", description: "a real Unity project directory (Assets/ + ProjectSettings/ProjectVersion.txt)" }],
    compatibility: { engineVersions: ">=2022.3", notes: "Unity family grammar (contract 04): 2022.3 LTS and 6000.0+ streams" },
    reversibility: { kind: "reversible", notes: "read-only inspection — no mutation" },
    idempotency: { repeatable: true },
    timeout: { defaultMs: 60000, maxMs: 300000 },
    cancellation: { supported: true, semantics: "cooperative (process-tree kill of the batch invocation)" },
    verification: { method: "output-schema", spec: "inspected fields must be present and the reported project version must parse in the Unity grammar" },
  },
  {
    id: "unity/scene.modify",
    version: "1.0.0",
    title: "Modify Unity project scene",
    description: "Typed, narrowly scoped scene/project modification executed through the real Unity editor in batch mode (-executeMethod); verified by Unity's own output and post-state inspection.",
    engineFamily: "unity",
    input: {
      type: "object",
      properties: {
        projectRoot: { type: "string" },
        operation: { type: "string", enum: ["scene.add-cube", "scene.set-active-build-target"] },
        parameters: { type: "object" },
      },
      required: ["projectRoot", "operation"],
    },
    output: {
      type: "object",
      properties: { exitStatus: { type: "number" }, unityLog: { type: "string" }, changedFiles: { type: "array" } },
      required: ["exitStatus"],
    },
    permissions: [engineHeadlessPermission, fileWritePermission],
    availability: {
      state: "conditional",
      reason: "requires a licensed, installed Unity Editor executable discoverable via contract 04 machine-local discovery; Unity licensing is an external prerequisite that cannot be provisioned by Gamos",
      prerequisites: ["unity-editor-installed", "unity-license-active", "unity-project-root"],
    },
    provenance: enginePluginProvenance("apps/zcode-cli/packages/unity-engine-plugin"),
    provider: mcpProvider("unity-engine"),
    prerequisites: [
      { id: "unity-editor-installed", description: "real Unity Editor executable discovered on the machine (NOT inferred from ProjectVersion.txt)" },
      { id: "unity-license-active", description: "an activated Unity license (Unity Personal/Plus/Pro sign-in or a CI license file) — an external, user-controlled prerequisite" },
    ],
    compatibility: { engineVersions: ">=2022.3", notes: "batch mode -batchmode -nographics -executeMethod" },
    reversibility: { kind: "recoverable", notes: "scene/project mutations are file mutations under workspace version control; recoverable via the project's existing VCS" },
    idempotency: { repeatable: false, dedupeKey: "operation+parameters+projectRoot" },
    timeout: { defaultMs: 600000, maxMs: 3600000 },
    cancellation: { supported: true, semantics: "cooperative (SIGTERM to the editor batch process; partial edits remain recoverable via VCS)" },
    verification: { method: "engine-query", spec: "Unity's editor log must report the executed method outcome AND the expected post-state (changed file present/marker) must be observed" },
  },
  {
    id: "unity/project.build",
    version: "1.0.0",
    title: "Build Unity project",
    description: "Real Unity batch-mode build of the project for a declared target; verified by Unity's build log and the produced artifact.",
    engineFamily: "unity",
    input: {
      type: "object",
      properties: { projectRoot: { type: "string" }, buildTarget: { type: "string", enum: ["StandaloneLinux64"] } },
      required: ["projectRoot", "buildTarget"],
    },
    output: {
      type: "object",
      properties: { exitStatus: { type: "number" }, buildLog: { type: "string" }, artifactPath: { type: "string" }, artifactSha256: { type: "string" } },
      required: ["exitStatus"],
    },
    permissions: [engineHeadlessPermission, fileWritePermission],
    availability: {
      state: "conditional",
      reason: "requires a licensed Unity Editor with the target build modules installed",
      prerequisites: ["unity-editor-installed", "unity-license-active", "unity-build-modules"],
    },
    provenance: enginePluginProvenance("apps/zcode-cli/packages/unity-engine-plugin"),
    provider: mcpProvider("unity-engine"),
    prerequisites: [
      { id: "unity-editor-installed", description: "real Unity Editor executable" },
      { id: "unity-license-active", description: "activated Unity license" },
      { id: "unity-build-modules", description: "build support modules for the declared target" },
    ],
    compatibility: { engineVersions: ">=2022.3", notes: "-batchmode -nographics -buildTarget" },
    reversibility: { kind: "reversible", notes: "build outputs are additive artifacts" },
    idempotency: { repeatable: true, dedupeKey: "projectRoot+buildTarget" },
    timeout: { defaultMs: 1800000, maxMs: 7200000 },
    cancellation: { supported: true, semantics: "cooperative (editor batch process termination)" },
    verification: { method: "artifact-hash", spec: "the build artifact must exist with the recorded sha256 and the Unity log must report build success" },
  },
];

/** Blender capabilities (M2.2, Worker A). */
const blenderCapabilities: readonly CapabilityRecord[] = [
  {
    id: "blender/scene.inspect",
    version: "1.0.0",
    title: "Inspect Blender scene",
    description: "Typed, read-only inspection of a real .blend file's scenes/objects through the controlled Blender bridge (headless).",
    engineFamily: "blender",
    input: { type: "object", properties: { blendFile: { type: "string" } }, required: ["blendFile"] },
    output: {
      type: "object",
      properties: { blenderVersion: { type: "string" }, scenes: { type: "array" }, objects: { type: "array" } },
      required: ["blenderVersion"],
    },
    permissions: [readOnlyCommandPermission],
    availability: { state: "conditional", reason: "requires a discovered Blender executable (>=4.1) and an existing .blend file", prerequisites: ["blender-installed"] },
    provenance: enginePluginProvenance("apps/zcode-cli/packages/blender-engine-plugin"),
    provider: mcpProvider("blender-engine"),
    prerequisites: [{ id: "blender-installed", description: "a real Blender executable discovered via contract 04 machine-local discovery" }],
    compatibility: { engineVersions: ">=4.1", notes: "Blender family grammar (contract 04)" },
    reversibility: { kind: "reversible", notes: "read-only inspection — no mutation" },
    idempotency: { repeatable: true },
    timeout: { defaultMs: 120000, maxMs: 600000 },
    cancellation: { supported: true, semantics: "cooperative (process-tree kill)" },
    verification: { method: "output-schema", spec: "reported scene/object data must come from the real .blend file parsed by the real Blender executable" },
  },
  {
    id: "blender/scene.modify",
    version: "1.0.0",
    title: "Modify Blender scene (typed operations)",
    description: "Typed, schema-validated scene/object manipulation (add primitive, set transform, rename, delete) through the controlled bridge add-on; the SAME typed contract drives interactive and headless execution. Arbitrary model-authored Python is never executed.",
    engineFamily: "blender",
    input: {
      type: "object",
      properties: {
        blendFile: { type: "string" },
        operations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              op: { type: "string", enum: ["add-primitive", "set-transform", "rename", "delete", "set-material-color"] },
              target: { type: "string" },
              primitive: { type: "string", enum: ["cube", "sphere", "cylinder", "plane", "monkey"] },
              location: { type: "array", items: { type: "number" } },
              rotation: { type: "array", items: { type: "number" } },
              scale: { type: "array", items: { type: "number" } },
              name: { type: "string" },
              color: { type: "array", items: { type: "number" } },
            },
            required: ["op"],
          },
        },
        save: { type: "boolean" },
      },
      required: ["blendFile", "operations"],
    },
    output: {
      type: "object",
      properties: { applied: { type: "array" }, saved: { type: "boolean" }, blendSha256: { type: "string" } },
      required: ["applied"],
    },
    permissions: [engineHeadlessPermission, fileWritePermission],
    availability: { state: "conditional", reason: "requires a discovered Blender executable (>=4.1) and an existing .blend file", prerequisites: ["blender-installed"] },
    provenance: enginePluginProvenance("apps/zcode-cli/packages/blender-engine-plugin"),
    provider: mcpProvider("blender-engine"),
    prerequisites: [{ id: "blender-installed", description: "a real Blender executable (>=4.1)" }],
    compatibility: { engineVersions: ">=4.1", notes: "typed operations only — the bridge add-on is reviewed code; no arbitrary Python passthrough" },
    reversibility: { kind: "recoverable", notes: ".blend mutation is a file mutation; recoverable via the workspace's VCS or an explicit backup copy the caller chose to keep" },
    idempotency: { repeatable: false, dedupeKey: "blendFile+operations" },
    timeout: { defaultMs: 300000, maxMs: 1800000 },
    cancellation: { supported: true, semantics: "cooperative (process-tree kill; an interrupted save leaves the original file intact because saves are atomic-rename)" },
    verification: { method: "engine-query", spec: "the saved .blend must be re-opened headlessly and the expected object states observed (name/transform/existence)" },
  },
  {
    id: "blender/scene.render",
    version: "1.0.0",
    title: "Render Blender scene",
    description: "Real render of a scene (Cycles CPU by default) producing an image artifact with its sha256; the render output — not the process exit — proves success.",
    engineFamily: "blender",
    input: {
      type: "object",
      properties: {
        blendFile: { type: "string" },
        outputPath: { type: "string" },
        engine: { type: "string", enum: ["CYCLES", "BLENDER_EEVEE"] },
        resolution: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } } },
      },
      required: ["blendFile", "outputPath"],
    },
    output: {
      type: "object",
      properties: { rendered: { type: "boolean" }, imageSha256: { type: "string" }, engineUsed: { type: "string" } },
      required: ["rendered", "imageSha256"],
    },
    permissions: [engineHeadlessPermission, fileWritePermission],
    availability: { state: "conditional", reason: "requires a discovered Blender executable (>=4.1); Cycles CPU renders headlessly without a display server", prerequisites: ["blender-installed"] },
    provenance: enginePluginProvenance("apps/zcode-cli/packages/blender-engine-plugin"),
    provider: mcpProvider("blender-engine"),
    prerequisites: [{ id: "blender-installed", description: "a real Blender executable (>=4.1)" }],
    compatibility: { engineVersions: ">=4.1", notes: "Cycles CPU is the default headless engine; EEVEE requires a display/GPU context (declared, degrades honestly)" },
    reversibility: { kind: "reversible", notes: "render output is an additive artifact" },
    idempotency: { repeatable: true, dedupeKey: "blendFile+outputPath+engine+resolution" },
    timeout: { defaultMs: 600000, maxMs: 3600000 },
    cancellation: { supported: true, semantics: "cooperative (process-tree kill; partial renders are discarded)" },
    verification: { method: "artifact-hash", spec: "the rendered image must exist, be non-empty, and its sha256 must be recorded" },
  },
  {
    id: "blender/asset.export",
    version: "1.0.0",
    title: "Export Blender asset",
    description: "Real export of scene objects to a declared format (e.g. OBJ/FBX/GLTF) through Blender's real exporters, with the exported artifact hash recorded.",
    engineFamily: "blender",
    input: {
      type: "object",
      properties: {
        blendFile: { type: "string" },
        outputPath: { type: "string" },
        format: { type: "string", enum: ["OBJ", "GLTF", "FBX"] },
        selection: { type: "array", items: { type: "string" } },
      },
      required: ["blendFile", "outputPath", "format"],
    },
    output: {
      type: "object",
      properties: { exported: { type: "boolean" }, artifactPath: { type: "string" }, artifactSha256: { type: "string" } },
      required: ["exported", "artifactSha256"],
    },
    permissions: [engineHeadlessPermission, fileWritePermission],
    availability: { state: "conditional", reason: "requires a discovered Blender executable (>=4.1) with the exporter available", prerequisites: ["blender-installed"] },
    provenance: enginePluginProvenance("apps/zcode-cli/packages/blender-engine-plugin"),
    provider: mcpProvider("blender-engine"),
    prerequisites: [{ id: "blender-installed", description: "a real Blender executable (>=4.1)" }],
    compatibility: { engineVersions: ">=4.1", notes: "uses Blender's built-in exporters via the typed bridge" },
    reversibility: { kind: "reversible", notes: "export output is an additive artifact" },
    idempotency: { repeatable: true, dedupeKey: "blendFile+outputPath+format+selection" },
    timeout: { defaultMs: 300000, maxMs: 1800000 },
    cancellation: { supported: true, semantics: "cooperative (process-tree kill)" },
    verification: { method: "artifact-hash", spec: "the exported artifact must exist, be non-empty, and its sha256 must be recorded" },
  },
];

/** Babylon capabilities (M2.3, Worker A). */
const babylonCapabilities: readonly CapabilityRecord[] = [
  {
    id: "babylon/project.inspect",
    version: "1.0.0",
    title: "Inspect Babylon project",
    description: "Typed, read-only inspection of a real Babylon.js project: package metadata, declared dependencies, scripts and toolchain versions.",
    engineFamily: "babylon",
    input: { type: "object", properties: { projectRoot: { type: "string" } }, required: ["projectRoot"] },
    output: {
      type: "object",
      properties: { nodeVersion: { type: "string" }, dependencies: { type: "object" }, scripts: { type: "object" } },
      required: ["nodeVersion"],
    },
    permissions: [readOnlyCommandPermission],
    availability: { state: "conditional", reason: "requires a real Babylon project root with package metadata", prerequisites: ["babylon-project-root"] },
    provenance: enginePluginProvenance("apps/zcode-cli/packages/babylon-engine-plugin"),
    provider: mcpProvider("babylon-engine"),
    prerequisites: [{ id: "babylon-project-root", description: "a directory with package.json declaring @babylonjs/* dependencies" }],
    compatibility: { engineVersions: ">=18.0", notes: "Babylon toolchain = Node runtime family grammar (contract 04)" },
    reversibility: { kind: "reversible", notes: "read-only inspection — no mutation" },
    idempotency: { repeatable: true },
    timeout: { defaultMs: 60000, maxMs: 300000 },
    cancellation: { supported: true, semantics: "cooperative (read-only probes abort on cancel)" },
    verification: { method: "output-schema", spec: "inspected fields must come from the real package metadata and the actual Node runtime" },
  },
  {
    id: "babylon/project.build",
    version: "1.0.0",
    title: "Build Babylon project",
    description: "Real build of the Babylon project through its declared, inspected build script (explicit and inspectable — never scripts inferred from model text).",
    engineFamily: "babylon",
    input: { type: "object", properties: { projectRoot: { type: "string" } }, required: ["projectRoot"] },
    output: {
      type: "object",
      properties: { exitStatus: { type: "number" }, buildLog: { type: "string" }, artifactPath: { type: "string" }, artifactSha256: { type: "string" } },
      required: ["exitStatus"],
    },
    permissions: [
      { kind: "command-execution", scope: "declared-build-script", rationale: "executes ONLY the project's inspected package.json build script with explicit arguments" },
    ],
    availability: { state: "conditional", reason: "requires an installable Babylon project (declared dependencies) and a declared build script", prerequisites: ["babylon-project-root", "node-toolchain", "network-for-dependencies"] },
    provenance: enginePluginProvenance("apps/zcode-cli/packages/babylon-engine-plugin"),
    provider: mcpProvider("babylon-engine"),
    prerequisites: [
      { id: "babylon-project-root", description: "real Babylon project root" },
      { id: "node-toolchain", description: "Node runtime satisfying the project's engines constraint" },
      { id: "network-for-dependencies", description: "declared network permission for dependency downloads — hashes of fetched artifacts are recorded" },
    ],
    compatibility: { engineVersions: ">=18.0", notes: "dependency fetches use the declared network permission and record fetched artifact hashes (contract 08)" },
    reversibility: { kind: "reversible", notes: "build outputs are additive artifacts" },
    idempotency: { repeatable: true, dedupeKey: "projectRoot" },
    timeout: { defaultMs: 600000, maxMs: 1800000 },
    cancellation: { supported: true, semantics: "cooperative (process-tree kill of the build)" },
    verification: { method: "artifact-hash", spec: "the build must report success AND the built artifact must exist with its sha256 recorded" },
  },
  {
    id: "babylon/project.run",
    version: "1.0.0",
    title: "Run Babylon project (dev runtime)",
    description: "Starts the real project runtime through its declared dev script, exposes the actual runtime URL, and records process identity for cancellation. The URL is then verified in the original ZCode Browser by the acceptance journey.",
    engineFamily: "babylon",
    input: {
      type: "object",
      properties: { projectRoot: { type: "string" }, port: { type: "number" } },
      required: ["projectRoot"],
    },
    output: {
      type: "object",
      properties: { started: { type: "boolean" }, runtimeUrl: { type: "string" }, pid: { type: "number" }, healthChecked: { type: "boolean" } },
      required: ["started", "runtimeUrl"],
    },
    permissions: [
      { kind: "command-execution", scope: "declared-dev-script", rationale: "executes ONLY the project's inspected dev script" },
      networkLocalPermission,
    ],
    availability: { state: "conditional", reason: "requires an installable Babylon project with a declared dev script and a free loopback port", prerequisites: ["babylon-project-root", "node-toolchain"] },
    provenance: enginePluginProvenance("apps/zcode-cli/packages/babylon-engine-plugin"),
    provider: mcpProvider("babylon-engine"),
    prerequisites: [
      { id: "babylon-project-root", description: "real Babylon project root" },
      { id: "node-toolchain", description: "Node runtime satisfying the project's engines constraint" },
    ],
    compatibility: { engineVersions: ">=18.0", notes: "loopback dev server; stale server processes are recorded and cancellable" },
    reversibility: { kind: "reversible", notes: "runtime process termination restores the prior state" },
    idempotency: { repeatable: false, dedupeKey: "projectRoot+port" },
    timeout: { defaultMs: 120000, maxMs: 600000 },
    cancellation: { supported: true, semantics: "cooperative (recorded pid is terminated; port is re-checked free)" },
    verification: { method: "engine-query", spec: "the running runtime's URL must respond to a real HTTP request before success is reported" },
  },
];

/** The canonical M2 capability records for the three engine plugins (append-only). */
export const ENGINE_PLUGIN_CAPABILITIES: readonly CapabilityRecord[] = [
  ...unityCapabilities,
  ...blenderCapabilities,
  ...babylonCapabilities,
];

/** Registers every shipped engine capability and returns the registry map. */
export function registerEnginePluginCapabilities(): Map<string, CapabilityRecord> {
  const registry = new Map<string, CapabilityRecord>();
  for (const record of ENGINE_PLUGIN_CAPABILITIES) {
    const registered = registerCapability(record);
    registry.set(`${registered.id}@${registered.version}`, registered);
  }
  return registry;
}

// ---------------------------------------------------------------------------
// The shipped engine-plugin metas (gamos/engine-plugin@2).
// ---------------------------------------------------------------------------

export const ENGINE_PLUGIN_METAS: readonly EnginePluginMeta[] = [
  {
    pluginId: "unity-engine",
    engineFamily: "unity",
    engineVersions: ">=2022.3",
    executable: { kind: "batch", command: "unity-editor", args: ["-batchmode", "-nographics"] },
    capabilities: ["unity/project.inspect", "unity/scene.modify", "unity/project.build"],
    headlessSupport: "full",
    requiresDisplayServer: false,
    provenance: enginePluginProvenance("apps/zcode-cli/packages/unity-engine-plugin"),
  },
  {
    pluginId: "blender-engine",
    engineFamily: "blender",
    engineVersions: ">=4.1",
    executable: { kind: "cli", command: "blender", args: ["-b"] },
    capabilities: ["blender/scene.inspect", "blender/scene.modify", "blender/scene.render", "blender/asset.export"],
    headlessSupport: "full",
    requiresDisplayServer: false,
    provenance: enginePluginProvenance("apps/zcode-cli/packages/blender-engine-plugin"),
  },
  {
    pluginId: "babylon-engine",
    engineFamily: "babylon",
    engineVersions: ">=18.0",
    executable: { kind: "server", command: "node" },
    capabilities: ["babylon/project.inspect", "babylon/project.build", "babylon/project.run"],
    headlessSupport: "full",
    requiresDisplayServer: false,
    provenance: enginePluginProvenance("apps/zcode-cli/packages/babylon-engine-plugin"),
  },
];
