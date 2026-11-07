import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { discoverNode } from "../src/discovery.js";

// The real Node install this suite verifies against (the sandbox pins
// /usr/bin/node at v24.22.2). BABYLON_NODE_PATH (if set by the runner) wins;
// otherwise the standard sandbox install is used.
const realNodeCandidates = [process.env.BABYLON_NODE_PATH, "/usr/bin/node", "/usr/local/bin/node"].filter(
  (candidate): candidate is string => typeof candidate === "string" && candidate.length > 0,
);
const realNode = realNodeCandidates[0];

async function fakeExecutable(dir: string, name: string, lines: string[], mode = 0o755): Promise<string> {
  const target = path.join(dir, name);
  await writeFile(target, ["#!/bin/sh", ...lines].join("\n") + "\n", { mode });
  return target;
}

async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

describe("node discovery", () => {
  test.skipIf(realNode === undefined)(
    "BABYLON_NODE_PATH override discovers the real node and parses its version",
    () => {
      const found = discoverNode({ env: { BABYLON_NODE_PATH: realNode } });
      expect(found.status).toBe("available");
      expect(found.executable).toBe(realNode);
      // the sandbox node is v24.22.2 — pinned in the environment contract
      expect(found.rawVersion).toBe("24.22.2");
      expect(found.parsed).toEqual({ major: 24, minor: 22, patch: 2 });
    },
  );

  test("a nonexistent BABYLON_NODE_PATH is unavailable with an explicit reason", () => {
    const found = discoverNode({ env: { BABYLON_NODE_PATH: "/nonexistent/gamos/node" } });
    expect(found.status).toBe("unavailable");
    expect(found.executable).toBeNull();
    expect(found.parsed).toBeNull();
    expect(found.reason ?? "").toMatch(/not found|BABYLON_NODE_PATH/i);
  });

  test("a non-executable BABYLON_NODE_PATH is unavailable with an explicit reason", async () => {
    const dir = await tempDir("gamos-node-disc-");
    try {
      const target = path.join(dir, "node-not-executable");
      await writeFile(target, "#!/bin/sh\necho 'v24.22.2'\n", { mode: 0o644 });
      const found = discoverNode({ env: { BABYLON_NODE_PATH: target } });
      expect(found.status).toBe("unavailable");
      expect(found.executable).toBeNull();
      expect(found.reason ?? "").toMatch(/not executable|permission/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a node 16.x executable is rejected by the >=18.0 version gate", async () => {
    const dir = await tempDir("gamos-node-disc-");
    try {
      const fake = await fakeExecutable(dir, "node16", ["echo 'v16.20.0'"]);
      const found = discoverNode({ env: { BABYLON_NODE_PATH: fake } });
      expect(found.status).toBe("unavailable");
      expect(found.rawVersion).toBe("16.20.0");
      expect(found.parsed).toEqual({ major: 16, minor: 20, patch: 0 });
      expect(found.reason ?? "").toMatch(/18/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("node v18.0.0 passes the version gate at the boundary and v17.9.9 does not", async () => {
    const dir = await tempDir("gamos-node-disc-");
    try {
      const boundary = await fakeExecutable(dir, "node18", ["echo 'v18.0.0'"]);
      const atBoundary = discoverNode({ env: { BABYLON_NODE_PATH: boundary } });
      expect(atBoundary.status).toBe("available");
      expect(atBoundary.parsed).toEqual({ major: 18, minor: 0, patch: 0 });

      const below = await fakeExecutable(dir, "node17", ["echo 'v17.9.9'"]);
      const belowGate = discoverNode({ env: { BABYLON_NODE_PATH: below } });
      expect(belowGate.status).toBe("unavailable");
      expect(belowGate.reason ?? "").toMatch(/18/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("an executable with unparseable version output is reported as version-unknown", async () => {
    const dir = await tempDir("gamos-node-disc-");
    try {
      const fake = await fakeExecutable(dir, "node-mystery", ["echo 'totally not a version string'"]);
      const found = discoverNode({ env: { BABYLON_NODE_PATH: fake } });
      expect(found.status).toBe("version-unknown");
      expect(found.executable).toBe(fake);
      expect(found.rawVersion).toBeNull();
      expect(found.parsed).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("an empty BABYLON_NODE_PATH is treated as unset and discovery falls through", async () => {
    const emptyPath = await tempDir("gamos-node-path-");
    try {
      const found = discoverNode({ env: { BABYLON_NODE_PATH: "", PATH: emptyPath }, roots: [] });
      expect(found.status).toBe("unavailable");
      expect(found.executable).toBeNull();
    } finally {
      await rm(emptyPath, { recursive: true, force: true });
    }
  });

  test("a PATH miss with no common roots is unavailable with a reason", async () => {
    const emptyPath = await tempDir("gamos-node-path-");
    try {
      const found = discoverNode({ env: { PATH: emptyPath }, roots: [] });
      expect(found.status).toBe("unavailable");
      expect(found.executable).toBeNull();
      expect(found.parsed).toBeNull();
      expect(found.reason ?? "").toBeTruthy();
    } finally {
      await rm(emptyPath, { recursive: true, force: true });
    }
  });

  test("PATH lookup finds an executable node and applies the version gate", async () => {
    const binDir = await tempDir("gamos-node-bin-");
    try {
      const fake = await fakeExecutable(binDir, "node", ["echo 'v20.10.0'"]);
      const found = discoverNode({ env: { PATH: binDir }, roots: [] });
      expect(found.status).toBe("available");
      expect(found.executable).toBe(fake);
      expect(found.parsed).toEqual({ major: 20, minor: 10, patch: 0 });
    } finally {
      await rm(binDir, { recursive: true, force: true });
    }
  });

  test.skipIf(realNode === undefined)(
    "default discovery (env override or PATH/common roots) finds a usable real node",
    () => {
      const found = discoverNode();
      expect(found.status).toBe("available");
      expect(found.executable).toBeTruthy();
      expect(found.parsed?.major).toBeGreaterThanOrEqual(18);
    },
  );

  test("chmod-restorable fixtures do not leak executable state", async () => {
    const dir = await tempDir("gamos-node-disc-");
    try {
      const target = await fakeExecutable(dir, "node-locked", ["echo 'v24.22.2'"]);
      await chmod(target, 0o644);
      const found = discoverNode({ env: { BABYLON_NODE_PATH: target } });
      expect(found.status).toBe("unavailable");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
