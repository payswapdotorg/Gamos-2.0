# Gamos Documentation — `docs/gamos/`

Governance and architecture documentation for the Gamos fork of ZCode
(`payswapdotorg/Gamos-2.0`, upstream `zai-org/ZCode` @
`a9fe401eede6e6e5e01be9048679c206fe6f02d9`, v3.17.2).

**Rule:** documents describe the *actual implemented* architecture. Anything not
yet implemented is explicitly marked as planned/pending.

## Status of the required document set (handoff §4)

| Document | Status |
|---|---|
| `PRODUCT-NORTH-STAR.md` | ✅ present (binding product definition) |
| `ARCHITECTURE.md` | ✅ present (verified upstream topology + planned additions marked) |
| `UPSTREAM-BASELINE.md` | ✅ present (verified fork/baseline record) |
| `FEATURE-PRESERVATION-MATRIX.md` | ✅ present (32 features, verified anchors) |
| `MILESTONES-AND-ACCEPTANCE.md` | ✅ present (M0–M7 + journeys) |
| `IMPLEMENTATION-STATUS.md` | ✅ present (honest ledger — updated every integration point) |
| `ADR/README.md` (+ ADR-0001…0003) | ✅ present |
| `PLUGIN-CAPABILITY-CONTRACT.md` | ⏳ pending — authored with M1 (capability registry work package) |
| `CAPABILITY-REGISTRY.md` | ⏳ pending — M1 |
| `GAME-DOMAIN-MODEL.md` | ⏳ pending — M1 |
| `INTENT-AND-WORKFLOW-ORCHESTRATION.md` | ⏳ pending — M1 |
| `ENGINE-PLUGIN-ARCHITECTURE.md` | ⏳ pending — M2 |
| `ENGINE-INTEGRATION-SPECIFICATIONS.md` | ⏳ pending — M2/M4 |
| `GAME-ASSET-PIPELINE.md` | ⏳ pending — M3 |
| `GAME-TESTING-AND-EVIDENCE.md` | ⏳ pending — M5 |
| `WORLD-PACKAGE-AND-PUBLISHING.md` | ⏳ pending — M6 |
| `PAYSWAP-PSP-INTEGRATION.md` | ⏳ pending — M7 |
| `PLUGIN-SECURITY-AND-APPROVALS.md` | ⏳ pending — M1/M2 |
| `REMOTE-AND-LOCAL-CAPABILITIES.md` | ⏳ pending — M2+ |

Machine-readable governance artifacts live at the repository root:
`.gamos-architecture-baseline.json`, `.gamos-protected-surfaces.json`,
`.gamos-authorized-modifications.json`, enforced by
`scripts/gamos/governance-check.mjs` (CI: `.github/workflows/gamos-governance.yml`).
