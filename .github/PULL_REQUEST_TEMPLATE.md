## Roadmap traceability
- Milestone / work-package ID (from docs/gamos/ROADMAP.json):
- Acceptance gate(s) affected:
- Frozen contract clause IDs:
- User-visible behavior added or changed:

## TDD evidence (mandatory)
- [ ] RED test was committed before production implementation.
- RED commit SHA:
- RED command:
- RED result (must fail for the intended missing behavior):
- [ ] GREEN implementation is the smallest change that makes the test pass.
- GREEN commit SHA:
- GREEN command and result:
- [ ] Negative/security/unavailable/cancel/idempotency cases were tested as applicable.
- Negative test commands and results:

## Integration and regression evidence
- [ ] Real integration test executed against the real authority, or limitation is explicitly recorded.
- Integration environment / engine / service version:
- Evidence paths and SHA-256:
- [ ] Focused package/contract tests pass.
- [ ] pnpm run architecture:check passes.
- [ ] Governance verifier and self-test pass.
- [ ] Roadmap self-test and roadmap-check pass.
- [ ] Applicable inherited ZCode regression journeys pass.
- CI run URL and tested commit SHA:

## Trust and safety
- [ ] No fake engine availability, fake project, simulated successful build, fabricated screenshot or pretend publishing.
- [ ] Plugin/MCP OS-process privileges and provenance are accurately disclosed.
- [ ] Native engine mutations use the ZCode permission path.
- [ ] No credentials or private user data are present in code, logs, screenshots or artifacts.
- [ ] No unauthorized changes to upstream-tracked or frozen control surfaces.

## TL integration checklist
- [ ] Changed source files, callers and data flow inspected.
- [ ] Scope is additive and consistent with ROADMAP.json.
- [ ] Failure modes and unavailable states are explicit.
- [ ] Required CI checks are green on the PR head.
