/**
 * `Bun.listen` / `Bun.connect({ fd })` sockets as ByteTransports.
 *
 * The Daemon listens with `Bun.listen` rather than `node:net` so the same
 * handlers serve fresh connections and the ones adopted from the previous
 * image during an execve upgrade (`connectFd` in `service/upgrade.ts`; Bun
 * cannot wrap an fd with `node:net`). Bun's `write` may accept only part of a
 * chunk; the rest is queued and flushed on `drain`.
 */
import { EventEmitter } from "node:events";
import {
  type ByteTransport,
  type EventReadable,
  type EventWritable,
  readEvents,
  writeEvents,
} from "@polaris/protocol";
import type { Socket, SocketHandler } from "bun";
import { Effect } from "effect";

type Callback = (error?: Error | null) => void;

export class BunSocketStream extends EventEmitter {
  destroyed = false;
  writable = true;
  private pending: Array<{ bytes: Uint8Array; callback: Callback }> = [];
  private endAfterFlush = false;

  constructor(private readonly socket: Socket<BunSocketStream | undefined>) {
    super();
  }

  write(chunk: Uint8Array, callback: Callback): boolean {
    if (this.pending.length > 0) {
      this.pending.push({ bytes: chunk, callback });

      return false;
    }

    const written = this.socket.write(chunk);

    if (written >= chunk.byteLength) {
      queueMicrotask(() => callback());

      return true;
    }

    if (written < 0) {
      queueMicrotask(() => callback(new Error("socket closed")));

      return false;
    }

    this.pending.push({ bytes: chunk.subarray(written), callback });

    return false;
  }

  /** Called on `drain`: push out what `write` could not. */
  flush(): void {
    while (this.pending.length > 0) {
      const head = this.pending[0]!;
      const written = this.socket.write(head.bytes);

      if (written < 0) return;

      if (written < head.bytes.byteLength) {
        head.bytes = head.bytes.subarray(written);

        return;
      }

      this.pending.shift();
      head.callback();
    }

    if (this.endAfterFlush) this.socket.end();
    this.emit("drain");
  }

  pause(): void {
    this.socket.pause();
  }

  resume(): void {
    this.socket.resume();
  }

  end(): void {
    this.writable = false;

    if (this.pending.length === 0) this.socket.end();
    else this.endAfterFlush = true;
  }

  closed(error?: Error): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.writable = false;
    const pending = this.pending;
    this.pending = [];

    for (const { callback } of pending) callback(error ?? new Error("socket closed"));
    this.emit("end");
    this.emit("close");
  }
}

export const toTransport = (stream: BunSocketStream): ByteTransport => ({
  incoming: readEvents(stream as unknown as EventReadable),
  write: writeEvents(stream as unknown as EventWritable),
  close: Effect.sync(() => stream.end()),
});

/**
 * Socket handlers that turn every opened connection into a ByteTransport. The
 * transport's reader is attached in `open`, before any data can arrive.
 */
export const socketHandlers = (
  onConnection: (transport: ByteTransport) => void
): SocketHandler<BunSocketStream | undefined> => ({
  binaryType: "uint8array",
  open(socket) {
    const stream = new BunSocketStream(socket);
    socket.data = stream;
    onConnection(toTransport(stream));
  },
  data(socket, data) {
    socket.data?.emit("data", data);
  },
  drain(socket) {
    socket.data?.flush();
  },
  end(socket) {
    socket.data?.emit("end");
  },
  close(socket, error) {
    socket.data?.closed(error);
  },
  error(socket, error) {
    socket.data?.emit("error", error);
  },
});
