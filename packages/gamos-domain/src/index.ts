/**
 * Public barrel of `@zcode/gamos-domain` — the pure Gamos gaming-domain package
 * (roadmap M1.1/M1.2). Imports nothing from the workspace; the only runtime
 * dependency of the vendored GameIR kernel is node:crypto.
 *
 * The vendored PlayLiquid GameIR lives under
 * `src/vendor/playliquid-gameos/` (byte-exact pin; see PROVENANCE.md) and is
 * re-exported through `./playliquid-gameir` for exact-compatibility testing.
 */

export * from "./contract.js";
export { gamosDomainModule } from "./module.js";
