# Gamos M2 — Unity, Blender and Babylon Real Engine Integrations

> **Authority note (binding):** This document is a persisted execution
> directive/handoff. It is subordinate to `docs/gamos/ROADMAP.json` (the sole
> milestone authority), the frozen contracts under `docs/gamos/contracts/`,
> and the repository's governance controls. It creates no competing milestone
> status or acceptance criteria. Gate IDs, meanings and scope come from
> `ROADMAP.json`. Received 2026-11-07; starting HEAD
> `a8da3bf41e5a82b6987dcb4dd4ebfcf2de0418de` on `gamos/development`.

**Assignment:** Complete M2 in `payswapdotorg/Gamos-2.0` using the existing TL + Worker A/B/C team, strict TDD, real integrations and repository-governed evidence. The TL owns architecture, shared interfaces, integration, security, CI and milestone completion. The TL must be able to execute this assignment without returning to an architect for routine technical decisions.

## 1. Authority and repository state

The repository is the only source of truth.

Normative authority:

1. `docs/gamos/ROADMAP.json` is the sole authority for milestone scope, status, dependency order, owners and acceptance gates.
2. Frozen contracts under `docs/gamos/contracts/` define the interfaces and security boundaries.
3. Actual source code, callers, tests, CI and recorded runtime evidence establish what is implemented.
4. Other documents—including this handoff—are subordinate execution guidance. They must not create competing milestone status or acceptance criteria.

Before implementation, persist this assignment in the repository under an appropriate `docs/gamos/` handoff or execution-plan location. Treat it as subordinate to `ROADMAP.json`. Do not use this chat, worker messages or implementation summaries as evidence of completion.

**Verified starting point:**

- Integration branch: `gamos/development`
- Starting HEAD: `a8da3bf41e5a82b6987dcb4dd4ebfcf2de0418de`
- Pristine upstream branch: `main`
- Pinned upstream baseline: `a9fe401eede6e6e5e01be9048679c206fe6f02d9`
- M1: `complete`, with six passed gates and committed evidence.
- M2: `planned`, dependency M1 complete, no completion evidence.
- Planned additive package paths:
  - `apps/zcode-cli/packages/unity-engine-plugin`
  - `apps/zcode-cli/packages/blender-engine-plugin`
  - `apps/zcode-cli/packages/babylon-engine-plugin`

Start from the latest `gamos/development`, not `main`. Reconfirm the branch head, clean integration state, governance checks and roadmap readiness before activating M2. Keep `main` at the pinned upstream baseline. Never force-push, rewrite the M1 history or bypass protected-surface governance.

Once the preflight succeeds, activate M2 by updating **only its status in `ROADMAP.json`** to the appropriate active state. Do not change its frozen scope or acceptance gates merely to make implementation easier.

## 2. M2 objective and boundaries

M2 delivers first-party Unity, Blender and Babylon integrations through the original ZCode plugin, MCP, agent-tool, permission and Browser infrastructure.

At the end of M2:

- A real Unity installation and project can be discovered, inspected, modified and verified through supported native interfaces.
- A real Blender scene can be manipulated through typed operations, saved, rendered and verified, with usable live and headless paths.
- A real Babylon project can be developed, built and run, with the actual running experience inspected through the original ZCode Browser.
- The three plugins are installable and manageable through the existing ZCode plugin lifecycle.
- Capability selection, availability, provenance, process trust, permission checks, cancellation and artifact evidence are operational rather than merely documented.

### Explicitly out of scope

Do not expand M2 into:

- Godot or Unreal integrations — M4.
- Blender-to-Unity or Blender-to-Babylon asset pipelines — M3.
- Game QA, visual regression and performance optimization — M5.
- GameOS, durable publishing, creator/player experiences — M6.
- Multiplayer, monetization, payments or PaySwap financial execution — M7.

Do not introduce a second application shell, model router, agent runtime, session/task store, plugin marketplace, permission system, scheduler, workflow compiler or journal.

Preserve the original ZCode New Task composer, model/provider selection, sessions, Browser, Terminal, Review, marketplace, plugin lifecycle, Dynamic Workflow runtime, CLI, Web and Desktop behavior.

