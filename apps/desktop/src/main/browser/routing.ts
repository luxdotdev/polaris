/**
 * Which tabs have their partition's Host-address routing in place (ADR 0093). Only a routed
 * tab may be driven over CDP: a page loaded before routing could reach this machine's loopback.
 */
import type { BrowserTabId } from "../../shared/browserContract.ts";

/** What the CDP gate reads: whether a tab is routed, and when that changes. */
export interface TabRoutingView {
  readonly isRouted: (tabId: BrowserTabId) => boolean;
  /** Resolves once the tab is routed; rejects when its setup fails or the tab closes first. */
  readonly whenRouted: (tabId: BrowserTabId) => Promise<void>;
  readonly onChange: (listener: (tabId: BrowserTabId, routed: boolean) => void) => () => void;
}

interface Waiter {
  readonly resolve: () => void;
  readonly reject: (cause: unknown) => void;
}

export const tabRouting = () => {
  const routed = new Set<BrowserTabId>();
  const waiters = new Map<BrowserTabId, Array<Waiter>>();
  const listeners = new Set<(tabId: BrowserTabId, routed: boolean) => void>();

  const settle = (tabId: BrowserTabId, settled: (waiter: Waiter) => void) => {
    const waiting = waiters.get(tabId) ?? [];

    waiters.delete(tabId);
    waiting.forEach(settled);
  };

  const set = (tabId: BrowserTabId, now: boolean) => {
    if (routed.has(tabId) === now) return;

    if (now) routed.add(tabId);
    else routed.delete(tabId);

    for (const listener of listeners) listener(tabId, now);
  };

  const view: TabRoutingView = {
    isRouted: (tabId) => routed.has(tabId),
    whenRouted: (tabId) => {
      if (routed.has(tabId)) return Promise.resolve();

      return new Promise((resolve, reject) =>
        waiters.set(tabId, [...(waiters.get(tabId) ?? []), { resolve, reject }])
      );
    },
    onChange: (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
  };

  return {
    view,
    /** The tab's partition setup succeeded. */
    routed: (tabId: BrowserTabId) => {
      set(tabId, true);
      settle(tabId, (waiter) => waiter.resolve());
    },
    /** The setup failed, or the Host's routing was retired: the tab is unrouted. */
    unrouted: (tabId: BrowserTabId, cause: unknown) => {
      set(tabId, false);
      settle(tabId, (waiter) => waiter.reject(cause));
    },
    forget: (tabId: BrowserTabId) => {
      routed.delete(tabId);
      settle(tabId, (waiter) => waiter.reject(new Error("the tab closed")));
    },
  };
};
