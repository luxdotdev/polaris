import { LanguageContextEvent } from "@polaris/protocol";
import { Schema } from "effect";
import { failure } from "../transport/framing.ts";

/** No replay log contains draft text. Slow subscribers end instead of retaining unbounded events. */
export class ContextEvents {
  private listeners = new Set<(event: LanguageContextEvent | null) => void>();
  emit(event: LanguageContextEvent) {
    const decoded = Schema.decodeUnknownSync(LanguageContextEvent)(event);

    for (const listener of this.listeners) listener(decoded);
  }
  hasSubscribers() {
    return this.listeners.size > 0;
  }
  close() {
    for (const listener of this.listeners) listener(null);
    this.listeners.clear();
  }
  watch(snapshot: LanguageContextEvent, signal?: AbortSignal): AsyncIterable<LanguageContextEvent> {
    if (this.listeners.size >= 16) throw failure("queue-full", "Language subscriber limit reached");
    const queue = [snapshot];
    let bytes = Buffer.byteLength(JSON.stringify(snapshot));
    let ended = false;
    let overflow = false;
    let wake: (() => void) | undefined;

    const listener = (event: LanguageContextEvent | null) => {
      if (ended) return;

      if (event === null) {
        ended = true;
        cleanup();
      } else {
        const size = Buffer.byteLength(JSON.stringify(event));

        if (queue.length >= 256 || bytes + size > 2097152) {
          overflow = true;
          ended = true;
          queue.length = 0;
          bytes = 0;
          cleanup();
        } else {
          queue.push(event);
          bytes += size;
        }
      }

      wake?.();
    };

    const cleanup = () => {
      this.listeners.delete(listener);
      signal?.removeEventListener("abort", abort);
    };

    const finish = () => {
      ended = true;
      queue.length = 0;
      bytes = 0;
      cleanup();
      wake?.();
    };

    const abort = finish;
    this.listeners.add(listener);
    signal?.addEventListener("abort", abort, { once: true });

    if (signal?.aborted) abort();

    const iterator: AsyncIterableIterator<LanguageContextEvent> = {
      async next() {
        while (!ended && queue.length === 0)
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        const event = queue.shift();

        if (event !== undefined) {
          bytes -= Buffer.byteLength(JSON.stringify(event));

          return { value: event, done: false };
        }

        cleanup();

        if (overflow) throw failure("queue-full", "Language subscriber fell behind");

        return { value: undefined, done: true };
      },
      async return() {
        finish();

        return { value: undefined, done: true };
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };

    return iterator;
  }
}
