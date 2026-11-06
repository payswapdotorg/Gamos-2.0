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
  "game-contracts/avatar.ts": "ca3f56146e2ae5b83e0bbc0ffa27ab3b7c2fe495ae797e0389168ff9a094dbf7",
  "game-contracts/brand.ts": "0ffd8758ca94c42206317fdd78fefff3c70168f4d8e6a2113ca043d68c6fd4f1",
  "game-contracts/capabilities.ts": "05f7bdadd0a69eb68e37b9d38b5e8c8a8764ed2d3e6a2c69def5c8bb212602a9",
  "game-contracts/game-identity.ts": "ddce06d66aa1f3b331bddff342a3845abe0fdd7092a33c1531253aaefad954ba",
  "game-contracts/git.ts": "3e095b23f1940eea0d8df9eb7c11f8d14fa1c5131ec51de065af13f2678a64d9",
  "game-contracts/ids.ts": "eb503f09cb085741da48fd0cd25e93bb1ea81da12b5fe9ba66b75aa2c4079485",
  "game-contracts/index.ts": "4c9b29b084451422fa4441c322664571ec80a137ccc84f5e9578a76c5e6cf508",
  "game-contracts/module.ts": "ba951c1ea5de044a32e68287a0df28588594ba3f7030d38713ed19427d1881e0",
  "game-contracts/selfcheck.ts": "d8333ab1e2d2748af2807049226953f7f3c67e13e99b08297587120208527327",
  "game-contracts/spatial.ts": "7b3f6f85e6b858de6c70b112adf4ed38126cc4ef37f8a85f871fa7eefa8c196d",
  "game-contracts/world.ts": "d1a261339cb5cd9fbf2cb21a0325a1a93b116c2f4b5edcda4fa5fd4a46a449da",
  "game-ir/contract.ts": "96a52cfdd9e2de19be3ae26a8527784660e8125d1380f07bf490c76df2dac6e8",
  "game-ir/diagnostics.ts": "ac4eb7a47276347132910c6840ec7941e5f0e69744b828f6e25de74667071cea",
  "game-ir/document.ts": "9912b4488c24223e3243900c7c7d7f94cea6254bd6f120da816fed471acae82e",
  "game-ir/evaluate.ts": "a2d599b6581a42cd3afba338ef1c27d4836fd0a87f54c4f3659f8606952a9323",
  "game-ir/index.ts": "08041ade9d4ca09ffb3305621cbefda3022c6f6874551ef2578b674a658c5710",
  "game-ir/nodes.ts": "f12fd3f083aa57816c498e02dc2136c3525a9406aa2eb876698b59c8c11b87e9",
  "game-ir/semantics.ts": "2217b0d0bef02fa4959f39c6c017271c77b81f0161a9052a84e9c67979108bde",
  "game-ir/shapes.ts": "94bfa51be83128f473b5ec6de7a3f326ecfff478ccfa960ebfe856bafeed3574",
  "game-ir/validate.ts": "0e74677a69223cdbd0a26108b243405b59975bc1150a0db4ab385a9693ead72e",
  "game-ir/values.ts": "68cede819de0d1a38bb6aeee2a8e11615252985466bf7c46be150385d4813f52"
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
