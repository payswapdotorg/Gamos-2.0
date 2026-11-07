import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { discoverBlender } from "../src/discovery.js";

// The real Blender 4.1.1 install this suite verifies against. BLENDER_PATH (if
// set by the runner) wins; otherwise the standard sandbox install is used.
const realBlenderCandidates = [process.env.BLENDER_PATH, "/home/z/engines/blender-4.1.1-linux-x64/blender"].filter(
  (candidate): candidate is string => typeof candidate === "string" && candidate.length > 0 && existsSync(candidate),
);
const realBlender = realBlenderCandidates[0];

async function fakeExecutable(dir: string, name: string, lines: string[], mode = 0o755): Promise<string> {
  const target = path.join(dir, name);
  await writeFile(target, ["#!/bin/sh", ...lines].join("\n") + "\n", { mode });
  return target;
}

async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

describe("blender discovery", () => {
  test.skipIf(realBlender === undefined)(
    "BLENDER_PATH override discovers the real Blender and parses its version",
    () => {
      const found = discoverBlender({ env: { BLENDER_PATH: realBlender } });
      expect(found.status).toBe("available");
      expect(found.executable).toBe(realBlender);
      expect(found.rawVersion).toContain("4.1.1");
      expect(found.parsed).toEqual({ major: 4, minor: 1, patch: 1 });
    },
  );

  test("a nonexistent BLENDER_PATH is unavailable with an explicit reason", () => {
    const found = discoverBlender({ env: { BLENDER_PATH: "/nonexistent/gamos/blender" } });
    expect(found.status).toBe("unavailable");
    expect(found.executable).toBeNull();
    expect(found.parsed).toBeNull();
    expect(found.reason ?? "").toMatch(/not found|BLENDER_PATH/i);
  });

  test("a non-executable BLENDER_PATH is unavailable with an explicit reason", async () => {
    const dir = await tempDir("gamos-blender-disc-");
    try {
      const target = path.join(dir, "blender-not-executable");
      await writeFile(target, "#!/bin/sh\necho 'Blender 4.1.1'\n", { mode: 0o644 });
      const found = discoverBlender({ env: { BLENDER_PATH: target } });
      expect(found.status).toBe("unavailable");
      expect(found.executable).toBeNull();
      expect(found.reason ?? "").toMatch(/not executable|permission/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a Blender 3.x executable is rejected by the >=4.1 version gate", async () => {
    const dir = await tempDir("gamos-blender-disc-");
    try {
      const fake = await fakeExecutable(dir, "blender3", ["echo 'Blender 3.6.2'"]);
      const found = discoverBlender({ env: { BLENDER_PATH: fake } });
      expect(found.status).toBe("unavailable");
      expect(found.rawVersion).toContain("3.6.2");
      expect(found.parsed).toEqual({ major: 3, minor: 6, patch: 2 });
      expect(found.reason ?? "").toMatch(/4\.1/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("an executable with unparseable version output is reported as version-unknown", async () => {
    const dir = await tempDir("gamos-blender-disc-");
    try {
      const fake = await fakeExecutable(dir, "blender-mystery", ["echo 'totally not a version string'"]);
      const found = discoverBlender({ env: { BLENDER_PATH: fake } });
      expect(found.status).toBe("version-unknown");
      expect(found.executable).toBe(fake);
      expect(found.rawVersion).toBeNull();
      expect(found.parsed).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("an empty BLENDER_PATH is treated as unset and discovery falls through", async () => {
    const emptyPath = await tempDir("gamos-blender-path-");
    try {
      const found = discoverBlender({ env: { BLENDER_PATH: "", PATH: emptyPath }, roots: [] });
      expect(found.status).toBe("unavailable");
      expect(found.executable).toBeNull();
    } finally {
      await rm(emptyPath, { recursive: true, force: true });
    }
  });

  test("a PATH miss with no common roots is unavailable with a reason", async () => {
    const emptyPath = await tempDir("gamos-blender-path-");
    try {
      const found = discoverBlender({ env: { PATH: emptyPath }, roots: [] });
      expect(found.status).toBe("unavailable");
      expect(found.executable).toBeNull();
      expect(found.parsed).toBeNull();
      expect(found.reason ?? "").toBeTruthy();
    } finally {
      await rm(emptyPath, { recursive: true, force: true });
    }
  });

  test("PATH lookup finds an executable blender and applies the version gate", async () => {
    const binDir = await tempDir("gamos-blender-bin-");
    try {
      const fake = await fakeExecutable(binDir, "blender", ["echo 'Blender 4.2.0'"]);
      const found = discoverBlender({ env: { PATH: binDir }, roots: [] });
      expect(found.status).toBe("available");
      expect(found.executable).toBe(fake);
      expect(found.parsed).toEqual({ major: 4, minor: 2, patch: 0 });
    } finally {
      await rm(binDir, { recursive: true, force: true });
    }
  });

  test.skipIf(realBlender === undefined)(
    "default discovery (env override or standard roots) finds a usable real Blender",
    () => {
      const found = discoverBlender();
      expect(found.status).toBe("available");
      expect(found.executable).toBeTruthy();
      expect(found.parsed?.major).toBeGreaterThanOrEqual(4);
    },
  );

  test("chmod-restorable fixtures do not leak executable state", async () => {
    const dir = await tempDir("gamos-blender-disc-");
    try {
      const target = await fakeExecutable(dir, "blender-locked", ["echo 'Blender 4.1.1'"]);
      await chmod(target, 0o644);
      const found = discoverBlender({ env: { BLENDER_PATH: target } });
      expect(found.status).toBe("unavailable");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
