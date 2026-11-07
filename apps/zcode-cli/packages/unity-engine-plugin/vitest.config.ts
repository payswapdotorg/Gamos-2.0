import { defineConfig } from "vitest/config";

// Local config so the package's tests run standalone (per its frozen
// `npm test` script) without climbing up to the app-level vitest.config.ts,
// which needs the app workspace's node_modules. App-root runs keep using the
// app config; per-test timeouts below only widen defaults, never narrow them.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 600_000,
  },
});
