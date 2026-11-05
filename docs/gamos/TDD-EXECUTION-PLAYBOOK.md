# Gamos TDD Execution Playbook

This playbook is binding for every implementation PR. Normative phase scope,
dependencies, work-package IDs, gate IDs, phase status and completion rules live
only in docs/gamos/ROADMAP.json.

## 1. Autonomous delivery rule

The Gamos TL owns sequencing, technical decisions inside frozen contracts,
integration, acceptance and phase promotion. Workers do not pause for product
owner confirmation between milestones. When dependencies are complete, the
roadmap validator reports the next phase as ready; the TL activates it and
allocates work without asking the user.

Seek explicit authorization only where an actual authority boundary requires
it: ZCode permission prompts; the user's target-platform entitlement for
publishing; explicit user/provider authorization for live money movement; or
repository CODEOWNER/ruleset governance review. These are not routine phase
approvals.

## 2. Mandatory TDD sequence

1. **RED — specify first.** Add the smallest test that captures intended
   behavior and failure cases. Run it before production changes. It must fail
   because the behavior is missing or the assertion is violated. A syntax,
   import, setup, environment or test-runner error is not valid RED evidence.
2. **GREEN — implement minimally.** Add the smallest production change that
   makes the new test pass. Avoid broad speculative abstractions ahead of a
   tested use case.
3. **HARDEN — reject bad states.** Add invalid-input, unknown-version,
   missing-prerequisite, wrong-engine, unavailable-capability,
   permission-denied, unauthenticated, cancellation, retry/idempotency and
   security tests as appropriate.
4. **INTEGRATE — test the real authority.** Run the feature against the actual
   ZCode service, plugin system, Dynamic Workflow runtime, native engine,
   browser or platform service it claims to integrate with.
5. **REGRESSION — preserve the product.** Run focused suites, relevant package
   tests, architecture/governance checks and affected inherited ZCode journeys.
6. **EVIDENCE — make the claim reproducible.** Commit the test-first record:
   RED and GREEN commits, exact commands, test names, runner/environment,
   workflow run URL, outcomes, artifact paths and SHA-256 values.

A PR is not TDD-complete merely because tests exist at merge time. The test-first
commit and observed RED result must be reviewable. When a constrained workflow
cannot retain a separate RED commit, include a reproducible RED transcript
against the pre-implementation commit or a test-only commit in the branch.

## 3. Test taxonomy — do not confuse evidence classes

| Test class | What it proves | Permitted doubles |
|---|---|---|
| Unit | Pure logic, parsers, validators and mappings | Deterministic fixtures at a boundary |
| Contract | Schema, version, compatibility, permission and protocol agreement | Controlled fixture documents |
| Integration | Real components are wired correctly | Doubles only for unrelated external systems, clearly identified |
| Engine integration | A real engine installation/project performs the operation | No simulated engine |
| End-to-end | A real user journey through the original app and real services | No mocked success path |
| Performance/reliability | Real resource, timing, recovery and concurrency behavior | No fabricated measurements |

A fixture can prove how a pure adapter behaves with known input. It cannot
prove Unity/Blender/Godot/Unreal is installed, Babylon renders, a plugin launches
safely, a release was published or a payment settled. If an engine or external
service is unavailable in CI, report the capability as unavailable/conditional
and provide a reproducible integration runner. Do not report the milestone gate
as passed until its required real integration evidence exists.

## 4. Evidence required in every implementation PR

- Milestone and work-package IDs from ROADMAP.json.
- Acceptance gate IDs affected and frozen contract clause IDs.
- Exact source files, public APIs, callers and data flow affected.
- RED test name, pre-implementation commit, command and intended failure.
- GREEN commit, exact command and actual passing result.
- Negative/security tests and outcomes.
- Real integration environment (engine/service version, OS, auth mode without
  secrets), or explicit unavailable/conditional state with reason and remedy.
- CI run URL, tested commit SHA, log/artifact paths and SHA-256 hashes.
- Inherited ZCode regression results and any known limitations.

Never store API keys, passwords, bearer tokens, private user data or credentials
in logs, screenshots, evidence JSON or repository files.

## 5. Worker and TL operating model

| Role | Owns | Coordinates with |
|---|---|---|
| TL | Roadmap, shared contracts, review, integration, security, CI, regression, evidence and phase transitions | All workers |
| Worker A | Native engine plugins, engine operations, asset pipelines and engine QA | B for capability contracts; C for artifacts |
| Worker B | Game domain, GameIR conformance, capability registry, discovery, intent and Dynamic Workflow GamePlans | A for engine metadata; C for package identity |
| Worker C | Durable GameOS, package/artifact graph, storage, publishing, player/community platform | A for build artifacts; B for domain/plan APIs |

Use isolated branches gamos/worker-a, gamos/worker-b and gamos/worker-c.
Workers open focused PRs to gamos/development; the TL integrates after
source-level review and required CI. No worker commits directly to main.
Shared contracts and cross-worker APIs are TL-owned. The TL may keep up to the
configured number of dependency-ready milestones active.

## 6. Phase gate procedure

For each milestone:

1. Read its scope, work packages and required gate IDs from ROADMAP.json.
2. Split work into bounded vertical slices; each slice gets RED tests before
   production implementation.
3. Assign one directly responsible worker. The TL owns cross-cutting contracts.
4. Merge each slice only after focused tests, negative tests and architecture
   checks pass.
5. At milestone end, execute every required gate against the candidate
   integration commit.
6. Create evidence/roadmap/M<n>.json using the evidence template. Every
   required gate must have one passed result that points to a real command,
   CI run and log/artifact evidence.
7. Set that milestone to complete in ROADMAP.json and point to the evidence file,
   tested commit and successful CI run.
8. Run roadmap-self-test and roadmap-check. CI must pass on the updated
   completion commit.
9. Activate the next dependency-ready milestone(s), up to the configured
   parallel limit. Do not wait for user phase approval.

A required gate that fails, is skipped, lacks evidence or ran against a
different tested commit blocks completion. Repair the earliest failing slice
and rerun that gate. Later milestones cannot bypass an earlier failed gate.

## 7. Binding technical invariants

- Reuse ZCode's current agent/task/session/model/provider/plugin/permission/
  workflow infrastructure.
- GameSpec is exactly the pinned PlayLiquid GameIRDocument. Acceptance criteria
  belong in GamePlan/AcceptanceRecord, never as a GameIR field.
- Capability discovery and selection fail closed. Represent available,
  unavailable, conditional, setup-required, authentication-required,
  approval-required and incompatible states explicitly.
- Native engine mutations go through ZCode's permission-gated execution path.
- Plugin UI sandboxing does not sandbox an MCP OS process. Disclose actual
  filesystem, network and environment privileges before activation.
- Use Dynamic Workflow's own script/compiler/runtime/journal for GamePlan.
- PaySwap owns financial intent, routes, authorization, ledger, execution,
  settlement, refunds, disputes and reconciliation.
- No in-memory placeholders for persistent platform services and no fake
  success states.

## 8. Definition of a complete PR

A PR is ready to integrate only when its test-first evidence is credible,
the GREEN implementation is minimal, required negative and integration tests
pass, architecture/governance/roadmap gates are green, and the reviewer can
trace every changed behavior to a roadmap work package and acceptance gate.
