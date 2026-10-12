/**
 * How Review groups files, remembered on this Mac (this window's `localStorage`) for every
 * Review: the file list's Intent / Path (Path by default) and, for an Agent Session, the
 * diff's By turn / By intent (By turn by default).
 */
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

export type ListGrouping = "path" | "intent";

export type SessionGrouping = "turn" | "intent";

interface Grouping {
  readonly list: ListGrouping;
  readonly session: SessionGrouping;
}

const KEY = "polaris.review.grouping.v1";

const DEFAULTS: Grouping = { list: "path", session: "turn" };

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const read = (): Grouping => {
  try {
    const saved = storage()?.getItem(KEY) ?? "";

    return {
      list: saved.includes("list=intent") ? "intent" : "path",
      session: saved.includes("session=intent") ? "intent" : "turn",
    };
  } catch {
    return DEFAULTS;
  }
};

export const groupingStore = createStore<Grouping>(() => read());

export const useListGrouping = (): ListGrouping => useStore(groupingStore, (s) => s.list);

export const useSessionGrouping = (): SessionGrouping => useStore(groupingStore, (s) => s.session);

const save = (patch: Partial<Grouping>) => {
  groupingStore.setState(patch);
  const { list, session } = groupingStore.getState();

  try {
    storage()?.setItem(KEY, `list=${list};session=${session}`);
  } catch {
    // Not remembered this time; the choice still holds in this window.
  }
};

export const setListGrouping = (list: ListGrouping) => save({ list });

export const setSessionGrouping = (session: SessionGrouping) => save({ session });
