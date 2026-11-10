import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { UnsafePassphraseError, UnrealRcConnector } from "../src/connector.js";
import { connectionInspect, propertyRead, propertyWrite, rollbackToSnapshot, type UnrealPluginConfig } from "../src/engine.js";
import { startMockRcServer, type MockRcHandle } from "./mock-rc-server.js";

/**
 * M4 WP-8 — the Unreal challenge-matrix rows that had no executed evidence
 * (the WP-8 audit of delivery plan §7), all against the in-repo mock RC
 * server (an EDITOR STAND-IN — protocol contracts ONLY; a mock can never
 * pass M4-G2; the real-editor leg is WP-6 on the maintainer-provided UE5
 * environment per §10):
 *
 * - U3 (passphrase bypass / inconsistent route authentication): a full
 *   lifecycle proving the attach probe succeeding while the gated routes
 *   refuse a wrong-token client (attach ≠ authentication — exactly the
 *   documented per-route inconsistency), with exactly one request per
 *   refused operation (no retry storm); plus the UnsafePassphraseError
 *   header-injection guard row.
 * - U7 (transaction and rollback failure): the locked-write row now also
 *   pins details.rollbackRestored === true (the rollback chain RAN and
 *   verified); and a NEW fail-closed row — a rollback whose restore is
 *   silently refused must NOT report success (rc-rollback-not-verified with
 *   the detected post-rollback state).
 * - U8 (socket teardown failure): the WebSocket close-handshake timeout
 *   path — a wedged editor that never acks the close frame surfaces
 *   wsClosed:false + the close-handshake failure while the editor stays
 *   LISTENING.
 */

const LIGHT_PATH = "/Game/FirstPerson/Maps/FirstPersonMap.FirstPersonMap:PersistentLevel.PointLight_1";

let mock: MockRcHandle;
let baseConfig: UnrealPluginConfig;

/** REVIEW-CLASS injected allowlist (the SHIPPED registry stays EMPTY at 0.1.0). */
const reviewedIntensityProperty = [{ propertyName: "Intensity", objectPathPrefix: "/Game/", valueSchema: z.number() }];

beforeAll(async () => {
  mock = await startMockRcServer();
  baseConfig = { endpoint: { host: "127.0.0.1", httpPort: mock.httpPort, wsPort: mock.wsPort } };
});

afterAll(async () => {
  await mock.close();
});

describe("§7 U3 — inconsistent route authentication in ONE lifecycle (attach succeeds, gated routes refuse)", () => {
  it("a wrong-token client attaches successfully (ungated /remote/info) while the gated routes refuse — attach is NOT authentication", async () => {
    const strictMock = await startMockRcServer({ requirePassphrase: true, passphrase: "the-real-secret" });
    try {
      const config: UnrealPluginConfig = {
        endpoint: { host: "127.0.0.1", httpPort: strictMock.httpPort, wsPort: strictMock.wsPort },
        // the client's token does NOT match the editor's — the default "no_key"
      };
      const attach = await connectionInspect(config, {});
      expect(attach.ok).toBe(true);
      const readsBefore = strictMock.requestCount("/remote/property");
      const read = await propertyRead(config, { objectPath: LIGHT_PATH, propertyNames: ["Intensity"] });
      expect(read.ok).toBe(false);
      if (read.ok) return;
      expect(read.code).toBe("rc-auth-required");
      // Exactly ONE request — no retry storm, no authentication-success wording.
      expect(strictMock.requestCount("/remote/property")).toBe(readsBefore + 1);
      expect(read.message).not.toMatch(/authenticat(ed|ion)\s+(succe|proof)/i);
      // The attach probe still succeeds afterwards — the connector does not
      // treat a 401 as a dead connection.
      const reattach = await connectionInspect(config, {});
      expect(reattach.ok).toBe(true);
    } finally {
      await strictMock.close();
    }
  });

  it("a header-unsafe passphrase is refused at CONSTRUCTION (UnsafePassphraseError, before any request)", () => {
    expect(
      () =>
        new UnrealRcConnector({
          endpoint: { host: "127.0.0.1", httpPort: mock.httpPort, wsPort: mock.wsPort },
          passphrase: "bad\nX-Injected: header",
        }),
    ).toThrow(UnsafePassphraseError);
    expect(
      () =>
        new UnrealRcConnector({
          endpoint: { host: "127.0.0.1", httpPort: mock.httpPort, wsPort: mock.wsPort },
          passphrase: "bad\r\nX-Injected: header",
        }),
    ).toThrow(UnsafePassphraseError);
  });
});

