# Gamos — Final M2 Closure and M3 Implementation Handoff

> **Authority note (binding):** This document is a persisted execution
> directive/handoff. It is subordinate to `docs/gamos/ROADMAP.json` (the sole
> milestone authority), the frozen contracts under `docs/gamos/contracts/`,
> and the repository's governance controls. It creates no competing milestone
> status or acceptance criteria. Gate IDs, meanings and scope come from
> `ROADMAP.json`. Received 2026-11-07; audited starting HEAD
> `0cf1afc7ea335101f068c2e1bf37360dd27f97e6` on `gamos/development`.

**Repository:** `payswapdotorg/Gamos-2.0`  
**Integration branch:** `gamos/development`  
**Audited starting commit:** `0cf1afc7ea335101f068c2e1bf37360dd27f97e6`  
**Upstream baseline:** ZCode v3.17.2, `a9fe401eede6e6e5e01be9048679c206fe6f02d9`  
**Team:** TL + Worker A + Worker B + Worker C  
**Execution:** Strict TDD; autonomous technical decisions; repository is the sole source of truth.

## 1. Binding authority and starting procedure

This assignment is an execution directive, not a new source of milestone authority.

The authority order remains:

1. `docs/gamos/ROADMAP.json` — sole normative authority for milestone scope, dependencies, statuses, work packages and acceptance gates.
2. The frozen Gamos contracts and repository governance controls.
3. Actual source code, callers, tests, CI results and committed runtime evidence.
4. This handoff and other Markdown status documents — subordinate execution guidance only.

Before implementation:

- Fetch the latest `gamos/development` and verify its actual HEAD. The audited starting commit is `0cf1afc7ea335101f068c2e1bf37360dd27f97e6`; do not assume it remains the latest.
- Verify the working tree is clean and no conflicting integration is in progress.
- Read the current roadmap, contracts, authorization ledger, architecture policy, worker briefs and TDD playbook.
- Run the repository's current governance, roadmap and architecture checks.
- Confirm the current governance trust-anchor pin. Do not reuse a superseded pin from earlier M1/M2 reports.
- Keep `main` as the pristine upstream mirror. Never merge Gamos implementation into `main`, force-push, rewrite historical commits or bypass protected-surface governance.

Commit this handoff under `docs/gamos/handoffs/` with a date-appropriate filename. It must explicitly remain subordinate to `ROADMAP.json`.

Do not duplicate milestone statuses or invent new acceptance criteria in this document.

## 2. M2 audit findings — close these before promotion

M2 remains `active`. There is no valid `evidence/roadmap/M2.json` completion bundle yet. The existing evidence does not authorize promotion.

The merged PR #8 is valuable: it documents the no-paid-Unity investigation, records the licensing uncertainty, preserves the blocked state and fixes an earlier CI evidence problem. Preserve this work.

However, close the following issues before accepting the M2 handoff.

### M2-A — Correct the Unity gate-status false-positive path

**Priority: P0.**

Current source:
- `.github/workflows/gamos-m2-e2e.yml`
- `apps/zcode-cli/packages/unity-engine-plugin/test/engine-real-unity.integration.test.ts`

The integration test performs a real-editor preflight and writes an `editorLicensed=true` or `editorLicensed=false` marker. The current workflow status step treats the presence of `editorLicensed=true` as sufficient to write `editor-verified`.

That marker is emitted after preflight, before the later real integration tests complete.

Consequently, a licensed editor can pass preflight, print `editorLicensed=true`, and then fail scene modification, player build or timeout verification. The test job will fail, but the `always()` status step can still write `editor-verified`.

This is an evidence-fidelity defect.

**Required implementation:**

1. Write RED tests for the status classifier before changing it.
2. Capture the actual Unity test-suite exit code independently of `tee` and shell pipeline behavior.
3. Generate or consume machine-readable suite results that distinguish:
   - editor unavailable;
   - editor present but unlicensed;
   - editor present but version-incompatible or otherwise unverified;
   - licensed editor with failed integration;
   - licensed editor with all required real integration tests passed.
4. `editor-verified` is permitted only when:
   - the editor is real;
   - the editor version matches the project fixture's required version;
   - the suite exit code is zero;
   - all required positive real-editor tests passed;
   - no required real-editor test was skipped;
   - actual mutation and build artifacts have been verified.
