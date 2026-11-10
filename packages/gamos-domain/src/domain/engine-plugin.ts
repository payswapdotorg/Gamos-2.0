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
import type { CapabilityRecord, JsonSchemaSpec, AvailabilitySpec } from "./capability-registry.js";
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

// The shared record helpers (permission constants, provider identity and the
// canonical M2/M4 provenance helpers + source-of-record commits) live in
// engine-plugin-shared.ts since the M4 WP-1 registration; the M2 records'
// call sites below are unchanged. The M2/M4 source-commit constants remain
// re-exported from THIS module (the historical public API surface).
export { M2_ENGINE_PLUGIN_SOURCE_COMMIT, M4_ENGINE_PLUGIN_SOURCE_COMMIT } from "./engine-plugin-shared.js";
import { enginePluginProvenance, m4EnginePluginProvenance, mcpProvider, readOnlyCommandPermission, engineHeadlessPermission, fileWritePermission, networkLocalPermission } from "./engine-plugin-shared.js";
// The M4 godot capability records (M4 WP-1, Worker B) — registration data in
// its own module since the max-lines split; spread into ENGINE_PLUGIN_CAPABILITIES below.
import { godotCapabilities } from "./engine-plugin-godot.js";
// The M4 unreal capability records (M4 WP-4, Worker B) — its own module per
// the WP-1 max-lines precedent; spread into ENGINE_PLUGIN_CAPABILITIES below.
import { unrealCapabilities } from "./engine-plugin-unreal.js";

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
  {
    id: "unity/asset.import",
    version: "1.0.0",
    title: "Import asset into Unity project",
    description:
      "Imports a hash-verified FBX/GLB export artifact (the Blender export leg's output) into a real Unity project through the licensed Unity Editor in batch mode: the artifact is staged byte-identical under Assets/ (idempotent for identical content, collision fail-closed otherwise), imported through AssetDatabase, and verified by the loaded asset's engine-query record.",
    engineFamily: "unity",
    input: {
      type: "object",
      properties: {
        projectRoot: { type: "string" },
        artifactPath: { type: "string", description: "Absolute path to the FBX/GLB export artifact inside the workspace (the source engine's verified output)." },
        targetAssetPath: {
          type: "string",
          description: 'Relative target path under Assets/ (default "Assets/Gamos/gamos-asset<ext>" derived from the artifact extension); must be a relative "Assets/…" path without ".." whose extension matches the artifact\'s (.fbx or .glb).',
        },
        expectedIntegrity: {
          type: "object",
          description: "Authoritative integrity record from the cross-engine asset-interchange manifest; a mismatch fails closed.",
          properties: { byteLength: { type: "number" }, sha256: { type: "string" } },
          required: ["byteLength", "sha256"],
        },
        placeInScene: {
          type: "object",
          description: "Place the imported asset into a scene at the origin (named GamosImported) and save the scene.",
          properties: { scenePath: { type: "string", description: 'Relative scene path under Assets/ (default "Assets/Scenes/GamosScene.unity").' } },
        },
      },
      required: ["projectRoot", "artifactPath"],
    },
    output: {
      type: "object",
      properties: {
        imported: { type: "boolean" },
        targetAssetPath: { type: "string" },
        guid: { type: "string", description: "The imported asset's AssetDatabase GUID (non-empty — verified)." },
        assetType: { type: "string" },
        meshCount: { type: "number" },
        vertexCount: { type: "number" },
        materialCount: { type: "number" },
        subAssetNames: { type: "array", items: { type: "string" } },
        sceneIntegrated: { type: "boolean" },
        scenePath: { type: "string" },
        stagedSha256: { type: "string" },
        stagedBytes: { type: "number" },
      },
      required: ["imported", "guid", "stagedSha256"],
    },
    permissions: [engineHeadlessPermission, fileWritePermission],
    availability: {
      state: "conditional",
      reason: "requires a licensed, installed Unity Editor executable matching the project's pinned version exactly; Unity licensing is an external prerequisite that cannot be provisioned by Gamos",
      prerequisites: ["unity-editor-installed", "unity-license-active", "unity-project-root"],
    },
    provenance: enginePluginProvenance("apps/zcode-cli/packages/unity-engine-plugin"),
    provider: mcpProvider("unity-engine"),
    prerequisites: [
      { id: "unity-editor-installed", description: "real Unity Editor executable whose version matches the project's pinned version exactly (the version contract is exact, not a floor)" },
      { id: "unity-license-active", description: "an activated Unity license (Unity Personal/Plus/Pro sign-in or a CI license file) — an external, user-controlled prerequisite" },
    ],
    compatibility: { engineVersions: ">=2022.3", notes: "batch mode -batchmode -nographics -executeMethod Gamos.AssetImport.ImportAsset; FBX/GLB interchange artifacts only (GLB requires the project to carry a glTF importer)" },
    reversibility: { kind: "reversible", notes: "additive asset under Assets/ plus an additive scene save — removing the staged asset and reverting the scene restores the prior state" },
    idempotency: { repeatable: true, dedupeKey: "projectRoot+artifactPath+targetAssetPath" },
    timeout: { defaultMs: 600000, maxMs: 3600000 },
    cancellation: { supported: true, semantics: "cooperative (SIGTERM to the editor batch process; the already-staged file is re-verified and re-imported idempotently by the next run)" },
    verification: { method: "engine-query", spec: "the imported asset must load through AssetDatabase with a non-empty GUID and meshCount>0 — a staged file alone does not prove import" },
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
        interchange: {
          type: "object",
          description: "Declared coordinate/scale settings applied by the exporter and recorded in the cross-engine manifest (M3).",
          properties: {
            upAxis: { type: "string", enum: ["y", "z"] },
            globalScale: { type: "number", description: "Uniform scale multiplier (FBX/OBJ only; the glTF exporter has no global scale setting)." },
          },
          required: ["upAxis"],
        },
      },
      required: ["blendFile", "outputPath", "format"],
    },
    output: {
      type: "object",
      properties: {
        exported: { type: "boolean" },
        artifactPath: { type: "string" },
        artifactSha256: { type: "string" },
        blenderVersion: { type: "string", description: "Exact Blender version string from the executing engine (manifest source provenance)." },
        sourceSha256: { type: "string", description: "sha256 of the source .blend file as exported." },
        unitScale: { type: "number" },
        appliedInterchange: {
          type: "object",
          description: "The interchange semantics actually applied by the exporter (echoed by the bridge, not assumed).",
          properties: {
            format: { type: "string", enum: ["fbx", "glb", "obj"] },
            handedness: { type: "string", enum: ["left", "right"] },
            upAxis: { type: "string", enum: ["y", "z"] },
            forwardAxis: { type: "string" },
            units: { type: "string" },
            scaleFactor: { type: "number" },
            appliedTransforms: { type: "string" },
            materials: { type: "object", properties: { referenced: { type: "array", items: { type: "string" } }, embedded: { type: "boolean" } } },
          },
        },
        dependentFiles: {
          type: "array",
          description: "Sidecar/dependent files written by the export (e.g. .mtl, copied textures) with engine-verified hashes.",
          items: {
            type: "object",
            properties: { path: { type: "string" }, mediaType: { type: "string" }, byteLength: { type: "number" }, sha256: { type: "string" } },
          },
        },
      },
      required: ["exported", "artifactSha256"],
    },
    permissions: [engineHeadlessPermission, fileWritePermission],
    availability: { state: "conditional", reason: "requires a discovered Blender executable (>=4.1) with the exporter available", prerequisites: ["blender-installed"] },
    provenance: enginePluginProvenance("apps/zcode-cli/packages/blender-engine-plugin"),
    provider: mcpProvider("blender-engine"),
    prerequisites: [{ id: "blender-installed", description: "a real Blender executable (>=4.1)" }],
    compatibility: { engineVersions: ">=4.1", notes: "uses Blender's built-in exporters via the typed bridge" },
    reversibility: { kind: "reversible", notes: "export output is an additive artifact" },
    idempotency: { repeatable: true, dedupeKey: "blendFile+outputPath+format+selection+interchange" },
    timeout: { defaultMs: 300000, maxMs: 1800000 },
    cancellation: { supported: true, semantics: "cooperative (process-tree kill)" },
    verification: { method: "artifact-hash", spec: "the exported artifact must exist, be non-empty, and its sha256 must be recorded; dependent files are re-verified by the engine" },
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
  {
    id: "babylon/asset.integrate",
    version: "1.0.0",
    title: "Integrate asset into Babylon project",
    description: "Integrates a verified GLB artifact (the Blender export leg's output) into a real Babylon project without spawning an engine binary: hash-verifies the artifact against the authoritative cross-engine manifest integrity record, stages a byte-identical copy under the project's public/assets directory, and appends/replaces the committed asset registry entry (src/gamos-assets.json).",
    engineFamily: "babylon",
    input: {
      type: "object",
      properties: {
        projectRoot: { type: "string" },
        artifactPath: { type: "string" },
        assetName: { type: "string", description: "Registry asset name (lowercase alphanumeric plus dashes, max 64 chars); defaults to the artifact filename stem." },
        expectedIntegrity: {
          type: "object",
          description: "Authoritative integrity record from the cross-engine asset-interchange manifest; a mismatch fails closed.",
          properties: { byteLength: { type: "number" }, sha256: { type: "string" } },
          required: ["byteLength", "sha256"],
        },
      },
      required: ["projectRoot", "artifactPath"],
    },
    output: {
      type: "object",
      properties: {
        integrated: { type: "boolean" },
        assetName: { type: "string" },
        stagedPath: { type: "string" },
        bytes: { type: "number" },
        sha256: { type: "string" },
        registryEntry: {
          type: "object",
          description: "The committed registry entry: the frozen {assetName, file, sha256} triple.",
          properties: { assetName: { type: "string" }, file: { type: "string" }, sha256: { type: "string" } },
        },
        registryPath: { type: "string" },
      },
      required: ["integrated", "sha256"],
    },
    permissions: [
      {
        kind: "filesystem-write",
        scope: "project-public-assets-staging",
        rationale: "stages the hash-verified GLB artifact into the project's public/assets staging directory and updates the committed asset registry (src/gamos-assets.json); no engine binary is ever spawned",
      },
    ],
    availability: { state: "conditional", reason: "requires a real Babylon project root and an existing GLB artifact inside the workspace (the source engine's export output)", prerequisites: ["babylon-project-root"] },
    provenance: enginePluginProvenance("apps/zcode-cli/packages/babylon-engine-plugin"),
    provider: mcpProvider("babylon-engine"),
    prerequisites: [
      { id: "babylon-project-root", description: "real Babylon project root (package.json declaring @babylonjs/* dependencies)" },
    ],
    compatibility: { engineVersions: ">=18.0", notes: "executableless typed file operation; the staged asset is consumed by the project's reviewed loader (@babylonjs/loaders, same major as @babylonjs/core) — registry-driven imports only, never model-authored URLs" },
    reversibility: { kind: "reversible", notes: "additive artifact + registry entry — removing the staged file and the registry row restores the prior state" },
    idempotency: { repeatable: true, dedupeKey: "projectRoot+artifactPath+assetName" },
    timeout: { defaultMs: 60000, maxMs: 300000 },
    cancellation: { supported: true, semantics: "cooperative (bounded local file operations; the registry write is an atomic tmp+rename, so an interruption leaves either the pre-state or the fully integrated state)" },
    verification: { method: "artifact-hash", spec: "the staged file's sha256 must equal the source artifact's sha256 (re-verified after the copy); a declared expectedIntegrity record is authoritative and any mismatch fails closed" },
  },
];

