import type { Entry } from "./types.ts";

/**
 * Client cancellation by request identifier, from the moment the broker takes a request: a
 * cancel that arrives while the request is still queued or preparing aborts it before it is sent.
 */
export function createRequestCancellations() {
  const entries = new WeakMap<Entry, Map<string, Set<AbortController>>>();

  /**
   * Track `requestId` on `entry` until `release`. `signal` aborts on a cancel or on `input`;
   * `attach` runs a dispatched request's own cancel on that abort.
   */
  function track(entry: Entry, requestId: string, input?: AbortSignal) {
    const controller = new AbortController();
    const requests = entries.get(entry) ?? new Map<string, Set<AbortController>>();
    const controllers = requests.get(requestId) ?? new Set<AbortController>();
    controllers.add(controller);
    requests.set(requestId, controllers);
    entries.set(entry, requests);

    const signal =
      input === undefined ? controller.signal : AbortSignal.any([input, controller.signal]);

    let attached: (() => void) | undefined;

    const attach = (cancel: () => void) => {
      attached = cancel;
      signal.addEventListener("abort", cancel, { once: true });

      if (signal.aborted) cancel();
    };

    const release = () => {
      if (attached !== undefined) signal.removeEventListener("abort", attached);
      controllers.delete(controller);

      if (controllers.size === 0 && requests.get(requestId) === controllers)
        requests.delete(requestId);
    };

    return { signal, attach, release };
  }

  function cancel(entry: Entry, requestId: string) {
    for (const controller of entries.get(entry)?.get(requestId) ?? []) controller.abort();
  }

  return { track, cancel };
}