5. A preflight success alone must never create a passing status.
6. If the suite fails after preflight, record a failed/non-passing state and retain the failure output.
7. If an editor is unavailable or unlicensed, preserve the honest non-passing status. A successful negative-path test is not a passing Unity integration gate.
8. Retain the complete suite output and machine-readable evidence in the uploaded CI artifact.

Add tests for the exact failure case: preflight succeeds and emits `editorLicensed=true`, but a later integration assertion fails. The resulting gate status must not be `editor-verified`.

Test the status writer against all previously identified states, including missing logs, malformed evidence, incomplete suites and contradictory markers.

### M2-B — Make the Unity project/editor version contract exact

**Priority: P1.**

The Unity test fixture's `ProjectSettings/ProjectVersion.txt` pins:

`6000.0.23f1`

with revision:

`ab2b18a5f80dcba39fd8f5ee57b07edc7c0f600f`

The current Unity discovery floor accepts Unity 2022.3 or later, and the test's provisioning message also permits 2022.3+.

That is not sufficiently precise for a project fixture pinned to Unity 6.

**Required implementation:**

- Make the tested editor version and project version agree exactly, including the revision where the official installation metadata exposes it.
- Ensure an incompatible editor is reported as incompatible, not licensed or verified.
- If the team chooses a different supported Unity version, update the project fixture, version contract and tests together.
- Never silently accept an older editor against a project that requires a newer version.
- Add RED tests for version mismatch, missing version metadata and malformed revision information.
- Record the real editor version and revision in the integration evidence.

### M2-C — Complete the no-cost Unity Personal provisioning investigation

**Priority: P0 for M2-G1.**

The maintainer directive is unchanged:

**Do not purchase Unity Pro, Enterprise or any paid Unity license.**

The repository's investigation establishes that Unity Personal is potentially available at zero cost, subject to the actual organization's eligibility. It also establishes that Personal activation uses Unity Hub sign-in; the documented command-line activation procedure is not the Personal activation route.

The exact Unity Software Terms clause covering Personal use on a separate build/CI machine was not retrievable during the investigation.

Do not treat third-party GameCI instructions as Unity licensing authorization.

**Required implementation:**

1. Preserve the eligibility and licensing report under `docs/gamos/UNITY-M2G1-PROVISIONING.md`.
2. Obtain the maintainer's eligibility attestation based on the actual Unity Personal terms. Do not assume the organization qualifies.
3. Verify and record the official Software Terms provisions covering:
   - Personal license eligibility;
   - named-user and machine use;
   - self-hosted build machines;
   - unattended batch builds;
   - whether any proposed CI activation method is permitted.
4. Commit the official source excerpts and source hashes, with retrieval dates.
5. Prefer an existing persistent machine or runner. Do not procure hardware or subscriptions.
6. Use Unity Hub activation with the eligible account only where the terms permit the actual arrangement.
7. Keep account credentials, Hub session data and license material outside Git, committed evidence, logs and uploaded CI artifacts.
8. Do not fabricate activation, reuse another user's license, bypass licensing or assume that a runner is licensed because an executable exists.
9. If no compliant zero-cost runner arrangement is available, leave M2-G1 blocked and document the exact missing prerequisite.

The present development sandbox is not suitable for hosting the Editor: the investigation records approximately 3.7 GB free disk, 3.9 GB RAM and no root access, compared with approximately 13 GB peak disk need. Do not retry installation there.

When a compliant licensed runner actually exists, run the real Unity integration suite using the exact compatible editor version. It must prove:

- actual project discovery;
- a real scene mutation;
- before/after scene evidence and hashes;
- successful player build;
- nonempty build artifact and SHA-256 verification;
- process timeout and process-tree termination.

A mocked editor, editor emulation or successful unlicensed negative path cannot satisfy M2-G1.

### M2-D — Prove the complete plugin lifecycle through ZCode

**Priority: P1.**

The three first-party engine plugins are registered through the existing plugin infrastructure, and the M2 journey verifies that they can be enabled through Settings → Plugins, persist their enabled state and become available after application restart.

That is not the complete M2-G4 acceptance requirement.

The existing M2J3 journey primarily proves enablement. It does not, by itself, prove the engine plugins' install, update and disable behavior.

