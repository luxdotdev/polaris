/**
 * The gateway transport: a WebSocket whose binary messages carry the same
 * length-prefixed frames as the socket, as one byte stream (a message may hold
 * several frames or part of one). Works wherever `WebSocket` is global.
 */
import { type ByteTransport, TransportError } from "@polaris/protocol";
import { Cause, Effect, Queue, type Scope, Stream } from "effect";
import { HostUnreachable } from "../errors.ts";

const NORMAL_CLOSURE = 1000;

const opened = (socket: WebSocket, hostId: string) =>
  Effect.callback<void, HostUnreachable>((resume) => {
    const onOpen = () => {
      cleanup();
      resume(Effect.void);
    };

    const onFail = () => {
      cleanup();
      resume(Effect.fail(new HostUnreachable({ hostId, detail: `${socket.url} refused` })));
    };

    const cleanup = () => {
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onFail);
      socket.removeEventListener("close", onFail);
    };

    socket.addEventListener("open", onOpen);
    socket.addEventListener("error", onFail);
    socket.addEventListener("close", onFail);

    return Effect.sync(() => {
      cleanup();
      socket.close(NORMAL_CLOSURE);
    });
  });

/** Opens `url` for `hostId`; the socket closes with the scope. */
export const webSocketTransport = (
  url: string,
  hostId: string
): Effect.Effect<ByteTransport, HostUnreachable, Scope.Scope> =>
  Effect.gen(function* () {
    const socket = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const created = new WebSocket(url);

        created.binaryType = "arraybuffer";

        return created;
      }),
      (socket) => Effect.sync(() => socket.close(NORMAL_CLOSURE))
    );

    // Listeners attach before the socket opens, so no message is missed.
    const incoming = yield* Queue.unbounded<Uint8Array, TransportError | Cause.Done>();

    socket.addEventListener("message", (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer)
        Queue.offerUnsafe(incoming, new Uint8Array(event.data));
    });
    socket.addEventListener("close", (event: CloseEvent) => {
      if (event.code === NORMAL_CLOSURE) Queue.endUnsafe(incoming);
      else
        Queue.failCauseUnsafe(
          incoming,
          Cause.fail(
            new TransportError({
              message: `the gateway closed the connection (${event.code} ${event.reason})`,
            })
          )
        );
    });

    yield* opened(socket, hostId);

    return {
      incoming: Stream.fromQueue(incoming),
      write: (bytes) =>
        socket.readyState === WebSocket.OPEN
          ? // SAFETY: the Wire encodes frames into fresh ArrayBuffers, never shared memory.
            Effect.sync(() => socket.send(bytes as Uint8Array<ArrayBuffer>))
          : Effect.fail(new TransportError({ message: "the gateway connection is closed" })),
      close: Effect.sync(() => socket.close(NORMAL_CLOSURE)),
    } satisfies ByteTransport;
  });
