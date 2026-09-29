/**
 * A scriptable stand-in for `codex app-server --listen unix://…`, for tests.
 * It speaks the same transport (WebSocket over a Unix socket, one JSON-RPC
 * message per text frame), so the driver under test runs its real connection
 * code.
 */
import type { ServerWebSocket } from "bun";
import { Schema } from "effect";
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

  const server = Bun.serve({
    unix: socketPath,
    fetch: (req, srv) =>
      srv.upgrade(req) ? undefined : new Response("upgrade required", { status: 426 }),
    websocket: {
      message: (ws, data) => {
        void onMessage(ws, data);
      },
    },
  });

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