/** The canonical M2 + M4 capability records for the engine plugins (append-only). */
export const ENGINE_PLUGIN_CAPABILITIES: readonly CapabilityRecord[] = [
  ...unityCapabilities,
  ...blenderCapabilities,
  ...godotCapabilities,
  ...babylonCapabilities,
  ...unrealCapabilities,
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
    capabilities: ["unity/project.inspect", "unity/scene.modify", "unity/project.build", "unity/asset.import"],
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
    capabilities: ["babylon/project.inspect", "babylon/project.build", "babylon/project.run", "babylon/asset.integrate"],
    headlessSupport: "full",
    requiresDisplayServer: false,
    provenance: enginePluginProvenance("apps/zcode-cli/packages/babylon-engine-plugin"),
  },
  // M4 WP-1 (Worker B): the godot-engine meta per M4-CAPABILITY-CONTRACTS §4.1 —
  // mirrors the shipped blender-engine shape exactly (cli kind, full headless
  // support, no display server); the executable resolves via contract 04
  // machine-local discovery (the pinned verified 4.2.2 recipe is the reference
  // installation). Registers together with the six §2 godot records.
  {
    pluginId: "godot-engine",
    engineFamily: "godot",
    engineVersions: ">=4.2",
    executable: { kind: "cli", command: "godot", args: ["--headless"] },
    capabilities: [
      "godot/project.inspect",
      "godot/scene.modify",
      "godot/script.check",
      "godot/asset.import",
      "godot/project.build",
      "godot/project.run",
    ],
    headlessSupport: "full",
    requiresDisplayServer: false,
    provenance: m4EnginePluginProvenance("apps/zcode-cli/packages/godot-engine-plugin"),
  },
  // M4 WP-4 (Worker B): the unreal-engine meta per M4-CAPABILITY-CONTRACTS §4.2 —
  // the connector ATTACHES to a running editor, so NO executable is declared
  // (omission is legal and honest: the plugin spawns nothing; kind "server"
  // would be wrong). Live-editor mutations are NEVER described as headless
  // execution (headlessSupport "none"); the externally owned editor is a GUI
  // application, so a display server is an honest G3 prerequisite (true).
  // Registers together with the five §3 unreal records.
  {
    pluginId: "unreal-engine",
    engineFamily: "unreal",
    engineVersions: ">=5.3",
    capabilities: [
      "unreal/connection.inspect",
      "unreal/object.inspect",
      "unreal/property.read",
      "unreal/property.write",
      "unreal/function.invoke",
    ],
    headlessSupport: "none",
    requiresDisplayServer: true,
    provenance: m4EnginePluginProvenance("apps/zcode-cli/packages/unreal-engine-plugin", "WP-4"),
  },
];
