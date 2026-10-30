/**
 * The SOCKS5 server a remote Host's Browser partitions proxy through, on 127.0.0.1 at an
 * ephemeral port. A CONNECT to a Host address becomes a Host-address stream on that Host's
 * connection, its hostname unresolved; any other name loads directly from this machine.
 */
import { connect, createServer, type Server, type Socket } from "node:net";
import { Effect, Fiber, Predicate, type Scope, Stream } from "effect";
import {
  greetingReply,
  Parsed,
  parseGreeting,
  parseRequest,
  requestReply,
  SocksReply,
  SocksTarget,
} from "./socks.ts";

/** A Host-address stream once open: the Host's bytes, and a way to send it ours. */
export interface HostAddressTransport {
  readonly incoming: Stream.Stream<Uint8Array, unknown>;
  readonly write: (bytes: Uint8Array) => Effect.Effect<void, unknown>;
}

/** Opens a stream to `hostname:port` on the Host's loopback; fails with the SOCKS reply to send. */
export type OpenHostAddress<R> = (target: {
  readonly hostname: string;
  readonly port: number;
}) => Effect.Effect<HostAddressTransport, SocksReply, Scope.Scope | R>;

export interface SocksServerOptions<R> {
  readonly open: OpenHostAddress<R>;
  readonly isHostAddress: (hostname: string) => boolean;
  /** Runs one connection's stream; interrupted when its socket closes. */
  readonly run: (effect: Effect.Effect<void, never, R>) => Fiber.Fiber<void>;
  /** A direct connection for any other name; `net.connect` by default. */
  readonly connectDirect?: (hostname: string, port: number) => Socket;
}

export interface SocksServer {
  readonly port: number;
  readonly close: () => Promise<void>;
}

type Route =
  | { readonly kind: "host"; readonly hostname: string; readonly port: number }
  | { readonly kind: "direct"; readonly hostname: string; readonly port: number }
  | { readonly kind: "refuse" };

/** IP literals go to the Host only when they are loopback, and never directly from here. */
export const routeOf = (target: SocksTarget, isHostAddress: (name: string) => boolean): Route =>
  SocksTarget.$match(target, {
    Domain: ({ hostname, port }): Route =>
      isHostAddress(hostname)
        ? { kind: "host", hostname, port }
        : { kind: "direct", hostname, port },
    Ip: ({ address, port }): Route =>
      isHostAddress(address) ? { kind: "host", hostname: address, port } : { kind: "refuse" },
  });

const concat = (a: Uint8Array, b: Uint8Array) => {
  const out = new Uint8Array(a.length + b.length);

  out.set(a);
  out.set(b, a.length);

  return out;
};

/** Writes and waits until the socket can take more, so `incoming` is read no faster than it drains. */
const writeTo = (socket: Socket, chunk: Uint8Array) =>
  Effect.callback<void>((resume) => {
    if (socket.destroyed) return resume(Effect.void);

    if (socket.write(chunk)) return resume(Effect.void);

    const done = () => {
      socket.off("drain", done).off("close", done);
      resume(Effect.void);
    };

    socket.once("drain", done).once("close", done);
  });

/**
 * Both directions until the browser closes its side or either fails. When the Host's side
 * ends first, the socket half-closes and the browser's side drains.
 */
export const pipeTransport = (
  socket: Socket,
  transport: HostAddressTransport,
  rest: Uint8Array
) => {
  const up = Effect.andThen(
    rest.length === 0 ? Effect.void : transport.write(rest),
    Stream.fromAsyncIterable<Uint8Array, unknown>(socket, (error) => error).pipe(
      Stream.runForEach((chunk) => transport.write(chunk))
    )
  );

  const down = transport.incoming.pipe(
    Stream.runForEach((chunk) => writeTo(socket, chunk)),
    Effect.andThen(Effect.sync(() => socket.end())),
    Effect.andThen(Effect.never)
  );

  return Effect.raceFirst(up, down);
};

