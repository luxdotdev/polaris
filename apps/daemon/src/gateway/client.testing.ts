/**
 * A WebSocket as a Client-side ByteTransport, for the gateway's tests: what
 * the SDK does (`packages/sdk`), without its retries or diagnostics. Binary
 * messages are the Wire's byte stream; the close code is kept for assertions.
 */
import { EventEmitter } from "node:events";
import { ConnectFailure } from "@polaris/client";
import { type ByteTransport, readEvents, TransportError, writeEvents } from "@polaris/protocol";
import { Deferred, Effect, type Scope } from "effect";

export interface TestWebSocketTransport extends ByteTransport {
  /** What `connectRpcWith` asks a Client transport; the gateway's tests never need it. */
  readonly diagnose: Effect.Effect<ConnectFailure>;
  /** The close code and reason once the peer or we closed. */
  readonly closed: Effect.Effect<{ readonly code: number; readonly reason: string }>;
}

class ClientSocketStream extends EventEmitter {
  destroyed = false;
  writable = true;

  constructor(private readonly socket: WebSocket) {
    super();
  }

  write(chunk: Uint8Array, callback: (error?: Error | null) => void): boolean {
    if (!this.writable) {
      queueMicrotask(() => callback(new Error("socket closed")));

      return false;
    }

    this.socket.send(chunk);
    queueMicrotask(() => callback());

    return true;
  }

  pause(): void {}

  resume(): void {}

  end(): void {
    this.writable = false;
    this.socket.close(1000, "closed");
  }

  closed(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.writable = false;
    this.emit("end");
    this.emit("close");
  }
}

export interface ConnectOptions {
  /** Sent as the `Origin` header, as a browser or the Even app's WebView would. */
  readonly origin?: string;
  readonly headers?: Record<string, string>;
}

/** Opens a WebSocket to `url`; fails when the server refuses the upgrade. */
export const webSocketTransport = (
  url: string,
  options: ConnectOptions = {}
): Effect.Effect<TestWebSocketTransport, TransportError, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.callback<TestWebSocketTransport, TransportError>((resume) => {
      const headers = { ...options.headers };

      if (options.origin !== undefined) headers.Origin = options.origin;
      const socket = new WebSocket(url, { headers });
      socket.binaryType = "arraybuffer";
      const stream = new ClientSocketStream(socket);
      const closed = Deferred.makeUnsafe<{ readonly code: number; readonly reason: string }>();
      let opened = false;

      socket.onopen = () => {
        opened = true;
        resume(
          Effect.succeed({
            incoming: readEvents(stream),
            write: writeEvents(stream),
            close: Effect.sync(() => stream.end()),
            closed: Deferred.await(closed),
            diagnose: Effect.succeed(
              new ConnectFailure({
                kind: "transient",
                reason: "connection-lost",
                detail: "WebSocket closed",
              })
            ),
          })
        );
      };

      socket.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) stream.emit("data", new Uint8Array(event.data));
      };

      socket.onclose = (event) => {
        Deferred.doneUnsafe(closed, Effect.succeed({ code: event.code, reason: event.reason }));
        stream.closed();

        if (!opened)
          resume(
            Effect.fail(
              new TransportError({ message: `the gateway refused the WebSocket (${event.code})` })
            )
          );
      };

      socket.onerror = () => {
        if (!opened) resume(Effect.fail(new TransportError({ message: "WebSocket failed" })));
      };
    }),
    (transport) => transport.close
  );
