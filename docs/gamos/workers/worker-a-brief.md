# Worker A — Engine Plugins (Unity, Blender, Babylon)

- Reports to: Gamos TL · Branch: `gamos/worker-a` (integrated to `gamos/development` via TL-reviewed PRs)
- Authorization: M1 scope activates ONLY after M0 acceptance (architect's acceptance rule)

## Scope

Deliver `unity-engine-plugin`, `blender-engine-plugin`, `babylon-engine-plugin` under
`apps/zcode-cli/packages/` (paths pre-declared in the baseline's planned additive
surfaces), implementing contracts 02, 03, 04 (engine probes), 07 (availability),
08 (artifacts), 09 (provenance).

## MUST deliver per PR

1. Source changes + commit SHA (additive only — protected surfaces untouched).
2. Contract references: which frozen contract clauses each change implements.
3. Tests + actual results (unit tests for manifest validation, discovery probes with
   fixture filesystems, availability resolution).
4. **Real engine integration evidence** where the engine is configured on the machine:
   a real headless Blender render, a real Unity batch-mode command, or a real Babylon
   bundle run — with artifact sha256 + command line + engine version (contract 08).
5. **Explicit unavailable/conditional states** where an engine is not installed
   (discovery record with reason; capability resolves to `unavailable` — no mocks,
   no fake availability, no placeholder functionality).

## Boundaries

- No changes to: agent runtime, task system, model router, permission system,
  marketplace, workflow runtime, or any protected surface (governance verifier will
  reject unauthorized modifications).
- Tool exposure via the existing plugin/MCP registration path; UI (if any) via the
  existing UI plugin API only.

## Definition of done (per engine plugin)

Manifest validates against `gamos/engine-plugin@1`; discovery probe implemented and
tested; ≥1 real integration evidence artifact OR a recorded explicit unavailable state
with reason; unit tests green; TL review complete.
