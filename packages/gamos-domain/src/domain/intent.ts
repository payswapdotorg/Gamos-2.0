/**
 * Intent resolution and structured model context (directive §11 / contract 05 §3 — M1.4).
 *
 * The pipeline: user message → data-only intent classification → GameConcept
 * (contract 01) → project-context resolution (contract 04 discovery) → capability
 * resolution (contract 02 registry, fail closed) → a provenance-backed
 * `gamos/model-context@1` document for the USER-SELECTED model.
 *
 * Rules that shape every branch below:
 * - Classification is a data-only FIRST pass; it may be refined by the user's
 *   selected model in-conversation, but this module never spawns a provider.
 * - Non-gaming and unsupported requests keep normal ZCode behavior: no concept,
 *   no gaming context, no injected issues.
 * - The context reflects REAL observations only (detection, machine discovery,
 *   registry records). Nothing is guessed, defaulted or fabricated — the
 *   builder itself fails closed on unobserved engine states.
 * - Substitutions are disclosed for approval, never silently applied.
 */

import { canonicalSha256 } from "../adapters/canonical.js";

import { createGameConcept } from "./game-concept.js";
import type { GameConcept, EngineFamilyPreference } from "./game-concept.js";
import type { EngineFamily } from "../engine-family.js";
import { resolveCapability } from "./capability-registry.js";
import type { CapabilityRecord, CapabilityResolutionError } from "./capability-registry.js";
import { joinEngineState } from "./discovery/discovery-record.js";
import type { MachineEngineDiscovery, EffectiveEngineState } from "./discovery/discovery-record.js";
import type { ProjectEngineDetection } from "../adapters/discovery/project-probes.js";

// ---------------------------------------------------------------------------
// Classification — data-only first pass
// ---------------------------------------------------------------------------

export type IntentRequestKind = "inspect" | "availability" | "plan" | "check-runtime" | "validate";

/** An engine the user mentioned, with how firmly they mentioned it. */
export interface MentionedEngine {
  readonly family: EngineFamily;
  readonly strength: "explicit" | "ambiguous";
}

export interface IntentClassification {
  readonly isGaming: boolean;
  readonly confidence: "high" | "medium" | "none";
  /** The concrete words that drove the classification (provenance for the pass). */
  readonly signals: readonly string[];
  readonly mentionedEngines: readonly MentionedEngine[];
  readonly genres: readonly string[];
  readonly requestKinds: readonly IntentRequestKind[];
  /** A gaming message that maps to no supported request kind is NOT handled here. */
  readonly supported: boolean;
  readonly unsupportedReason?: string;
}

const ENGINE_WORDS: ReadonlyArray<{ family: EngineFamily; pattern: RegExp }> = [
  { family: "unity", pattern: /\bunity\b/i },
  { family: "unreal", pattern: /\bunreal\b/i },
  { family: "godot", pattern: /\bgodot\b/i },
  { family: "blender", pattern: /\bblender\b/i },
  { family: "babylon", pattern: /\bbabylon(\.?js)?\b/i },
];

const GENRES: ReadonlyArray<{ genre: string; pattern: RegExp }> = [
  { genre: "tower-defense", pattern: /\btower[- ]defense\b/i },
  { genre: "platformer", pattern: /\bplatformer\b/i },
  { genre: "rpg", pattern: /\b(rpg|role[- ]playing game)\b/i },
  { genre: "shooter", pattern: /\b(shooter|fps|shmup)\b/i },
  { genre: "puzzle", pattern: /\bpuzzle\b/i },
  { genre: "racing", pattern: /\bracing\b/i },
  { genre: "strategy", pattern: /\bstrategy\b/i },
  { genre: "roguelike", pattern: /\b(roguelike|rogue-like)\b/i },
  { genre: "simulation", pattern: /\b(simulation|sim)\b/i },
  { genre: "sandbox", pattern: /\bsandbox\b/i },
  { genre: "arcade", pattern: /\barcade\b/i },
];

const GAMING_WORD = /\b(game|games|gaming|gameplay|gameplay|gamedev|player|level design|sprite|game project)\b/i;

