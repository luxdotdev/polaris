/**
 * The gateway's listener: `Bun.serve` on 127.0.0.1 upgrading `GET /polaris/rpc`
 * to a WebSocket (ADR 0075, 0076). Each connection is offered to `connections`
 * as a ByteTransport; `transport/server.ts` serves it like a socket connection,
 * with a token required. A port that cannot be bound leaves the Daemon running
 * without a gateway, with a warning, rather than refusing to start.
 */
import type { ByteTransport } from "@polaris/protocol";
import type { Server, ServerWebSocket } from "bun";
import { Effect, Queue, Schedule, type Scope, Stream } from "effect";
import {
  GATEWAY_PATH,
  newGatewayNonce,
  removeGatewayRecord,
  writeGatewayRecord,
} from "./config.ts";
import { admitRequest } from "./request.ts";
import { CLOSE_GOING_AWAY, type GatewaySocketStream, gatewayWebSocket } from "./transport.ts";

export interface GatewayOptions {
  /** 0 asks for an ephemeral port (tests, benches). */
  readonly port: number;
  /** Where `{ port }` is written while listening; null writes nothing. */
  readonly recordPath: string | null;
}

export interface RunningGateway {
  readonly port: number;
  readonly url: string;
  /** What `GET /polaris/identity` answers and `gateway.json` holds, new at every start. */
  readonly nonce: string;
  /** One ByteTransport per accepted WebSocket. */
  readonly connections: Stream.Stream<ByteTransport>;
}

class BindError extends Error {
  override readonly name = "BindError";
}

type GatewayServer = Server<GatewaySocketStream | undefined>;

const PORT_IN_USE_RETRIES = 3;

const bind = (
  port: number,
  nonce: string,
  connections: Queue.Queue<ByteTransport>,
  open: Set<ServerWebSocket<GatewaySocketStream | undefined>>
): Effect.Effect<GatewayServer, BindError> =>
  Effect.try({
    try: () =>
      Bun.serve<GatewaySocketStream | undefined>({
        hostname: "127.0.0.1",
        port,
        development: false,
        fetch(request, server) {
          const admitted = admitRequest(request, server.requestIP(request)?.address ?? null);

          if (!admitted.ok) return new Response(admitted.reason, { status: admitted.status });

          if (admitted.route === "identity") return Response.json({ nonce });

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

/**
 * Listens for the lifetime of the scope. Returns null when the port stays
 * busy (another Daemon, or the previous image during an upgrade): the Daemon
 * runs without a gateway and says so.
 */
export const startGateway = Effect.fn("startGateway")(function* (
  options: GatewayOptions
): Effect.fn.Return<RunningGateway | null, never, Scope.Scope> {
  const connections = yield* Queue.unbounded<ByteTransport>();
  const open = new Set<ServerWebSocket<GatewaySocketStream | undefined>>();
  const nonce = newGatewayNonce();

  const server = yield* bind(options.port, nonce, connections, open).pipe(
    Effect.retry({ schedule: Schedule.spaced("500 millis"), times: PORT_IN_USE_RETRIES }),
    Effect.catch((error: BindError) =>
      Effect.as(Effect.logWarning(`no gateway: ${error.message}`), null)
    )
  );

  const port = server?.port;

  if (server === null || port === undefined) return null;

  yield* Effect.addFinalizer(() =>
    Effect.promise(async () => {
      for (const socket of open) socket.close(CLOSE_GOING_AWAY, "the Daemon is stopping");
      await server.stop(true);

      if (options.recordPath !== null) removeGatewayRecord(options.recordPath);
    })
  );

  if (options.recordPath !== null) writeGatewayRecord(options.recordPath, { port, nonce });

  return {
    port,
    url: `ws://127.0.0.1:${port}${GATEWAY_PATH}`,
    nonce,
    connections: Stream.fromQueue(connections),
  };
});
