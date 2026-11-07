import { defineConfig } from "vite";

// Fixed, committed fixture configuration. The dev server binds loopback only
// with strictPort so a busy port is an explicit failure (never a silent
// retry on another port). The port itself comes from the CLI (`--port`) or
// this config's default.
export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
  },
});
