/** The risk column's own state per Review: which finding "Ask the reviewer" is about. */
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

const askAbout = createStore<Readonly<Record<string, string | null>>>(() => ({}));

export const useAskAbout = (subjectKey: string) => useStore(askAbout, (s) => s[subjectKey] ?? null);

export const setAskAbout = (subjectKey: string, findingId: string | null) =>
  askAbout.setState({ [subjectKey]: findingId });
