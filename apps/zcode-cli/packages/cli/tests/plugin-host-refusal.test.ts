import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { runPluginHostCommand } from "../src/plugin-host-command.js";

/**
 * Gamos M2-D (final-closure directive §2, requirement 8) — missing or
 * corrupted plugin runtime assets FAIL CLOSED at the host boundary.
 *
 * The config layer registers an official plugin's MCP server by its declared
 * `${ZCODE_PLUGIN_ROOT}/dist/mcp/server.js` path; it does not (and must not)
 * fabricate server presence. The fail-closed seam is the REAL plugin host
 * (`__zcode-plugin-host`, src/plugin-host-command.ts): a nonexistent server
 * file is refused before import, and a corrupted server module that does not
 * export `main()` is refused after import — both exit 1 with an explicit
 * error, never a partial tool surface.
 */

function stubContext(): { stderr: { write: (text: string) => void }; captured: string[] } {
  const captured: string[] = [];
  return { stderr: { write: (text: string) => void captured.push(text) }, captured };
}

describe("Gamos M2-D — plugin host fails closed on missing/corrupted runtime assets", () => {
  it("refuses a declared server file that does not exist (exit 1, explicit error, no import)", async () => {
    const root = await mkdtemp(join(tmpdir(), "gamos-m2d-host-missing-"));
    try {
      const missingServer = join(root, "dist", "mcp", "server.js");
      const ctx = stubContext();
      const exit = await runPluginHostCommand(ctx as never, [missingServer]);
      expect(exit).toBe(1);
      expect(ctx.captured.join("")).toContain("Plugin server file does not exist.");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("refuses a corrupted server module that exports no main() (exit 1, explicit error)", async () => {
    const root = await mkdtemp(join(tmpdir(), "gamos-m2d-host-corrupt-"));
    try {
      const corruptedServer = join(root, "dist", "mcp", "server.js");
      await mkdir(dirname(corruptedServer), { recursive: true });
      await writeFile(
        corruptedServer,
        "// corrupted runtime asset (gamos M2-D fixture): no main export\nexport const broken = true;\n",
      );
      const ctx = stubContext();
      const exit = await runPluginHostCommand(ctx as never, [corruptedServer]);
      expect(exit).toBe(1);
      expect(ctx.captured.join("")).toContain("Plugin server does not export main().");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
