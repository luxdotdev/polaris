import { LanguageJsonRpcEnvelope } from "@polaris/protocol";
import type { LanguageError } from "@polaris/protocol";
import { Predicate } from "effect";
import { bounded } from "./deadline.ts";
import { encodeFrame, failure, LspFramer } from "./framing.ts";

export { LspFramer, encodeFrame } from "./framing.ts";

export interface ProcessPort {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  write: (bytes: Uint8Array) => Promise<void>;
  stop: (graceful?: boolean) => Promise<void>;
  exited: Promise<number>;
  pid: number;
}

type Pending = {
  resolve: (value: typeof import("@polaris/protocol").LanguageJson.Type) => void;
  reject: (error: LanguageError) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** One FIFO per process, including notifications, requests, cancellation and server responses. */
export class OrderedConnection {
  private tail = Promise.resolve();
  private queued = 0;
  private queuedBytes = 0;
  private nextId = 0;
  private closed = false;
  private pending = new Map<number, Pending>();
  private read: Promise<void>;
  private stopping: Promise<void> | undefined;
  private closeResult: Promise<void> | undefined;
  private reader: import("node:stream/web").ReadableStreamDefaultReader<Uint8Array>;

  constructor(
    private readonly port: ProcessPort,
    private readonly receive: (message: LanguageJsonRpcEnvelope) => void,
    private readonly onFailure: (error: LanguageError) => void
  ) {
    this.reader = port.stdout.getReader();
    this.read = this.pump();
  }

  private async pump() {
    const framer = new LspFramer();

    try {
      while (!this.closed) {
        const item = await this.reader.read();

        if (item.done) {
          framer.end();
          break;
        }

        for (const message of framer.push(item.value)) this.accept(message);
      }

      if (!this.closed) this.fail(failure("server-failed", "Language server output closed"));
    } catch {
      if (!this.closed) this.fail(failure("server-failed", "Language server framing failed"));
    } finally {
      this.reader.releaseLock();
    }
  }

  private accept(message: LanguageJsonRpcEnvelope) {
    if (!("method" in message) && "id" in message && Predicate.isNumber(message.id)) {
      const request = this.pending.get(message.id);

      if (request === undefined) return;
      this.pending.delete(message.id);
      clearTimeout(request.timer);

      if ("error" in message && message.error !== undefined)
        request.reject(failure("server-failed", "Language server rejected request"));
      else if ("result" in message) request.resolve(message.result);

      return;
    }

    this.receive(message);
  }

  send(message: LanguageJsonRpcEnvelope): Promise<void> {
    if (this.closed) return Promise.reject(failure("not-ready", "Language connection closed"));
    const frame = encodeFrame(message);

    if (this.queued >= 256 || this.queuedBytes + frame.length > 8388608)
      return Promise.reject(failure("queue-full", "Language write queue full"));
    this.queued++;
    this.queuedBytes += frame.length;

    const operation = this.tail.then(async () => {
      if (this.closed) throw failure("not-ready", "Language connection closed");
      await bounded(this.port.write(frame), 10000);
    });

    this.tail = operation.then(
      () => {},
      () => {
        this.fail(failure("server-failed", "Language write failed"));
      }
    );
    void operation
      .finally(() => {
        this.queued--;
        this.queuedBytes -= frame.length;
      })
      .catch(() => {});

    return operation;
  }

  request(
    method: string,
    params: typeof import("@polaris/protocol").LanguageJsonObject.Type,
    timeoutMs = 10000
  ) {
    if (this.pending.size >= 64) throw failure("queue-full", "Language request limit reached");
    const id = ++this.nextId;

    const result = new Promise<typeof import("@polaris/protocol").LanguageJson.Type>(
      (resolve, reject) => {
        const timer = setTimeout(
          () => this.cancel(id, "timeout"),
          Math.min(30000, Math.max(1, timeoutMs))
        );

        this.pending.set(id, { resolve, reject, timer });
      }
    );

    void this.send({ jsonrpc: "2.0", id, method, params }).catch(() => this.cancel(id));

    return { id, result };
  }

  cancel(id: number, reason: "cancelled" | "timeout" = "cancelled") {
    const request = this.pending.get(id);

    if (request === undefined) return;
    this.pending.delete(id);
    clearTimeout(request.timer);
    request.reject(failure(reason, "Language request ended"));
    void this.send({ jsonrpc: "2.0", method: "$/cancelRequest", params: { id } }).catch(() => {});
  }

  private fail(error: LanguageError) {
    if (this.closed) return;
    this.closed = true;

    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }

    this.pending.clear();
    this.onFailure(error);
  }

  close(graceful = false) {
    if (this.closeResult !== undefined) return this.closeResult;
    this.stopping = Promise.resolve().then(async () => {
      // Cancel closes pending reads; its source finalizer does not own process shutdown.
      void this.reader.cancel().catch(() => {});
      await Promise.all([this.port.stop(graceful), this.read, this.tail]);
    });
    this.closeResult = bounded(this.stopping, 10000);
    this.fail(failure("cancelled", "Language connection closed"));

    return this.closeResult;
  }

  /** Actual teardown settlement remains owned after the close deadline rejects. */
  settlement() {
    return this.stopping ?? Promise.resolve();
  }

  stats() {
    return { queued: this.queued, queuedBytes: this.queuedBytes, pending: this.pending.size };
  }
}