const REQUEST_KIND_PATTERNS: ReadonlyArray<{ kind: IntentRequestKind; pattern: RegExp }> = [
  { kind: "validate", pattern: /\bvalidat(e|es|ing|ion)\b/i },
  { kind: "inspect", pattern: /\binspect\b|\bexplain\b[^.]*\bstructured\b|\banalyz(e|ing)\b[^.]*\bproject\b/i },
  {
    kind: "availability",
    pattern: /\b(identify|list|which|what)\b[^.]*\b(engines?|capabilities?|tools?)\b[^.]*\bavailable\b|\bavailable here\b/i,
  },
  { kind: "check-runtime", pattern: /\bcheck\b[^.]*\b(prepar|ready|readiness)\b|\bcan\b[^.]*\bprepared for\b/i },
  {
    kind: "plan",
    pattern: /\bplan\b|\b(create|build|make|generate)\b[^.]*\b(prototype|game|games|level|scene|asset|assets)\b|\bprototype\b/i,
  },
];

/**
 * Data-only first-pass classification of a user message. Deterministic and
 * side-effect free; a model-assisted refinement may run in-conversation on top
 * of the returned signals, but the selected model is never bypassed here.
 */
export function classifyIntent(message: string): IntentClassification {
  const signals: string[] = [];
  const mentionedEngines: MentionedEngine[] = [];
  for (const { family, pattern } of ENGINE_WORDS) {
    if (pattern.test(message)) {
      mentionedEngines.push({ family, strength: "explicit" });
      signals.push(`engine:${family}`);
    }
  }
  // Two or more engine mentions in one message is an open question, not a choice.
  if (mentionedEngines.length >= 2) {
    for (const mention of mentionedEngines) {
      (mention as { strength: "explicit" | "ambiguous" }).strength = "ambiguous";
    }
    signals.push("engine-question:multi");
  }

  const genres: string[] = [];
  for (const { genre, pattern } of GENRES) {
    if (pattern.test(message)) {
      genres.push(genre);
      signals.push(`genre:${genre}`);
    }
  }

  const gamingWord = GAMING_WORD.test(message);
  if (gamingWord) signals.push("gaming-word");

  const requestKinds = REQUEST_KIND_PATTERNS.filter(({ pattern }) => pattern.test(message)).map(({ kind }) => kind);

  const isGaming = gamingWord || genres.length > 0 || mentionedEngines.length > 0;
  const confidence: IntentClassification["confidence"] = !isGaming
    ? "none"
    : mentionedEngines.length > 0 && genres.length > 0
      ? "high"
      : "medium";

  const supported = isGaming && requestKinds.length > 0;
  return {
    isGaming,
    confidence,
    signals,
    mentionedEngines,
    genres,
    requestKinds,
    supported,
    ...(supported ? {} : { unsupportedReason: isGaming ? "gaming request does not map to a supported request kind (inspect | availability | plan | check-runtime | validate)" : "not a gaming message" }),
  };
}

// ---------------------------------------------------------------------------
// Resolution — classification × discovery × registry
// ---------------------------------------------------------------------------

export interface IntentIssue {
  readonly code:
    | "ambiguous-engine"
    | "project-mismatch"
    | "missing-project"
    | "engine-unavailable"
    | "substitution-proposed"
    | "unavailable-capability"
    | "unsupported-request";
  readonly severity: "blocking" | "approval" | "info";
  readonly message: string;
  readonly candidates?: readonly string[];
}

export interface CapabilityRequestResult {
  readonly request: { id: string; version?: string };
  readonly ok: boolean;
  readonly record?: CapabilityRecord;
  readonly error?: CapabilityResolutionError;
}

export interface IntentResolutionInput {
  readonly message: string;
  readonly workspaceRoot: string;
  /** Real project detection for the workspace (contract 04 §1 — detectProjectEngines). */
  readonly projectDetection: ProjectEngineDetection;
  /** Real machine-local engine discovery (contract 04 §2/§3). */
  readonly machineDiscovery: MachineEngineDiscovery;
  readonly registry: ReadonlyMap<string, CapabilityRecord>;
  /** Explicitly requested capabilities (optional — the pipeline resolves these fail-closed). */
  readonly requestedCapabilities?: readonly { id: string; version?: string }[];
  /** A model-refined classification, when the conversation produced one. */
  readonly classification?: IntentClassification;
  readonly now?: string;
  readonly sessionId?: string;
}

export interface IntentResolution {
  readonly isGaming: boolean;
  readonly classification: IntentClassification;
  readonly concept?: GameConcept;
  readonly engineStates: readonly EffectiveEngineState[];
  readonly capabilityResults: readonly CapabilityRequestResult[];
  readonly issues: readonly IntentIssue[];
  readonly context?: GamingModelContext;
}

const PROJECT_DEPENDENT_KINDS: ReadonlyArray<IntentRequestKind> = ["inspect", "validate", "check-runtime"];

