/**
 * The development bridge: a WebSocket on 127.0.0.1 forwarding each connection's bytes to the
 * Daemon's Unix socket, so the simulator gets a Client's power over a dev Daemon. A random
 * token is required, and only the bridge's own Host and Origin pass, so no web page can reach it.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Socket } from "bun";
import { Predicate } from "effect";

export interface DevBridgeServer {
  readonly port: number;
  readonly token: string;
  readonly stop: () => void;
}

interface Pipe {
  socket: Socket<undefined> | null;
  /** Bytes from the phone not yet written to the Daemon (before connect, or under backpressure). */
  pending: Array<Uint8Array>;
  closed: boolean;
}

const sameToken = (given: string | null, token: string): boolean => {
  if (given === null) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);

  return a.length === b.length && timingSafeEqual(a, b);
};

const flush = (pipe: Pipe) => {
  const { socket } = pipe;

  if (socket === null) return;

  while (pipe.pending.length > 0) {
    const [chunk] = pipe.pending;

    if (chunk === undefined) return;
    const written = socket.write(chunk);

    if (written < chunk.length) {
      pipe.pending[0] = chunk.subarray(written);

      return;
    }

    pipe.pending.shift();
  }
};

/**
 * React Native's iOS WebSocket sends an Origin derived from the URL; a browser page can only
 * send this one if the bridge served it, and it serves no pages. Anything else is a page.
 */
const OWN_HOSTS = (port: number) => new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

const admitted = (request: Request, port: number): boolean => {
  const own = OWN_HOSTS(port);
  const origin = request.headers.get("origin");

  if (!own.has(request.headers.get("host") ?? "")) return false;

  return origin === null || [...own].some((host) => origin === `http://${host}`);
};

/** Starts the bridge to `socketPath`; `port` 0 picks a free one. */
export const startDevBridge = (socketPath: string, port = 0): DevBridgeServer => {
  const token = randomBytes(24).toString("base64url");

  const server = Bun.serve<Pipe>({
    hostname: "127.0.0.1",
    port,
    fetch: (request, srv) => {
      const url = new URL(request.url);

      if (!admitted(request, srv.port ?? port)) return new Response("no browsers", { status: 403 });

      if (url.pathname !== "/polaris/rpc") return new Response("not found", { status: 404 });

      if (!sameToken(url.searchParams.get("token"), token))
        return new Response("wrong token", { status: 401 });

      return srv.upgrade(request, { data: { socket: null, pending: [], closed: false } })
        ? undefined
        : new Response("WebSocket only", { status: 426 });
    },
    websocket: {
      open: (ws) => {
        const pipe = ws.data;

        void Bun.connect({
          unix: socketPath,
          socket: {
            data: (_socket, chunk) => {
              ws.sendBinary(chunk);
            },
            drain: () => flush(pipe),
            close: () => ws.close(1000),
            error: () => ws.close(1011),
          },
        }).then(
          (socket) => {
            if (pipe.closed) {
              socket.end();

              return;
            }

            pipe.socket = socket;
            flush(pipe);
          },
          () => ws.close(1011, "no Daemon on the socket")
        );
      },
      message: (ws, message) => {
        if (Predicate.isString(message)) {
          ws.close(1003, "binary only");

          return;
        }

        ws.data.pending.push(message);
        flush(ws.data);
      },
      close: (ws) => {
        ws.data.closed = true;
        ws.data.socket?.end();
      },
    },
  });

  return { port: server.port ?? port, token, stop: () => void server.stop(true) };
};
