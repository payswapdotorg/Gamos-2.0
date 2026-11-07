import { chmod, cp, mkdir, rm } from "node:fs/promises";
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

// The Blender bridge scripts are fixed, committed templates under src/bridge
// (they are never generated and never contain payloads from tool inputs).
// Bundle them next to every emitted server location so the bundled
// dist/mcp/server.js and the tsc-compiled dist outputs can both resolve them.
const bridgeSource = resolve(packageRoot, "src", "bridge");
for (const bridgeDest of [
  resolve(packageRoot, "dist", "mcp", "bridge"),
  resolve(packageRoot, "dist", "bridge"),
]) {
  await rm(bridgeDest, { recursive: true, force: true });
  await mkdir(dirname(bridgeDest), { recursive: true });
  await cp(bridgeSource, bridgeDest, { recursive: true });
}
