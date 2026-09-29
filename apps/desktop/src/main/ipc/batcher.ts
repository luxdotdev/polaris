/**
 * Coalesces every subscription's items for one window into a single IPC
 * message per flush window, so a Turn streaming hundreds of deltas a second
 * costs at most one message per window, not one per delta.
 */
import type { BatchEntry, IpcError } from "../../shared/api.ts";

/** Well inside one 120 Hz frame (8.3 ms), so batching adds no visible latency. */
export const FLUSH_WINDOW_MS = 4;

export interface Batcher {
  readonly push: <A>(id: number, item: A) => void;
  /** The feed ended: null when cleanly, else the error. Sent after its last items. */
  readonly end: (id: number, error: IpcError | null) => void;
  /** Sends what is pending now. */
  readonly flush: () => void;
  readonly dispose: () => void;
}

interface Pending {
  items: Array<unknown>;
  end?: IpcError | null;
}

export interface BatcherOptions {
  readonly send: (entries: ReadonlyArray<BatchEntry>) => void;
  readonly windowMs?: number;
}

export const newBatcher = ({ send, windowMs = FLUSH_WINDOW_MS }: BatcherOptions): Batcher => {
  let pending = new Map<number, Pending>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const flush = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;

    if (pending.size === 0) return;

    const entries = [...pending].map(([id, p]): BatchEntry =>
      p.end === undefined ? { id, items: p.items } : { id, items: p.items, end: p.end }
    );

    pending = new Map();
    send(entries);
  };

  const entry = (id: number) => {
    let p = pending.get(id);

    if (p === undefined) {
      p = { items: [] };
      pending.set(id, p);
    }

    if (timer === null && !disposed) timer = setTimeout(flush, windowMs);

    return p;
  };

  return {
    push: (id, item) => {
      if (!disposed) entry(id).items.push(item);
    },
    end: (id, error) => {
      if (!disposed) entry(id).end = error;
    },
    flush,
    dispose: () => {
      disposed = true;

      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = new Map();
    },
  };
};