## 3. Frozen architecture and contracts

The following contracts are binding. Read the actual current files before implementation:

| Contract | M2 responsibility |
|---|---|
| `02-capability-registry.md` | `gamos/capability@2`; full execution-safety metadata; fail-closed registration and resolution; existing agent tool dispatch. |
| `03-engine-plugin-capability-metadata.md` | `gamos/engine-plugin@2`; existing ZCode plugin lifecycle; engine metadata; MCP and optional UI plugin surfaces. |
| `04-project-context-and-engine-discovery.md` | Real machine-local engine discovery; engine-specific version parsers; machine-neutral shared project metadata. |
| `06-permission-and-approval-mapping.md` | Native mutations through existing ZCode permission-gated agent execution. |
| `07-local-vs-remote-capability-availability.md` | Honest availability, prerequisites, unavailable reasons and approved substitutions. |
| `08-artifact-and-evidence-contracts.md` | Real artifacts, hashes, exact engine versions, reproducibility commands and session linkage. |
| `09-plugin-trust-and-provenance.md` | Exact provenance, process authority, installation disclosure and MCP security. |

The existing `packages/gamos-domain` package remains the pure gaming-domain authority. It must not start processes, open sockets, become a tool bus or own execution state.

Engine plugins belong under `apps/zcode-cli/packages/`, following the actual upstream plugin conventions and package lifecycle. Before choosing manifest files, entry points, exports, build scripts or registration locations, inspect the existing plugin source and its manifest interpreter. Do not assume a root-level `plugin.json` or invent a new manifest format.

The plugin metadata must follow `gamos/engine-plugin@2`; its declared capability IDs must resolve to complete records in the central registry. Capability contract versions are not engine versions: engine compatibility must use the engine-family grammar from Contract 04, not a universal SemVer assumption.

## 4. Mandatory preflight — provenance contract conformance

**Owner: TL + Worker B. Blocking prerequisite for registering the first M2 engine plugin.**

The source review found a discrepancy between the frozen provenance contract and the exported implementation types:

- `packages/gamos-domain/src/domain/capability-registry.ts`
- `packages/gamos-domain/src/domain/plugin-trust.ts`
- `docs/gamos/contracts/02-capability-registry.md`
- `docs/gamos/contracts/09-plugin-trust-and-provenance.md`

Contract 09 defines `gamos/provenance@2`, including:

- Publisher values `zcode-official`, `gamos-tl` and `community`.
- A structured source identifying either a marketplace artifact or a repository, commit and path.
- Execution surfaces and applicable review information.
- Review references for community MCP-bearing plugins.

The inspected exported implementation types use different publisher values and a less specific source representation. The TL must establish whether a complete canonical adapter already exists. If it does not, correct the implementation through TDD before adding engine-plugin registrations.

Required tests:

1. Canonical valid provenance records are accepted and retained without losing source, commit, path, publisher or surface information.
2. Invalid publisher values are rejected.
3. Missing repository commit/path or marketplace version/hash is rejected where required.
4. Missing provenance is rejected.
5. Community MCP provenance without the required review reference is rejected.
6. Declared execution surfaces must match the actual packaged content.
7. An unresolvable provenance reference produces an explicit disabled/rejected state.
8. Capability and engine-plugin records consume the same canonical provenance semantics.

Do not simply weaken Contract 09 to fit the existing types. It is hash-protected. If the frozen contract genuinely requires revision, use the complete authorization, rebaseline, TL review, CODEOWNERS and ruleset process. Never alter governance control hashes or frozen contracts informally.

Keep the historical M1 evidence intact. If this audit exposes a material M1 conformance defect, record the finding and its remediation explicitly in the repository rather than rewriting the history or silently relabelling old evidence.

## 5. Work packages and ownership

Use the existing isolated worker branches:

- `gamos/worker-a`
- `gamos/worker-b`
- `gamos/worker-c`

Merge work only through TL-reviewed PRs into `gamos/development`.

### M2.1 — Unity native integration

**Owner: Worker A**

Deliver the first real Unity vertical slice.

Required work:

