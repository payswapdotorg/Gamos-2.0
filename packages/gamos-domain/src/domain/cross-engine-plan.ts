/**
 * Cross-engine pipeline plan builder (`gamos/cross-engine-plan@1`, M3.3).
 *
 * Pure facility that turns a fail-closed-validated request into an
 * engine-aware GamePlan for the cross-engine asset pipeline:
 *
 *   Blender source project ──export──▶ staging artifact + interchange manifest
 *   ──manifest-validate──▶ target-engine integration (babylon integrate /
 *   unity import) ──▶ project build ──▶ (babylon only) runtime verification.
 *
 * Final-closure handoff §7 (M3 pipeline) + the M3.1/M3.2/M3.4 legs already
 * shipped the real operations this plan references: blender/asset.export@1.0.0
 * (manifest-ingredient export), core/asset.manifest-validate@1.0.0 (the core
 * record shipped below), babylon/asset.integrate@1.0.0, unity/asset.import@1.0.0,
 * babylon/project.build@1.0.0, unity/project.build@1.0.0 and
 * babylon/project.run@1.0.0 (contract 03 §2 records, append-only).
 *
 * Fail-closed rules beyond the GamePlan wire contract:
 * - the request is validated with an EXACT field set (unknown/missing fields
 *   fail closed) and every relative path must be a canonical workspace-relative
 *   POSIX path (canonicalizeClaimPath is reused as the authority);
 * - the Babylon target consumes GLB only — target babylon + format fbx fails
 *   closed (babylon/asset.integrate stages a hash-verified GLB artifact);
 * - op inputs are derived as workspaceRoot-joined absolutes (pure computation —
 *   node:path, same purity class as node:crypto in adapters/canonical.ts);
 * - expectedIntegrity is INTENTIONALLY absent from the integrate/import op
 *   input: the interchange manifest — not the plan — is the integrity
 *   authority at runtime, and the generated workflow script instructs the
 *   actor to read the manifest and pass its artifact record (plan-workflow.ts);
 * - the emitted plan is validated through parseGamePlan before it is returned
 *   (including the unordered resource-claim conflict gate): the builder can
 *   never hand out a plan the plan contract itself would reject.
 *
 * Module direction: this module imports game-plan + resource-claims (and the
 * capability-registry TYPE only) plus the pure workspace-path adapter — the
 * same purity pattern as adapters/canonical.ts (node:crypto) providing
 * node:path computation without a domain-layer IO dependency.
 * plan-workflow.ts does NOT import this module — the script generator derives
 * the manifest-integrity instruction from the plan structure alone, so the
 * dependency graph stays one-way and acyclic.
 */

import { parseGamePlan } from "./game-plan.js";
import type { GamePlan, GamePlanStep, PlanArtifactExpectation, PlanPermissionRequirement } from "./game-plan.js";
import { canonicalizeClaimPath } from "./resource-claims.js";
import type { ResourceClaim, ResourceClaimAccess, ResourceClaimScope } from "./resource-claims.js";
import type { CapabilityRecord } from "./capability-registry.js";
import { isAbsoluteHostPath, joinHostPath, relativeHostPath, resolveHostPath } from "../adapters/workspace-paths.js";

export { CROSS_ENGINE_PLAN_SCHEMA_ID } from "./cross-engine-plan-request.js";
export type { CrossEngineTarget, CrossEngineInterchangeFormat, CrossEnginePlanRequest, ValidatedRequest } from "./cross-engine-plan-request.js";
import { fail, validateCrossEnginePlanRequest } from "./cross-engine-plan-request.js";


// ---------------------------------------------------------------------------
// The shipped core capability record (append-only once published)
// ---------------------------------------------------------------------------

/**
 * The source-of-record commit for the M3.3 cross-engine plan slice: the GREEN
 * commit that first shipped this module (the builder, the core record and the
 * enrichment). A commit cannot contain its own hash, so the pin was authored
 * as the slice's RED commit and re-pinned to the shipping GREEN commit in the
 * slice's HARDEN pass — the exact pattern the M2 engine records follow (their
 * source-of-record names the PR that first shipped them; a later version bump
 * points at its own shipping commit). Provenance is exact (contract 09 §4):
 * the sha names a commit object that exists.
 */