describe("§7 U7 — rollback failure detection (verified against the pre-snapshot, never assumed)", () => {
  it("the locked-write failure carries details.rollbackRestored === true (the rollback chain RAN and verified)", async () => {
    const lockedMock = await startMockRcServer({ lockedProperties: ["Intensity"] });
    try {
      const config: UnrealPluginConfig = {
        endpoint: { host: "127.0.0.1", httpPort: lockedMock.httpPort, wsPort: lockedMock.wsPort },
        propertyAllowlist: reviewedIntensityProperty,
      };
      const result = await propertyWrite(config, {
        objectPath: LIGHT_PATH,
        property: "Intensity",
        value: 5,
        expectPostState: 5,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe("rc-transaction-failed");
      expect(result.details).toMatchObject({ rollbackRestored: true });
      // The editor is still alive — a failed transaction never terminates it.
      expect(await lockedMock.isAlive()).toBe(true);
    } finally {
      await lockedMock.close();
    }
  });

  it("a rollback whose restore is SILENTLY REFUSED fails closed — rc-rollback-not-verified, never ok:true", async () => {
    const lockedMock = await startMockRcServer({ lockedProperties: ["Intensity"] });
    try {
      const config: UnrealPluginConfig = {
        endpoint: { host: "127.0.0.1", httpPort: lockedMock.httpPort, wsPort: lockedMock.wsPort },
        propertyAllowlist: reviewedIntensityProperty,
      };
      // The editor currently holds 8000; we ask to "roll back" to 1234 — the
      // locked property silently refuses the restore write, so the post-
      // rollback re-read will NOT match the snapshot. This must be DETECTED
      // and reported as a failure, never as a successful rollback.
      const result = await rollbackToSnapshot(config, {
        objectPath: LIGHT_PATH,
        property: "Intensity",
        preSnapshot: 1234,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe("rc-rollback-not-verified");
      expect(result.details).toMatchObject({ postRollbackState: 8000 });
      expect(await lockedMock.isAlive()).toBe(true);
    } finally {
      await lockedMock.close();
    }
  });
});

describe("§7 U8 — WebSocket close-handshake timeout (a wedged editor that never acks the close frame)", () => {
  it(
    "a wedged close handshake surfaces wsClosed:false + the close-handshake failure while the editor stays LISTENING",
    async () => {
      const wedgedMock = await startMockRcServer();
      try {
        const connector = new UnrealRcConnector({
          endpoint: { host: "127.0.0.1", httpPort: wedgedMock.httpPort, wsPort: wedgedMock.wsPort },
        });
        const attach = await connector.connect();
        expect(attach.ok).toBe(true);
        const ws = await connector.connectWs();
        expect(ws.ok).toBe(true);
        expect(wedgedMock.wsConnections()).toBe(1);

        // Wedge the editor's close handshake: it stops reading its sockets, so
        // the client's close frame is never acked.
        wedgedMock.wedgeWsCloseHandshake();

        const report = await connector.disconnect();
        expect(report.closed).toBe(true);
        expect(report.wsClosed).toBe(false);
        expect(report.failures.some((f) => f.message.includes("close handshake did not complete"))).toBe(true);
        // The externally owned editor is STILL alive and listening.
        expect(await wedgedMock.isAlive()).toBe(true);
      } finally {
        await wedgedMock.close();
      }
    },
    15_000,
  );
});
