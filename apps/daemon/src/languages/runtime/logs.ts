import { LanguageServerLogEvent, LanguageServerLogLine } from "@polaris/protocol";
import type { LanguageContextIdentity } from "@polaris/protocol";
import { failure } from "../transport/framing.ts";

const maxLines = 2000;

const maxBytes = 512 * 1024;

const lineBytes = 8192;

/** One process generation owns this memory; no timers, files or durable events. */
export class ServerLogs {
  private lines: (LanguageServerLogLine | undefined)[] = [];
  private head = 0;
  private count = 0;
  private bytes = 0;
  private sequence = 0;
  private closed = false;
  private partial = "";
  private listeners = new Set<(event: LanguageServerLogEvent | null) => void>();
  constructor(readonly context: LanguageContextIdentity) {}

  stderr(chunk: string) {
    if (this.closed) return;

    const parts = (this.partial + chunk).split(/\r?\n/);
    this.partial = (parts.pop() ?? "").slice(0, lineBytes);

    for (const part of parts) this.append("stderr", "warning", part);

    if (chunk === "" && this.partial !== "") {
      this.append("stderr", "warning", this.partial);
      this.partial = "";
    }
  }

  append(
    source: LanguageServerLogLine["source"],
    level: LanguageServerLogLine["level"],
    text: string
  ) {
    if (this.closed) return;

    for (const part of text.split(/\r?\n/)) {
      if (part.length === 0) continue;

      const bounded = Buffer.from(part.slice(0, lineBytes)).subarray(0, lineBytes).toString("utf8");
      // A partial UTF-8 character can decode to a three-byte replacement character.

      const clipped = Buffer.byteLength(bounded) > lineBytes ? bounded.slice(0, -1) : bounded;

      const line = LanguageServerLogLine.make({
        sequence: ++this.sequence,
        time: Date.now(),
        source,
        level,
        text: clipped,
      });

      if (this.count === maxLines) this.evict();
      this.lines[(this.head + this.count) % maxLines] = line;
      this.count++;
      this.bytes += Buffer.byteLength(JSON.stringify(line));

      while (this.bytes > maxBytes) this.evict();

      const event = LanguageServerLogEvent.cases.Line.make({ context: this.context, line });

      for (const listener of this.listeners) listener(event);
    }
  }

  private evict() {
    const removed = this.lines[this.head];

    if (removed !== undefined) this.bytes -= Buffer.byteLength(JSON.stringify(removed));
    this.lines[this.head] = undefined;
    this.head = (this.head + 1) % maxLines;
    this.count--;
  }

  private backlog() {
    const lines: LanguageServerLogLine[] = [];

    for (let i = 0; i < this.count; i++) {
      const line = this.lines[(this.head + i) % maxLines];

      if (line !== undefined) lines.push(line);
    }

    return lines;
  }

  close() {
    this.closed = true;
    this.lines = [];
    this.head = 0;
    this.count = 0;
    this.bytes = 0;
    this.partial = "";

    for (const listener of this.listeners) listener(null);
    this.listeners.clear();
  }

  lastLine() {
    return this.count === 0
      ? null
      : (this.lines[(this.head + this.count - 1) % maxLines]?.text ?? null);
  }

  stats() {
    return { lines: this.count, bytes: this.bytes, subscribers: this.listeners.size };
  }

  watch(signal?: AbortSignal): AsyncIterableIterator<LanguageServerLogEvent> {
    if (this.closed) throw failure("not-ready", "Language server log ended");

    if (this.listeners.size >= 16) throw failure("queue-full", "Language log subscriber limit");

    const queue: LanguageServerLogEvent[] = [
      LanguageServerLogEvent.cases.Snapshot.make({ context: this.context, lines: this.backlog() }),
    ];

    let bytes = Buffer.byteLength(JSON.stringify(queue[0]));

    let ended = false;

    let overflow = false;

    let wake: (() => void) | undefined;

    const cleanup = () => {
      this.listeners.delete(listener);
      signal?.removeEventListener("abort", finish);
    };

    const finish = () => {
      ended = true;
      queue.length = 0;
      bytes = 0;
      cleanup();
      wake?.();
    };

    const listener = (event: LanguageServerLogEvent | null) => {
      if (ended) return;

      if (event === null) return finish();

      const size = Buffer.byteLength(JSON.stringify(event));

      if (queue.length >= 256 || bytes + size > 2 * 1024 * 1024) {
        overflow = true;
        finish();
      } else {
        queue.push(event);
        bytes += size;
        wake?.();
      }
    };

    this.listeners.add(listener);
    signal?.addEventListener("abort", finish, { once: true });

    if (signal?.aborted) finish();

    return {
      async next() {
        while (!ended && queue.length === 0)
          await new Promise<void>((resolve) => {
            wake = resolve;
          });

        if (overflow) throw failure("queue-full", "Language log subscriber fell behind");

        const event = queue.shift();

        if (event === undefined) return { value: undefined, done: true };
        bytes -= Buffer.byteLength(JSON.stringify(event));

        return { value: event, done: false };
      },
      async return() {
        finish();

        return { value: undefined, done: true };
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }
}
