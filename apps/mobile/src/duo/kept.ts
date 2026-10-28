/**
 * Unsent input kept above the screens (DESIGN.md, iPhone Duo: posture never navigates and focus
 * stays). Folding swaps the constellation's rail for its span; both read and write the same
 * draft and claim choice here, so neither is lost with the view that showed it.
 */
import type { Unsent } from "../constellation/unsent.ts";
import { useCallback, useSyncExternalStore } from "react";

export interface Kept<T> {
  readonly all: () => ReadonlyMap<string, T>;
  readonly set: (key: string, value: T) => void;
  readonly subscribe: (listener: () => void) => () => void;
}

export const keptStore = <T>(): Kept<T> => {
  let values: ReadonlyMap<string, T> = new Map();
  const listeners = new Set<() => void>();

  return {
    all: () => values,
    set: (key, value) => {
      if (values.get(key) === value) return;
      values = new Map(values).set(key, value);

      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
  };
};

/** The lead composer's draft, per Host and Constellation. */
export const leadDrafts = keptStore<string>();

/** Each handed claim's unsent choice and answer, per Host, Constellation and Task. */
export const claimChoices = keptStore<Unsent>();

export const constellationKey = (hostId: string, constellationId: string) =>
  `${hostId}/${constellationId}`;

export const taskKey = (hostId: string, constellationId: string, taskId: string) =>
  `${hostId}/${constellationId}/${taskId}`;

/** Every kept value in a store, and a setter; re-renders when any changes. */
export const useKept = <T>(store: Kept<T>) => {
  const all = useSyncExternalStore(store.subscribe, store.all);
  const set = useCallback((key: string, value: T) => store.set(key, value), [store]);

  return [all, set] as const;
};