/**
 * Resolves a user message against the REAL observations (detection, machine
 * discovery, registry). Non-gaming and unsupported messages retain normal
 * ZCode behavior. Everything else produces a GameConcept plus issues plus a
 * provenance-backed model context — with substitutions disclosed, never applied.
 */
export function resolveGamingIntent(input: IntentResolutionInput): IntentResolution {
  const classification = input.classification ?? classifyIntent(input.message);

  // Non-gaming: normal ZCode behavior — nothing gaming-shaped is injected.
  if (!classification.isGaming) {
    return { isGaming: false, classification, engineStates: [], capabilityResults: [], issues: [] };
  }

  const issues: IntentIssue[] = [];

  // Unsupported gaming request: the model answers conversationally; the gaming
  // pipeline does not fabricate a concept or context for it.
  if (!classification.supported) {
    issues.push({
      code: "unsupported-request",
      severity: "blocking",
      message: classification.unsupportedReason ?? "unsupported gaming request",
    });
    return { isGaming: true, classification, engineStates: [], capabilityResults: [], issues };
  }

  // --- Engine preferences from the user's words ---------------------------------
  let preferences: EngineFamilyPreference[] = [];
  const mentioned = classification.mentionedEngines;
  if (mentioned.length >= 2) {
    preferences = mentioned.map((m) => ({ engineFamily: m.family, preference: "acceptable" as const }));
    issues.push({
      code: "ambiguous-engine",
      severity: "approval",
      message: `the user mentioned multiple engines (${mentioned.map((m) => m.family).join(", ")}) without choosing one — disambiguate before planning`,
      candidates: mentioned.map((m) => m.family),
    });
  } else if (mentioned.length === 1) {
    preferences = [{ engineFamily: mentioned[0]!.family, preference: "required" as const }];
  } else if (input.projectDetection.isProject) {
    // No stated engine: the REAL detected project families are soft context.
    preferences = input.projectDetection.detected.map((d) => ({ engineFamily: d.engineFamily, preference: "acceptable" as const }));
  }

  // --- Project reality checks ----------------------------------------------------
  if (!input.projectDetection.isProject) {
    const needsProject = classification.requestKinds.some((k) => PROJECT_DEPENDENT_KINDS.includes(k));
    issues.push({
      code: "missing-project",
      severity: needsProject ? "blocking" : "info",
      message: `no game project detected at ${input.workspaceRoot}: ${input.projectDetection.nonProjectReason ?? "no engine-family project markers found"}`,
    });
  } else if (preferences.some((p) => p.preference === "required")) {
    const required = preferences.find((p) => p.preference === "required")!.engineFamily;
    const detectedFamilies = input.projectDetection.detected.map((d) => d.engineFamily);
    if (!detectedFamilies.includes(required)) {
      issues.push({
        code: "project-mismatch",
        severity: "approval",
        message: `the user asked about ${required}, but the detected project is ${detectedFamilies.join(", ")} (${input.projectDetection.detected.map((d) => d.evidence.join(", ")).join("; ")}) — confirm before proceeding`,
      });
    }
  }

  // --- Engine state JOIN (shared intent × machine-local discovery) ---------------
  const bindingFamilies = mentioned.length > 0
    ? mentioned.map((m) => m.family)
    : input.projectDetection.isProject
      ? input.projectDetection.detected.map((d) => d.engineFamily)
      : [];
  const engineStates =
    bindingFamilies.length > 0
      ? joinEngineState(
          {
            schemaVersion: 2,
            workspacePath: input.workspaceRoot,
            engineBindings: bindingFamilies.map((family) => ({ engineFamily: family })),
          },
          input.machineDiscovery,
        )
      : [];

  // --- Substitution disclosure (never a silent swap) ------------------------------
  for (const preference of preferences.filter((p) => p.preference === "required")) {
    const state = engineStates.find((s) => s.engineFamily === preference.engineFamily);
    if (state === undefined) continue;
    if (state.state === "unavailable" || state.state === "unknown") {
      const alternatives = input.machineDiscovery.engines
        .filter((e) => e.installed && e.engineFamily !== preference.engineFamily)
        .map((e) => e.engineFamily);
      if (alternatives.length > 0) {
        issues.push({
          code: "substitution-proposed",
          severity: "approval",
          message: `${preference.engineFamily} is ${state.state} on this machine (${state.reason ?? "no reason recorded"}), while ${alternatives.join(", ")} ${alternatives.length === 1 ? "is" : "are"} installed — a substitution requires explicit user approval (never silently applied)`,
          candidates: alternatives,
        });
      } else {
        issues.push({
          code: "engine-unavailable",
          severity: "blocking",
          message: `${preference.engineFamily} is ${state.state} on this machine (${state.reason ?? "no reason recorded"}) and no alternative engine is installed`,
        });
      }
    }
  }

  // --- Capability resolution (fail closed through the registry) --------------------
  const capabilityResults: CapabilityRequestResult[] = [];
  for (const request of input.requestedCapabilities ?? []) {
    const outcome = resolveCapability(input.registry, { id: request.id, version: request.version });
    if (outcome.ok) {
      capabilityResults.push({ request, ok: true, record: outcome.record });
    } else {
      capabilityResults.push({ request, ok: false, error: outcome.error });
      issues.push({
        code: "unavailable-capability",
        severity: "blocking",
        message: `capability ${request.id} could not be resolved: ${outcome.error.reason}`,
      });
    }
  }

  // --- GameConcept (contract 01) ----------------------------------------------------
  const now = input.now ?? new Date().toISOString();
  const conceptId = `intent-${canonicalSha256(input.message).slice(0, 16)}`;
  const constraints: string[] = [];
  if (/\bread[- ]only\b/i.test(input.message)) constraints.push("read-only");
  const concept = createGameConcept({
    conceptId,
    kind: "gaming",
    genre: classification.genres,
    mechanics: [],
    platformPreferences: preferences,
    references: [],
    constraints,
    ...(input.projectDetection.isProject
      ? {
          projectContext: {
            projectRoot: input.workspaceRoot,
            discoveryRecordRef: `gamos/engine-discovery@2:${canonicalSha256(
              `${input.machineDiscovery.workspacePath}:${input.machineDiscovery.discoveredAt}`,
            ).slice(0, 16)}`,
          },
        }
      : {}),
    acceptanceExpectations: [],
    provenance: {
      origin: "user-message",
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      sourceRef: "intent-resolution",
      capturedAt: now,
    },
  });

  const context = buildGamingModelContext({
    now,
    workspaceRoot: input.workspaceRoot,
    classification,
    projectDetection: input.projectDetection,
    machineDiscovery: input.machineDiscovery,
    engineStates,
    capabilityResults,
    ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
  });

  return {
    isGaming: true,
    classification,
    concept,
    engineStates,
    capabilityResults,
    issues,
    context,
  };
}

