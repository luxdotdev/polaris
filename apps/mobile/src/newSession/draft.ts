/**
 * The sheet's prompt draft, kept on this phone until Start: a new session has no id yet, so the
 * Host's per-session drafts (continuity.saveDraft) can't hold it.
 */
import * as SecureStore from "expo-secure-store";
import { useEffect, useRef, useState } from "react";

const KEY = "polaris.newSession.draft";

/** Typing pauses this long before the draft is written. */
const SAVE_DELAY_MS = 500;

export interface DraftStore {
  readonly load: () => Promise<string | null>;
  readonly save: (text: string) => Promise<void>;
}

export const secureDraftStore: DraftStore = {
  load: () => SecureStore.getItemAsync(KEY),
  save: (text) =>
    text.trim() === "" ? SecureStore.deleteItemAsync(KEY) : SecureStore.setItemAsync(KEY, text),
};

export type DraftStatus = "saved" | "saving" | "idle";

export interface Draft {
  readonly text: string;
  readonly setText: (text: string) => void;
  /** "saved" once the latest non-empty text is written. */
  readonly status: DraftStatus;
  /** Forgets the draft (after Start). */
  readonly clear: () => Promise<void>;
}

export const useDraft = (store: DraftStore = secureDraftStore): Draft => {
  const [text, setTextState] = useState("");
  const [status, setStatus] = useState<DraftStatus>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touched = useRef(false);
  const latest = useRef(0);

  useEffect(() => {
    void store.load().then((saved) => {
      if (saved === null || touched.current) return;
      setTextState(saved);
      setStatus("saved");
    });

    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [store]);

  const setText = (next: string) => {
    touched.current = true;
    setTextState(next);
    setStatus(next.trim() === "" ? "idle" : "saving");

    if (timer.current !== null) clearTimeout(timer.current);

    const write = ++latest.current;

    timer.current = setTimeout(() => {
      void store.save(next).then(() => {
        // Newer typing keeps "saving" until its own write lands.
        if (write === latest.current) setStatus(next.trim() === "" ? "idle" : "saved");
      });
    }, SAVE_DELAY_MS);
  };

  const clear = async () => {
    if (timer.current !== null) clearTimeout(timer.current);
    latest.current++;
    setTextState("");
    setStatus("idle");
    await store.save("");
  };

  return { text, setText, status, clear };
};
