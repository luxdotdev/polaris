/**
 * How diff tabs draw, remembered on this Mac (this window's `localStorage`) for every diff:
 * unified or split, and syntax-aware or by line. Unified and syntax-aware by default.
 */
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

export type DiffStyle = "unified" | "split";

export interface DiffPrefs {
  readonly style: DiffStyle;
  readonly syntax: boolean;
}

const KEY = "polaris.diff.v1";

export const DEFAULT_PREFS: DiffPrefs = { style: "unified", syntax: true };

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/** "style=split;syntax=off" back to prefs; anything unknown keeps its default. */
export const parsePrefs = (saved: string): DiffPrefs => ({
  style: saved.includes("style=split") ? "split" : "unified",
  syntax: !saved.includes("syntax=off"),
});

export const formatPrefs = ({ style, syntax }: DiffPrefs) =>
  `style=${style};syntax=${syntax ? "on" : "off"}`;

const read = (): DiffPrefs => {
  try {
    return parsePrefs(storage()?.getItem(KEY) ?? "");
  } catch {
    return DEFAULT_PREFS;
  }
};

export const diffPrefsStore = createStore<DiffPrefs>(() => read());

export const useDiffPrefs = (): DiffPrefs => useStore(diffPrefsStore, (s) => s);

export const setDiffPrefs = (patch: Partial<DiffPrefs>) => {
  diffPrefsStore.setState(patch);

  try {
    storage()?.setItem(KEY, formatPrefs(diffPrefsStore.getState()));
  } catch {
    // Not remembered this time; the choice still holds in this window.
  }
};
