/**
 * A server WebSocket as a ByteTransport: binary messages are the byte stream
 * the Wire frames (`frame.ts`), in whatever pieces they arrive, so blobs flow
 * both ways exactly as on the socket. `send` can accept a message under
 * backpressure (-1); the write then completes on `drain`, so the Wire never
 * queues a second one and the byte stream stays whole.
 */
import { EventEmitter } from "node:events";
import { type ByteTransport, MAX_FRAME_BYTES, writeEvents } from "@polaris/protocol";
import type { ServerWebSocket, WebSocketHandler } from "bun";
import { Cause, Effect, Predicate, Queue, Stream } from "effect";

import {
  GATEWAY_HELLO_TIMEOUT_MS,
  GATEWAY_PRE_HELLO_BYTES,
  GATEWAY_MAX_QUEUED_BYTES,
  GATEWAY_MAX_QUEUED_MESSAGES,
} from "./limits.ts";

export interface GatewayTransport extends ByteTransport {
  readonly authenticated: () => void;
  /** How the connection went, for the Daemon's log: who closed it, with what code, and the bytes moved. */
  readonly summary: () => string;
}

import { gatewayLogText } from "./log.ts";

type Callback = (error?: Error | null) => void;

/** Close codes the gateway sends (RFC 6455 §7.4.1). */
export const CLOSE_NORMAL = 1000;

export const CLOSE_GOING_AWAY = 1001;

export const CLOSE_UNSUPPORTED_DATA = 1003;

const closedError = () => new Error("socket closed");

export class GatewaySocketStream extends EventEmitter {
  destroyed = false;
  writable = true;
  private awaitingDrain: Array<Callback> = [];
  private queuedBytes = 0;
  private beforeHello: number | null = 0;
  private readonly pending = Effect.runSync(
    Queue.make<Uint8Array, Cause.Done>({
      capacity: GATEWAY_MAX_QUEUED_MESSAGES,
      strategy: "dropping",
    })
  );
  private readonly deadline: ReturnType<typeof setTimeout>;
  private readonly openedAt = performance.now();
  private bytesIn = 0;
  private bytesOut = 0;
  private ending: string | null = null;
  readonly incoming = Stream.fromQueue(this.pending).pipe(
    Stream.map((bytes) => {
      this.queuedBytes -= bytes.byteLength;

      return bytes;
    })
  );
  readonly authenticated = () => {
    this.beforeHello = null;
    clearTimeout(this.deadline);
  };

  constructor(private readonly socket: ServerWebSocket<GatewaySocketStream | undefined>) {
    super();
    this.deadline = setTimeout(
      () => this.refuse(1008, "hello timed out"),
      GATEWAY_HELLO_TIMEOUT_MS
    );
  }

  receive(bytes: Uint8Array): void {
    if (this.destroyed) return;
    this.bytesIn += bytes.byteLength;

    if (this.beforeHello !== null) {
      this.beforeHello += bytes.byteLength;

      if (this.beforeHello > GATEWAY_PRE_HELLO_BYTES) {
        this.refuse(1009, "hello input too large");

        return;
      }
    }

    if (this.queuedBytes + bytes.byteLength > GATEWAY_MAX_QUEUED_BYTES) {
      this.refuse(1009, "input buffer full");

      return;
    }

    this.queuedBytes += bytes.byteLength;

    if (!Queue.offerUnsafe(this.pending, bytes)) this.refuse(1009, "input buffer full");
  }

  refuse(code: number, reason: string): void {
    this.ending ??= `the Daemon closed it (${code} ${gatewayLogText(reason, 80)})`;
    this.socket.close(code, reason);
    this.closed();
  }

  write(chunk: Uint8Array, callback: Callback): boolean {
    if (!this.writable) {
      queueMicrotask(() => callback(closedError()));

      return false;
    }

    const status = this.socket.send(chunk);

    if (status !== 0) this.bytesOut += chunk.byteLength;

    if (status === 0) {
      queueMicrotask(() => callback(closedError()));

      return false;
    }

    // -1: queued by Bun; the next write waits until this one drained.
    if (status === -1) {
      this.awaitingDrain.push(callback);

      return false;
    }

    queueMicrotask(() => callback());

    return true;
  }

  flush(): void {
    const waiting = this.awaitingDrain;
    this.awaitingDrain = [];
    waiting.forEach((callback) => callback());
    this.emit("drain");
  }

  end(): void {
    this.ending ??= `the Daemon closed it (${CLOSE_NORMAL})`;
    this.writable = false;
    this.socket.close(CLOSE_NORMAL, "closed");
  }

  /** The peer's close frame, or the socket dropping without one (1006). */
  peerClosed(code: number, reason: string): void {
    this.ending ??= `the peer closed it (${code}${reason === "" ? "" : ` ${gatewayLogText(reason, 80)}`})`;
    this.closed();
  }

  summary(): string {
    const seconds = ((performance.now() - this.openedAt) / 1000).toFixed(1);
    const stage = this.beforeHello === null ? "after hello" : "before hello";

    return `${this.ending ?? "open"} ${stage}, after ${seconds} s, ${this.bytesIn} bytes in, ${this.bytesOut} out`;
  }

  closed(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    clearTimeout(this.deadline);
    Effect.runSync(Queue.clear(this.pending));
    Queue.endUnsafe(this.pending);
    this.queuedBytes = 0;
    this.writable = false;
    const waiting = this.awaitingDrain;
    this.awaitingDrain = [];
    waiting.forEach((callback) => callback(closedError()));
    this.emit("end");
    this.emit("close");
  }
}

const toTransport = (stream: GatewaySocketStream): GatewayTransport => ({
  incoming: stream.incoming,
  authenticated: stream.authenticated,
  summary: () => stream.summary(),
  write: writeEvents(stream),
  close: Effect.sync(() => stream.end()),
});

/**
 * WebSocket handlers that hand every opened connection to `onConnection` as a
 * ByteTransport, with the reader attached before any message can arrive. No
 * pings and no authenticated idle timeout: an idle Extension must not wake an idle Daemon,
 * and the Wire's own ping (while a reply is due) detects a dead peer.
 */
export const gatewayWebSocket = (
  onConnection: (transport: GatewayTransport) => boolean,
  open: Set<ServerWebSocket<GatewaySocketStream | undefined>>
): WebSocketHandler<GatewaySocketStream | undefined> => ({
  perMessageDeflate: false,
  idleTimeout: 0,
  sendPings: false,
  // A message may carry a whole frame; the Wire refuses longer ones itself.
  maxPayloadLength: MAX_FRAME_BYTES + 64,
  // Only one write is ever queued, so reaching the limit means a peer that stopped reading.
  closeOnBackpressureLimit: true,
  open(socket) {
    const stream = new GatewaySocketStream(socket);
    socket.data = stream;
    open.add(socket);

    if (!onConnection(toTransport(stream))) stream.refuse(1013, "gateway busy");
  },
  message(socket, message) {
    if (Predicate.isString(message)) {
      socket.data?.refuse(CLOSE_UNSUPPORTED_DATA, "binary frames only");

      return;
    }

    socket.data?.receive(message);
  },
  drain(socket) {
    socket.data?.flush();
  },
  close(socket, code, reason) {
    open.delete(socket);
    socket.data?.peerClosed(code, reason);
  },
});