- Detect actual Unity Editor installations and supported executable locations. Do not infer editor availability merely from `ProjectSettings/ProjectVersion.txt`.
- Inspect a real Unity project, its project version, relevant structure and supported capabilities.
- Implement typed, narrowly scoped project/scene inspection and modification operations.
- Execute supported operations through real Unity editor or batch interfaces.
- Build or test the real project and verify the result using Unity's actual output or test mechanisms.
- Capture exact Unity version, invocation, exit status, project identity, changed files and artifact hashes.

Adversarial cases must include:

- Editor missing, unsupported or unparseable version.
- Project marker present but editor absent.
- Project root invalid or changed between discovery and invocation.
- Paths escaping the selected workspace.
- Permission denied.
- Display server required but unavailable.
- Timeout, cancellation, interrupted operation and partial output.
- Build/test failure and artifact verification failure.

A Unity project marker alone is not integration success. At least one real project must undergo a real modification and verification through an actual supported Unity editor/batch execution path.

### M2.2 — Blender typed operations

**Owner: Worker A**

Deliver a real Blender operation bridge with consistent contracts for live and headless operation.

Required work:

- Discover the actual Blender executable and version.
- Detect real `.blend` project files and inspect their contents.
- Define typed, schema-validated operations for scene/object manipulation.
- Use a controlled, reviewed Blender bridge or add-on for engine-side operations. A trusted internal Python implementation may be used behind that bridge, but arbitrary model-authored Python must not become an unreviewed execution shortcut.
- Make the same typed operation contract usable in interactive and headless execution.
- Save the modified `.blend` file, render a real image and export a real artifact.
- Verify the saved scene and rendered/exported output rather than trusting a successful process exit alone.

Adversarial cases must include:

- Blender missing or unsupported version.
- Invalid or corrupt `.blend` file.
- Missing scene/object/material.
- Invalid transforms and unsupported operation parameters.
- Path traversal and workspace escape.
- Display/headless availability mismatch.
- Permission denial, cancellation and partial save.
- Render/export failure and hash mismatch.

Acceptance requires a real scene manipulation, save, render and verification. A mocked render or a generated image unrelated to a real Blender execution does not count.

### M2.3 — Babylon runtime integration

**Owner: Worker A**

Deliver a typed Babylon project/runtime bridge that uses the actual Node/Babylon toolchain and the original ZCode Browser.

Required work:

- Discover Babylon projects using real project metadata and dependencies.
- Probe actual Node and Babylon toolchain versions.
- Implement typed project inspection, build and run operations using the existing agent execution and permission path.
- Make project scripts and runtime commands explicit and inspectable. Do not silently execute arbitrary scripts inferred from model text.
- Start the real project and expose its actual runtime URL.
- Verify that URL in the original ZCode Browser, including actual rendered content and at least one meaningful behavior assertion.
- Capture real build output and runtime evidence with hashes and reproducibility metadata.

Adversarial cases must include:

- Missing Node/Babylon dependency.
- Incompatible Node or toolchain version.
- Malformed project metadata.
- Missing or unsafe package scripts.
- Port conflict and server startup failure.
- Network restriction and dependency-fetch permission denial.
- Browser navigation failure, blank render or incorrect page content.
- Runtime crash, cancellation and stale server process.

A successful TypeScript build or a Playwright-only browser test is not sufficient. The ZCode Browser must inspect the real running Babylon experience.

### M2.4 — Capability and registry integration

**Owner: Worker B**

Coordinate with Worker A and TL to publish the canonical capabilities for all three engines.

Required work:

- Complete the provenance preflight in Section 4.
- Define each engine's capability IDs, versions, input schemas, output schemas, permissions, provider identity, prerequisites, compatibility, reversibility, idempotency, timeout, cancellation and verification metadata.
- Ensure every plugin-declared capability resolves to a complete central registry record.
- Keep engine version predicates family-specific.
- Make availability reflect actual discovery and runtime conditions.
- Ensure unknown, unsupported, incompatible or unavailable operations fail closed with an explicit reason and remediation.
- Ensure meaningful engine/provider/capability substitutions require disclosure and approval through the existing ZCode approval flow.
- Provide model-facing metadata through the existing agent tool/MCP registration path.

