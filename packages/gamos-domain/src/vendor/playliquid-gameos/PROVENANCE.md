# Vendored PlayLiquid GameIR — provenance record (contract 09 / contract 01 §2 rule 4)

- **Upstream repository:** `payswapdotorg/PlayLiquid-2.0`
- **Vendored subtree:** `packages/playliquid-gameos/src/game-ir/` and
  `packages/playliquid-gameos/src/game-contracts/` (the GameIR kernel's only
  upstream dependency; the module dependency matrix forbids any other import)
- **Pinned source commit:** `196b305e75decfeaa162d3da479dc125cff1521a`
- **Vendored into Gamos:** `packages/gamos-domain/src/vendor/playliquid-gameos/src/`
  preserving the upstream relative layout so `../game-contracts/index.js` imports
  resolve unchanged (byte-exact copy; no local edits — see the drift rule below)
- **Why vendored rather than npm-dependency:** the Gamos workspace does not carry
  the `@playliquid/gameos` package and the pinned-commit exactness requirement
  (contract 01 §2: "the upstream module remains the named source of truth") is
  enforceable only when the bytes are in-repo and hash-verifiable
- **Drift rule:** any difference between these files and the pinned upstream
  subtree is a governance defect. Refreshing the pin is an authorized-modification
  change (GAMOS-AUTH ledger entry + rebaseline + TL-reviewed PR) that must update
  this provenance record, the ROADMAP.json `source_anchors.playliquid_gameir_commit`
  pin and the exact-compatibility tests in the same change
- **External dependencies:** none — the vendored set imports only relative
  modules plus `node:crypto` (evaluate.ts hashing); it stays a pure data/validation
  kernel with no engine, network or process coupling (contract 01 package boundary)