**Required implementation:**

Audit the actual ZCode marketplace, official-plugin registration, install/update and plugin-disable paths. Do not build a parallel lifecycle.

Add tests and real app evidence proving the applicable lifecycle for all three engine plugins:

- Unity Engine;
- Blender Engine;
- Babylon Engine.

The evidence must establish:

1. The official plugin definitions resolve to the correct packages and manifests.
2. The plugin can be installed or provisioned through the existing supported ZCode lifecycle.
3. The package and runtime hashes match the expected manifest/provenance.
4. An update changes to the intended version without retaining stale runtime assets.
5. Disable removes the plugin's effective tool availability from the agent.
6. Re-enable restores the expected tools without duplicating server registrations.
7. Uninstall/removal, where supported by the existing lifecycle, removes the installed state cleanly.
8. Missing or corrupted runtime assets fail closed.
9. Permission denial prevents native engine mutations.
10. Cancellation terminates the relevant operation and does not report false success.
11. Actual MCP process privileges are disclosed separately from permission to invoke a tool.

Use the original ZCode plugin-management UI and APIs. Do not prove lifecycle behavior by directly editing configuration files or manually copying package directories.

If inherited ZCode tests already establish part of this behavior, cite the exact test, source and caller, and add only the missing Gamos-specific assertions. Do not count a generic marketplace test as proof of the engine plugins without verifying that it exercises their manifests and runtime assets.

### M2-E — Complete cross-plugin and inherited regression

**Priority: P1.**

The Unity suite currently runs three real-editor integration tests inside a `describe.skipIf(!realEditorFound)` block. When no real Editor is available, the tests are skipped.

This is an honest unavailable state, but it cannot establish that all three engines passed their real integration suites.

**Required implementation:**

Run the M2 regression candidate on the same exact tested source commit and verify:

- Gamos domain and capability-contract suites;
- Unity unit tests and real-editor tests;
- real Blender integration;
- real Babylon integration;
- all three plugin manifest and lifecycle checks;
- permission approval and denial;
- cancellation and timeout handling;
- original ZCode build and affected inherited application journeys;
- marketplace and session behavior;
- architecture and governance checks.

The M2-G5 evidence must identify every suite, including skipped tests. A skipped Unity integration suite must remain a non-passing Unity integration result.

Do not infer G5 from a green domain-only job or from a successful M2 journey that exercises only part of the engine behavior.

### M2-F — Promote only when all five gates pass

Do not alter M2 scope or gate definitions to make the milestone complete.

When the work above is finished:

1. Run all five canonical M2 acceptance gates.
2. Ensure M2-G1 has positive real licensed-editor evidence.
3. Ensure M2-G4 has complete lifecycle/security proof.
4. Ensure M2-G5 has cross-plugin and inherited regression evidence.
5. Verify the exact tested commit and workflow head.
6. Commit the required evidence records and artifacts with aligned SHA-256 entries.
7. Create `evidence/roadmap/M2.json` from the repository template.
8. Set M2 to `complete` in `ROADMAP.json` only after every required gate is passed.
9. Run the roadmap self-tests and canonical validator.
10. Run required CI on the completion candidate and verify that it is green.
11. Verify `main` remains the pristine upstream baseline.

The current Unity Personal CI investigation and PR #8 must remain in the history. Do not delete, rewrite or downgrade their evidence.

## 3. M3 activation rule

M3 is fully defined in `docs/gamos/ROADMAP.json`, but its dependency is M2.

The roadmap's dependency policy is binding:

- M3 must not become active before M2 is complete.
- A failed, skipped or unevidenced M2 gate blocks dependent milestones.
- A later phase cannot bypass an incomplete dependency.
- The TL may activate dependency-ready phases without routine maintainer approval.
- At most two dependency-ready milestones may be active concurrently.

Therefore:

**While closing M2, prepare M3's contract and implementation plan, but do not begin M3 implementation PRs or change M3 to active.**

Once M2 is complete and `roadmap-check.mjs` reports M3 ready, the TL must activate M3 through the canonical roadmap and begin implementation automatically. Do not return for routine phase approval.

Keep this assignment scoped to M3. Do not start M4 or other downstream milestones as part of this handoff.

## 4. M3 objective and scope

