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

/** The lead composer's draft and its Send, per Host and Constellation, shared by every arrangement. */
export interface LeadInput {
  readonly text: string;
  /** Bumped by each edit, so a Send's acknowledgement clears only the text it sent. */
  readonly generation: number;
  readonly sending: boolean;
  readonly error: string | null;
}

const NO_INPUT: LeadInput = { text: "", generation: 0, sending: false, error: null };

export const leadInputs = keptStore<LeadInput>();

/** Edits and Sends on a lead input store; one Send at a time per key, whichever view started it. */
export const leadComposing = (store: Kept<LeadInput>) => {
  const get = (key: string) => store.all().get(key) ?? NO_INPUT;

  const patch = (key: string, change: Partial<LeadInput>) =>
    store.set(key, { ...get(key), ...change });

  const type = (key: string, text: string) =>
    patch(key, { text, generation: get(key).generation + 1 });

  const send = async (key: string, onSend: (text: string) => Promise<void>) => {
    const now = get(key);
    const text = now.text.trim();

    if (now.sending || text === "") return;
    patch(key, { sending: true, error: null });

    try {
      await onSend(text);
      const cleared = get(key).generation === now.generation;

      patch(
        key,
        cleared ? { text: "", generation: now.generation + 1, sending: false } : { sending: false }
      );
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);

      patch(key, { sending: false, error: `Couldn't send: ${message}` });
    }
  };

  return { get, type, send };
};

const lead = leadComposing(leadInputs);

/** The kept lead input for one Constellation, with its edit and Send. */
export const useLeadInput = (key: string) => {
  const all = useSyncExternalStore(leadInputs.subscribe, leadInputs.all);

  return {
    ...(all.get(key) ?? NO_INPUT),
    type: (text: string) => lead.type(key, text),
    send: (onSend: (text: string) => Promise<void>) => void lead.send(key, onSend),
  };
};

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
