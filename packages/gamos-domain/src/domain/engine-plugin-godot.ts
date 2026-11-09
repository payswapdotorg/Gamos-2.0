/**
 * The canonical M4 Godot engine capability records (M4 WP-1, Worker B) —
 * contract 03 §2 registration data (`gamos/capability@2` records for the
 * `godot` family), implemented VERBATIM from the field-level contract
 * docs/gamos/M4-CAPABILITY-CONTRACTS.md §2 (authored at
 * M4_ENGINE_PLUGIN_SOURCE_COMMIT; see engine-plugin-shared.ts).
 *
 * Extracted from engine-plugin.ts when the M4 WP-1 registration would
 * otherwise have pushed that file past the repository max-lines lint bound —
 * the records' content is unchanged; engine-plugin.ts remains the
 * REGISTRATION surface (ENGINE_PLUGIN_CAPABILITIES spreads this array and
 * the godot-engine meta lives there, so every declared id resolves through
 * the same single registry — contract 03 rule 1).
 *
 * All records: engineFamily "godot", family-grammar compatibility ">=4.2",
 * mcpProvider("godot-engine"), process-group cooperative cancellation.
 * Honest availability (conditional, real prerequisites), honest reversibility
 * (mutations recoverable until the real engine journey demonstrates the
 * five-part chain — rule 5), and verification specs that name the
 * engine-side read-back / artifact / filesystem proof — never an exit code
 * alone (rule 8).
 */

import type { CapabilityRecord } from "./capability-registry.js";
import {
  m4EnginePluginProvenance,
  mcpProvider,
  readOnlyCommandPermission,
  engineHeadlessPermission,
  fileWritePermission,
} from "./engine-plugin-shared.js";

/**
 * Godot capabilities (M4 WP-1, Worker B) — the six records of the M4.3
 * capability registration, implemented VERBATIM from the field-level contract
 * docs/gamos/M4-CAPABILITY-CONTRACTS.md §2 (authored at
 * M4_ENGINE_PLUGIN_SOURCE_COMMIT). All records: engineFamily "godot",
 * family-grammar compatibility ">=4.2", mcpProvider("godot-engine"),
 * process-group cooperative cancellation. Honest availability (conditional,
 * real prerequisites), honest reversibility (mutations recoverable until the
 * real engine journey demonstrates the five-part chain — rule 5), and
 * verification specs that name the engine-side read-back / artifact /
 * filesystem proof — never an exit code alone (rule 8).
 */
