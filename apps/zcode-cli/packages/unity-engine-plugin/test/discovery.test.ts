import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { discoverUnityEditor } from "../src/discovery.js";
import { LICENSE_REQUIRED_REASON, classifyUnityBatchOutput } from "../src/engine.js";

// Fixture executables are used ONLY in this suite: these are parser tests of
// the Unity version grammar and the discovery gate. They are NOT engine
// execution proof — that lives exclusively in
// test/engine-real-unity.integration.test.ts behind an honest skipIf gate.

async function fakeExecutable(dir: string, name: string, lines: string[], mode = 0o755): Promise<string> {
  const target = path.join(dir, name);
  await writeFile(target, ["#!/bin/sh", ...lines].join("\n") + "\n", { mode });
  return target;
}

async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

describe("unity editor discovery", () => {
  test("UNITY_EDITOR_PATH override discovers the editor and parses a Unity 6 version", async () => {
    const dir = await tempDir("gamos-unity-disc-");
    try {
      const fake = await fakeExecutable(dir, "unity-editor", ["echo '6000.0.23f1'"]);
      const found = discoverUnityEditor({ env: { UNITY_EDITOR_PATH: fake } });
      expect(found.status).toBe("available");
      expect(found.executable).toBe(fake);
      expect(found.rawVersion).toBe("6000.0.23f1");
      expect(found.parsed).toEqual({ year: 6000, major: 0, stream: 23, sequence: 1 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("the >=2022.3 version gate accepts the boundary version and rejects everything below it", async () => {
    const dir = await tempDir("gamos-unity-disc-");
    try {
      const boundary = await fakeExecutable(dir, "unity-2022-3", ["echo '2022.3.10f1'"]);
      const atBoundary = discoverUnityEditor({ env: { UNITY_EDITOR_PATH: boundary } });
      expect(atBoundary.status).toBe("available");
      expect(atBoundary.rawVersion).toBe("2022.3.10f1");
      expect(atBoundary.parsed).toEqual({ year: 2022, major: 3, stream: 10, sequence: 1 });

      const below = await fakeExecutable(dir, "unity-2022-2", ["echo '2022.2.21f1'"]);
      const belowGate = discoverUnityEditor({ env: { UNITY_EDITOR_PATH: below } });
      expect(belowGate.status).toBe("unavailable");
      expect(belowGate.rawVersion).toBe("2022.2.21f1");
      expect(belowGate.reason ?? "").toMatch(/2022\.3/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a Unity 2021 editor is rejected by the version gate with an explicit reason", async () => {
    const dir = await tempDir("gamos-unity-disc-");
    try {
      const fake = await fakeExecutable(dir, "unity-2021", ["echo '2021.3.10f1'"]);
      const found = discoverUnityEditor({ env: { UNITY_EDITOR_PATH: fake } });
      expect(found.status).toBe("unavailable");
      expect(found.rawVersion).toBe("2021.3.10f1");
      expect(found.parsed).toEqual({ year: 2021, major: 3, stream: 10, sequence: 1 });
      expect(found.reason ?? "").toMatch(/2022\.3/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a nonexistent UNITY_EDITOR_PATH is unavailable with an explicit reason", () => {
    const found = discoverUnityEditor({ env: { UNITY_EDITOR_PATH: "/nonexistent/gamos/Unity" } });
    expect(found.status).toBe("unavailable");
    expect(found.executable).toBeNull();
    expect(found.parsed).toBeNull();
    expect(found.reason ?? "").toMatch(/not found|UNITY_EDITOR_PATH/i);
  });

  test("a non-executable UNITY_EDITOR_PATH is unavailable with an explicit reason", async () => {
    const dir = await tempDir("gamos-unity-disc-");
    try {
      const target = path.join(dir, "unity-not-executable");
      await writeFile(target, "#!/bin/sh\necho '6000.0.23f1'\n", { mode: 0o644 });
      const found = discoverUnityEditor({ env: { UNITY_EDITOR_PATH: target } });
      expect(found.status).toBe("unavailable");
      expect(found.reason ?? "").toMatch(/not executable|permission/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("an editor with unparseable version output is reported as version-unknown", async () => {
    const dir = await tempDir("gamos-unity-disc-");
    try {
      const fake = await fakeExecutable(dir, "unity-mystery", ["echo 'totally not a version string'"]);
      const found = discoverUnityEditor({ env: { UNITY_EDITOR_PATH: fake } });
      expect(found.status).toBe("version-unknown");
      expect(found.executable).toBe(fake);
      expect(found.rawVersion).toBeNull();
      expect(found.parsed).toBeNull();
      expect(found.reason ?? "").toMatch(/parse/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("the version grammar accepts all Unity release-type letters and rejects partial versions", async () => {
    const dir = await tempDir("gamos-unity-disc-");
    try {
      for (const [version, letter] of [
        ["2022.3.10f1", "f"],
        ["2023.1.0b7", "b"],
        ["2021.2.5p4", "p"],
        ["6000.0.23f1", "f"],
      ] as const) {
        const fake = await fakeExecutable(dir, `unity-${version}`, [`echo '${version}'`]);
        const found = discoverUnityEditor({ env: { UNITY_EDITOR_PATH: fake } });
        if (letter === "p" || version.startsWith("2021")) {
          expect(found.status).toBe("unavailable"); // below the 2022.3 floor, but parsed
          expect(found.parsed).not.toBeNull();
        } else {
          expect(found.status).toBe("available");
        }
      }

      // a version without the release-type suffix does not match the grammar
      const partial = await fakeExecutable(dir, "unity-partial", ["echo '2022.3.10'"]);
      const partialFound = discoverUnityEditor({ env: { UNITY_EDITOR_PATH: partial } });
      expect(partialFound.status).toBe("version-unknown");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("version output with surrounding noise still parses per line", async () => {
    const dir = await tempDir("gamos-unity-disc-");
    try {
      const fake = await fakeExecutable(dir, "unity-noisy", ["echo 'UnityEditor launcher'", "echo '6000.0.23f1'"]);
      const found = discoverUnityEditor({ env: { UNITY_EDITOR_PATH: fake } });
      expect(found.status).toBe("available");
      expect(found.rawVersion).toBe("6000.0.23f1");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a -version probe exiting non-zero is unavailable with the output excerpt", async () => {
    const dir = await tempDir("gamos-unity-disc-");
    try {
      const fake = await fakeExecutable(dir, "unity-broken", ["echo 'license kaboom' 1>&2", "exit 1"]);
      const found = discoverUnityEditor({ env: { UNITY_EDITOR_PATH: fake } });
      expect(found.status).toBe("unavailable");
      expect(found.reason ?? "").toMatch(/exit|code/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("PATH lookup finds unity-editor and unity executables and applies the version gate", async () => {
    const binDir = await tempDir("gamos-unity-bin-");
    try {
      const fake = await fakeExecutable(binDir, "unity-editor", ["echo '6000.0.23f1'"]);
      const found = discoverUnityEditor({ env: { PATH: binDir }, roots: [] });
      expect(found.status).toBe("available");
      expect(found.executable).toBe(fake);
      expect(found.parsed).toEqual({ year: 6000, major: 0, stream: 23, sequence: 1 });

      const binDir2 = await tempDir("gamos-unity-bin2-");
      try {
        const fakeUnity = await fakeExecutable(binDir2, "unity", ["echo '2022.3.10f1'"]);
        const found2 = discoverUnityEditor({ env: { PATH: binDir2 }, roots: [] });
        expect(found2.status).toBe("available");
        expect(found2.executable).toBe(fakeUnity);
      } finally {
        await rm(binDir2, { recursive: true, force: true });
      }
    } finally {
      await rm(binDir, { recursive: true, force: true });
    }
  });

  test("an empty UNITY_EDITOR_PATH is treated as unset and discovery falls through", async () => {
    const emptyPath = await tempDir("gamos-unity-path-");
    try {
      const found = discoverUnityEditor({ env: { UNITY_EDITOR_PATH: "", PATH: emptyPath }, roots: [] });
      expect(found.status).toBe("unavailable");
      expect(found.executable).toBeNull();
    } finally {
      await rm(emptyPath, { recursive: true, force: true });
    }
  });

  test("a PATH miss with no common roots is unavailable with a reason", async () => {
    const emptyPath = await tempDir("gamos-unity-path-");
    try {
      const found = discoverUnityEditor({ env: { PATH: emptyPath }, roots: [] });
      expect(found.status).toBe("unavailable");
      expect(found.executable).toBeNull();
      expect(found.parsed).toBeNull();
      expect(found.reason ?? "").toBeTruthy();
    } finally {
      await rm(emptyPath, { recursive: true, force: true });
    }
  });

  test("common-root candidates are probed when PATH misses", async () => {
    const dir = await tempDir("gamos-unity-roots-");
    try {
      const fake = await fakeExecutable(dir, "Unity", ["echo '6000.0.23f1'"]);
      const found = discoverUnityEditor({ env: { PATH: "" }, roots: [fake] });
      expect(found.status).toBe("available");
      expect(found.executable).toBe(fake);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("default discovery does not throw in this sandbox (honest miss, no real editor)", () => {
    const found = discoverUnityEditor({ env: { PATH: "" }, roots: [] });
    expect(found.status).toBe("unavailable");
    // machine-independent: no real editor is pre-supposed on any dev machine
    expect(existsSync(String(found.executable))).toBe(false);
  });

  test("chmod-restorable fixtures do not leak executable state", async () => {
    const dir = await tempDir("gamos-unity-disc-");
    try {
      const target = await fakeExecutable(dir, "unity-locked", ["echo '6000.0.23f1'"]);
      await chmod(target, 0o644);
      const found = discoverUnityEditor({ env: { UNITY_EDITOR_PATH: target } });
      expect(found.status).toBe("unavailable");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("unity batch output license classification (pure parser)", () => {
  test("Unity license failures are classified as license-required", () => {
    expect(classifyUnityBatchOutput("No valid Unity Editor license attached. Exiting.")).toBe(
      "license-required",
    );
    expect(classifyUnityBatchOutput("The license could not be obtained from the licensing service.")).toBe(
      "license-required",
    );
    expect(classifyUnityBatchOutput("Licensing client check failed, aborting batchmode.")).toBe(
      "license-required",
    );
    expect(
      classifyUnityBatchOutput("batchmode: Failed to activate license: no entitlement found"),
    ).toBe("license-required");
  });

  test("'another Unity instance is running' is a DIFFERENT failure, never license-required", () => {
    expect(
      classifyUnityBatchOutput("It looks like another Unity instance is running with this project open."),
    ).toBe("editor-lock");
  });

  test("normal batch output is not classified", () => {
    expect(classifyUnityBatchOutput("Batchmode quit successfully invoked - shutting down!")).toBeNull();
    expect(classifyUnityBatchOutput("")).toBeNull();
    expect(classifyUnityBatchOutput("Refreshing native plugins possible parent name")).toBeNull();
  });

  test("the license-required reason is the honest external-prerequisite wording", () => {
    expect(LICENSE_REQUIRED_REASON).toMatch(/external, user-controlled prerequisite/i);
    expect(LICENSE_REQUIRED_REASON).toMatch(/never fabricated/i);
  });
});
