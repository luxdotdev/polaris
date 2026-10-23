/**
 * A server WebSocket as a ByteTransport: binary messages are the byte stream
 * the Wire frames (`frame.ts`), in whatever pieces they arrive, so blobs flow
 * both ways exactly as on the socket. `send` can accept a message under
 * backpressure (-1); the write then completes on `drain`, so the Wire never
 * queues a second one and the byte stream stays whole.
 */
import { EventEmitter } from "node:events";
import { type ByteTransport, MAX_FRAME_BYTES, readEvents, writeEvents } from "@polaris/protocol";
import type { ServerWebSocket, WebSocketHandler } from "bun";
import { Effect, Predicate } from "effect";

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

  constructor(private readonly socket: ServerWebSocket<GatewaySocketStream | undefined>) {
    super();
  }

  write(chunk: Uint8Array, callback: Callback): boolean {
    if (!this.writable) {
      queueMicrotask(() => callback(closedError()));

      return false;
    }

    const status = this.socket.send(chunk);

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

  // A WebSocket's reads cannot be paused; the Wire's limits bound what a peer can queue.
  pause(): void {}

  resume(): void {}

  end(): void {
    this.writable = false;
    this.socket.close(CLOSE_NORMAL, "closed");
  }

  closed(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.writable = false;
    const waiting = this.awaitingDrain;
    this.awaitingDrain = [];
    waiting.forEach((callback) => callback(closedError()));
    this.emit("end");
    this.emit("close");
  }
}

const toTransport = (stream: GatewaySocketStream): ByteTransport => ({
  incoming: readEvents(stream),
  write: writeEvents(stream),
  close: Effect.sync(() => stream.end()),
});

/**
 * WebSocket handlers that hand every opened connection to `onConnection` as a
 * ByteTransport, with the reader attached before any message can arrive. No
 * pings and no idle timeout: an idle Extension must not wake an idle Daemon,
 * and the Wire's own ping (while a reply is due) detects a dead peer.
 */
export const gatewayWebSocket = (
  onConnection: (transport: ByteTransport) => void,
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
    onConnection(toTransport(stream));
  },
  message(socket, message) {
    if (Predicate.isString(message)) {
      socket.close(CLOSE_UNSUPPORTED_DATA, "binary frames only");

      return;
    }

    socket.data?.emit("data", message);
  },
  drain(socket) {
    socket.data?.flush();
  },
  close(socket) {
    open.delete(socket);
    socket.data?.closed();
  },
});
