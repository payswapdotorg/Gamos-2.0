/**
 * M4 WP-5 binding contract tests — the Unreal Remote Control connector
 * against the in-repo mock RC server (the EDITOR STAND-IN; protocol
 * contracts ONLY — a mock can never pass M4-G2, delivery plan §3 order 5).
 *
 * These tests landed FIRST (RED): every failure against the stub surface is
 * a MISSING-BEHAVIOR failure (delivery plan §4 TDD discipline). The contract
 * sources: readiness §4.2 (corrected connector design), §2.2 U-T1..U-T8,
 * the capability contracts §3 (the WP-4 records), and the delivery plan §5.2
 * (Unreal security requirements).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { LoopbackOnlyError, UnrealRcConnector } from "../src/connector.js";
import { discoverUnrealRcEndpoint } from "../src/discovery.js";
import {
  connectionInspect,
  functionInvoke,
  objectInspect,
  propertyRead,
  propertyWrite,
  rollbackToSnapshot,
  type UnrealPluginConfig,
} from "../src/engine.js";
import { REVIEWED_FUNCTION_ALLOWLIST } from "../src/function-allowlist.js";
import { REVIEWED_PROPERTY_ALLOWLIST } from "../src/typed-ops.js";
import { startMockRcServer, type MockRcHandle } from "./mock-rc-server.js";

const LIGHT_PATH = "/Game/FirstPerson/Maps/FirstPersonMap.FirstPersonMap:PersistentLevel.PointLight_1";

let mock: MockRcHandle;
let baseConfig: UnrealPluginConfig;

/** REVIEW-CLASS injected allowlists (the protocol-machinery rows; the SHIPPED registries stay empty). */
const reviewedIntensityProperty = [{ propertyName: "Intensity", objectPathPrefix: "/Game/", valueSchema: z.number() }];
const reviewedSetIntensityFunction = [
  { functionName: "SetIntensity", objectPathPrefix: "/Game/", argumentSchema: z.object({ value: z.number() }) },
];

beforeAll(async () => {
  mock = await startMockRcServer();
  baseConfig = {
    endpoint: { host: "127.0.0.1", httpPort: mock.httpPort, wsPort: mock.wsPort },
  };
});

afterAll(async () => {
  await mock.close();
});

describe("construction — loopback-only client config (U-T1, fail closed BEFORE any request)", () => {
  it("refuses a non-loopback configured host at construction (throw, not warn)", () => {
    expect(
      () => new UnrealRcConnector({ endpoint: { host: "10.0.0.5", httpPort: 30010, wsPort: 30020 } }),
    ).toThrow(LoopbackOnlyError);
  });

  it("refuses `localhost` — a resolvable name proves nothing about the address it resolves to", () => {
    expect(() => new UnrealRcConnector({ endpoint: { host: "localhost", httpPort: 30010, wsPort: 30020 } })).toThrow(
      LoopbackOnlyError,
    );
  });

  it("refuses an off-host IPv4 and a hostname with dots (never dialed)", () => {
    expect(() => new UnrealRcConnector({ endpoint: { host: "192.168.1.10", httpPort: 30010, wsPort: 30020 } })).toThrow(
      LoopbackOnlyError,
    );
    expect(() => new UnrealRcConnector({ endpoint: { host: "editor.internal", httpPort: 30010, wsPort: 30020 } })).toThrow(
      LoopbackOnlyError,
    );
  });

  it("accepts the literal loopback forms", () => {
    expect(
      () => new UnrealRcConnector({ endpoint: { host: "127.0.0.1", httpPort: 30010, wsPort: 30020 } }),
    ).not.toThrow();
    expect(() => new UnrealRcConnector({ endpoint: { host: "::1", httpPort: 30010, wsPort: 30020 } })).not.toThrow();
  });
});