M3 title in the roadmap:

**Cross-engine asset and workflow orchestration.**

M3 must execute real multi-engine workflows with dependencies, parallelism, conflict prevention, cancellation, resume and reproducible artifact evidence.

The complete M3 scope is:

| Work package | Scope | Owner |
|---|---|---|
| M3.1 | Blender-to-Unity export/import and scene integration | Worker A |
| M3.2 | Blender-to-Babylon export/build/runtime pipeline | Worker A |
| M3.3 | Engine-aware GamePlan generation, dependencies, parallelism, resume and cancellation | Worker B |
| M3.4 | Cross-engine artifact manifests, hashes, reproducibility and handoff records | Worker C |
| M3.5 | Parallel-write safety, integration and real end-to-end evidence | TL |

The five roadmap gates are binding:

- **M3-G1:** A real Blender asset is exported, validated, imported into Unity, built and verified with hashed source/output evidence.
- **M3-G2:** A real Blender asset is consumed by a real Babylon project and verified in the actual running Browser experience.
- **M3-G3:** Independent work runs concurrently, dependent work waits, conflicting writes are prevented and outputs integrate deterministically.
- **M3-G4:** Workflow interruption is resumed from the existing journal; cancellation is observable and cancelled steps are never reported successful.
- **M3-G5:** A natural-language request completes across Blender and a target engine without manual repetition, collecting actual build, runtime and artifact evidence.

No M3 gate may be replaced by a unit-test-only or fixture-only equivalent.

## 5. M3 architecture constraints

### 5.1 Preserve the existing authorities

ZCode continues to own:

- the original application and New Task composer;
- the selected model and provider;
- tasks, sessions, permissions and agent execution;
- plugin lifecycle and MCP dispatch;
- Dynamic Workflow authoring, compilation, runtime, governor and journal;
- Browser, Terminal and Review.

Native engines continue to own their project and asset state.

GameSpec remains exactly the pinned PlayLiquid GameIRDocument. Do not add M3 fields to GameIR or GameSpec.

PaySwap remains the financial authority. M3 does not introduce payment, marketplace settlement or monetization services.

### 5.2 Extend Dynamic Workflow; do not build another workflow runtime

Existing implementation to reuse:

- `packages/gamos-domain/src/domain/game-plan.ts`
- `packages/gamos-domain/src/domain/plan-workflow.ts`
- the existing `@zcode/dynamic-workflow` compiler and analyzer;
- the existing `@zcode/dynamic-workflow-runtime`;
- the production workflow driver and durable `dwf_*` journal.

The current GamePlan model already has:

- step IDs;
- capability references;
- dependencies;
- execution constraints;
- `maxConcurrency`;
- deterministic plan hashing.

The current generator already creates topological levels and emits `Promise.all` for independent steps. The existing compiler accepts and analyzes the generated script.

Do not introduce:

- a second scheduler;
- another task or session store;
- a second workflow compiler;
- another execution journal;
- a Gamos-owned workflow runtime;
- a second concurrency governor.

Use the existing Dynamic Workflow runtime's real concurrency, persistence, stop, resume and journal behavior.

### 5.3 Add explicit resource-conflict safety

The current GamePlan does not adequately express which project files, scenes or assets a step reads or writes. M3-G3 cannot be proven until this is addressed.

First inspect the existing frozen contracts and Dynamic Workflow behavior. Then design a versioned, additive M3 resource-claim contract. Do not casually modify a frozen contract or existing GamePlan wire format.

The resource-claim model must distinguish:

- read access;
- write access;
- project-wide or scene-wide mutations;
- individual asset paths;
- generated output paths;
- temporary staging paths.

Required rules:

1. Two read-only steps may run concurrently when their resource claims are compatible.
2. A write must not run concurrently with a read or write that overlaps its declared resource.
3. Conflicting unordered writes must fail closed or be explicitly serialized through a deterministic dependency decision.
4. No silent race resolution or arbitrary registry-order fallback.
5. Resource paths must be canonicalized and confined to the selected workspace.
6. Symlink escapes, traversal, path aliasing and ambiguous ownership must fail closed.
7. Generated outputs must be staged and integrated deterministically.
8. Every step's declared write scope must be enforced by the capability execution path, not merely recorded in a plan.

