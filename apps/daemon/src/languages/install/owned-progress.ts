import type { LanguageError } from "@polaris/protocol";
import type { Progress } from "./types.ts";
import type { RequestGuard } from "./host.ts";
import { abortable, checkAbort, failure } from "./validation.ts";

/** One coalescing slot per demand; every yielded fact is independently reauthorized. */
export function ownedProgress(options: {
  signal: AbortSignal;
  guard: RequestGuard;
  latest: Progress | null;
  settled: boolean;
  error: LanguageError | undefined;
  detach: () => void;
}) {
  const controller = new AbortController();
  const signal = AbortSignal.any([options.signal, controller.signal]);
  let latest = options.latest;
  let delivered = -1;
  let settled = options.settled;
  let error = options.error;
  let wake = () => {};

  let reading = false;
  let detached = false;

  const detach = () => {
    if (detached) return;
    detached = true;
    options.signal.removeEventListener("abort", cancelled);
    options.detach();
  };

  const cancelled = () => {
    settled = true;
    error = failure("cancelled", "Installation progress demand was cancelled", true);
    wake();
    detach();
  };

  options.signal.addEventListener("abort", cancelled, { once: true });

  async function next(): Promise<IteratorResult<Progress>> {
    if (reading) throw failure("conflict", "Progress stream already has a pending read", true);
    reading = true;

    try {
      checkAbort(signal);
      await abortable(options.guard(signal), signal);

      while (!settled && (latest === null || latest.sequence <= delivered))
        await abortable(
          new Promise<void>((resolve) => {
            wake = resolve;
          }),
          signal
        );
      checkAbort(signal);
      await abortable(options.guard(signal), signal);

      if (error !== undefined) throw error;

      if (latest !== null && latest.sequence > delivered) {
        delivered = latest.sequence;

        return { done: false, value: structuredClone(latest) };
      }

      detach();

      return { done: true, value: undefined };
    } catch (cause) {
      detach();
      throw cause;
    } finally {
      reading = false;
    }
  }

  const dispose = () => {
    settled = true;
    latest = null;
    controller.abort();
    wake();
    detach();
  };

  const updates: AsyncIterableIterator<Progress, undefined, unknown> = {
    next,
    async return() {
      dispose();

      return { done: true, value: undefined };
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };

  return {
    updates,
    publish(value: Progress) {
      if (detached || settled) return;

      if (latest !== null && value.sequence <= latest.sequence) return;
      latest = structuredClone(value);
      wake();
    },
    finish(cause?: LanguageError) {
      settled = true;
      error = cause;
      wake();
    },
    dispose,
  };
}
