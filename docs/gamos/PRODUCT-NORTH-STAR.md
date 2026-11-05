# Gamos — Product North Star

> Product definition and non-negotiable rules. Milestone scope, status and acceptance gates are authoritative in ROADMAP.json.

---

## 1. Definition

**Gamos is the existing ZCode application, evolved into the main AI interface
through which users create, develop, test, operate, package and publish games.**

We extend ZCode itself. We do not build a new chat application, a replacement
application shell, a second agent runtime, a second model router, a second task
system, a second plugin marketplace or a second tool-execution infrastructure.

## 2. The user's experience (the promise)

A user opens the **existing New Task interface**, describes an intention —
*"make a 3D racing game"*, *"convert my Blender model into a game-ready
asset"*, *"prepare my game for release"* — and Gamos:

- understands the intent, the game project involved, the relevant engines and tools;
- knows which capabilities are available, unavailable, conditional, or require
  installation / authentication / approval;
- composes the required operations across engines and tools with correct
  dependencies, parallelism and verification;
- executes through the **existing ZCode agent runtime** under the **user's
  selected model**;
- verifies the result with real evidence (builds, tests, screenshots, metrics) —
  never a simulated or claimed result;
- can carry the game from creation to a published, playable, monetizable world.

## 3. The three problems Gamos must solve

| Problem | Gamos answer |
|---|---|
| **A. Professional game development uses several disconnected tools** (Unity, Blender, asset tools, build tools, deployment) | Unify them through the plugin architecture and a capability registry, inside one harness |
| **B. Creating a game and distributing it are disconnected** | Build, share, play and monetize through the Gamos/PlayLiquid-compatible gaming platform and real PaySwap payment services |
| **C. General-purpose harnesses don't understand game production** | Gaming-domain knowledge, engine-native integrations, specialized Skills, context discovery and multi-step orchestration |

The desired outcome: Gamos is **significantly more efficient at game
development** than a general-purpose harness with an equivalent collection of
disconnected plugins.

## 4. Non-negotiable product rules

1. **ZCode remains the application.** Original functionality stays reachable and
   operational. Inherited features may be extended or preserved — never removed,
   hidden or simplified to make room for Gamos features.
2. **The original New Task composer is authoritative.** Every control stays
   (project/model selection, collaboration modes, thinking controls,
   attachments, context references, slash commands, mentions, send/stop, draft
   persistence, queue behavior, Browser and Terminal).
3. **One authority per responsibility.** Model selection/credentials: ZCode
   provider system. Agent execution: ZCode runtime. Tasks/sessions: ZCode
   session system. Permissions: ZCode permission system. Plugin lifecycle: ZCode
   plugin system. Gaming semantics: Gamos domain (PlayLiquid/GameIR-aligned).
   Engine state: the engines themselves. Payments: PaySwap.
4. **Engines remain authoritative** for their project/scene state; Gamos keeps
   only indexes and projections.
5. **No simulated integrations.** Unsupported capabilities return explicit
   *unavailable / not configured / conditional* states. Never a fake engine
   connection, fabricated project, fake build result, or pretend payment route.
6. **Every important operation is observable** — intent, target, provider,
   capability, inputs, permission decision, status, outputs, errors,
   verification, artifacts.

## 5. Authority model (who decides what)

| Authority | Owner |
|---|---|
| Reasoning | The user's selected model |
| Execution | The existing ZCode agent runtime |
| Engine/project state | Unity, Blender, Babylon, Godot, Unreal — each for its own projects |
| Gaming semantics | Gamos domain layer (reusing PlayLiquid/GameIR contracts where correct) |
| Financial execution | PaySwap |

## 6. What "complete" means (final acceptance, abridged)

- The original application still functions as ZCode, with all inherited features operational.
- Gaming work happens through the existing New Task interface and the real plugin architecture.
- Unity, Blender, Babylon, Godot and Unreal have functional, verifiable native integrations.
- Multi-engine intentions are composed and executed across engine boundaries.
- Game behavior is validated with real evidence, not model claims.
- Real game artifacts can be published and played by other users through real platform flows.
- PaySwap provides real existing / conditional / opportunity payment routes.
- The product builds, installs, launches, updates safely and passes the
  inherited plus Gamos regression suites.

The full, binding milestone scope, dependencies, status and acceptance criteria
are maintained only in `ROADMAP.json` (M0–M7). This document defines the product
intent and invariants; it does not maintain a second milestone plan.
