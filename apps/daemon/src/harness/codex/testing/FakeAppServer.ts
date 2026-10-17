/**
 * A scriptable stand-in for `codex app-server --listen unix://…`, for tests.
 * It speaks the same transport (WebSocket over a Unix socket, one JSON-RPC
 * message per text frame), so the driver under test runs its real connection
 * code. On Windows it listens as the Windows server does: on a loopback port,
 * recorded in the state file beside the socket path, behind a capability token.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ServerWebSocket } from "bun";
import { Schema } from "effect";
import { processCreated } from "../../../platform/windowsNative.ts";
import { defaultStateFile, tokenFileOf } from "../AppServer.ts";
import { type RpcId, RpcMessage, type RpcPayload } from "../protocol.ts";

/** The client's answer to a server→client request: its `result`, or `{ error }` (as received). */
export type ClientAnswer = RpcPayload;

export interface ClientRequest {
  readonly id: RpcId;
  readonly method: string;
  readonly params: RpcPayload;
}

export interface FakeConnection {
  /** Answer the client request currently being handled. */
  readonly reply: (result: RpcPayload) => void;
  readonly replyError: (code: number, message: string) => void;
  readonly notify: (method: string, params: RpcPayload) => void;
  /** A server→client request; resolves with the client's `result` (or `{ error }`). */
  readonly request: (method: string, params: RpcPayload) => Promise<ClientAnswer>;
  /** Drop the connection, as if app-server exited. */
  readonly drop: () => void;
}

export type Handler = (request: ClientRequest, conn: FakeConnection) => void | Promise<void>;

export interface FakeAppServer {
  /** Every client message, in arrival order (requests, notifications and responses). */
  readonly received: Array<RpcMessage>;
  readonly requests: (method: string) => Array<ClientRequest>;
  readonly stop: () => void;
}

/** One JSON-RPC message the fake writes. */
interface ServerMessage {
  readonly id?: RpcId | undefined;
  readonly method?: string;
  readonly params?: RpcPayload;
  readonly result?: RpcPayload;
  readonly error?: { readonly code: number; readonly message: string };
}

const decodeMessage = Schema.decodeUnknownSync(Schema.fromJsonString(RpcMessage));

/**
 * The recorded root: like the real server's `.cmd` shim it has exited, and only the listener,
 * this process, is alive. A live root would send stopAppServer to read its command line.
 */
let exitedRoot: number | undefined;

const rootPid = () => (exitedRoot ??= Bun.spawnSync([process.execPath, "-e", ""]).pid);

/** Windows: a loopback port, recorded in the state file with this process as its listener. */
const serveOnLoopback = (
  socketPath: string,
  upgrade: (req: Request, srv: Bun.Server<undefined>) => Response | undefined,
  websocket: Bun.WebSocketHandler<undefined>
) => {
  const stateFile = defaultStateFile(socketPath);
  const token = randomUUID();
  const tokenFile = tokenFileOf(stateFile);
  mkdirSync(dirname(tokenFile), { recursive: true });
  writeFileSync(tokenFile, token);

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (req, srv) =>
      req.headers.get("authorization") === `Bearer ${token}`
        ? upgrade(req, srv)
        : new Response("unauthorized", { status: 401 }),
    websocket,
  });

  writeFileSync(
    stateFile,
    JSON.stringify({
      pid: rootPid(),
      version: null,
      codexPath: "fake-codex",
      socketPath,
      startedAt: Date.now(),
      sanitizedEnv: true,
      listen: `ws://127.0.0.1:${server.port}`,
      listenerPid: process.pid,
      listenerCreated: String(processCreated(process.pid)),
    })
  );

  return server;
};

export const startFakeAppServer = (socketPath: string, handler: Handler): FakeAppServer => {
  const received: Array<RpcMessage> = [];
  let nextServerId = 1000;
  const waiting = new Map<string, (value: ClientAnswer) => void>();

  const connectionFor = (ws: ServerWebSocket<undefined>, current: ClientRequest | null) => {
    const send = (message: ServerMessage) => ws.send(JSON.stringify(message));

    return {
      reply: (result) => send({ id: current?.id, result }),
      replyError: (code, message) => send({ id: current?.id, error: { code, message } }),
      notify: (method, params) => send({ method, params }),
      request: (method, params) =>
        new Promise((resolve) => {
          const id = nextServerId++;
          waiting.set(String(id), resolve);
          send({ id, method, params });
        }),
      drop: () => ws.close(1011, "app-server exited"),
    } satisfies FakeConnection;
  };

  const onMessage = async (ws: ServerWebSocket<undefined>, data: string | Buffer) => {
    const message = decodeMessage(String(data));
    received.push(message);
    const { id, method, params } = message;

    if (method === undefined) {
      const resolve = waiting.get(String(id));
      waiting.delete(String(id));
      resolve?.(message.error === undefined ? (message.result ?? null) : { error: message.error });

      return;
    }

    if (id === undefined) return;
    await handler({ id, method, params }, connectionFor(ws, { id, method, params }));
  };

  const websocket = {
    message: (ws: ServerWebSocket<undefined>, data: string | Buffer) => {
      void onMessage(ws, data);
    },
  };

  const upgrade = (req: Request, srv: Bun.Server<undefined>) =>
    srv.upgrade(req) ? undefined : new Response("upgrade required", { status: 426 });

  const server =
    process.platform === "win32"
      ? serveOnLoopback(socketPath, upgrade, websocket)
      : Bun.serve({ unix: socketPath, fetch: upgrade, websocket });

  return {
    received,
    requests: (method) =>
      received.flatMap((m) =>
        m.method === method && m.id !== undefined ? [{ id: m.id, method, params: m.params }] : []
      ),
    stop: () => {
      void server.stop(true);
    },
  };
};

/** One recorded frame: `out` is client→server, `in` is server→client. */
export const Frame = Schema.Struct({ dir: Schema.Literals(["in", "out"]), msg: RpcMessage });

export type Frame = typeof Frame.Type;

const decodeFrame = Schema.decodeUnknownSync(Schema.fromJsonString(Frame));

export const readFixture = async (path: string): Promise<ReadonlyArray<Frame>> =>
  (await Bun.file(path).text())
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => decodeFrame(line));

/**
 * Replays a recorded session: for each client request, finds the next recorded
 * request with that method and sends back what the real app-server sent until
 * the client's next recorded message, rewriting the response id.
 */
export const replay = (frames: ReadonlyArray<Frame>): Handler => {
  let cursor = 0;

  return (request, conn) => {
    const at = frames.findIndex(
      (f, i) => i >= cursor && f.dir === "out" && f.msg.method === request.method
    );

    if (at < 0) return conn.replyError(-32601, `fixture has no further ${request.method}`);
    const recordedId = frames[at]!.msg.id;
    let i = at + 1;

    for (; i < frames.length && frames[i]!.dir === "in"; i++) {
      const msg = frames[i]!.msg;

      if (msg.method !== undefined) conn.notify(msg.method, msg.params);
      else if (msg.id === recordedId)
        if (msg.error === undefined) conn.reply(msg.result ?? null);
        else conn.replyError(msg.error.code, msg.error.message);
    }

    cursor = i;
  };
};
