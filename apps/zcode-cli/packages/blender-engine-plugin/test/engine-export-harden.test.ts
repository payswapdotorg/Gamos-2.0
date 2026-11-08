/**
 * M3 source-leg HARDEN — failure paths of the manifest-ingredient export that
 * must fail closed WITHOUT a real Blender (the engine rejects them before or
 * independently of the spawn):
 *
 * - dependent-file re-verification: malformed bridge records, missing files,
 *   empty files and hash/size mismatches are structured failures, never
 *   silently accepted (a lying bridge cannot fabricate integrity records);
 * - the GLTF+globalScale combination is rejected at the typed boundary
 *   before any process is spawned;
 * - a missing blend file fails before any export attempt.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { assetExport, verifyExportDependentFileRecords } from "../src/engine.js";

let workspace = "";

beforeAll(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), "gamos-harden-"));
});

afterAll(async () => {
  if (workspace) {
    await rm(workspace, { recursive: true, force: true });
  }
});

function sha256Of(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

describe("dependent-file re-verification fails closed (trust but verify)", () => {
  test("accepts a truthful record and classifies its media type", async () => {
    const sidecar = path.join(workspace, "mesh.mtl");
    await writeFile(sidecar, "newmtl Material\nKd 1 1 1\n");
    const size = (await stat(sidecar)).size;
    const truthful = await verifyExportDependentFileRecords([
      { path: sidecar, bytes: size, sha256: sha256Of(sidecar) },
    ]);
    expect(truthful.ok).toBe(true);
    if (truthful.ok) {
      expect(truthful.records).toHaveLength(1);
      expect(truthful.records[0]?.mediaType).toBe("text/plain");
      expect(truthful.records[0]?.byteLength).toBe(size);
      expect(truthful.records[0]?.sha256).toBe(sha256Of(sidecar));
    }
  });

  test("rejects malformed bridge records", async () => {
    const malformed = await verifyExportDependentFileRecords(["not-an-object", null, { path: 42 }]);
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) {
      expect(malformed.code).toBe("export-dependent-file-invalid");
    }
  });

  test("rejects missing dependent files", async () => {
    const missing = await verifyExportDependentFileRecords([
      { path: path.join(workspace, "does-not-exist.mtl"), bytes: 10, sha256: "a".repeat(64) },
    ]);
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.code).toBe("export-dependent-file-missing");
    }
  });

  test("rejects hash and size mismatches (a lying bridge cannot fabricate integrity)", async () => {
    const sidecar = path.join(workspace, "truthy.bin");
    await writeFile(sidecar, Buffer.from([1, 2, 3]));
    const size = (await stat(sidecar)).size;
    const wrongHash = await verifyExportDependentFileRecords([
      { path: sidecar, bytes: size, sha256: "b".repeat(64) },
    ]);
    expect(wrongHash.ok).toBe(false);
    if (!wrongHash.ok) {
      expect(wrongHash.code).toBe("export-dependent-file-hash-mismatch");
      expect(wrongHash.message).toContain("integrity mismatch");
    }
    const wrongSize = await verifyExportDependentFileRecords([
      { path: sidecar, bytes: size + 1, sha256: sha256Of(sidecar) },
    ]);
    expect(wrongSize.ok).toBe(false);
    if (!wrongSize.ok) {
      expect(wrongSize.code).toBe("export-dependent-file-hash-mismatch");
    }
  });

  test("rejects empty dependent files", async () => {
    const empty = path.join(workspace, "empty.mtl");
    await writeFile(empty, "");
    const outcome = await verifyExportDependentFileRecords([{ path: empty, bytes: 0, sha256: "c".repeat(64) }]);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe("export-dependent-file-empty");
    }
  });
});

describe("export input fail-closed before any spawn", () => {
  test("GLTF + globalScale is rejected at the typed boundary (no executable needed)", async () => {
    const outcome = await assetExport(
      "definitely-not-a-real-blender",
      {
        blendFile: path.join(workspace, "scene.blend"),
        outputPath: path.join(workspace, "out.glb"),
        format: "GLTF",
        interchange: { upAxis: "y", globalScale: 2 },
      },
      workspace,
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe("invalid-input");
    }
  });

  test("a missing blend file fails before the export attempt", async () => {
    const outcome = await assetExport(
      "definitely-not-a-real-blender",
      {
        blendFile: path.join(workspace, "missing.blend"),
        outputPath: path.join(workspace, "out.fbx"),
        format: "FBX",
      },
      workspace,
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe("blend-file-missing");
    }
  });
});
