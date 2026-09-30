/**
 * The open Output panel's width, one for the window, kept in `localStorage`.
 * Null until the user drags it: the default then follows the window.
 */
import { Option, Schema } from "effect";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

const STORAGE_KEY = "polaris.output.v1";

const Persisted = Schema.Struct({ width: Schema.NullOr(Schema.Number) });

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Persisted));

const storage = (): Storage | null =>
  "localStorage" in globalThis ? globalThis.localStorage : null;

const load = (): number | null => {
  try {
    const raw = storage()?.getItem(STORAGE_KEY) ?? null;

    return raw === null
      ? null
      : Option.match(decode(raw), { onNone: () => null, onSome: (p) => p.width });
  } catch {
    return null;
  }
};

const store = createStore<{ readonly width: number | null }>(() => ({ width: load() }));

let saveTimer: ReturnType<typeof setTimeout> | null = null;

store.subscribe((state) => {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      storage()?.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage unavailable: the width holds for this run only.
    }
  }, 300);
});

export const useOutputWidth = (): number | null => useStore(store, (s) => s.width);

/** Null goes back to the default. */
export const setOutputWidth = (width: number | null) => store.setState({ width });
