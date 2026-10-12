import type { ProcessPort } from "../transport/index.ts";
import { failure } from "../transport/framing.ts";
import { LanguageProcessLimit, LanguageError } from "@polaris/protocol";
import { Schema } from "effect";
import type { Entry } from "./types.ts";

type ProcessOwner = Pick<Entry, "identity">;

/** Launch reservations include retiring processes until their cleanup completes. */
export class ProcessBudget {
  private readonly slots = new Map<
    symbol,
    { owner: ProcessOwner | undefined; retiring: boolean }
  >();
  private readonly waiters = new Set<() => void>();
  constructor(public limit: number) {
    Schema.decodeUnknownSync(LanguageProcessLimit)(limit);
  }

  get used() {
    return this.slots.size;
  }

  get retiring() {
    return [...this.slots.values()].some((slot) => slot.retiring);
  }

  owns(owner: ProcessOwner) {
    return [...this.slots.values()].some((slot) => slot.owner === owner && !slot.retiring);
  }

  retire(owner: ProcessOwner) {
    for (const slot of this.slots.values()) if (slot.owner === owner) slot.retiring = true;
    this.changed();
  }

  setLimit(limit: number) {
    this.limit = Schema.decodeUnknownSync(LanguageProcessLimit)(limit);
    this.changed();
  }

  private changed() {
    for (const wake of this.waiters) wake();
    this.waiters.clear();
  }

  wait(signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      const wake = () => {
        signal.removeEventListener("abort", abort);
        this.waiters.delete(wake);
        resolve();
      };

      const abort = () => {
        this.waiters.delete(wake);
        reject(failure("cancelled", "Language process admission cancelled"));
      };

      if (signal.aborted) return abort();
      this.waiters.add(wake);
      signal.addEventListener("abort", abort, { once: true });
    });
  }

  reserve(owner?: ProcessOwner) {
    if (this.used >= this.limit)
      throw new LanguageError({
        reason: "process-limit",
        message: "Close files in an unused language, then restart this server.",
        retryable: true,
      });
    const key = Symbol("language-process-reservation");
    const slot = { owner, retiring: false };
    this.slots.set(key, slot);
    let started = false;
    let released = false;

    const release = () => {
      if (released) return;
      released = true;
      this.slots.delete(key);
      this.changed();
    };

    return {
      spawn: (invoke: () => ProcessPort): ProcessPort => {
        const port = invoke();
        started = true;

        return {
          ...port,
          stop: (graceful) => {
            slot.retiring = true;
            this.changed();

            return port.stop(graceful).then(release);
          },
        };
      },
      releaseUnstarted: () => {
        if (!started) release();
      },
    };
  }
}

export type ProcessReservation = ReturnType<ProcessBudget["reserve"]>;
