# Worker A — Engine Plugins (Unity, Blender, Babylon, then Godot/Unreal)

- Reports to: Gamos TL.
- Branch: gamos/worker-a; integrate through TL-reviewed PRs into gamos/development.
- Active scope and gate IDs: read docs/gamos/ROADMAP.json. Do not infer scope from
  this brief if the canonical roadmap changes.
- M1 work starts only after M0 is marked complete by the roadmap gate.

## Scope

Deliver the first-party Unity, Blender and Babylon engine plugins under
apps/zcode-cli/packages/ in M2, then Godot and Unreal in M4. Follow frozen
contracts 02, 03, 04, 07, 08 and 09. Plugin/capability metadata must use
gamos/engine-plugin@2 and gamos/capability@2.

## TDD and evidence per vertical slice

1. Add a test that fails for the intended missing behavior; record RED commit,
   test name, exact command and result.
2. Implement the smallest change that passes; record GREEN commit and result.
3. Add negative tests for unsupported versions, missing executables, wrong
   projects, unavailable display/auth/network, permission denial, cancellation
   and unsafe process privileges as applicable.
4. Run real engine integration when configured: e.g. Blender headless render,
   Unity native batch/editor operation or Babylon runtime/browser test. Record
   engine version, command, artifact SHA-256 and CI evidence.
5. Where unavailable, record the actual probe, reason and remedy. An unavailable
   state is honest progress but does not satisfy a required real-integration gate.

## Boundaries

- No changes to agent runtime, task/session system, model router, permission
  system, marketplace or Dynamic Workflow runtime.
- All native mutations go through ZCode permission-gated execution.
- Use the existing plugin/MCP registration path and existing UI plugin API.
- A UI sandbox does not sandbox an MCP OS process. Process filesystem, network
  and environment privileges must match contract 09 and be disclosed before
  activation.
- No fake engine availability, fake projects, mocked successful builds or
  fabricated screenshots.

## Definition of done per plugin

Manifest validates against gamos/engine-plugin@2; discovery/version probes and
availability tests pass; typed capability operations and permission denial are
tested; provenance is resolvable; at least one real integration evidence artifact
exists for milestone acceptance; TL review and inherited regression gates pass.
