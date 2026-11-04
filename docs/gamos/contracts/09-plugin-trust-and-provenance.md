# Gamos Phase-0 Contract 09 — Plugin Trust & Provenance

- Status: **FROZEN (Phase 0)** — hash-protected governance control file
- Owner: Gamos TL

## 1. Principle

Engine plugins inherit the **existing ZCode plugin trust chain** (verified in Phase B:
official marketplace zips from cdn-zcode.z.ai with sha256 verification recorded in
`installed_plugins.json`, `known_marketplaces.json`, cache layout under
`~/.zcode/cli/plugins/`). Gamos adds provenance metadata; it does not add a second
trust system.

## 2. Provenance ref (schema `gamos/provenance@1`, referenced by contracts 02/03)

```ts
interface ProvenanceRef {
  publisher: "zcode-official" | "gamos-tl" | "community";
  source: {
    type: "marketplace"; marketplaceId: string; version: string; sha256: string;
  } | {
    type: "repository"; repo: string; commitSha: string; path: string;
  };
  reviewedBy?: string;              // TL login for TL-reviewed plugins
  reviewRef?: string;               // PR / ledger decision_ref
}
```

MUST rules:
1. Every capability and engine plugin carries a provenance ref; unprovenanced
   declarations MUST be rejected at registration (fail closed).
2. Community plugins execute with the **existing sandbox/plugin-sandbox surfaces**
   (`src/preload/pluginSandbox*`, plugin-sandbox alias builds — present in the verified
   build outputs) and declare `requiresDisplayServer`/permissions honestly.
3. Marketplace sha256 MUST be verified at install (existing behavior — verified by the
   real jupyter-notebook install) and re-verified on update.
4. TL-published (gamos-tl) plugins additionally reference the governance decision
   (ledger entry or PR) that authorized their introduction — keeping the repository-level
   and runtime-level trust chains connected.
5. A plugin whose provenance cannot be resolved at load time MUST be disabled with an
   explicit state, not silently skipped.

## 3. Supply-chain notes

- Engine executables are user-installed (contract 04 discovery); Gamos never downloads
  engines implicitly. Engine SDK/package fetches during tasks require the `network`
  permission (contract 06) and record fetched artifact hashes (contract 08).
