import { chmod, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";

const packageRoot = resolve(import.meta.dirname, "..");
const serverOutputPath = resolve(packageRoot, "dist", "mcp", "server.js");

await build({
  bundle: true,
  entryPoints: [resolve(packageRoot, "src", "mcp", "server.ts")],
  format: "esm",
  legalComments: "none",
  outfile: serverOutputPath,
  platform: "node",
  target: "node24",
});

await chmod(serverOutputPath, 0o755);

// The Unreal connector ATTACHES to a running editor over verified loopback
// HTTP/WebSocket — it spawns nothing and stages no bridge scripts (readiness
// §4.2). Only the MCP dist artifact is built here.
await rm(resolve(packageRoot, "dist", "mcp", "bridge"), { recursive: true, force: true });
await mkdir(dirname(serverOutputPath), { recursive: true });