Prefer explicit plan dependencies where ordering has semantic meaning. If the system automatically serializes a conflict, it must record the ordering decision and reason in workflow evidence.

A conflict test must demonstrate that two concurrent mutations of the same real scene or asset cannot corrupt one another. A test that only verifies a dependency graph in isolation is insufficient.

## 6. M3 asset interchange contract

Worker B and Worker C, coordinated by the TL, must define an additive, versioned cross-engine asset manifest before the production pipelines are implemented.

The manifest is not a replacement for PlayLiquid GameIR and must not become a second asset database.

At minimum, it must capture:

**Identity and provenance**
- manifest schema/version;
- artifact identity;
- source engine and exact version;
- source project/scene identity;
- source asset path and source SHA-256;
- export capability and exporter version;
- source operation/plan identity.

**File integrity**
- output format and media type;
- output path or artifact reference;
- byte length;
- SHA-256;
- dependent texture/material files and their hashes;
- relative paths and dependency references.

**Interchange semantics**
- coordinate system and handedness;
- up axis and forward axis;
- world units and scale;
- origin and applied transforms;
- geometry, normal and tangent availability;
- UV channels;
- material and texture references;
- color-space assumptions;
- skeleton and animation metadata when supported;
- unsupported features and compatibility warnings.

**Target verification**
- target engine and exact version;
- target project identity;
- importer and import settings;
- imported object/resource identity;
- resulting asset paths;
- validation outcome;
- imported asset hash or engine-verified identity;
- build artifact hash;
- evidence paths and evidence hashes.

Reject unknown schema versions, missing mandatory metadata, corrupted hashes, absent dependencies, unsafe paths and unsupported target features.

The manifest must distinguish:

- exported;
- export-validated;
- import-pending;
- imported;
- import-validated;
- built;
- runtime-verified;
- failed;
- cancelled.

A file existing on disk does not prove successful import or runtime use.

Blender currently has real export coverage for formats including FBX and GLB. Unity and Babylon currently have project/build/runtime capabilities, but their M2 plugins do not yet provide the complete cross-engine asset-import operations required by M3.

Use real engine compatibility tests to determine the appropriate format for each destination. FBX is a sensible first candidate for Unity's native importer, and GLB/glTF is a sensible candidate for Babylon's loader, but the actual supported versions, importer behavior and asset fidelity must be verified rather than assumed.

Do not add arbitrary model-authored Python, C#, shell or JavaScript as an import shortcut. Use reviewed, typed operations and bounded execution.

## 7. M3.1 — Blender to Unity pipeline

**Owner: Worker A. TL owns the shared contract and review.**

Implement a real vertical pipeline:

1. Select a real Blender workspace and scene.
2. Inspect and identify the source asset using the Blender plugin.
3. Export the selected asset using a typed Blender operation.
4. Apply and record the declared coordinate, scale and transform settings.
5. Verify the exported file exists, is nonempty and has a valid SHA-256.
6. Generate and validate the cross-engine asset manifest.
7. Transfer the asset into the selected Unity project's permitted import location.
8. Add a reviewed, typed Unity Editor import operation. The current Unity bridge does not provide the complete M3 asset-import capability.
9. Use Unity's real asset-import facilities to import the asset.
10. Verify the imported mesh, object, material, texture and relevant metadata through an actual Unity Editor query.
11. Integrate the imported asset into a real Unity scene or prefab.
12. Save and verify the project mutation.
13. Build the Unity player using the existing typed build path.
14. Verify the actual build artifact, size and SHA-256.
15. Produce a source-to-target handoff record identifying both the exported and imported assets.

Include negative paths for:

- missing Blender;
- missing or incompatible Unity;
- unsupported format;
- missing texture dependency;
- corrupt export;
- hash mismatch;
- unsafe import path;
- incompatible units or transforms;
- missing importer support;
- failed Unity import;
- failed build;
- permission denial;
- cancellation and timeout.

Do not report the pipeline as successful until the Unity Editor has actually imported and verified the exported asset.

## 8. M3.2 — Blender to Babylon pipeline

**Owner: Worker A. TL owns the real Browser acceptance.**

Implement the real asset pipeline:

