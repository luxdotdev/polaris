// The spike's far end: an https hello, a WebSocket echo and a report sink on loopback,
// put on the tailnet by `tailscale serve`. Every request is appended to log/requests.jsonl.
import { appendFileSync, mkdirSync } from "node:fs";

const PORT = Number(Bun.env.SPIKE_PORT ?? 8787);

const LOG = new URL("log/requests.jsonl", import.meta.url).pathname;

mkdirSync(new URL("log/", import.meta.url).pathname, { recursive: true });

type LogEntry = {
  event: "request" | "report" | "ws-open" | "ws-message" | "ws-close";
  method?: string;
  path?: string;
  origin?: string | null;
  userAgent?: string | null;
  body?: string;
  code?: number;
  reason?: string;
};

const log = (entry: LogEntry) => {
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry });

  appendFileSync(LOG, `${line}\n`);
  console.log(line);
};

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const seen = (request: Request): LogEntry => ({
  event: "request",
  method: request.method,
  path: new URL(request.url).pathname,
  origin: request.headers.get("origin"),
  userAgent: request.headers.get("user-agent"),
});

type SocketData = { origin: string | null };

const server = Bun.serve<SocketData>({
  hostname: "127.0.0.1",
  port: PORT,
  async fetch(request, bunServer) {
    const path = new URL(request.url).pathname;

    log(seen(request));

    if (path.endsWith("/ws")) {
      const origin = request.headers.get("origin");

      if (bunServer.upgrade(request, { data: { origin } })) return undefined;

      return new Response("expected a WebSocket upgrade", { status: 426 });
    }

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    if (path.endsWith("/report") && request.method === "POST") {
      log({ event: "report", body: await request.text() });

      return new Response("thanks", { headers: cors });
    }

    if (path.endsWith("/hello")) return new Response("polaris-spike ok", { headers: cors });

    return new Response("not found", { status: 404, headers: cors });
  },
  websocket: {
    open(socket) {
      log({ event: "ws-open", origin: socket.data.origin });
    },
    message(socket, message) {
      log({ event: "ws-message", body: String(message) });

      socket.send(`echo (origin ${socket.data.origin ?? "none"}): ${String(message)}`);
    },
    close(_socket, code, reason) {
      log({ event: "ws-close", code, reason });
    },
  },
});

console.log(`polaris-spike echo on http://127.0.0.1:${server.port}, logging to ${LOG}`);
