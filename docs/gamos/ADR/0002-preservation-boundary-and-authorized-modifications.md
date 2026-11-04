# ADR-0002 — Preservation boundary and authorized modifications

- **Status:** Accepted (2026-11-04)
- **Deciders:** Gamos TL
- **Context:** The handoff's non-negotiable rules: ZCode remains the
  application; existing functionality must remain operational; identifiers
  (`@zcode/*`, `window.zcode`, IPC channels, env vars, storage keys, RPC
  contracts, protocol names, services) are infrastructure, not branding.
- **Decision:** freeze a machine-readable preservation boundary:
  - `.gamos-protected-surfaces.json` — protected paths and rules (the inherited
    application, its contracts and its official plugins).
  - `.gamos-authorized-modifications.json` — the **only** sanctioned way to
    modify a protected surface. Every entry requires: file & symbol, reason,
    affected functionality, new functionality, regression tests, TL approval,
    and verification evidence.
  - Gamos capabilities are added as **new files and new packages**
    (`packages/gamos-domain/`, `apps/zcode-cli/packages/*-engine-plugin/`, …).
  - Upstream's own admission semantics remain in force: any modified
    upstream-tracked file must also be registered with upstream's architecture
    governance (`scripts/architecture/upstream-admission.mjs`,
    `pnpm run architecture:check`).
- **Consequences:** "zero modifications, pure additions" is the default hard
  gate; the governance verifier enforces it in CI (ADR-0003). Workers cannot
  unblock a failing gate by self-serving allowlist entries — additions to the
  authorization list require TL approval recorded in the entry itself.
