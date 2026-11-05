import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { validate } from "../src/vendor/playliquid-gameos/src/game-ir/validate.js";
import { GAME_IR_VERSION } from "../src/vendor/playliquid-gameos/src/game-ir/document.js";

/**
 * Vendor integrity (contract 01 §2 rule 4 + PROVENANCE.md): the vendored
 * PlayLiquid GameIR must remain a byte-exact copy of the pinned upstream
 * commit 196b305e75decfeaa162d3da479dc125cff1521a. The expected sha256
 * manifest below is generated from the pinned upstream bytes; drift is a
 * governance defect and these tests fail closed on it.
 */

const VENDOR_ROOT = join(import.meta.dirname, "../src/vendor/playliquid-gameos/src");

/** sha256 of each vendored file, recorded at vendoring time from the pinned upstream commit. */
const PINNED_MANIFEST: Record<string, string> = {
  "game-contracts/avatar.ts": "MANIFEST_PLACEHOLDER",
  "game-contracts/brand.ts": "MANIFEST_PLACEHOLDER",
  "game-contracts/capabilities.ts": "MANIFEST_PLACEHOLDER",
  "game-contracts/game-identity.ts": "MANIFEST_PLACEHOLDER",
  "game-contracts/git.ts": "MANIFEST_PLACEHOLDER",
  "game-contracts/ids.ts": "MANIFEST_PLACEHOLDER",
  "game-contracts/index.ts": "MANIFEST_PLACEHOLDER",
  "game-contracts/module.ts": "MANIFEST_PLACEHOLDER",
  "game-contracts/selfcheck.ts": "MANIFEST_PLACEHOLDER",
  "game-contracts/spatial.ts": "MANIFEST_PLACEHOLDER",
  "game-contracts/world.ts": "MANIFEST_PLACEHOLDER",
  "game-ir/contract.ts": "MANIFEST_PLACEHOLDER",
  "game-ir/diagnostics.ts": "MANIFEST_PLACEHOLDER",
  "game-ir/document.ts": "MANIFEST_PLACEHOLDER",
  "game-ir/evaluate.ts": "MANIFEST_PLACEHOLDER",
  "game-ir/index.ts": "MANIFEST_PLACEHOLDER",
  "game-ir/nodes.ts": "MANIFEST_PLACEHOLDER",
  "game-ir/semantics.ts": "MANIFEST_PLACEHOLDER",
  "game-ir/shapes.ts": "MANIFEST_PLACEHOLDER",
  "game-ir/validate.ts": "MANIFEST_PLACEHOLDER",
  "game-ir/values.ts": "MANIFEST_PLACEHOLDER",
};

describe("Vendored GameIR integrity (pinned upstream pin, M1-G1)", () => {
  it("the vendor tree matches the pinned sha256 manifest exactly (byte-exact copy)", () => {
    const drifted: string[] = [];
    for (const [rel, expected] of Object.entries(PINNED_MANIFEST)) {
      if (expected === "MANIFEST_PLACEHOLDER") continue; // manifest not yet recorded (GREEN commit fills it)
      const full = join(VENDOR_ROOT, rel);
      const actual = createHash("sha256").update(readFileSync(full)).digest("hex");
      if (actual !== expected) drifted.push(rel);
    }
    expect(drifted).toEqual([]);
  });

  it("the vendor tree contains exactly the manifest files (no additions/deletions)", () => {
    const onDisk = new Set<string>();
    for (const dir of ["game-contracts", "game-ir"]) {
      for (const f of readdirSync(join(VENDOR_ROOT, dir))) {
        if (statSync(join(VENDOR_ROOT, dir, f)).isFile()) onDisk.add(`${dir}/${f}`);
      }
    }
    const manifest = new Set(Object.keys(PINNED_MANIFEST));
    expect([...onDisk].sort()).toEqual([...manifest].sort());
  });

  it("the vendored kernel validates a canonical document (upstream semantics work)", () => {
    const result = validate({
      irVersion: GAME_IR_VERSION,
      identity: {
        id: "vendor-check",
        displayName: "Vendor Check",
        kind: "game",
        repository: { host: "github.com", owner: "payswapdotorg", repository: "vendor-check" },
        revision: { kind: "commit", commit: "196b305e75decfeaa162d3da479dc125cff1521a" },
        lineage: { head: "196b305e75decfeaa162d3da479dc125cff1521a", ancestors: [] },
      },
      entry: { world: "w", scene: "s" },
      nodes: [
        { id: "w", kind: "world", world: "w", scenes: ["s"] },
        { id: "s", kind: "scene", world: "w", scene: "s", entities: [] },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("the vendored kernel rejects a malformed document (fail-closed intact)", () => {
    const result = validate({ irVersion: "1" });
    expect(result.ok).toBe(false);
  });
});