Capability IDs are append-only once published. Do not redefine an existing ID to mean a different operation. Breaking capability semantics require a new version.

Do not create a new dispatch bus or put engine processes inside `packages/gamos-domain`.

### M2.5 — Trust, permissions, lifecycle and integration security

**Owner: TL**

Worker C owns the adversarial test matrix and independent evidence audit, under TL direction. Worker C must not start M6/GameOS work as part of this assignment.

Required work:

- Verify actual ZCode plugin installation, update, disable and load behavior from source.
- Prove the three plugins are handled by the existing plugin lifecycle.
- Verify package/archive hashes at install and update.
- Verify provenance resolution and explicit failure when provenance cannot be resolved.
- Verify MCP process disclosures accurately describe actual filesystem, network and environment privileges.
- Verify community MCP first-shipped env minimization and working-directory containment wherever applicable.
- Ensure the user-facing disclosure appears before activation.
- Verify that capability-invocation approval is not described as sandboxing or constraining the MCP OS process.
- Verify every native engine mutation uses the existing permission-gated agent execution path.
- Test denial, cancellation, timeout, retry and partial-failure behavior.
- Verify no engine plugin can bypass the registry, approval or ZCode plugin lifecycle.

**Security boundary:** A renderer UI plugin sandbox applies only to renderer-side UI. An MCP process is an OS process with the authority of its execution context. Do not call MCP processes "sandboxed." Disclose the actual filesystem, network and environment reach. A tool invocation approval is not an OS-process privilege boundary.

## 6. Required implementation behavior

Every engine capability must have:

- A typed input schema validated before execution.
- A typed output schema validated after execution.
- A resolved engine/provider identity.
- Real machine/project discovery.
- An explicit availability state and reason.
- A declared permission requirement.
- A bounded timeout and cancellation behavior.
- An idempotency/reversibility statement.
- A verification method proving the result.
- Artifact references with exact hashes where applicable.

Process invocation must be designed defensively:

- Use argument arrays and avoid shell interpolation.
- Resolve executables using trusted discovery rather than model-provided command paths.
- Constrain project/workspace paths and reject traversal.
- Use explicit working directories.
- Bound execution time and output volume.
- Propagate cancellation and terminate child processes appropriately.
- Return nonzero and structured errors on failed verification.
- Do not turn partial or failed operations into successful workflow results.

Native mutations must remain behind ZCode's existing permission-gated tool execution. The plugin must not create background daemons or direct mutation paths that bypass this gate.

The GamePlan remains an existing ZCode Dynamic Workflow script. Extend the M1 capability integration only as necessary for M2. All execution, cancellation, recovery and history continue to use the existing compiler/runtime and `dwf_*` journal. Do not introduce a second scheduler or journal.

## 7. Mandatory TDD discipline

Every vertical slice follows this exact order:

1. **RED:** Write the failing test before production implementation. Run it and preserve the failure caused by the missing behavior.
2. **GREEN:** Implement the smallest production change that passes the test.
3. **HARDEN:** Add malformed-input, unavailable-state, compatibility, permission, cancellation, retry, timeout, provenance and security cases relevant to the slice.
4. **INTEGRATE:** Exercise the real plugin system and actual engine/runtime authority.
5. **REGRESSION:** Run focused suites, affected inherited ZCode suites, architecture and governance checks.
6. **EVIDENCE:** Commit reproducible records and artifact hashes.

Each work package must preserve:

- RED commit SHA.
- GREEN commit SHA.
- Test names and exact commands.
- Actual exit codes and relevant output.
- Negative/security test results.
- Real engine/runtime version and runner environment.
- Integration artifact paths and SHA-256 values.
- CI run identifiers and URLs.

A test that fails because of a syntax error, missing import, bad test setup or broken runner is not valid RED evidence.

Fixtures are permitted for isolated unit and parser tests only. They cannot prove Unity execution, Blender scene manipulation, Babylon rendering, plugin installation, runtime execution, permission enforcement or browser integration.

## 8. Real engine test environments

M2's first three gates explicitly require real integrations. The TL must establish an actual runner strategy rather than weaken these gates.

