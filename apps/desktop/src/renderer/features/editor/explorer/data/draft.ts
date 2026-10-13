/** Each Commit box's draft, by explorer key; its own module so `suggest.ts` loads light. */
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { IDLE, type Suggestion } from "../model/suggest.ts";

/** A commit in this explorer: its message as typed, and the last run's hook output. */
export interface CommitDraft {
  readonly message: string;
  readonly run:
    | { readonly kind: "idle" }
    | { readonly kind: "running"; readonly startedAt: number; readonly output: string }
    | { readonly kind: "failed"; readonly output: string; readonly exitCode: number | null };
  /** The subject of the commit just made, until the next edit to the message. */
  readonly committed: string | null;
  /** "Write a message" (data/suggest.ts). */
  readonly suggestion: Suggestion;
}

const blank: CommitDraft = {
  message: "",
  run: { kind: "idle" },
  committed: null,
  suggestion: IDLE,
};

export const drafts = createStore<Record<string, CommitDraft>>(() => ({}));

export const patch = (key: string, change: (d: CommitDraft) => Partial<CommitDraft>) =>
  drafts.setState((s) => {
    const current = s[key] ?? blank;

    return { [key]: { ...current, ...change(current) } };
  });

export const useCommitDraft = (key: string) => useStore(drafts, (s) => s[key] ?? blank);

export const draftOf = (key: string): CommitDraft => drafts.getState()[key] ?? blank;

/** Typing over a written message makes it the user's own: Undo goes away. */
export const setMessage = (key: string, message: string) =>
  patch(key, (d) => ({
    message,
    committed: null,
    suggestion: d.suggestion.kind === "replaced" ? IDLE : d.suggestion,
  }));