export const M3_CROSS_ENGINE_SOURCE_COMMIT = "0795a64c3effd1c75976fc115dc0d75d232a1d1a";

/**
 * core/asset.manifest-validate@1.0.0 — the ONE core capability the cross-engine
 * pipeline adds: it validates a `gamos/asset-interchange@1` manifest against
 * the exporting operation's machine evidence (reads the manifest + the export
 * artifact, verifies status "exported" and that the artifact integrity record
 * matches the export step's reported bytes + sha256). It is an agent-tool over
 * files the pipeline already produced — no engine binary, no writes.
 */
const manifestValidateCapability: CapabilityRecord = {
  id: "core/asset.manifest-validate",
  version: "1.0.0",
  title: "Validate the cross-engine asset interchange manifest",
  description:
    'Validates a gamos/asset-interchange@1 manifest against the exporting operation\'s machine evidence: reads the manifest and the export artifact, verifies the manifest status is "exported" and that the artifact integrity record (byteLength + sha256) matches the export step\'s reported bytes and hash. Pure validation — no writes, no engine execution.',
  engineFamily: "core",
  input: {
    type: "object",
    properties: {
      manifestPath: { type: "string", description: "Absolute path to the gamos/asset-interchange@1 manifest written beside the exported artifact." },
      artifactPath: { type: "string", description: "Absolute path to the exported interchange artifact the manifest describes." },
    },
    required: ["manifestPath", "artifactPath"],
  },
  output: {
    type: "object",
    properties: {
      valid: { type: "boolean", description: "True only when the manifest parses, its status is \"exported\" and its artifact integrity record matches the exporting operation's reported evidence." },
      artifactSha256: { type: "string", description: "The manifest's authoritative artifact sha256 (the integrity record downstream steps must pass as expectedIntegrity)." },
    },
    required: ["valid", "artifactSha256"],
  },
  permissions: [
    {
      kind: "command-execution",
      scope: "read-only",
      rationale: "reads the interchange manifest and the exported artifact for validation only (no writes, no engine execution)",
    },
  ],
  availability: {
    state: "available",
    reason: "pure validation over files the pipeline already produced inside the workspace (the manifest and the export artifact)",
    prerequisites: [],
  },
  provenance: {
    publisher: "gamos-tl",
    source: {
      type: "repository",
      repo: "payswapdotorg/Gamos-2.0",
      commitSha: M3_CROSS_ENGINE_SOURCE_COMMIT,
      path: "packages/gamos-domain/src/domain/cross-engine-plan.ts",
    },
    surfaces: ["mcp"],
    reviewedBy: "gamos-tl",
    reviewRef: "M3.3 cross-engine plan builder (TL-reviewed)",
  },
  provider: {
    kind: "agent-tool",
    identity: "builtin:files+export-result",
    discoveredVia: "workflow actor instructions",
  },
  prerequisites: [],
  compatibility: { runtime: "node>=24", notes: "pure data validation — the manifest and the export result are read as files/evidence" },
  reversibility: { kind: "reversible", notes: "read-only validation — no mutation" },
  idempotency: { repeatable: true },
  timeout: { defaultMs: 30000, maxMs: 120000 },
  cancellation: { supported: true, semantics: "cooperative (bounded read-only validation; aborts between file reads)" },
  verification: {
    method: "output-schema",
    spec: 'valid:true requires the manifest to parse, its status to be "exported" and its artifact integrity record to match the exporting operation\'s reported byteLength + sha256',
  },
};

/** The shipped core capability records for the cross-engine pipeline (append-only). */
export const CROSS_ENGINE_CORE_CAPABILITIES: readonly CapabilityRecord[] = [manifestValidateCapability];


// ---------------------------------------------------------------------------
// Plan assembly (pure derivation)
// ---------------------------------------------------------------------------

/**
 * The permission union the referenced capabilities declare, mirrored verbatim
 * from the REAL shipped records (engine-plugin.ts capability permissions +
 * the core manifest-validate record above), deduplicated by kind|scope. The
 * builder is standalone data (it imports no engine-plugin module — the
 * architecture direction stays one-way), so the mirrored literals are pinned
 * here and guarded against drift by the domain test suite.
 */