1. Select a real Blender asset.
2. Export through the Blender plugin using the chosen supported interchange format.
3. Verify the exported artifact and manifest.
4. Transfer the artifact into a real Babylon project.
5. Add a typed Babylon project operation that integrates the asset through the project's supported asset-loading path.
6. Ensure asset references and texture dependencies resolve from the actual project.
7. Build using the project's declared, allowlisted build script.
8. Run the actual project using the Babylon plugin's real runtime operation.
9. Open the running URL in the original ZCode Browser.
10. Verify that the imported asset is actually loaded and visible in the running experience.
11. Verify object identity, geometry/scene presence and relevant material/texture behavior.
12. Capture Browser evidence and artifact hashes.
13. Stop the runtime through the existing project-stop mechanism and verify the process/port has been released.

The current Babylon plugin already supports real project inspection, build, run and stop. The M3 work must extend this real path to import and verify cross-engine assets, not just copy a GLB into a project and claim success.

Negative tests must cover missing asset files, unsupported formats, missing textures, malformed manifests, path escapes, failed builds, unavailable runtimes, Browser verification failure and stop/cancellation failure.

A Vite HTTP 200 response alone is not proof that the asset rendered.

## 9. M3.3 — GamePlan and Dynamic Workflow orchestration

**Owner: Worker B. TL owns runtime integration and shared interfaces.**

Extend the existing plan-generation path.

The plan must represent:

- engine-aware capability selection;
- source and target project context;
- export, validation, transfer, import, build and runtime-verification steps;
- explicit dependencies between those steps;
- independent work eligible for concurrency;
- maximum concurrency;
- resource claims;
- idempotency and retry behavior;
- artifact expectations;
- permission requirements;
- cancellation and resume semantics;
- final acceptance-record references.

The generator must preserve the existing GamePlan identity and deterministic hash behavior.

The generated GamePlan must compile through the existing Dynamic Workflow compiler and execute through the actual existing runtime. Add compiler acceptance tests and runtime acceptance tests.

### Dependency ordering

Tests must prove:

- a dependent import cannot execute before the export is verified;
- a build cannot execute before import validation succeeds;
- runtime verification cannot execute before the build/run prerequisite is satisfied;
- an unavailable engine or unresolved capability blocks execution before dependent work starts;
- an earlier failed step blocks dependent success;
- independent work can run concurrently only when resource claims permit it.

### Concurrency

Use the existing Dynamic Workflow concurrency governor.

Do not create a Gamos-specific parallel worker pool or scheduler.

Test actual concurrency against the real workflow runtime, including:

- two independent read operations;
- two independent writes to distinct outputs;
- two writes to the same output;
- read/write conflicts;
- project-wide scene conflicts;
- explicit dependency ordering;
- deterministic artifact integration.

The same-resource mutation test must demonstrate actual protection, not merely a generated-script ordering assertion.

### Resume

Test interruption after one or more real workflow steps have completed.

Restart or resume the workflow through the existing Dynamic Workflow surface. Verify:

- the existing `dwf_*` journal identifies completed, failed and pending steps;
- completed outputs are verified before being reused;
- completed non-idempotent mutations are not repeated blindly;
- dependent pending work resumes in the correct order;
- resumed outputs match the original verified artifacts;
- no second journal or Gamos recovery database is introduced.

### Cancellation

Cancel a real workflow during an actual engine operation.

Verify:

- the existing ZCode stop/cancellation path receives the request;
- the relevant engine subprocess or runtime is stopped;
- the workflow journal records the terminal cancelled state;
- pending dependent work does not run;
- a cancelled step is never reported as successful;
- partial outputs are either cleaned or recorded as incomplete;
- no later retry silently treats cancelled partial output as valid.

Resume and cancellation must be tested against the real runtime, not only with mocked promises or unit-test state transitions.

## 10. M3.4 — Artifact manifests and reproducibility

**Owner: Worker C. TL owns storage boundaries and evidence acceptance.**

Build the cross-engine artifact manifest and evidence facilities defined in Section 6.

Verify:

- source asset hashes;
- exported asset hashes;
- dependent file hashes;
- imported asset identity;
- engine and exporter versions;
- build artifact hashes;
- runtime verification references;
- plan and workflow-run identity;
- reproducibility metadata;
- evidence hashes.