// ---------------------------------------------------------------------------
// Structured model context — provenance-backed, fail closed
// ---------------------------------------------------------------------------

/** Everything the context may state, as actually observed. */
export interface GamingContextObservations {
  readonly now: string;
  readonly workspaceRoot: string;
  readonly classification: IntentClassification;
  readonly projectDetection: ProjectEngineDetection;
  readonly machineDiscovery: MachineEngineDiscovery;
  readonly engineStates: readonly EffectiveEngineState[];
  readonly capabilityResults: readonly CapabilityRequestResult[];
  readonly sessionId?: string;
}

export interface ContextCapabilityEntry {
  readonly id: string;
  readonly version?: string;
  readonly title?: string;
  readonly provider?: { kind: string; identity: string };
  readonly availability?: { state: string; reason: string; prerequisites: readonly string[] };
  readonly permissions?: readonly { kind: string; scope: string; rationale: string }[];
  readonly compatibility?: { engineVersions?: string; runtime?: string; notes?: string };
  readonly reversibility?: { kind: string; notes: string };
  readonly resolved: boolean;
  readonly reason?: string;
}

export interface GamingModelContext {
  readonly schemaVersion: "gamos/model-context@1";
  readonly generatedAt: string;
  readonly workspaceRoot: string;
  readonly intent: {
    readonly requestKinds: readonly IntentRequestKind[];
    readonly mentionedEngines: readonly MentionedEngine[];
    readonly confidence: IntentClassification["confidence"];
  };
  readonly project: {
    readonly isProject: boolean;
    readonly root: string;
    readonly identity?: string;
    readonly detected: readonly {
      readonly family: EngineFamily;
      readonly evidence: readonly string[];
      readonly rawVersion?: string;
    }[];
    readonly nonProjectReason?: string;
  };
  readonly engines: readonly {
    readonly family: EngineFamily;
    readonly state: EffectiveEngineState["state"];
    readonly versionMatch?: boolean;
    readonly rawVersion?: string;
    readonly reason?: string;
  }[];
  readonly discovery: {
    readonly discoveredAt: string;
    readonly host: { platform: string; arch: string };
    readonly recordVersion: string;
  };
  readonly capabilities: readonly ContextCapabilityEntry[];
  readonly sourceFiles: readonly string[];
  readonly provenance: {
    readonly observedVia: readonly string[];
    readonly engineObservations: number;
    readonly capabilityObservations: number;
    readonly projectEvidenceCount: number;
  };
}

