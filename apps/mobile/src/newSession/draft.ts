/**
 * A new session's prompt drafts, one per Host and Workspace, kept on this phone until the first
 * send: a new session has no id yet, so the Host's per-session drafts (continuity.saveDraft) can't
 * hold them.
 */
import * as SecureStore from "expo-secure-store";
import { useEffect, useRef, useState } from "react";
import { type DraftStore, draftKey, draftWriter } from "./draftWriter.ts";
import type { Target } from "./model.ts";

export type { DraftStore } from "./draftWriter.ts";

export const secureDraftStore: DraftStore = {
  load: (key) => SecureStore.getItemAsync(key),
  save: (key, text) =>
    text.trim() === "" ? SecureStore.deleteItemAsync(key) : SecureStore.setItemAsync(key, text),
};

export type DraftStatus = "saved" | "saving" | "idle";

export interface Draft {
  readonly text: string;
  readonly setText: (text: string) => void;
  /** "saved" once the latest non-empty text is written. */
  readonly status: DraftStatus;
  /** Forgets this place's draft (after the first send). */
  readonly clear: () => Promise<void>;
}

/** The draft of the chosen Host and Workspace; switching place keeps the last one's draft. */
export const useDraft = (target: Target | null, store: DraftStore = secureDraftStore): Draft => {
  const key = target === null ? null : draftKey(target);
  const [text, setTextState] = useState("");
  const [status, setStatus] = useState<DraftStatus>("idle");
  const latest = useRef<{ key: string | null; text: string }>({ key, text: "" });

  const [writer] = useState(() =>
    draftWriter(store, (savedKey, saved) => {
      // Newer typing keeps "saving" until its own write lands.
      if (savedKey === latest.current.key && saved === latest.current.text)
        setStatus(saved.trim() === "" ? "idle" : "saved");
    })
  );

  useEffect(() => {
    latest.current = { key, text: "" };
    setTextState("");
    setStatus("idle");

    if (key === null) return;
    const mark = latest.current;

    void writer.flush().then(() =>
      store.load(key).then((saved) => {
        // Typing (or another place) since the switch wins over the stored draft.
        if (saved === null || latest.current !== mark) return;
        latest.current = { key, text: saved };
        setTextState(saved);
        setStatus("saved");
      })
    );
  }, [key, store, writer]);

  useEffect(() => () => void writer.flush(), [writer]);

  return {
    text,
    status,
    setText: (next) => {
      latest.current = { key, text: next };
      setTextState(next);

      if (key === null) return;
      setStatus(next.trim() === "" ? "idle" : "saving");
      writer.write(key, next);
    },
    clear: async () => {
      latest.current = { key, text: "" };
      setTextState("");
      setStatus("idle");

      if (key !== null) await writer.clear(key);
    },
  };
};
