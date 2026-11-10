import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  GODOT_PATH_ENV,
  defaultCommonRoots,
  discoverGodot,
  godotTemplatesVersion,
  parseGodotExecutableVersion,
} from "../src/discovery.js";

/**
 * Unit-level discovery contract (no real Godot needed — env and roots are
 * injected; executable candidates are fake scripts):
 *
 * - the env override is authoritative (its outcome is reported, never a
 *   fallback to another executable the user did not ask for);
 * - an unparseable `--version` output is `version-unknown` — fail closed,
 *   never available-by-guess;
 * - a parseable version below the family minimum (`>=4.2`) is `unavailable`
 *   with an honest reason;
 * - the version grammar is the Godot FAMILY grammar, pinned on the exact
 *   shapes the domain parser documents (parity pins: the verified
 *   4.2.2.stable.official.15073afe3, pre-release 4.3.rc1, dev channel,
 *   v-prefix, mono extra segment).
 */

let scratch = "";

beforeAll(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "gamos-godot-discovery-"));
});

afterAll(async () => {
  if (scratch) {
    await rm(scratch, { recursive: true, force: true });
  }
});

async function fakeExecutable(versionOutput: string): Promise<string> {
  const file = path.join(scratch, `fake-${Math.random().toString(36).slice(2)}.sh`);
  await writeFile(file, `#!/bin/sh\necho ${JSON.stringify(versionOutput)}\n`, { mode: 0o755 });
  await chmod(file, 0o755);
  return file;
}

const EMPTY_ENV: Record<string, string | undefined> = { PATH: "" };

describe("Godot family version grammar (parity pins with the domain parser)", () => {
  test("parses the verified engine version exactly", () => {
    const parsed = parseGodotExecutableVersion("4.2.2.stable.official.15073afe3");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed).toMatchObject({ major: 4, minor: 2, patch: 2, channel: "stable", channelOrdinal: 0 });
      expect(parsed.raw).toBe("4.2.2.stable.official.15073afe3");
    }
  });

  test("parses pre-release, dev, v-prefix and mono forms", () => {
    const rc = parseGodotExecutableVersion("4.3.rc1.official.abc123");
    expect(rc.ok).toBe(true);
    if (rc.ok) expect(rc).toMatchObject({ major: 4, minor: 3, patch: 0, channel: "rc", channelOrdinal: 1 });

    const dev = parseGodotExecutableVersion("4.4.dev");
    expect(dev.ok).toBe(true);
    if (dev.ok) expect(dev).toMatchObject({ channel: "dev", channelOrdinal: 0 });

    const vprefixed = parseGodotExecutableVersion("v4.2.1.stable");
    expect(vprefixed.ok).toBe(true);

    const mono = parseGodotExecutableVersion("4.2.2.stable.mono.official.15073afe3");
    expect(mono.ok).toBe(true);
  });

  test("fails closed on non-Godot output", () => {
    expect(parseGodotExecutableVersion("Blender 4.1.1").ok).toBe(false);
    expect(parseGodotExecutableVersion("not a version").ok).toBe(false);
    expect(parseGodotExecutableVersion("").ok).toBe(false);
    expect(parseGodotExecutableVersion("4.2").ok).toBe(false);
  });

  test("derives the export-templates version directory name (no build/extra suffix)", () => {
    const stable = parseGodotExecutableVersion("4.2.2.stable.official.15073afe3");
    if (stable.ok) expect(godotTemplatesVersion(stable)).toBe("4.2.2.stable");
    const rc = parseGodotExecutableVersion("4.3.rc1.official.abc");
    if (rc.ok) expect(godotTemplatesVersion(rc)).toBe("4.3.rc1");
    const dev = parseGodotExecutableVersion("4.4.dev");
    if (dev.ok) expect(godotTemplatesVersion(dev)).toBe("4.4.dev");
  });
});

describe("discoverGodot (injected environment; fail-closed outcomes)", () => {
  test("an authoritative env override that does not exist is unavailable — never a fallback", async () => {
    const missing = path.join(scratch, "does-not-exist");
    const discovery = discoverGodot({ env: { ...EMPTY_ENV, [GODOT_PATH_ENV]: missing }, roots: [] });
    expect(discovery.status).toBe("unavailable");
    expect(discovery.executable).toBeNull();
    expect(discovery.reason).toContain(missing);
  });

  test("a non-Godot binary under the override is version-unknown — never available-by-guess", async () => {
    const fake = await fakeExecutable("Blender 4.1.1");
    const discovery = discoverGodot({ env: { ...EMPTY_ENV, [GODOT_PATH_ENV]: fake }, roots: [] });
    expect(discovery.status).toBe("version-unknown");
    expect(discovery.executable).toBe(fake);
    expect(discovery.reason).toBeTruthy();
  });

  test("a Godot-grammar version below the family minimum is unavailable with an honest reason", async () => {
    const fake = await fakeExecutable("4.1.3.stable.official.abcdef1234");
    const discovery = discoverGodot({ env: { ...EMPTY_ENV, [GODOT_PATH_ENV]: fake }, roots: [] });
    expect(discovery.status).toBe("unavailable");
    expect(discovery.reason).toContain("4.1.3");
  });

  test("a satisfying version under the override is available with the parsed family version", async () => {
    const fake = await fakeExecutable("4.2.2.stable.official.15073afe3");
    const discovery = discoverGodot({ env: { ...EMPTY_ENV, [GODOT_PATH_ENV]: fake }, roots: [] });
    expect(discovery.status).toBe("available");
    expect(discovery.executable).toBe(fake);
    expect(discovery.rawVersion).toBe("4.2.2.stable.official.15073afe3");
    expect(discovery.parsed).toMatchObject({ major: 4, minor: 2, patch: 2, channel: "stable" });
  });

  test("a pre-release of a FUTURE minor passes the >=4.2 family grammar (4.3.rc1)", async () => {
    const fake = await fakeExecutable("4.3.rc1.official.abc123");
    const discovery = discoverGodot({ env: { ...EMPTY_ENV, [GODOT_PATH_ENV]: fake }, roots: [] });
    expect(discovery.status).toBe("available");
  });

  test("no candidate anywhere is an honest unavailable with the search description", () => {
    const discovery = discoverGodot({ env: EMPTY_ENV, roots: [] });
    expect(discovery.status).toBe("unavailable");
    expect(discovery.reason).toContain("no Godot executable found");
  });

  test("default common roots include the /home/z/engines layouts the verified recipe installs", () => {
    const roots = defaultCommonRoots();
    expect(roots.length).toBeGreaterThan(0);
    expect(roots.some((r) => r.includes("/home/z/engines"))).toBe(true);
  });
});
