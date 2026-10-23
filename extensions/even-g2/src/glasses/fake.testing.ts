/** Glasses for tests: keeps what a real display would show, and takes input like the touchpad. */
import type { Page } from "../model/page.ts";
import type { Glasses } from "./bridge.ts";
import type { GlassesEvent } from "./input.ts";

export interface FakeGlasses extends Glasses {
  /** What the display shows now; null before the first page. */
  readonly shown: () => Page | null;
  readonly text: () => string;
  readonly rows: () => ReadonlyArray<string>;
  readonly microphoneOn: () => boolean;
  readonly exits: () => number;
  readonly send: (event: GlassesEvent) => void;
  /** Resolves once `predicate` holds for what is shown. */
  readonly until: (
    predicate: (glasses: FakeGlasses) => boolean,
    what: string,
    timeoutMs?: number
  ) => Promise<void>;
}

export const fakeGlasses = (): FakeGlasses => {
  let shown: Page | null = null;
  let microphone = false;
  let exits = 0;
  const listeners = new Set<(event: GlassesEvent) => void>();

  const glasses: FakeGlasses = {
    create: async (page) => {
      if (shown !== null) return false;
      shown = page;

      return true;
    },
    rebuild: async (page) => {
      shown = page;

      return true;
    },
    upgrade: async (text) => {
      if (shown === null) return false;
      const page = shown;

      shown = {
        ...page,
        texts: page.texts.map((t) => (t.id === text.id ? { ...t, content: text.content } : t)),
      };

      return true;
    },
    microphone: async (on) => {
      microphone = on;

      return true;
    },
    exit: async () => {
      exits++;
    },
    onEvent: (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    shown: () => shown,
    text: () => shown?.texts.map((t) => t.content).join("\n") ?? "",
    rows: () => shown?.lists.flatMap((list) => list.items) ?? [],
    microphoneOn: () => microphone,
    exits: () => exits,
    send: (event) => {
      for (const listener of listeners) listener(event);
    },
    until: async (predicate, what, timeoutMs = 20_000) => {
      const deadline = Date.now() + timeoutMs;

      while (!predicate(glasses)) {
        if (Date.now() > deadline)
          throw new Error(
            `the glasses never showed ${what}; they show:\n${glasses.text()}\n${glasses.rows().join("\n")}`
          );
        await Bun.sleep(20);
      }
    },
  };

  return glasses;
};