const PIPELINE_PERMISSIONS: readonly PlanPermissionRequirement[] = [
  { kind: "engine-headless", scope: "declared-workspace", rationale: "typed engine operation through the real engine executable in headless/batch mode (existing permission-gated agent execution)" },
  { kind: "filesystem-write", scope: "declared-workspace", rationale: "the typed operation persists engine files (scene/project/artifact) inside the declared workspace" },
  { kind: "command-execution", scope: "read-only", rationale: "reads the interchange manifest and the exported artifact for validation only (no writes, no engine execution)" },
  { kind: "filesystem-write", scope: "project-public-assets-staging", rationale: "stages the hash-verified GLB artifact into the project's public/assets staging directory and updates the committed asset registry (src/gamos-assets.json); no engine binary is ever spawned" },
  { kind: "command-execution", scope: "declared-build-script", rationale: "executes ONLY the project's inspected package.json build script with explicit arguments" },
  { kind: "command-execution", scope: "declared-dev-script", rationale: "executes ONLY the project's inspected dev script" },
  { kind: "network-access", scope: "loopback", rationale: "the runtime bridge starts a local dev server on a loopback port" },
];

/** Babylon pipeline permission union: all seven (integrate + build + run legs). */
const BABYLON_PIPELINE_PERMISSIONS: readonly PlanPermissionRequirement[] = PIPELINE_PERMISSIONS;
/** Unity pipeline permission union: export (engine-headless + filesystem-write) + manifest validation (read-only command). */
const UNITY_PIPELINE_PERMISSIONS: readonly PlanPermissionRequirement[] = PIPELINE_PERMISSIONS.slice(0, 3);
/**
 * Godot pipeline permission union (M4 WP-7): export + import + build + run —
 * engine-headless + filesystem-write + the manifest read-only command. The
 * godot/project.run leg is engine-headless ONLY (no network, no build/dev
 * scripts — the headless run is the terminal verification), so the union is
 * the same three-entry shape as unity's, mirrored verbatim from the REAL
 * godot records (engine-plugin-godot.ts permissions).
 */
const GODOT_PIPELINE_PERMISSIONS: readonly PlanPermissionRequirement[] = PIPELINE_PERMISSIONS.slice(0, 3);
/**
 * Unreal pipeline permission union (M4 WP-7): export + manifest validation +
 * the three read-only RC legs — the loopback-rc-endpoint network permission
 * mirrored VERBATIM from the REAL unreal records (engine-plugin-unreal.ts
 * networkRcEndpointPermission, the WP-4 contracts §3.1 "same spec as 3.1"
 * clause covering object.inspect/property.read). Mutations are NOT planned:
 * the reviewed property/function allowlists are EMPTY at 0.1.0 (the WP-5
 * fail-closed default) — no mutation permission is claimed.
 */
const UNREAL_PIPELINE_PERMISSIONS: readonly PlanPermissionRequirement[] = [
  ...PIPELINE_PERMISSIONS.slice(0, 3),
  {
    kind: "network-access",
    scope: "loopback-rc-endpoint",
    rationale:
      "read-only requests against the verified loopback Remote Control listener (GET /remote/info, typed object describe, typed property reads); the Passphrase header is a transport-compatibility token only, never claimed as server-side authentication (readiness §2.2 U-T2)",
  },
];

interface ClaimSpec {
  readonly access: ResourceClaimAccess;
  readonly scope: ResourceClaimScope;
  readonly path: string;
}

function planStep(
  stepId: string,
  capabilityId: string,
  input: Record<string, unknown>,
  dependsOn: readonly string[],
  claims: readonly ClaimSpec[],
): GamePlanStep;
function planStep(
  stepId: string,
  capabilityId: string,
  input: Record<string, unknown>,
  dependsOn: readonly string[],
  claims: undefined,
): GamePlanStep;
function planStep(
  stepId: string,
  capabilityId: string,
  input: Record<string, unknown>,
  dependsOn: readonly string[],
  claims: readonly ClaimSpec[] | undefined,
): GamePlanStep {
  return {
    stepId,
    capability: { capabilityId, capabilityVersion: "1.0.0", input },
    dependsOn: [...dependsOn],
    // undefined claims = the step touches NO workspace files (the unreal RC
    // legs are network-only): the optional resourceClaims field is omitted —
    // an empty claims array would itself fail the claim contract's
    // at-least-one rule, and fabricating a path claim would be dishonest.
    ...(claims !== undefined
      ? {
          resourceClaims: {
            schemaVersion: 1,
            claims: claims.map((claim) => ({ access: claim.access, scope: claim.scope, path: claim.path })) as readonly ResourceClaim[],
          },
        }
      : {}),
  };
}

