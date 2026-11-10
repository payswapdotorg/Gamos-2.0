/**
 * M4 WP-5 HARDEN rows — the negative tests of the Unreal connector contract
 * (delivery plan §7 Unreal challenge matrix rows that are mock-testable, plus
 * readiness Deliverable 6 G2 RED-plan rows 1–7). Every row fails closed
 * client-side BEFORE any request is built wherever the contract says so —
 * proven by the mock's request log and transaction counter, never assumed.
 *
 * A mock RC server tests PROTOCOL CONTRACTS ONLY — none of these rows can
 * ever pass M4-G2 (delivery plan §3 order 5 / §9; the real-editor leg is
 * WP-6 on the maintainer-provided UE5 environment).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { UnrealRcConnector } from "../src/connector.js";
import { connectionInspect, propertyRead, propertyWrite, objectInspect, functionInvoke } from "../src/engine.js";
import { parseUnrealObjectPath } from "../src/object-paths.js";
import { startMockRcServer, type MockRcHandle } from "./mock-rc-server.js";

const LIGHT_PATH = "/Game/FirstPerson/Maps/FirstPersonMap.FirstPersonMap:PersistentLevel.PointLight_1";

let mock: MockRcHandle;

beforeAll(async () => {
  mock = await startMockRcServer();
});

afterAll(async () => {
  await mock.close();
});

describe("object-path grammar (U-T5 — fail-closed parse, no free-form URL construction)", () => {
  it("accepts the documented shapes", () => {
    expect(parseUnrealObjectPath("/Script/Engine.PointLight").ok).toBe(true);
    expect(parseUnrealObjectPath(LIGHT_PATH).ok).toBe(true);
    expect(parseUnrealObjectPath("/Game/UI/MyWidget.MyWidget_C:WidgetTree:Panel").ok).toBe(true);
    expect(parseUnrealObjectPath("/Game/Maps/Level").ok).toBe(true);
  });

  it("rejects relative paths, traversal, empty segments, and bare separators", () => {
    expect(parseUnrealObjectPath("Game/Maps/Level").ok).toBe(false);
    expect(parseUnrealObjectPath("/Game/../Engine/Secret").ok).toBe(false);
    expect(parseUnrealObjectPath("/Game//Maps").ok).toBe(false);
    expect(parseUnrealObjectPath("/").ok).toBe(false);
    expect(parseUnrealObjectPath("/Game/").ok).toBe(false);
  });

  it("rejects query-string/credential smuggling, URI syntax, and encoded text", () => {
    expect(parseUnrealObjectPath("/Game/Maps/Level?Passphrase=secret").ok).toBe(false);
    expect(parseUnrealObjectPath("/Game/Maps/Level&x=1").ok).toBe(false);
    expect(parseUnrealObjectPath("/Game/Maps/%2e%2e/Secret").ok).toBe(false);
    expect(parseUnrealObjectPath("/Game/x@evil.internal:Level").ok).toBe(false);
    expect(parseUnrealObjectPath("http://evil/Level").ok).toBe(false);
  });

  it("rejects whitespace, control characters, non-ASCII, and oversized input", () => {
    expect(parseUnrealObjectPath("/Game/My Level").ok).toBe(false);
    expect(parseUnrealObjectPath("/Game/Level\n").ok).toBe(false);
    expect(parseUnrealObjectPath("/Game/Levéel").ok).toBe(false);
    expect(parseUnrealObjectPath(`/Game/${"A".repeat(600)}`).ok).toBe(false);
  });

  it("rejects malformed sub-object components and dotted non-final segments", () => {
    expect(parseUnrealObjectPath("/Game/Maps/Level.Map:").ok).toBe(false); // trailing colon = empty component → must fail
    expect(parseUnrealObjectPath("/Game/My.Dir/Level").ok).toBe(false);
    expect(parseUnrealObjectPath("/Game/Maps/Level.Map:A:B:C:D").ok).toBe(false); // FOUR components exceeds the documented 1..3
    expect(parseUnrealObjectPath("/Game/Maps/Level.Map.Map2").ok).toBe(false);
  });
});

describe("client-side fail-closed rows — refused BEFORE any request is built (G2 RED-plan row 4)", () => {
  it("an invalid object path is refused with zero network round-trips", async () => {
    const describesBefore = mock.requestCount("/remote/object/describe");
    const result = await objectInspect(
      { endpoint: { host: "127.0.0.1", httpPort: mock.httpPort, wsPort: mock.wsPort } },
      { objectPath: "/Game/../Engine/Secret" },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("object-path-invalid");
    expect(mock.requestCount("/remote/object/describe")).toBe(describesBefore);
  });

  it("malformed property names are refused at the frozen input schema (zero round-trips)", async () => {
    const readsBefore = mock.requestCount("/remote/property");
    const result = await propertyRead(
      { endpoint: { host: "127.0.0.1", httpPort: mock.httpPort, wsPort: mock.wsPort } },
      { objectPath: LIGHT_PATH, propertyNames: ["Intensity; DROP TABLE"] },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid-input");
    expect(mock.requestCount("/remote/property")).toBe(readsBefore);
  });

  it("a property write WITHOUT expectPostState is refused at the schema (the chain is mandatory)", async () => {
    const transactionsBefore = mock.transactions();
    const result = await propertyWrite(
      {
        endpoint: { host: "127.0.0.1", httpPort: mock.httpPort, wsPort: mock.wsPort },
        propertyAllowlist: [{ propertyName: "Intensity", objectPathPrefix: "/Game/", valueSchema: z.number() }],
      },
      { objectPath: LIGHT_PATH, property: "Intensity", value: 5 },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid-input");
    expect(mock.transactions()).toBe(transactionsBefore);
  });

  it("a grammar-invalid functionName is refused at the schema (zero round-trips)", async () => {
    const callsBefore = mock.requestCount("/remote/object/call");
    const result = await functionInvoke(
      {
        endpoint: { host: "127.0.0.1", httpPort: mock.httpPort, wsPort: mock.wsPort },
        functionAllowlist: [{ functionName: "SetIntensity", objectPathPrefix: "/Game/", argumentSchema: z.object({}) }],
      },
      { objectPath: LIGHT_PATH, functionName: "not a valid name!", arguments: {} },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid-input");
    expect(mock.requestCount("/remote/object/call")).toBe(callsBefore);
  });
});

describe("authentication refusals (U-T2 — transport token, never a claim of server-side auth)", () => {
  it("401 refusals resolve to rc-auth-required with EXACTLY one request — never a retry storm", async () => {
    const gated = await startMockRcServer({ requirePassphrase: true, passphrase: "correct-horse" });
    try {
      const propertyRequestsStart = 0; // fresh server: zero so far
      const result = await propertyRead(
        {
          endpoint: { host: "127.0.0.1", httpPort: gated.httpPort, wsPort: gated.wsPort },
          passphrase: "wrong-token",
          opTimeoutMs: { propertyRead: 3_000 },
        },
        { objectPath: LIGHT_PATH, propertyNames: ["Intensity"] },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe("rc-auth-required");
      expect(gated.requestCount("/remote/property")).toBe(propertyRequestsStart + 1);
      expect(result.message).not.toMatch(/authenticat(ed|ion)\s+(succe|proof)/i);
    } finally {
      await gated.close();
    }
  });
});

describe("unknown route shapes and schema drift (U-T7 — fail closed, never a silent parse)", () => {
  it("an alien /remote/info shape resolves to rc-schema-mismatch", async () => {
    const alien = await startMockRcServer({ infoShape: "alien" });
    try {
      const result = await connectionInspect({
        endpoint: { host: "127.0.0.1", httpPort: alien.httpPort, wsPort: alien.wsPort },
      }, {});
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe("rc-schema-mismatch");
    } finally {
      await alien.close();
    }
  });
});

describe("bounded time — the wedged editor resolves to rc-timeout, not a hang (U-T6)", () => {
  it("a slow editor fails the per-op timeout bound and the op returns promptly", async () => {
    const slow = await startMockRcServer({ responseDelayMs: 2_000 });
    try {
      const started = Date.now();
      const result = await propertyRead(
        {
          endpoint: { host: "127.0.0.1", httpPort: slow.httpPort, wsPort: slow.wsPort },
          opTimeoutMs: { propertyRead: 250 },
        },
        { objectPath: LIGHT_PATH, propertyNames: ["Intensity"] },
      );
      const elapsed = Date.now() - started;
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe("rc-timeout");
      expect(elapsed).toBeLessThan(1_500);
    } finally {
      await slow.close();
    }
  });
});

describe("no auto-reconnect anywhere (U-T6 — the harness owns lifecycle)", () => {
  it("a dropped WebSocket is surfaced as disconnected and NEVER reconnected by the connector", async () => {
    const connector = new UnrealRcConnector({
      endpoint: { host: "127.0.0.1", httpPort: mock.httpPort, wsPort: mock.wsPort },
    });
    await connector.connect();
    const ws = await connector.connectWs();
    expect(ws.ok).toBe(true);
    expect(mock.wsConnections()).toBe(1);
    mock.terminateAllWs();
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(connector.state().wsConnected).toBe(false);
    // No reconnect happened: the connection count stays at zero.
    expect(mock.wsConnections()).toBe(0);
    await connector.disconnect();
  });
});

describe("transaction discipline (U-T3 — the write-not-taken row; exit code alone proves nothing)", () => {
  it("a write the editor silently refuses is DETECTED by the post-state re-read and fails closed with the rollback chain", async () => {
    const refusing = await startMockRcServer({ lockedProperties: ["Intensity"] });
    try {
      const original = refusing.objects.get(LIGHT_PATH)?.properties.Intensity;
      const result = await propertyWrite(
        {
          endpoint: { host: "127.0.0.1", httpPort: refusing.httpPort, wsPort: refusing.wsPort },
          propertyAllowlist: [{ propertyName: "Intensity", objectPathPrefix: "/Game/", valueSchema: z.number() }],
        },
        { objectPath: LIGHT_PATH, property: "Intensity", value: 12345, expectPostState: 12345 },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe("rc-transaction-failed");
      // The editor never took the write: the store still holds the original.
      expect(refusing.objects.get(LIGHT_PATH)?.properties.Intensity).toBe(original);
      // The "editor" is still alive — the failure never escalated to anything destructive.
      expect(await refusing.isAlive()).toBe(true);
    } finally {
      await refusing.close();
    }
  });
});

describe("teardown failure surfacing (U-T4 — never swallowed, never the editor)", () => {
  it("disconnect stops in-flight requests, reports the aborts, and leaves the externally owned editor alive", async () => {
    const slow = await startMockRcServer({ responseDelayMs: 5_000 });
    try {
      const connector = new UnrealRcConnector({
        endpoint: { host: "127.0.0.1", httpPort: slow.httpPort, wsPort: slow.wsPort },
      });
      await connector.connect();
      // Leave a read in flight, then tear down.
      const inFlight = connector.readProperty(LIGHT_PATH, "Intensity", 8_000);
      await new Promise((resolve) => setTimeout(resolve, 150));
      const report = await connector.disconnect();
      const outcome = await inFlight;
      expect(outcome.ok).toBe(false);
      expect(report.closed).toBe(true);
      expect(report.inFlightAborted).toBeGreaterThanOrEqual(1);
      expect(report.failures.length).toBeGreaterThanOrEqual(1);
      // The "editor" (the mock) is STILL LISTENING — nothing was terminated.
      expect(await slow.isAlive()).toBe(true);
    } finally {
      await slow.close();
    }
  });

  it("the connector has NO editor-termination path at all (structural pin)", async () => {
    const connectorSource = await readFile(
      fileURLToPath(new URL("../src/connector.ts", import.meta.url)),
      "utf8",
    );
    const engineSource = await readFile(fileURLToPath(new URL("../src/engine.ts", import.meta.url)), "utf8");
    for (const source of [connectorSource, engineSource]) {
      expect(source).not.toMatch(/child_process/);
      expect(source).not.toMatch(/\.kill\s*\(/);
      expect(source).not.toMatch(/spawnSync|execSync|execFile/);
      expect(source).not.toMatch(/process\.exit/);
    }
  });

  it("the externally owned editor survives MANY connector lifecycles", async () => {
    for (let i = 0; i < 3; i += 1) {
      const connector = new UnrealRcConnector({
        endpoint: { host: "127.0.0.1", httpPort: mock.httpPort, wsPort: mock.wsPort },
      });
      await connector.connect();
      await connector.connectWs();
      await connector.subscribe("editorPropertyChanged");
      const report = await connector.disconnect();
      expect(report.closed).toBe(true);
      expect(report.wsClosed).toBe(true);
    }
    expect(mock.wsConnections()).toBe(0);
    expect(await mock.isAlive()).toBe(true);
  });
});

describe("unknown objects fail closed with the honest editor verdict (G3 rows)", () => {
  it("a well-formed but nonexistent object path surfaces the editor's 404 as object-not-found", async () => {
    const result = await objectInspect(
      { endpoint: { host: "127.0.0.1", httpPort: mock.httpPort, wsPort: mock.wsPort } },
      { objectPath: "/Game/Maps/DoesNotExist.Map" },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("object-not-found");
  });
});
