/**
 * The in-repo mock Unreal Remote Control server (M4 WP-5 test fixture).
 *
 * This is the EDITOR STAND-IN the contract tests attach to: a plain Node
 * HTTP server + a `ws` WebSocket server implementing EXACTLY the pinned wire
 * contract of src/rc-protocol.ts. It exists to test the connector's PROTOCOL
 * CONTRACTS ONLY — a mock can NEVER pass M4-G2 (delivery plan §3 order 5 /
 * §9: the real-editor acceptance leg is WP-6 on the maintainer-provided UE5
 * environment), and nothing in this file is ever shipped in dist/.
 *
 * Honesty properties the mock itself must model:
 *   - the `/remote/info` response reports the ACTUAL bound addresses and
 *     ports of THIS server (the editor's own report of its listeners — the
 *     binding the connector must verify loopback-only; bind "0.0.0.0" in the
 *     U-T1 negative row and the mock reports that truthfully);
 *   - the Passphrase header gates the mutation routes but NOT /remote/info
 *     (mirroring the documented per-route inconsistency — unreal-rc README
 *     line 56, readiness §2.2 U-T2);
 *   - every request is logged (method + route + count) so client-side
 *     fail-closed rows can prove ZERO network round-trips and NO retry
 *     storms;
 *   - `lockedProperties` models an editor that silently refuses a write (the
 *     write-not-taken row: the post-state re-read mismatches expectPostState);
 *   - the mock is the EXTERNALLY OWNED EDITOR for teardown contracts: the
 *     connector must leave it alive and listening after every lifecycle.
 */