describe("HTTP attach lifecycle — connection.inspect (the server-REPORTED binding is the authority, U-T1)", () => {
  it("connects and returns the pinned info shape with the INSPECTED listener binding", async () => {
    const result = await connectionInspect(baseConfig, {});
    if (!result.ok) {
      expect(result, `connectionInspect must succeed: ${result.message}`).toBeTruthy();
      return;
    }
    expect(result.editorVersion).toBe("5.3.2");
    expect(result.remoteControlVersion).toBe("1.0");
    expect(result.routes).toContain("/remote/info");
    expect(result.routes).toContain("/remote/property");
    // The binding is the server's OWN report — the actual ephemeral ports,
    // never the client's requested address.
    expect(result.listenerBinding.httpPort).toBe(mock.httpPort);
    expect(result.listenerBinding.wsPort).toBe(mock.wsPort);
    expect(result.listenerBinding.httpBindAddress).toBe("127.0.0.1");
    expect(result.listenerBinding.wsBindAddress).toBe("127.0.0.1");
    // The op's own teardown ran and surfaced no failures.
    expect(result.teardown.closed).toBe(true);
    expect(result.teardown.failures).toEqual([]);
  });

  it("resolves unavailable (rc-listener-not-loopback) when the server reports a non-loopback binding", async () => {
    const lanBound = await startMockRcServer({ httpBind: "0.0.0.0", wsBind: "0.0.0.0" });
    try {
      const config: UnrealPluginConfig = {
        endpoint: { host: "127.0.0.1", httpPort: lanBound.httpPort, wsPort: lanBound.wsPort },
      };
      const result = await connectionInspect(config, {});
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe("rc-listener-not-loopback");
    } finally {
      await lanBound.close();
    }
  });
});

describe("typed object inspection — unreal/object.inspect (§3.2)", () => {
  it("describes a validated object path through the real mock editor", async () => {
    const result = await objectInspect(baseConfig, { objectPath: LIGHT_PATH });
    if (!result.ok) {
      expect(result, `objectInspect must succeed: ${result.message}`).toBeTruthy();
      return;
    }
    expect(result.objectPath).toBe(LIGHT_PATH);
    expect(result.class).toBe("PointLight");
    expect(result.properties.map((p) => p.name)).toContain("Intensity");
    expect(result.properties.map((p) => p.name)).toContain("Visible");
    expect(result.outerPath).toBe("/Game/FirstPerson/Maps/FirstPersonMap.FirstPersonMap:PersistentLevel");
  });
});

describe("typed property reads — unreal/property.read (§3.3, READ_ACCESS)", () => {
  it("reads an allowlisted name set from the live editor state", async () => {
    const result = await propertyRead(baseConfig, { objectPath: LIGHT_PATH, propertyNames: ["Intensity", "Visible"] });
    if (!result.ok) {
      expect(result, `propertyRead must succeed: ${result.message}`).toBeTruthy();
      return;
    }
    expect(result.values).toEqual({ Intensity: 8000, Visible: true });
  });
});

