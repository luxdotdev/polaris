/** A switch kept in device storage, on by default (see `constellations.ts`). */
export interface PreferenceStorage {
  readonly load: () => Promise<string | null>;
  readonly save: (value: string) => Promise<void>;
}

export interface Preference {
  readonly get: () => boolean;
  readonly set: (on: boolean) => void;
  readonly subscribe: (listener: () => void) => () => void;
}

/** On until the stored value says off; a change before the load finishes wins over it. */
export const createPreference = (storage: PreferenceStorage): Preference => {
  let on = true;
  let touched = false;
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((listener) => listener());

  void storage.load().then((stored) => {
    if (touched || stored !== "off") return;
    on = false;
    changed();
  });

  return {
    get: () => on,
    set: (next) => {
      touched = true;

      if (next === on) return;
      on = next;
      void storage.save(next ? "on" : "off");
      changed();
    },
    subscribe: (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
  };
};