- Unity: provide a runner with an actual supported Unity Editor installation and required licensing/configuration. Protect license material and credentials; never commit them.
- Blender: provide a runner with an actual Blender executable. Run the real save/render/export integration.
- Babylon: use a real Node/Babylon project and an actual running browser environment. Verify through ZCode Browser.

Use pre-provisioned or otherwise approved real engine installations. Do not make the application silently download/install Unity, Blender or other engine executables. Engine SDK and project dependency fetches must use the declared network permission and record relevant artifact hashes.

The absence of a real engine is an honest `unavailable` or `blocked` state. It is not a passing integration gate. Do not substitute a mock, fixture, fake executable, hardcoded version or fabricated screenshot.

The TL may separate deterministic unit jobs from engine-backed integration jobs, but the milestone cannot become complete until every required real integration gate has passed.

## 9. Required end-to-end journeys

In addition to isolated engine tests, build a real user journey for each engine through the existing ZCode experience.

Each journey must:

1. Launch the original ZCode application and use the original New Task composer.
2. Use the selected model/provider through the existing routing path.
3. Select a real workspace and gather provenance-backed project and machine context.
4. Resolve the requested typed engine capability through the registry.
5. Surface the required existing ZCode permission/approval interaction.
6. Invoke the installed engine plugin through the existing plugin/MCP system.
7. Perform the actual engine operation.
8. Verify the actual engine result and collect its artifact evidence.
9. Record the result in the existing conversation/workflow/session history.
10. Demonstrate honest error, denial or unavailable behavior for a negative path.

Use a deterministic local model endpoint only where necessary for repeatable automation, and disclose that clearly. Such an endpoint may drive a real app-side integration test; it may not simulate successful engine execution, fake an artifact or replace the real engine. Do not claim live-LLM authorship where none occurred.

Retain the existing original-app regression journey and the inherited ZCode E2E coverage. M2 must not regress the M0/M1 behavior.

## 10. M2 acceptance gates

The following five gate IDs and meanings come from `docs/gamos/ROADMAP.json`. Do not rename, merge, weaken or replace them.

| Gate | Required proof |
|---|---|
| **M2-G1 — Unity real integration** | A real Unity installation/project is discovered, modified and verified by actual editor/batch build or tests, with versioned and hashed evidence. |
| **M2-G2 — Blender real integration** | A real Blender scene is manipulated through typed operations, saved, rendered and verified; arbitrary Python is not an unreviewed shortcut. |
| **M2-G3 — Babylon real integration** | A real Babylon project builds/runs and the ZCode Browser verifies the actual runtime URL, rendered content and behavior. |
| **M2-G4 — Plugin lifecycle and security** | Install/update/disable/provenance/hash, MCP process disclosure, permission denial and cancellation are tested through the existing ZCode plugin lifecycle. |
| **M2-G5 — Cross-plugin regression** | All three engines pass contract/integration suites and applicable inherited ZCode build, permission, marketplace, session and architecture regressions. |

A gate passes only when its required behavior is proved by actual tests and evidence. No gate passes because a package compiles, a manifest validates, a worker reports completion or a CI workflow unrelated to the gate is green.

## 11. CI and regression requirements

Extend the repository's existing governance and testing setup without weakening it.

Required checks include:

- Governance verifier and protected-surface hash validation.
- Governance tamper-rejection tests.
- Upstream architecture check.
- Roadmap self-tests and canonical roadmap validator.
- All focused `gamos-domain` tests.
- Engine plugin typecheck/build/lint and contract tests.
- Real Unity, Blender and Babylon integration jobs.
- Plugin install/update/disable and provenance/security tests.
- Permission-denial and cancellation tests.
- Original ZCode regression coverage applicable to build, session, Browser, Terminal, Review, marketplace, plugin and application lifecycle.
- Architecture and preservation checks.

Engine-backed checks must actually run on runners with the required engines installed. Preserve runner identity, OS, runtime versions and engine versions in the evidence. Do not make a passing unit-test job stand in for a missing engine runner.

The new CI must execute on the relevant M2 PRs and completion candidate. Do not replace or make optional any existing required governance status check.