export const godotCapabilities: readonly CapabilityRecord[] = [
  {
    id: "godot/project.inspect",
    version: "1.0.0",
    title: "Inspect Godot project",
    description:
      "Typed, read-only inspection of a real Godot project: the engine-reported version, project.godot config (config_version, application name/features, scripts, main scene) re-parsed by the real engine run — never a cached file.",
    engineFamily: "godot",
    input: { type: "object", properties: { projectRoot: { type: "string" } }, required: ["projectRoot"] },
    output: {
      type: "object",
      properties: {
        godotVersion: { type: "string" },
        configVersion: { type: "number" },
        projectName: { type: "string" },
        configFeatures: { type: "array", items: { type: "string" } },
        hasScripts: { type: "array", items: { type: "string" } },
        mainScene: { type: "string" },
      },
      required: ["godotVersion"],
    },
    permissions: [readOnlyCommandPermission],
    availability: {
      state: "conditional",
      reason: "requires a discovered Godot executable (>=4.2) and an existing project.godot",
      prerequisites: ["godot-installed"],
    },
    provenance: m4EnginePluginProvenance("apps/zcode-cli/packages/godot-engine-plugin"),
    provider: mcpProvider("godot-engine"),
    prerequisites: [
      { id: "godot-installed", description: "a real Godot executable discovered via contract 04 machine-local discovery (version verified in the family grammar)" },
    ],
    compatibility: {
      engineVersions: ">=4.2",
      runtime: "Godot 4.2 stable channel or newer (family grammar; dev/alpha/beta/rc ordered below stable)",
      notes: "verified recipe: Godot 4.2.2.stable.official.15073afe3, binary sha256 69eb9881… (readiness §7)",
    },
    reversibility: { kind: "reversible", notes: "read-only inspection — no mutation" },
    idempotency: { repeatable: true },
    timeout: { defaultMs: 60000, maxMs: 300000 },
    cancellation: { supported: true, semantics: "cooperative (SIGTERM to the engine process group; children reaped via process-group kill)" },
    verification: {
      method: "engine-query",
      spec: "the reported config MUST be re-parsed from the real project.godot by the real engine run (--version + config read-back), not from a cached file",
    },
  },
  {
    id: "godot/scene.modify",
    version: "1.0.0",
    title: "Modify Godot scene (typed operations)",
    description:
      "Typed, schema-validated scene mutation (node-path + property allowlist, JSON-safe values) executed through the committed data-only GDScript bridge — NO user text is ever interpolated into GDScript; the modified scene is re-loaded in a fresh engine process and the applied values asserted.",
    engineFamily: "godot",
    input: {
      type: "object",
      properties: {
        projectRoot: { type: "string" },
        scenePath: { type: "string", description: "Scene resource path inside the declared project (e.g. res://scenes/main.tscn)." },
        operations: {
          type: "array",
          description: "Typed, allowlisted operations — node-path grammar, property-name allowlist, JSON-safe values only (the data-only bridge takes validated JSON inputs).",
          items: {
            type: "object",
            properties: { nodePath: { type: "string" }, property: { type: "string" }, value: {} },
            required: ["nodePath", "property"],
          },
        },
      },
      required: ["projectRoot", "scenePath", "operations"],
    },
    output: {
      type: "object",
      properties: {
        applied: {
          type: "array",
          items: { type: "object", properties: { nodePath: { type: "string" }, property: { type: "string" }, verifiedValue: {} } },
        },
        failures: { type: "array", items: { type: "object" } },
      },
      required: ["applied"],
    },
    permissions: [engineHeadlessPermission, fileWritePermission],
    availability: {
      state: "conditional",
      reason: "requires a discovered Godot executable (>=4.2) and an existing scene file inside the declared project (scene existence checked at dispatch)",
      prerequisites: ["godot-installed"],
    },
    provenance: m4EnginePluginProvenance("apps/zcode-cli/packages/godot-engine-plugin"),
    provider: mcpProvider("godot-engine"),
    prerequisites: [
      { id: "godot-installed", description: "a real Godot executable discovered via contract 04 machine-local discovery (version verified in the family grammar)" },
    ],
    compatibility: {
      engineVersions: ">=4.2",
      runtime: "Godot 4.2 stable channel or newer (family grammar; dev/alpha/beta/rc ordered below stable)",
      notes: "verified recipe: Godot 4.2.2.stable.official.15073afe3, binary sha256 69eb9881… (readiness §7); data-only bridge — no user text interpolated into GDScript",
    },
    reversibility: {
      kind: "recoverable",
      notes: "pre-mutation scene snapshot staged in workspace temp + typed inverse ops; upgrade to reversible ONLY after the real journey demonstrates snapshot restore + engine read-back of restored state (rule 5)",
    },
    idempotency: { repeatable: true, dedupeKey: "projectRoot+scenePath+operations-hash" },
    timeout: { defaultMs: 120000, maxMs: 600000 },
    cancellation: { supported: true, semantics: "cooperative (SIGTERM to the engine process group; children reaped via process-group kill)" },
    verification: {
      method: "engine-query",
      spec: "the modified scene MUST be re-loaded in a fresh engine process and the applied values asserted (tolerance 1e-5 class); an exit code alone does not prove the mutation",
    },
  },
  {
    id: "godot/script.check",
    version: "1.0.0",
    title: "Check Godot script (parse/syntax)",
    description:
      "Read-only parse/syntax check of a GDScript file through the real engine (--check-only): the exit code AND the engine-reported parse-error text together prove the outcome (verified fail-closed — readiness §4.1).",
    engineFamily: "godot",
    input: {
      type: "object",
      properties: { projectRoot: { type: "string" }, scriptPath: { type: "string", description: "Script resource path inside the declared project (e.g. res://scripts/player.gd)." } },
      required: ["projectRoot", "scriptPath"],
    },
    output: {
      type: "object",
      properties: {
        ok: { type: "boolean" },
        parseErrors: { type: "array", items: { type: "object", properties: { line: { type: "number" }, column: { type: "number" }, message: { type: "string" } } } },
        engineVersion: { type: "string" },
      },
      required: ["ok", "engineVersion"],
    },
    permissions: [readOnlyCommandPermission],
    availability: {
      state: "conditional",
      reason: "requires a discovered Godot executable (>=4.2) and an existing script file inside the declared project",
      prerequisites: ["godot-installed"],
    },
    provenance: m4EnginePluginProvenance("apps/zcode-cli/packages/godot-engine-plugin"),
    provider: mcpProvider("godot-engine"),
    prerequisites: [
      { id: "godot-installed", description: "a real Godot executable discovered via contract 04 machine-local discovery (version verified in the family grammar)" },
    ],
    compatibility: {
      engineVersions: ">=4.2",
      runtime: "Godot 4.2 stable channel or newer (family grammar; dev/alpha/beta/rc ordered below stable)",
      notes: "verified recipe: Godot 4.2.2.stable.official.15073afe3, binary sha256 69eb9881… (readiness §7)",
    },
    reversibility: { kind: "reversible", notes: "read-only check — no mutation" },
    idempotency: { repeatable: true },
    timeout: { defaultMs: 60000, maxMs: 300000 },
    cancellation: { supported: true, semantics: "cooperative (SIGTERM to the engine process group; children reaped via process-group kill)" },
    verification: {
      method: "output-schema",
      spec: "--check-only exit code AND the engine-reported parse-error text (verified fail-closed this session — readiness §4.1)",
    },
  },
  {
    id: "godot/asset.import",
    version: "1.0.0",
    title: "Import asset into Godot project",
    description:
      "Imports a real asset file into the project through the real engine's headless import pass: the engine processes the staged source into .godot/imported/* artifacts plus .import metadata, re-verified by filesystem probe with the source sha256 unchanged.",
    engineFamily: "godot",
    input: {
      type: "object",
      properties: {
        projectRoot: { type: "string" },
        sourcePath: { type: "string", description: "Absolute path to the readable source asset inside the workspace (e.g. a Blender OBJ/FBX/GLB export artifact)." },
        targetAssetPath: { type: "string", description: "Target resource path inside the project (res://…; the staged copy location of the source asset)." },
      },
      required: ["projectRoot", "sourcePath", "targetAssetPath"],
    },
    output: {
      type: "object",
      properties: {
        importedFiles: { type: "array", items: { type: "string" } },
        importMetadataPath: { type: "string" },
        sourceSha256: { type: "string" },
      },
      required: ["importedFiles", "sourceSha256"],
    },
    permissions: [engineHeadlessPermission, fileWritePermission],
    availability: {
      state: "conditional",
      reason: "requires a discovered Godot executable (>=4.2), an existing readable source asset and workspace confinement of the staged copy",
      prerequisites: ["godot-installed"],
    },
    provenance: m4EnginePluginProvenance("apps/zcode-cli/packages/godot-engine-plugin"),
    provider: mcpProvider("godot-engine"),
    prerequisites: [
      { id: "godot-installed", description: "a real Godot executable discovered via contract 04 machine-local discovery (version verified in the family grammar)" },
    ],
    compatibility: {
      engineVersions: ">=4.2",
      runtime: "Godot 4.2 stable channel or newer (family grammar; dev/alpha/beta/rc ordered below stable)",
      notes: "verified recipe: Godot 4.2.2.stable.official.15073afe3, binary sha256 69eb9881… (readiness §7); real Blender OBJ → import verified (UID + md5 + .mesh read-back)",
    },
    reversibility: {
      kind: "recoverable",
      notes: "idempotent re-import; removal compensation = deleting the imported files + .import metadata; verified by filesystem probe",
    },
    idempotency: { repeatable: true, dedupeKey: "projectRoot+sourcePath+targetAssetPath" },
    timeout: { defaultMs: 600000, maxMs: 3600000 },
    cancellation: { supported: true, semantics: "cooperative (SIGTERM to the engine process group; children reaped via process-group kill)" },
    verification: {
      method: "filesystem-probe",
      spec: ".godot/imported/* artifacts + .import metadata exist AND the source sha256 is unchanged (a staged file alone does not prove import — mirror of the blender asset.export/import discipline)",
    },
  },
  {
    id: "godot/project.build",
    version: "1.0.0",
    title: "Export Godot project (headless build)",
    description:
      "Real headless export of the project through an allowlisted export preset: the produced PCK + platform binary are verified by existence, sha256 and size bounds — the artifact, not the exit code, proves the build.",
    engineFamily: "godot",
    input: {
      type: "object",
      properties: {
        projectRoot: { type: "string" },
        preset: { type: "string", description: "Allowlisted export preset name declared in export_presets.cfg." },
        outPath: { type: "string", description: "Pre-created output directory inside the declared workspace (the out dir must already exist)." },
      },
      required: ["projectRoot", "preset", "outPath"],
    },
    output: {
      type: "object",
      properties: {
        artifactPath: { type: "string" },
        artifactSha256: { type: "string" },
        artifactBytes: { type: "number" },
        templatesVersion: { type: "string", description: "The export-templates version string, which must match the engine version exactly." },
      },
      required: ["artifactPath", "artifactSha256"],
    },
    permissions: [engineHeadlessPermission, fileWritePermission],
    availability: {
      state: "conditional",
      reason: "requires a discovered Godot executable (>=4.2), the allowlisted preset declared in the project, and export templates installed for the EXACT engine version",
      prerequisites: ["godot-installed", "godot-export-templates-installed"],
    },
    provenance: m4EnginePluginProvenance("apps/zcode-cli/packages/godot-engine-plugin"),
    provider: mcpProvider("godot-engine"),
    prerequisites: [
      { id: "godot-installed", description: "a real Godot executable discovered via contract 04 machine-local discovery (version verified in the family grammar)" },
      { id: "godot-export-templates-installed", description: "export templates present in ~/.local/share/godot/export_templates/<exact-version-string>/ — mismatched or missing templates fail closed with the honest reason (G3)" },
    ],
    compatibility: {
      engineVersions: ">=4.2",
      runtime: "Godot 4.2 stable channel or newer (family grammar; dev/alpha/beta/rc ordered below stable)",
      notes: "verified recipe: Godot 4.2.2.stable.official.15073afe3, binary sha256 69eb9881… (readiness §7); real --export-release ELF 62,214,272 B verified; broken scripts abort the export (fail-closed)",
    },
    reversibility: {
      kind: "recoverable",
      notes: "artifact-producing, not scene-mutating; compensation = artifact deletion; output verified by hash",
    },
    idempotency: { repeatable: true, dedupeKey: "projectRoot+preset+outPath" },
    timeout: { defaultMs: 600000, maxMs: 3600000 },
    cancellation: { supported: true, semantics: "cooperative (SIGTERM to the engine process group; children reaped via process-group kill)" },
    verification: {
      method: "artifact-hash",
      spec: "exported PCK + platform binary existence, sha256 and size bounds (readiness §4.1 verification column is the binding spec)",
    },
  },
  {
    id: "godot/project.run",
    version: "1.0.0",
    title: "Run Godot project (headless verification)",
    description:
      "Headless run of the project (optionally a declared scene, bounded by quit-after-frames): success is exit 0 AND zero engine crash lines in the output — neither alone suffices; run side effects are confined to workspace temp and the .godot dir.",
    engineFamily: "godot",
    input: {
      type: "object",
      properties: {
        projectRoot: { type: "string" },
        scene: { type: "string", description: "Optional scene resource path (res://…) to run instead of the project's main scene." },
        quitAfterFrames: { type: "number", description: "Frame bound for the headless run (the engine quits after this many frames)." },
      },
      required: ["projectRoot"],
    },
    output: {
      type: "object",
      properties: {
        exitCode: { type: "number" },
        stdoutTail: { type: "string" },
        stderrTail: { type: "string" },
        crashLines: { type: "array", items: { type: "string" } },
      },
      required: ["exitCode"],
    },
    permissions: [engineHeadlessPermission],
    availability: {
      state: "conditional",
      reason: "requires a discovered Godot executable (>=4.2) and a real project root (project.godot)",
      prerequisites: ["godot-installed"],
    },
    provenance: m4EnginePluginProvenance("apps/zcode-cli/packages/godot-engine-plugin"),
    provider: mcpProvider("godot-engine"),
    prerequisites: [
      { id: "godot-installed", description: "a real Godot executable discovered via contract 04 machine-local discovery (version verified in the family grammar)" },
    ],
    compatibility: {
      engineVersions: ">=4.2",
      runtime: "Godot 4.2 stable channel or newer (family grammar; dev/alpha/beta/rc ordered below stable)",
      notes: "verified recipe: Godot 4.2.2.stable.official.15073afe3, binary sha256 69eb9881… (readiness §7); exported binary runs --headless exit 0 (verified)",
    },
    reversibility: {
      kind: "recoverable",
      notes: "run side effects (user logs, caches) confined to workspace temp and the .godot dir; compensation = cache cleanup — execution only, no project mutation asserted, so reversible-on-no-mutation is NOT claimed",
    },
    idempotency: { repeatable: true },
    timeout: { defaultMs: 300000, maxMs: 1800000 },
    cancellation: { supported: true, semantics: "cooperative (SIGTERM to the engine process group; children reaped via process-group kill)" },
    verification: {
      method: "output-schema",
      spec: "exit 0 AND zero crash lines in output (both required; neither alone suffices)",
    },
  },
];