/**
 * Builds the engine-aware cross-engine GamePlan. Babylon target: 5 steps
 * (export → manifest-validate → integrate → build → run). Unity target: 4
 * steps (no runtime step — the StandaloneLinux64 player build is the terminal
 * verification). Godot target (M4 WP-7): 5 steps — the WP-3 hop chain
 * (export → manifest-validate → import → build → run; the headless run's
 * exit-0-and-zero-crash-lines verdict is the terminal verification). Unreal
 * target (M4 WP-7): 5 steps — the RC verification chain (export →
 * manifest-validate → attach → describe → property-read; the typed read-back
 * from the live editor is the terminal verification, and mutations are
 * deliberately NOT planned while the reviewed allowlists stay empty at 0.1.0).
 * The returned plan is validated through parseGamePlan (the
 * generator-honesty invariant): a builder bug that would emit an invalid plan
 * fails closed instead of shipping one.
 */
export function buildCrossEngineAssetPlan(input: unknown): GamePlan {
  const request = validateCrossEnginePlanRequest(input);

  const { workspaceRoot, targetEngine, format, assetName } = request;
  const ext = format; // "glb" | "fbx" — the artifact extension
  const opFormat = format === "glb" ? "GLTF" : "FBX"; // blender/asset.export format enum

  // Derived absolute op inputs (pure computation — no filesystem access).
  const blendFileAbs = joinHostPath(workspaceRoot, request.blendFile);
  const stagingArtifactAbs = joinHostPath(workspaceRoot, "staging", `${assetName}.${ext}`);
  const manifestAbs = `${stagingArtifactAbs}.manifest.json`;
  const targetRootAbs = joinHostPath(workspaceRoot, request.targetProjectRoot);

  // Workspace-relative canonical claim paths (derived, then re-validated
  // through the claim-path authority — a non-canonical derivation is a
  // builder bug and fails closed here rather than at parse time).
  const claimPath = (absPath: string): string => {
    const rel = relativeHostPath(workspaceRoot, absPath);
    const canonical = canonicalizeClaimPath(rel);
    if (canonical === null) {
      fail("resourceClaims.claims[].path", `derived claim path "${rel}" is not a canonical workspace-relative POSIX path (fail closed — builder derivation bug)`);
    }
    return canonical;
  };

  const stagingArtifactClaim = claimPath(stagingArtifactAbs);
  const manifestClaim = claimPath(manifestAbs);
  const blendFileClaim = claimPath(blendFileAbs);
  const targetRootClaim = claimPath(targetRootAbs);

  // --- the export leg (Blender source → staging artifact) --------------------
  const exportStep = planStep(
    "export-asset",
    "blender/asset.export",
    {
      blendFile: blendFileAbs,
      outputPath: stagingArtifactAbs,
      format: opFormat,
      ...(request.upAxis !== undefined
        ? { interchange: { upAxis: request.upAxis, ...(request.globalScale !== undefined ? { globalScale: request.globalScale } : {}) } }
        : {}),
    },
    [],
    [
      { access: "read", scope: "asset-path", path: blendFileClaim },
      { access: "write", scope: "generated-output", path: stagingArtifactClaim },
    ],
  );

  // --- the manifest validation leg (staging evidence → export-validated) -----
  const validateStep = planStep(
    "validate-export",
    "core/asset.manifest-validate",
    { manifestPath: manifestAbs, artifactPath: stagingArtifactAbs },
    ["export-asset"],
    [
      { access: "read", scope: "staging", path: manifestClaim },
      { access: "read", scope: "staging", path: stagingArtifactClaim },
    ],
  );

  const steps: GamePlanStep[] = [exportStep, validateStep];
  const artifactExpectations: PlanArtifactExpectation[] = [
    { artifactKind: "file", verificationMethod: "artifact-hash", expectedPathPattern: stagingArtifactClaim },
  ];

  if (targetEngine === "babylon") {
    // --- the integration leg (staging → public/assets, registry-driven) -----
    const stagedAssetClaim = claimPath(joinHostPath(targetRootAbs, "public", "assets", `${assetName}.glb`));
    const integrateStep = planStep(
      "integrate-asset",
      "babylon/asset.integrate",
      // expectedIntegrity is intentionally NOT here: the manifest is the
      // integrity authority and the generated script tells the actor to read
      // it and pass its artifact record (plan-workflow.ts enrichment).
      { projectRoot: targetRootAbs, artifactPath: stagingArtifactAbs, assetName },
      ["validate-export"],
      [
        { access: "read", scope: "staging", path: stagingArtifactClaim },
        { access: "write", scope: "generated-output", path: stagedAssetClaim },
      ],
    );
    steps.push(integrateStep);

    const distClaim = claimPath(joinHostPath(targetRootAbs, "dist"));
    steps.push(
      planStep(
        "build-project",
        "babylon/project.build",
        { projectRoot: targetRootAbs },
        ["integrate-asset"],
        [
          { access: "read", scope: "project", path: targetRootClaim },
          { access: "write", scope: "generated-output", path: distClaim },
        ],
      ),
    );
    steps.push(
      planStep(
        "verify-runtime",
        "babylon/project.run",
        { projectRoot: targetRootAbs },
        ["build-project"],
        [{ access: "read", scope: "project", path: targetRootClaim }],
      ),
    );
    artifactExpectations.push({ artifactKind: "build", verificationMethod: "artifact-hash", expectedPathPattern: distClaim });
  } else if (targetEngine === "unity") {
    // --- the import leg (staging → Assets/, placed into the scene) ----------
    const importedAssetClaim = claimPath(joinHostPath(targetRootAbs, "Assets", "Gamos", `${assetName}.${ext}`));
    const sceneClaim = claimPath(joinHostPath(targetRootAbs, "Assets", "Scenes", "GamosScene.unity"));
    const importStep = planStep(
      "import-asset",
      "unity/asset.import",
      {
        projectRoot: targetRootAbs,
        artifactPath: stagingArtifactAbs,
        targetAssetPath: `Assets/Gamos/${assetName}.${ext}`,
        placeInScene: { scenePath: "Assets/Scenes/GamosScene.unity" },
      },
      ["validate-export"],
      [
        { access: "read", scope: "staging", path: stagingArtifactClaim },
        { access: "write", scope: "generated-output", path: importedAssetClaim },
        { access: "write", scope: "scene", path: sceneClaim },
      ],
    );
    steps.push(importStep);

    const buildsClaim = claimPath(joinHostPath(targetRootAbs, "Builds"));
    steps.push(
      planStep(
        "build-project",
        "unity/project.build",
        { projectRoot: targetRootAbs, buildTarget: "StandaloneLinux64" },
        ["import-asset"],
        [
          { access: "read", scope: "project", path: targetRootClaim },
          { access: "write", scope: "generated-output", path: buildsClaim },
        ],
      ),
    );
    artifactExpectations.push({ artifactKind: "build", verificationMethod: "artifact-hash", expectedPathPattern: buildsClaim });
    artifactExpectations.push({ artifactKind: "scene", verificationMethod: "engine-query", expectedPathPattern: sceneClaim });
  } else if (targetEngine === "godot") {
    // --- M4 WP-7: the Godot hop-chain legs (the WP-3 runtime-verified recipe) -
    // The import stages the manifest-described GLB into the project's assets/
    // dir (absolute targetAssetPath INSIDE the project root, exactly the WP-3
    // hop usage); the build exports through the LinuxX11 preset into the
    // pre-created workspace builds dir (outside the project — the exported
    // binary must not become a project import); the run is the headless
    // terminal verification (exit 0 AND zero crash lines, the record's
    // verification spec — neither alone suffices).
    const importedAssetClaim = claimPath(joinHostPath(targetRootAbs, "assets", `${assetName}.${ext}`));
    const importStep = planStep(
      "import-asset",
      "godot/asset.import",
      // expectedIntegrity is intentionally NOT here (the manifest is the
      // integrity authority — the same discipline as the babylon integrate
      // leg; plan-workflow.ts instructs the actor to read the manifest).
      { projectRoot: targetRootAbs, sourcePath: stagingArtifactAbs, targetAssetPath: joinHostPath(targetRootAbs, "assets", `${assetName}.${ext}`) },
      ["validate-export"],
      [
        { access: "read", scope: "staging", path: stagingArtifactClaim },
        { access: "write", scope: "generated-output", path: importedAssetClaim },
      ],
    );
    steps.push(importStep);

    const buildsClaim = claimPath(joinHostPath(workspaceRoot, "builds"));
    steps.push(
      planStep(
        "build-project",
        "godot/project.build",
        { projectRoot: targetRootAbs, preset: "LinuxX11", outPath: joinHostPath(workspaceRoot, "builds") },
        ["import-asset"],
        [
          { access: "read", scope: "project", path: targetRootClaim },
          { access: "write", scope: "generated-output", path: buildsClaim },
        ],
      ),
    );
    steps.push(
      planStep(
        "verify-runtime",
        "godot/project.run",
        { projectRoot: targetRootAbs, quitAfterFrames: 3 },
        ["build-project"],
        [{ access: "read", scope: "project", path: targetRootClaim }],
      ),
    );
    artifactExpectations.push({ artifactKind: "build", verificationMethod: "artifact-hash", expectedPathPattern: buildsClaim });
  } else {
    // --- M4 WP-7: the Unreal RC verification-chain legs (read-only) ---------
    // The attach leg connects to the DISCOVERED loopback endpoint (no
    // endpoint override — machine-local discovery is the authority; the
    // record's server-reported listener verification is the op's own
    // verification spec). The describe leg typed-describes the exact target
    // object; the verify leg is the engine-query read-back of the typed
    // properties. Mutations are deliberately NOT planned: the reviewed
    // property/function allowlists are EMPTY at 0.1.0 — planning a mutation
    // against unreviewed entries would violate the never-plan-unregistered
    // discipline (the real-editor mutation journey is WP-6, maintainer-side).
    // NONE of the RC legs touch workspace files — no resource claims (the
    // network permission is declared in the plan's permission union).
    const objectPath = request.targetObjectPath;
    const propertyNames = request.targetPropertyNames;
    if (objectPath === undefined || propertyNames === undefined) {
      fail("target", "the unreal leg requires objectPath + propertyNames (fail closed — the request validation invariant was violated; this is a builder bug)");
    }
    steps.push(
      planStep("attach-editor", "unreal/connection.inspect", {}, ["validate-export"], undefined),
    );
    steps.push(
      planStep("describe-target", "unreal/object.inspect", { objectPath }, ["attach-editor"], undefined),
    );
    steps.push(
      planStep(
        "verify-target",
        "unreal/property.read",
        { objectPath, propertyNames: [...propertyNames] },
        ["describe-target"],
        undefined,
      ),
    );
  }

  const rawPlan = {
    planId: request.planId,
    conceptRef: { conceptId: request.conceptId, conceptSha256: request.conceptSha256 },
    engineBinding: {
      engineFamily: targetEngine,
      bindingReason: `cross-engine asset pipeline: Blender source project "${request.sourceProjectIdentity}" exported through staging into the ${targetEngine} target project "${request.targetProjectIdentity}" (user-selected target engine)`,
    },
    steps,
    permissions:
      targetEngine === "babylon"
        ? BABYLON_PIPELINE_PERMISSIONS
        : targetEngine === "unity"
          ? UNITY_PIPELINE_PERMISSIONS
          : targetEngine === "godot"
            ? GODOT_PIPELINE_PERMISSIONS
            : UNREAL_PIPELINE_PERMISSIONS,
    acceptanceRecord: { recordId: request.recordId, recordSha256: request.recordSha256 },
    artifactExpectations,
    executionConstraints: { maxConcurrency: request.maxConcurrency, requiresApproval: true },
    createdAt: request.now,
    provenance: { authoredBy: "user-selected-model" },
  };

  // Generator-honesty invariant: the emitted plan must itself pass the plan
  // contract (ids, hashes, DAG resolvability, acyclicity AND the unordered
  // resource-claim conflict gate — the pipeline's overlapping staging/project
  // claims are ordered by the explicit dependsOn edges above).
  try {
    return parseGamePlan(rawPlan);
  } catch (error) {
    throw new Error(
      `GAMOS/CROSS-ENGINE-PLAN: built plan failed parseGamePlan — the generator emitted an invalid plan (fail closed; this is a builder bug, not a caller error): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