describe("typed property writes — unreal/property.write (§3.4, the five-part chain, U-T3)", () => {
  it("pre-snapshots, applies with a transaction, and verifies the post-state by re-read", async () => {
    const before = mock.objects.get(LIGHT_PATH)?.properties.Intensity;
    expect(before).toBe(8000);
    const config: UnrealPluginConfig = {
      ...baseConfig,
      propertyAllowlist: reviewedIntensityProperty,
    };
    const result = await propertyWrite(config, {
      objectPath: LIGHT_PATH,
      property: "Intensity",
      value: 12000,
      expectPostState: 12000,
    });
    if (!result.ok) {
      expect(result, `propertyWrite must succeed: ${result.message}`).toBeTruthy();
      return;
    }
    expect(result.applied).toBe(true);
    expect(result.preSnapshot).toBe(8000);
    expect(result.postState).toBe(12000);
    expect(result.transactionId).toMatch(/^txn-/);
    expect(mock.objects.get(LIGHT_PATH)?.properties.Intensity).toBe(12000);
  });

  it("expectPreState mismatches are refused BEFORE the write request is built", async () => {
    const transactionsBefore = mock.transactions();
    const config: UnrealPluginConfig = {
      ...baseConfig,
      propertyAllowlist: reviewedIntensityProperty,
    };
    const result = await propertyWrite(config, {
      objectPath: LIGHT_PATH,
      property: "Intensity",
      value: 999,
      expectPreState: 424242, // the live value is 12000 (the previous test's verified write)
      expectPostState: 999,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("precondition-failed");
    // Only the pre-snapshot read happened — NO transaction was issued.
    expect(mock.transactions()).toBe(transactionsBefore);
  });

  it("rollbackToSnapshot restores the pre-snapshot value and verifies the post-rollback state against the snapshot", async () => {
    const config: UnrealPluginConfig = {
      ...baseConfig,
      propertyAllowlist: reviewedIntensityProperty,
    };
    const rolled = await rollbackToSnapshot(config, {
      objectPath: LIGHT_PATH,
      property: "Intensity",
      preSnapshot: 8000,
    });
    if (!rolled.ok) {
      expect(rolled, `rollbackToSnapshot must succeed: ${rolled.message}`).toBeTruthy();
      return;
    }
    expect(rolled.restoredTo).toBe(8000);
    expect(rolled.postRollbackState).toBe(8000);
    expect(rolled.verifiedAgainstSnapshot).toBe(true);
    expect(mock.objects.get(LIGHT_PATH)?.properties.Intensity).toBe(8000);
  });
});

describe("individually allowlisted function invocation — unreal/function.invoke (§3.5)", () => {
  it("the SHIPPED allowlist is EMPTY at 0.1.0 — every functionName fails closed client-side (zero call requests)", async () => {
    expect(REVIEWED_FUNCTION_ALLOWLIST).toEqual([]);
    const callsBefore = mock.requestCount("/remote/object/call");
    const result = await functionInvoke(baseConfig, {
      objectPath: LIGHT_PATH,
      functionName: "SetIntensity",
      arguments: { value: 1 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("function-not-allowlisted");
    expect(mock.requestCount("/remote/object/call")).toBe(callsBefore);
  });

  it("the SHIPPED property allowlist is EMPTY at 0.1.0 — every property write fails closed client-side (zero transactions)", async () => {
    expect(REVIEWED_PROPERTY_ALLOWLIST).toEqual([]);
    const transactionsBefore = mock.transactions();
    const result = await propertyWrite(baseConfig, {
      objectPath: LIGHT_PATH,
      property: "Intensity",
      value: 5,
      expectPostState: 5,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("property-not-allowlisted");
    expect(mock.transactions()).toBe(transactionsBefore);
  });

  it("an injected REVIEW-CLASS entry exercises the protocol: generateTransaction:true is honored", async () => {
    const config: UnrealPluginConfig = {
      ...baseConfig,
      functionAllowlist: reviewedSetIntensityFunction,
    };
    const result = await functionInvoke(config, {
      objectPath: LIGHT_PATH,
      functionName: "SetIntensity",
      arguments: { value: 6000 },
    });
    if (!result.ok) {
      expect(result, `functionInvoke must succeed: ${result.message}`).toBeTruthy();
      return;
    }
    expect(result.functionName).toBe("SetIntensity");
    expect(result.returnValue).toBe(true);
    // The mock only issues a transactionId when generateTransaction === true.
    expect(result.transactionId).toMatch(/^txn-/);
    expect(mock.objects.get(LIGHT_PATH)?.properties.Intensity).toBe(6000);
  });

  it("an injected allowlist entry for a DIFFERENT function still refuses the unlisted name", async () => {
    const config: UnrealPluginConfig = {
      ...baseConfig,
      functionAllowlist: reviewedSetIntensityFunction,
    };
    const callsBefore = mock.requestCount("/remote/object/call");
    const result = await functionInvoke(config, {
      objectPath: LIGHT_PATH,
      functionName: "K2Node_ExecuteConsoleCommand",
      arguments: {},
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("function-not-allowlisted");
    expect(mock.requestCount("/remote/object/call")).toBe(callsBefore);
  });
});

describe("HTTP/WS lifecycle and teardown (U-T4/U-T6)", () => {
  it("connectWs + subscribe + event delivery + unsubscribe, tracked on both sides", async () => {
    const connector = new UnrealRcConnector({
      endpoint: { host: "127.0.0.1", httpPort: mock.httpPort, wsPort: mock.wsPort },
    });
    const attached = await connector.connect();
    if (!attached.ok) {
      expect(attached, `connect must succeed: ${attached.message}`).toBeTruthy();
      return;
    }
    const wsResult = await connector.connectWs();
    if (!wsResult.ok) {
      expect(wsResult, `connectWs must succeed: ${wsResult.message}`).toBeTruthy();
      return;
    }
    const sub = await connector.subscribe("editorPropertyChanged");
    if (!sub.ok) {
      expect(sub, `subscribe must succeed: ${sub.message}`).toBeTruthy();
      return;
    }
    expect(mock.subscriptions()).toContain("editorPropertyChanged");
    expect(connector.state().subscriptions).toContain("editorPropertyChanged");

    const received: unknown[] = [];
    connector.onServerFrame((frame) => {
      if (frame.type === "event") received.push(frame.payload);
    });
    mock.emitEvent("editorPropertyChanged", { objectPath: LIGHT_PATH });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(received).toEqual([{ objectPath: LIGHT_PATH }]);

    const unsub = await connector.unsubscribe("editorPropertyChanged");
    expect(unsub.ok).toBe(true);
    expect(mock.subscriptions()).not.toContain("editorPropertyChanged");

    const report = await connector.disconnect();
    expect(report.closed).toBe(true);
    expect(report.wsClosed).toBe(true);
    expect(report.failures).toEqual([]);
    expect(mock.wsConnections()).toBe(0);
    // The externally owned "editor" is STILL ALIVE after teardown (U-T4).
    expect(await mock.isAlive()).toBe(true);
  });

  it("a raw connector write journals the applied mutation and disconnect RESTORES it (only its own authorized changes)", async () => {
    const original = mock.objects.get(LIGHT_PATH)?.properties.Intensity;
    const connector = new UnrealRcConnector({
      endpoint: { host: "127.0.0.1", httpPort: mock.httpPort, wsPort: mock.wsPort },
      propertyAllowlist: reviewedIntensityProperty,
    });
    const attached = await connector.connect();
    if (!attached.ok) {
      expect(attached, `connect must succeed: ${attached.message}`).toBeTruthy();
      return;
    }
    const written = await connector.writeProperty(LIGHT_PATH, "Intensity", 31337);
    if (!written.ok) {
      expect(written, `writeProperty must succeed: ${written.message}`).toBeTruthy();
      return;
    }
    // Applied but chain-unverified: the journal holds the previous value.
    expect(connector.journal().length).toBe(1);
    expect(connector.journal()[0]?.previousValue).toBe(original);

    const report = await connector.disconnect();
    expect(report.rolledBack.length).toBe(1);
    expect(report.rolledBack[0]?.restored).toBe(true);
    expect(mock.objects.get(LIGHT_PATH)?.properties.Intensity).toBe(original);
    expect(await mock.isAlive()).toBe(true);
  });

  it("disconnect is idempotent, clears state, and never touches the editor", async () => {
    const connector = new UnrealRcConnector({
      endpoint: { host: "127.0.0.1", httpPort: mock.httpPort, wsPort: mock.wsPort },
    });
    await connector.connect();
    const first = await connector.disconnect();
    expect(first.closed).toBe(true);
    const second = await connector.disconnect();
    expect(second.closed).toBe(true);
    expect(second.failures).toEqual([]);
    expect(connector.state().connected).toBe(false);
    expect(await mock.isAlive()).toBe(true);
  });
});

describe("endpoint discovery — honest availability (readiness Deliverable 3 row)", () => {
  it("reports available with the parsed family-grammar version for a running editor", async () => {
    const result = await discoverUnrealRcEndpoint({
      endpoint: { host: "127.0.0.1", httpPort: mock.httpPort, wsPort: mock.wsPort },
    });
    if (result.status !== "available") {
      expect(result, `discovery must be available: ${result.detail}`).toBeTruthy();
      return;
    }
    expect(result.editorVersion).toBe("5.3.2");
    expect(result.listenerBinding.httpPort).toBe(mock.httpPort);
  });

  it("reports unavailable (rc-endpoint-absent) when nothing listens — no retries, no hang", async () => {
    const result = await discoverUnrealRcEndpoint({
      endpoint: { host: "127.0.0.1", httpPort: 1, wsPort: 1 }, // port 1: nothing there
      timeoutMs: 2_000,
    });
    expect(result.status).toBe("unavailable");
    if (result.status === "available") return;
    expect(result.reason).toBe("rc-endpoint-absent");
  });

  it("reports unavailable (auth-required) on 401 refusals — never a retry storm", async () => {
    const gated = await startMockRcServer({ requirePassphrase: true, gateInfoRoute: true, passphrase: "correct-horse" });
    try {
      const result = await discoverUnrealRcEndpoint({
        endpoint: { host: "127.0.0.1", httpPort: gated.httpPort, wsPort: gated.wsPort },
        timeoutMs: 2_000,
      });
      expect(result.status).toBe("unavailable");
      if (result.status === "available") return;
      expect(result.reason).toBe("rc-auth-required");
      expect(gated.requestLog.length).toBe(1);
    } finally {
      await gated.close();
    }
  });

  it("reports unavailable (version-unknown) for an unparseable editor version — fail closed", async () => {
    const weird = await startMockRcServer({ editorVersion: "not-a-version" });
    try {
      const result = await discoverUnrealRcEndpoint({
        endpoint: { host: "127.0.0.1", httpPort: weird.httpPort, wsPort: weird.wsPort },
        timeoutMs: 2_000,
      });
      expect(result.status).toBe("unavailable");
      if (result.status === "available") return;
      expect(result.reason).toBe("version-unknown");
    } finally {
      await weird.close();
    }
  });
});