import { createServer, type IncomingMessage, type Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";

export interface MockRcOptions {
  /** HTTP bind: "127.0.0.1" (default) or "0.0.0.0" (the U-T1 negative row). */
  httpBind?: string;
  /** WS bind: same semantics. */
  wsBind?: string;
  /** Ports: 0 (default) = ephemeral, so parallel tests never collide. */
  httpPort?: number;
  wsPort?: number;
  /** When true, the mutation routes require the correct Passphrase header. */
  requirePassphrase?: boolean;
  /** The expected passphrase value (default: the connector's shipped default). */
  passphrase?: string;
  /** The reported editor version (default "5.3.2"). */
  editorVersion?: string;
  /** Global response delay in ms (the slow/wedged editor rows). */
  responseDelayMs?: number;
  /** Property names whose writes are silently refused by the "editor". */
  lockedProperties?: string[];
  /** When true, even /remote/info requires the Passphrase header (the U-T2 401 row). */
  gateInfoRoute?: boolean;
  /** When "alien", /remote/info returns an unknown shape (the rc-schema-mismatch row, U-T7). */
  infoShape?: "normal" | "alien";
}

export interface MockObjectEntry {
  class: string;
  outerPath: string;
  properties: Record<string, unknown>;
}

export interface MockRequestLogEntry {
  method: string;
  route: string;
}

export interface MockRcHandle {
  httpPort: number;
  wsPort: number;
  httpBind: string;
  wsBind: string;
  /** The live object store (assert state after operations). */
  objects: Map<string, MockObjectEntry>;
  /** Every received HTTP request (for zero-round-trip / no-retry proofs). */
  requestLog: MockRequestLogEntry[];
  requestCount(route: string): number;
  /** Current WebSocket connection count. */
  wsConnections(): number;
  /** Active event subscriptions across connections. */
  subscriptions(): string[];
  /** Transaction counter (Undo History support — NOT universal rollback). */
  transactions(): number;
  /** Broadcast an event frame to subscribed connections. */
  emitEvent(eventName: string, payload: unknown): void;
  /** Abruptly terminate every WebSocket (the dropped-connection row). */
  terminateAllWs(): void;
  /** True while the "editor" is still alive and listening (teardown proof). */
  isAlive(): Promise<boolean>;
  close(): Promise<void>;
}

const DEFAULT_FIXTURES: Record<string, MockObjectEntry> = {
  "/Script/Engine.PointLight": {
    class: "Class",
    outerPath: "/Script/Engine",
    properties: { Intensity: 8000, Visible: true },
  },
  "/Game/FirstPerson/Maps/FirstPersonMap.FirstPersonMap:PersistentLevel.PointLight_1": {
    class: "PointLight",
    outerPath: "/Game/FirstPerson/Maps/FirstPersonMap.FirstPersonMap:PersistentLevel",
    properties: { Intensity: 8000, Visible: true },
  },
};

/** The mock's reviewed-function surface (the injected-allowlist test target). */
const MOCK_FUNCTIONS: Record<string, (entry: MockObjectEntry, args: Record<string, unknown>) => unknown> = {
  SetIntensity: (entry, args) => {
    const value = args.value;
    if (typeof value !== "number") return false;
    entry.properties.Intensity = value;
    return true;
  },
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Starts the mock Remote Control server (the editor stand-in). */
export async function startMockRcServer(options: MockRcOptions = {}): Promise<MockRcHandle> {
  const httpBind = options.httpBind ?? "127.0.0.1";
  const wsBind = options.wsBind ?? "127.0.0.1";
  const passphrase = options.passphrase ?? "no_key";
  const editorVersion = options.editorVersion ?? "5.3.2";
  const delayMs = options.responseDelayMs ?? 0;
  const locked = new Set(options.lockedProperties ?? []);

  const objects = new Map<string, MockObjectEntry>(
    Object.entries(DEFAULT_FIXTURES).map(([path, entry]) => [path, { ...entry, properties: { ...entry.properties } }]),
  );
  const requestLog: MockRequestLogEntry[] = [];
  let transactionCounter = 0;

  let httpServer: Server;
  const httpReady = new Promise<void>((resolve) => {
    httpServer = createServer((req, res) => {
      const route = req.url ?? "/";
      requestLog.push({ method: req.method ?? "?", route });
      void handleHttp(req, res, route);
    });
    httpServer.listen(options.httpPort ?? 0, httpBind, () => resolve());
  });

  const wsServer = new WebSocketServer({ host: wsBind, port: options.wsPort ?? 0 });
  const perConnectionSubs = new Map<WebSocket, Set<string>>();
  const wsReady = new Promise<void>((resolve, reject) => {
    wsServer.once("listening", () => resolve());
    wsServer.once("error", reject);
  });

  wsServer.on("connection", (ws: WebSocket) => {
    perConnectionSubs.set(ws, new Set());
    ws.on("message", (data) => {
      let frame: { type?: string; eventName?: string };
      try {
        frame = JSON.parse(String(data)) as { type?: string; eventName?: string };
      } catch {
        ws.send(JSON.stringify({ type: "error", reason: "unparseable frame" }));
        return;
      }
      const subs = perConnectionSubs.get(ws);
      if (!subs) return;
      if (frame.type === "subscribe" && typeof frame.eventName === "string") {
        subs.add(frame.eventName);
        ws.send(JSON.stringify({ type: "subscribed", eventName: frame.eventName }));
      } else if (frame.type === "unsubscribe" && typeof frame.eventName === "string") {
        subs.delete(frame.eventName);
        ws.send(JSON.stringify({ type: "unsubscribed", eventName: frame.eventName }));
      } else {
        ws.send(JSON.stringify({ type: "error", reason: "unknown frame type" }));
      }
    });
    ws.on("close", () => {
      perConnectionSubs.delete(ws);
    });
  });

  async function handleHttp(req: IncomingMessage, res: import("node:http").ServerResponse, route: string): Promise<void> {
    try {
      if (delayMs > 0) await sleep(delayMs);
      // The documented per-route inconsistency: the mutation routes may
      // require the Passphrase header even when /remote/info does not
      // (unreal-rc README:56; readiness §2.2 U-T2). gateInfoRoute models the
      // stricter versions where even the info route refuses.
      if (options.requirePassphrase && (options.gateInfoRoute === true || route !== "/remote/info")) {
        const provided = req.headers.passphrase;
        if (typeof provided !== "string" || provided !== passphrase) {
          res.writeHead(401, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "unauthorized" }));
          return;
        }
      }
      if (req.method === "GET" && route === "/remote/info") {
        if (options.infoShape === "alien") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ status: "ok" }));
          return;
        }
        // The editor's OWN report of its actual listeners (never the client's
        // requested address) — the U-T1 verification surface.
        const httpAddr = httpServer!.address();
        const wsAddr = wsServer.address();
        const info = {
          editorVersion,
          remoteControlVersion: "1.0",
          routes: ["/remote/info", "/remote/object/describe", "/remote/property", "/remote/object/call"],
          listenerBinding: {
            httpBindAddress: typeof httpAddr === "object" && httpAddr ? httpAddr.address : httpBind,
            httpPort: typeof httpAddr === "object" && httpAddr ? httpAddr.port : (options.httpPort ?? 0),
            wsBindAddress: typeof wsAddr === "object" && wsAddr ? wsAddr.address : wsBind,
            wsPort: typeof wsAddr === "object" && wsAddr ? wsAddr.port : (options.wsPort ?? 0),
          },
        };
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(info));
        return;
      }

      if (req.method === "PUT" && route === "/remote/object/describe") {
        const body = JSON.parse((await readBody(req)) || "{}") as { objectPath?: string };
        const entry = typeof body.objectPath === "string" ? objects.get(body.objectPath) : undefined;
        if (!entry) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "unknown-object" }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            class: entry.class,
            properties: Object.keys(entry.properties).map((name) => ({ name, type: typeof entry.properties[name] })),
            outerPath: entry.outerPath,
          }),
        );
        return;
      }

      if (req.method === "PUT" && route === "/remote/property") {
        const body = JSON.parse((await readBody(req)) || "{}") as {
          objectPath?: string;
          propertyName?: string;
          accessMode?: string;
          propertyValue?: unknown;
          generateTransaction?: boolean;
        };
        const entry = typeof body.objectPath === "string" ? objects.get(body.objectPath) : undefined;
        if (!entry || typeof body.propertyName !== "string" || !(body.propertyName in entry.properties)) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "unknown-object" }));
          return;
        }
        if (body.accessMode === "READ_ACCESS") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ value: entry.properties[body.propertyName] }));
          return;
        }
        if (body.accessMode === "WRITE_TRANSACTION_ACCESS") {
          transactionCounter += 1;
          const transactionId = body.generateTransaction === true ? `txn-${transactionCounter}` : null;
          if (!locked.has(body.propertyName)) {
            entry.properties[body.propertyName] = body.propertyValue;
          }
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ transactionId }));
          return;
        }
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "unsupported-access-mode" }));
        return;
      }

      if (req.method === "PUT" && route === "/remote/object/call") {
        const body = JSON.parse((await readBody(req)) || "{}") as {
          objectPath?: string;
          functionName?: string;
          arguments?: Record<string, unknown>;
          generateTransaction?: boolean;
        };
        const entry = typeof body.objectPath === "string" ? objects.get(body.objectPath) : undefined;
        const fn = typeof body.functionName === "string" ? MOCK_FUNCTIONS[body.functionName] : undefined;
        if (!entry || !fn) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "unknown-function" }));
          return;
        }
        transactionCounter += 1;
        const transactionId = body.generateTransaction === true ? `txn-${transactionCounter}` : null;
        const returnValue = fn(entry, body.arguments ?? {});
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ returnValue, transactionId }));
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unknown-route" }));
    } catch {
      if (!res.headersSent) {
        res.writeHead(400, { "content-type": "application/json" });
      }
      res.end(JSON.stringify({ error: "bad-request" }));
    }
  }

  await httpReady;
  await wsReady;

  const httpAddress = httpServer!.address();
  const wsAddress = wsServer.address();

  return {
    httpPort: typeof httpAddress === "object" && httpAddress ? httpAddress.port : (options.httpPort ?? 0),
    wsPort: typeof wsAddress === "object" && wsAddress ? wsAddress.port : (options.wsPort ?? 0),
    httpBind,
    wsBind,
    objects,
    requestLog,
    requestCount(route: string): number {
      return requestLog.filter((e) => e.route === route).length;
    },
    wsConnections(): number {
      return perConnectionSubs.size;
    },
    subscriptions(): string[] {
      const all = new Set<string>();
      for (const subs of perConnectionSubs.values()) for (const name of subs) all.add(name);
      return [...all];
    },
    transactions(): number {
      return transactionCounter;
    },
    emitEvent(eventName: string, payload: unknown): void {
      for (const [ws, subs] of perConnectionSubs) {
        if (subs.has(eventName)) {
          ws.send(JSON.stringify({ type: "event", eventName, payload }));
        }
      }
    },
    terminateAllWs(): void {
      for (const ws of perConnectionSubs.keys()) ws.terminate();
    },
    async isAlive(): Promise<boolean> {
      const probeUrl = `http://${httpBind === "0.0.0.0" ? "127.0.0.1" : httpBind}:${typeof httpServer!.address() === "object" && httpServer!.address() ? (httpServer!.address() as import("node:net").AddressInfo).port : 0}/remote/info`;
      try {
        const res = await fetch(probeUrl);
        // ANY HTTP answer (including a 401 refusal) proves the "editor" is
        // still listening — the teardown contract is about the SERVER's life.
        return res.status > 0;
      } catch {
        return false;
      }
    },
    async close(): Promise<void> {
      for (const ws of [...perConnectionSubs.keys()]) ws.terminate();
      await new Promise<void>((resolve) => wsServer.close(() => resolve()));
      await new Promise<void>((resolve, reject) => {
        httpServer!.close(() => resolve());
        httpServer!.once("error", reject);
      });
    },
  };
}
