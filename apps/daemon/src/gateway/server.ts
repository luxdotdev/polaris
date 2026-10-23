/**
 * The gateway's listener: `Bun.serve` on 127.0.0.1 upgrading `GET /polaris/rpc`
 * to a WebSocket (ADR 0075, 0076). Each connection is offered to `connections`
 * as a GatewayTransport; `transport/server.ts` serves it like a socket connection,
 * with a token required. A port that cannot be bound leaves the Daemon running
 * without a gateway, with a warning, rather than refusing to start.
 */
import type { Server, ServerWebSocket } from "bun";
import { Effect, Queue, Schedule, type Scope, Stream } from "effect";
import {
  GATEWAY_PATH,
  newGatewaySecret,
  removeGatewayRecord,
  writeGatewayRecord,
} from "./config.ts";
import { identityResponse, IDENTITY_BODY_LIMIT } from "./identity.ts";
import { GATEWAY_MAX_CONNECTIONS, requestBudget } from "./limits.ts";
import { admitRequest } from "./request.ts";
import {
  CLOSE_GOING_AWAY,
  type GatewaySocketStream,
  type GatewayTransport,
  gatewayWebSocket,
} from "./transport.ts";

export interface GatewayOptions {
  /** 0 asks for an ephemeral port (tests, benches). */
  readonly port: number;
  /** Where `{ port, secret }` is written while listening; null writes nothing. */
  readonly recordPath: string | null;
}

export interface RunningGateway {
  readonly port: number;
  readonly url: string;
  /** The private HMAC key in `gateway.json`, new at every start; never served. */
  readonly secret: string;
  /** One GatewayTransport per accepted WebSocket. */
  readonly connections: Stream.Stream<GatewayTransport>;
}

class BindError extends Error {
  override readonly name = "BindError";
}

type GatewayServer = Server<GatewaySocketStream | undefined>;

const PORT_IN_USE_RETRIES = 3;

const bind = (
  port: number,
  secret: string,
  connections: Queue.Queue<GatewayTransport>,
  open: Set<ServerWebSocket<GatewaySocketStream | undefined>>
): Effect.Effect<GatewayServer, BindError> => {
  const upgradeBudget = requestBudget(32, 2);
  const identityBudget = requestBudget(32, 4);

  return Effect.try({
    try: () =>
      Bun.serve<GatewaySocketStream | undefined>({
        hostname: "127.0.0.1",
        port,
        development: false,
        maxRequestBodySize: IDENTITY_BODY_LIMIT,
        idleTimeout: 10,
        fetch(request, server) {
          const admitted = admitRequest(request, server.requestIP(request)?.address ?? null);

          if (!admitted.ok) return new Response(admitted.reason, { status: admitted.status });

          if (admitted.route === "identity") {
            if (!identityBudget()) return new Response("Try again later", { status: 429 });

            return identityResponse(request, secret);
          }

          if (open.size >= GATEWAY_MAX_CONNECTIONS)
            return new Response("Gateway connections full", { status: 503 });

          if (request.headers.get("upgrade")?.toLowerCase() === "websocket" && !upgradeBudget())
            return new Response("Try again later", { status: 429 });

          if (server.upgrade(request, { data: undefined })) return undefined;

          return new Response("This is the Polaris gateway; open a WebSocket here", {
            status: 426,
            headers: { Upgrade: "websocket" },
          });
        },
        websocket: gatewayWebSocket((transport) => Queue.offerUnsafe(connections, transport), open),
        error: () => new Response("The gateway request failed", { status: 500 }),
      }),
    catch: (cause) =>
      new BindError(`cannot listen on 127.0.0.1:${port}: ${String(cause)}`, { cause }),
  });
};

/**
 * Listens for the lifetime of the scope. Returns null when the port stays
 * busy (another Daemon, or the previous image during an upgrade): the Daemon
 * runs without a gateway and says so.
 */
export const startGateway = Effect.fn("startGateway")(function* (
  options: GatewayOptions
): Effect.fn.Return<RunningGateway | null, never, Scope.Scope> {
  const connections = yield* Queue.make<GatewayTransport>({
    capacity: GATEWAY_MAX_CONNECTIONS,
    strategy: "dropping",
  });

  const open = new Set<ServerWebSocket<GatewaySocketStream | undefined>>();
  const secret = newGatewaySecret();

  const server = yield* bind(options.port, secret, connections, open).pipe(
    Effect.retry({ schedule: Schedule.spaced("500 millis"), times: PORT_IN_USE_RETRIES }),
    Effect.catch((error: BindError) =>
      Effect.as(Effect.logWarning(`no gateway: ${error.message}`), null)
    )
  );

  const port = server?.port;

  if (server === null || port === undefined) return null;

  yield* Effect.addFinalizer(() =>
    Effect.promise(async () => {
      for (const socket of open)
        if (socket.data === undefined) socket.close(CLOSE_GOING_AWAY, "the Daemon is stopping");
        else socket.data.refuse(CLOSE_GOING_AWAY, "the Daemon is stopping");
      await server.stop(true);

      if (options.recordPath !== null) removeGatewayRecord(options.recordPath);
    })
  );

  if (options.recordPath !== null) writeGatewayRecord(options.recordPath, { port, secret });

  return {
    port,
    url: `ws://127.0.0.1:${port}${GATEWAY_PATH}`,
    secret,
    connections: Stream.fromQueue(connections),
  };
});