A repeated export using the same source, tool version and declared settings should either produce the same digest or report the reason for a difference. Do not make false reproducibility claims when timestamps, nondeterministic metadata or engine behavior changes output bytes.

Large generated engine builds and binary assets must not be committed to Git merely to make the evidence bundle appear complete. Use the existing CI artifact mechanism for large outputs. Commit small manifests, command records, hashes, test results and evidence references into the repository.

Do not introduce a new persistent artifact service as part of M3 unless the existing architecture and roadmap explicitly require it. Durable GameOS storage belongs to its downstream roadmap scope.

## 11. M3.5 — Real end-to-end journey

**Owner: TL, with all three workers supporting.**

Build one complete journey through the original ZCode user experience.

The user submits a natural-language request through the original New Task composer, with the selected model/provider and real workspace.

The journey must then:

1. Discover the actual Blender project and target engine project.
2. Resolve the real engine capabilities through the registry.
3. Generate an engine-aware GamePlan.
4. Validate dependencies and resource claims.
5. Request the existing ZCode permissions where needed.
6. Execute the real Blender export.
7. Validate and record the source artifact.
8. Import the asset into a real Unity or Babylon project.
9. Verify the target import.
10. Build and run the target project.
11. Verify the runtime result.
12. Record all operations in the original session/workflow history.
13. Retain manifests, hashes, outputs and screenshots.
14. Demonstrate at least one meaningful failure, denial or cancellation path.

A deterministic local model endpoint may be used when required for reliable automation, as in M2. Its use must be disclosed in the evidence. The endpoint may drive the actual application and real engine tools; it may not fabricate tool calls, successful imports, build artifacts or runtime results.

The user must not have to manually repeat the export/import/build process outside the original application journey.

## 12. Strict TDD procedure for every M2 and M3 slice

The mandatory sequence is:

**RED → GREEN → HARDEN → INTEGRATE → REGRESSION → EVIDENCE**

For each vertical capability:

### RED
- Add the test before production implementation.
- Run it against the pre-implementation source.
- Prove it fails because the intended behavior is absent.
- Commit or preserve the test-first state.
- Record the RED commit SHA and exact command.

A syntax error, import error, missing dependency, runner failure or environment problem is not valid RED evidence.

### GREEN
- Implement the smallest production change.
- Run the exact test.
- Commit the passing implementation.
- Record the GREEN commit SHA and exit code.

### HARDEN
Add appropriate tests for:

- malformed input;
- missing or incompatible engines;
- unknown schema versions;
- hash corruption;
- path traversal and symlink escapes;
- missing permissions;
- permission denial;
- unavailable tools;
- duplicate and conflicting writes;
- cancellation;
- timeout and process-tree termination;
- interrupted execution;
- idempotency and retry;
- incomplete outputs;
- deterministic integration.

### INTEGRATE
Use the actual authority being changed:

- real Blender installation and project;
- real Unity Editor and project;
- real Babylon project and runtime;
- real ZCode plugin lifecycle;
- real Dynamic Workflow compiler and runtime;
- real ZCode Browser.

A unit fixture is never a substitute for any of these integration gates.

### REGRESSION
Run affected package suites, all relevant Gamos suites, inherited ZCode journeys, governance and architecture checks.

### EVIDENCE
Commit exact test names, commands, exit codes, RED/GREEN SHAs, runner details, engine versions, workflow URLs, artifact paths and SHA-256 hashes.

Every worker PR must contain this evidence before integration.

## 13. Worker coordination

Use the existing three-worker model and isolated branches:

- `gamos/worker-a`
- `gamos/worker-b`
- `gamos/worker-c`

The TL integrates to `gamos/development`.

### Worker A — Native engine pipelines

Owns M3.1 and M3.2:

- Blender export improvements;
- Unity typed asset import and verification;
- Babylon typed asset integration;
- real engine-backed tests;
- build and runtime verification.

Submit separate focused PRs for Blender→Unity and Blender→Babylon.

### Worker B — Domain and orchestration

Owns M3.3:

- cross-engine plan semantics;
- versioned resource-claim contract;
- dependency and conflict validation;
- deterministic workflow generation;
- GamePlan compatibility;
- compiler and runtime integration tests.

Do not change shared contracts without TL coordination. Do not create a second scheduler, journal or workflow runtime.