## 12. Evidence and milestone completion

The canonical completion evidence file is:

`evidence/roadmap/M2.json`

Use the schema and requirements in `docs/gamos/ROADMAP.json` and `evidence/roadmap/PHASE-EVIDENCE-TEMPLATE.json`.

It must contain:

- `phase_id: "M2"`
- Passed status.
- Full tested commit SHA.
- Workflow-run head SHA.
- Workflow run ID, URL and successful conclusion.
- Completion timestamp.
- Runner, OS, runtime and real engine environment details.
- One passed gate result for each of M2-G1 through M2-G5.
- Exact commands, result summaries and committed evidence paths.
- SHA-256 for each evidence artifact.

Every gate must have at least one committed evidence path and a matching nonempty hash entry. Keep path/hash arrays aligned. The roadmap validator must be able to recompute each hash against the committed file bytes.

Store real integration logs, screenshots, build/render outputs or reproducibility records under an appropriate `evidence/phase-*/` path. Do not commit large generated engine builds or machine secrets into Git merely to make evidence appear complete; use the repository's existing CI artifact mechanism where appropriate, with committed evidence records that identify the exact artifact and hash.

Update `IMPLEMENTATION-STATUS.md` only as a subordinate status summary. The milestone state and completion evidence pointer live only in `ROADMAP.json`.

Before declaring M2 complete:

1. Verify the source and callers for all three plugin integrations.
2. Run all five M2 gates and inspect their actual CI results.
3. Confirm the tested commit and workflow head refer to the exact tested source tree.
4. Commit the M2 evidence bundle.
5. Set M2 to `complete` in `ROADMAP.json` and link its completion evidence.
6. Run `roadmap-self-test.mjs` and `roadmap-check.mjs`.
7. Ensure the required CI is green on the completion state, following the repository's established evidence/merge pattern.
8. Confirm `main` remains the pinned upstream mirror.

Do not mark M2 complete while any real engine integration is unavailable or unevidenced.

## 13. Integration sequence and worker coordination

The TL may run independent engine work in parallel, but must freeze shared plugin and capability interfaces before workers implement against them.

Suggested sequence:

1. TL establishes package conventions, provenance conformance, registry interfaces and the real plugin lifecycle path.
2. Worker B supplies the canonical capability/provenance records and contract tests.
3. Worker A implements the Unity, Blender and Babylon vertical slices on isolated branches.
4. Worker C builds the adversarial plugin-trust, permissions, lifecycle and evidence checks; independently audits each engine's proof.
5. TL reviews each PR at source level, checks the real callers and runtime path, integrates and reruns regression.
6. TL completes the five gates and promotes M2 only after the canonical validator and required CI pass.

Workers must not edit shared interfaces independently without TL coordination. Prefer separate PRs for Unity, Blender, Babylon and shared registry/security changes so the reviewer can identify and isolate failures.

Worker C's temporary M2 assignment is test/security/evidence support only. It does not activate M6 or authorize GameOS, publishing or financial work.

## 14. Definition of done

M2 is done only when:

- All three actual engine integrations are implemented and exercised.
- All three plugins use the existing ZCode plugin/MCP infrastructure.
- Registry metadata, provenance and availability match the frozen contracts.
- Native mutations follow the existing ZCode permission path.
- MCP process privileges are honestly disclosed.
- Plugin install/update/disable, hash verification, permission denial and cancellation are tested.
- Real engine artifacts and reproducibility evidence are committed or securely retained and hash-bound.
- All five M2 gates pass.
- Applicable inherited ZCode behavior remains operational.
- Governance, architecture, focused domain and M2 integration CI pass.
- `ROADMAP.json` records M2 completion with the canonical evidence pointer.
- `main` remains pristine.

After M2 completion, let the canonical roadmap validator derive the next dependency-ready milestones. M3 and M4 may then become ready; the TL may activate no more than the roadmap's configured parallel limit. Do not begin either as part of this M2 assignment.

**Execute autonomously. Do not return for routine architecture approval or milestone permission.** Existing ZCode user permission prompts, target-engine license requirements and protected-repository governance remain binding and cannot be bypassed.
