/**
 * The risk panel's own state per Review: which finding "Ask the reviewer" is about, and
 * whether the conversation with the Reviewer stands in for the findings (Paper X-G).
 */
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

const askAbout = createStore<Readonly<Record<string, string | null>>>(() => ({}));

export const useAskAbout = (subjectKey: string) => useStore(askAbout, (s) => s[subjectKey] ?? null);

export const setAskAbout = (subjectKey: string, findingId: string | null) =>
  askAbout.setState({ [subjectKey]: findingId });

const chatting = createStore<Readonly<Record<string, boolean>>>(() => ({}));

/** True while the panel shows the conversation; "Findings" goes back. */
export const useChatting = (subjectKey: string) =>
  useStore(chatting, (s) => s[subjectKey] ?? false);

export const setChatting = (subjectKey: string, open: boolean) =>
  chatting.setState({ [subjectKey]: open });