const reply = (socket: Socket, code: SocksReply) => {
  socket.end(requestReply(code));
};

const directFailure = (error: NodeJS.ErrnoException): SocksReply =>
  error.code === "ECONNREFUSED"
    ? SocksReply.connectionRefused
    : error.code === "ENOTFOUND" || error.code === "EHOSTUNREACH"
      ? SocksReply.hostUnreachable
      : SocksReply.generalFailure;

const pipeDirect = (socket: Socket, remote: Socket, rest: Uint8Array) => {
  remote.once("error", (error) => {
    if (remote.connecting) reply(socket, directFailure(error));
    else socket.destroy();
  });
  remote.once("connect", () => {
    socket.write(requestReply(SocksReply.succeeded));

    if (rest.length > 0) remote.write(rest);
    socket.pipe(remote).on("error", () => remote.destroy());
    remote.pipe(socket);
    socket.resume();
  });
  socket.once("close", () => remote.destroy());
};

function pipeHost<R>(
  socket: Socket,
  route: { readonly hostname: string; readonly port: number },
  rest: Uint8Array,
  options: SocksServerOptions<R>
) {
  const stream = options.open({ hostname: route.hostname, port: route.port }).pipe(
    Effect.tap(() => Effect.sync(() => socket.write(requestReply(SocksReply.succeeded)))),
    Effect.flatMap((transport) => pipeTransport(socket, transport, rest)),
    Effect.catch((code) => Effect.sync(() => reply(socket, code))),
    Effect.catchCause(() => Effect.void),
    Effect.scoped,
    Effect.ensuring(Effect.sync(() => socket.destroy()))
  );

  const fiber = options.run(stream);

  socket.once("close", () => Effect.runFork(Fiber.interrupt(fiber)));
}

function start<R>(
  socket: Socket,
  target: SocksTarget,
  rest: Uint8Array,
  options: SocksServerOptions<R>
) {
  const route = routeOf(target, options.isHostAddress);

  if (route.kind === "refuse") return reply(socket, SocksReply.notAllowed);

  if (route.kind === "direct") {
    const remote = (options.connectDirect ?? ((host, port) => connect(port, host)))(
      route.hostname,
      route.port
    );

    return pipeDirect(socket, remote, rest);
  }

  pipeHost(socket, route, rest, options);
}

/** Reads the greeting, then the request, from whatever arrives, however it is split. */
function handshake<R>(socket: Socket, options: SocksServerOptions<R>) {
  let received: Uint8Array = new Uint8Array();
  let greeted = false;

  const fail = ({ reply: code }: { readonly reply: SocksReply | null }) => {
    socket.off("data", onData);

    if (code === null) socket.destroy();
    else reply(socket, code);
  };

  const onRequest = () =>
    Parsed.$match(parseRequest(received), {
      NeedMore: () => undefined,
      Invalid: fail,
      Done: ({ value, rest }) => {
        socket.off("data", onData);
        socket.pause();
        start(socket, value, rest, options);
      },
    });

  const onData = (chunk: Uint8Array) => {
    received = concat(received, chunk);

    if (greeted) return onRequest();

    Parsed.$match(parseGreeting(received), {
      NeedMore: () => undefined,
      Invalid: fail,
      Done: ({ value: acceptable, rest }) => {
        socket.write(greetingReply(acceptable));

        if (!acceptable) return void socket.end();
        greeted = true;
        received = rest;
        onRequest();
      },
    });
  };

  socket.on("data", onData);
  socket.on("error", () => socket.destroy());
}

export const startSocksServer = <R>(options: SocksServerOptions<R>): Promise<SocksServer> =>
  new Promise((resolve, reject) => {
    const sockets = new Set<Socket>();

    const server: Server = createServer({ noDelay: true }, (socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      handshake(socket, options);
    });

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      resolve({
        port: Predicate.isObject(address) ? address.port : 0,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());

            for (const socket of sockets) socket.destroy();
          }),
      });
    });
  });