### Worker C — Artifact and evidence integrity

Owns M3.4:

- asset manifest schema implementation with Worker B;
- source/output hashes;
- dependency integrity;
- reproducibility records;
- handoff records;
- artifact/evidence validators.

Worker C must not activate GameOS, publishing, storage-platform or monetization work belonging to later milestones.

### TL — Integration and architecture

Owns:

- M2 acceptance and promotion;
- M3 shared contracts and API boundaries;
- resource-conflict enforcement;
- Dynamic Workflow runtime integration;
- cross-engine pipeline integration;
- security and permissions;
- CI and regression;
- real app journeys;
- evidence integrity;
- canonical roadmap updates.

The TL must review source, callers and tests, not approve based on worker summaries.

No worker should independently modify a shared contract or the same production surface as another worker without TL coordination.

## 14. CI and acceptance evidence

Preserve the existing governance workflow and M0/M1 regression coverage.

Required checks include:

- `node scripts/gamos/governance-check.mjs --pin <current-authorized-pin>`
- `node scripts/gamos/governance-self-test.mjs`
- `node scripts/gamos/roadmap-self-test.mjs`
- `node scripts/gamos/roadmap-check.mjs`
- `pnpm run architecture:check`
- `pnpm exec vitest run --project gamos-domain`
- focused Unity, Blender and Babylon plugin suites;
- Dynamic Workflow compiler and runtime tests;
- inherited ZCode build, plugin, permission, session and Browser journeys;
- real engine-backed M3 pipelines;
- M3 real end-to-end journey.

Do not weaken required checks to accommodate unavailable engines.

### M3 evidence

The canonical completion file is:

`evidence/roadmap/M3.json`

It must contain:

- `phase_id: "M3"`;
- passed status;
- full tested commit SHA;
- workflow-run head SHA;
- workflow ID, URL and successful conclusion;
- completion timestamp;
- actual runner, OS, runtime and engine versions;
- one passing result for each M3-G1 through M3-G5;
- exact commands and result summaries;
- committed evidence paths;
- SHA-256 hashes matching the committed evidence bytes.

Store detailed M3 artifacts under `evidence/phase-m3/` using the repository's evidence conventions.

CI artifacts may hold large output files, but committed evidence must identify their exact source, run, digest and relationship to the tested commit.

## 15. M3 definition of done

M3 is complete only when all of the following are true:

- A real Blender asset has been exported, validated, imported into a real Unity project, built and verified.
- A real Blender asset has been exported, consumed by a real Babylon project and verified in the original ZCode Browser.
- Asset manifests capture provenance, versions, metadata and verified hashes.
- Dependency ordering works through the existing GamePlan and Dynamic Workflow path.
- Independent work executes concurrently when safe.
- Conflicting project and asset writes are prevented or deterministically serialized with recorded reasons.
- Interrupted workflows resume from the existing durable journal.
- Cancellation is real, observable and never reported as success.
- The original New Task journey can complete the cross-engine workflow without manual repetition.
- Real build, import, runtime and artifact evidence is retained.
- All five M3 acceptance gates pass.
- The complete relevant inherited ZCode regression suite passes.
- Governance, architecture and roadmap validation pass on the completion candidate.
- `evidence/roadmap/M3.json` is complete and hash-verifiable.
- `ROADMAP.json` records M3 as complete.
- `main` remains the pristine upstream mirror.

If any Unity-dependent M3 gate cannot execute because a compliant free Personal runner is unavailable, report it as blocked. Do not substitute fixtures or claim completion.

## 16. Final operating instruction

The repository remains the only source of truth.

The TL must:

1. Commit this handoff into the repository.
2. Close the outstanding M2 issues without changing the roadmap's acceptance criteria.
3. Promote M2 only when all five M2 gates have passed.
4. Let the canonical validator make M3 dependency-ready.
5. Activate M3 without routine maintainer approval.
6. Implement all five M3 work packages and gates using strict TDD.
7. Commit all evidence and canonical roadmap changes.
8. Preserve the original ZCode product and all frozen authority boundaries.

Do not stop after writing plans, schemas or mocked workflows. The assignment is to implement and verify the full real M3 pipelines.

Do not report progress as completion. The validator, source, tests, CI and hash-bound evidence determine completion.