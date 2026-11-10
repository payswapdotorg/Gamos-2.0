import { defineConfig } from "vitest/config";

// Local config so the package's tests run standalone (per its frozen
// `npm test` script) without climbing up to the app-level vitest.config.ts,
// which needs the app workspace's node_modules. App-root runs keep using the
// app config; per-test timeouts below only widen defaults, never narrow them.
//
// The Unreal suite is contract-only: every test runs against the in-repo mock
// Remote Control server (test/mock-rc-server.ts — an EDITOR STAND-IN, never a
// gate substitute). No engine binaries are provisioned or fetched; a mock can
// never pass M4-G2 (delivery plan §3 order 5 / §9).
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 300_000,
  },
});