/**
 * Builds the `gamos/model-context@1` document the selected model receives.
 * Every field comes from the supplied observations; nothing is invented. The
 * builder FAILS CLOSED when an engine state names a family absent from the
 * machine discovery — a fabricated "available" engine can never reach the model.
 */
export function buildGamingModelContext(observations: GamingContextObservations): GamingModelContext {
  const { projectDetection, machineDiscovery, engineStates, capabilityResults } = observations;

  for (const state of engineStates) {
    const machineEntry = machineDiscovery.engines.find((e) => e.engineFamily === state.engineFamily);
    // "unavailable"/"unknown" for an undiscovered family is a REAL observation
    // (the absence was probed). A state claiming "available" without an
    // installed machine entry is fabrication — fail closed.
    if (state.state === "available" && (machineEntry === undefined || !machineEntry.installed)) {
      throw new Error(
        `GAMOS/MODEL-CONTEXT: engine state for ${state.engineFamily} is not backed by a machine-discovery observation (fail closed — never fabricate engine availability)`,
      );
    }
  }

  const detected = projectDetection.detected.map((d) => ({
    family: d.engineFamily,
    evidence: d.evidence,
    ...(d.rawVersion !== undefined ? { rawVersion: d.rawVersion } : {}),
  }));
  const sourceFiles = [...new Set(projectDetection.detected.flatMap((d) => [...d.evidence]))];

  const engines = engineStates.map((state) => {
    const machineEntry = machineDiscovery.engines.find((e) => e.engineFamily === state.engineFamily);
    return {
      family: state.engineFamily,
      state: state.state,
      ...(state.versionMatch !== undefined ? { versionMatch: state.versionMatch } : {}),
      ...(machineEntry?.rawVersion !== undefined ? { rawVersion: machineEntry.rawVersion } : {}),
      ...(state.reason !== undefined ? { reason: state.reason } : {}),
    };
  });

  const capabilities: ContextCapabilityEntry[] = capabilityResults.map((result) => {
    if (result.ok && result.record) {
      const record = result.record;
      return {
        id: record.id,
        version: record.version,
        title: record.title,
        provider: { kind: record.provider.kind, identity: record.provider.identity },
        availability: {
          state: record.availability.state,
          reason: record.availability.reason,
          prerequisites: record.availability.prerequisites ?? [],
        },
        permissions: record.permissions.map((p) => ({ kind: p.kind, scope: p.scope, rationale: p.rationale })),
        compatibility: { ...record.compatibility },
        reversibility: { kind: record.reversibility.kind, notes: record.reversibility.notes },
        resolved: true,
      };
    }
    const error = result.error;
    return {
      id: error?.requestedId ?? result.request.id,
      ...(error?.requestedVersion !== undefined || result.request.version !== undefined
        ? { version: error?.requestedVersion ?? result.request.version }
        : {}),
      resolved: false,
      reason: error?.reason ?? "capability resolution failed without an error record (fail closed)",
    };
  });

  return {
    schemaVersion: "gamos/model-context@1",
    generatedAt: observations.now,
    workspaceRoot: observations.workspaceRoot,
    intent: {
      requestKinds: observations.classification.requestKinds,
      mentionedEngines: observations.classification.mentionedEngines,
      confidence: observations.classification.confidence,
    },
    project: {
      isProject: projectDetection.isProject,
      root: projectDetection.root,
      ...(detected.length > 0 ? { identity: projectDetection.detected[0]!.projectName } : {}),
      detected,
      ...(projectDetection.nonProjectReason !== undefined ? { nonProjectReason: projectDetection.nonProjectReason } : {}),
    },
    engines,
    discovery: {
      discoveredAt: machineDiscovery.discoveredAt,
      host: { ...machineDiscovery.host },
      recordVersion: machineDiscovery.discoveryVersion,
    },
    capabilities,
    sourceFiles,
    provenance: {
      observedVia: ["project-probes", "machine-discovery", "capability-registry"],
      engineObservations: machineDiscovery.engines.length,
      capabilityObservations: capabilityResults.length,
      projectEvidenceCount: sourceFiles.length,
    },
  };
}
