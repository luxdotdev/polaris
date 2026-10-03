import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import type * as P from "@polaris/protocol";
import type { LanguageId } from "../model/language.ts";

export interface LanguageRow {
  readonly label: string;
  readonly detail: string;
  readonly uri?: string;
  readonly range?: typeof P.LanguageRange.Type;
  readonly encoding?: typeof P.LanguagePositionEncoding.Type;
  readonly run?: () => void;
}

export interface LanguageViewState {
  readonly language: LanguageId;
  readonly manual: LanguageId | null;
  readonly status: "unavailable" | "loading" | "ready";
  readonly fact: string;
  readonly providers: readonly string[];
  readonly panel: string | null;
  readonly rows: readonly LanguageRow[];
  readonly busy: boolean;
}

export const languageStore = createStore<{
  readonly files: Readonly<Record<string, LanguageViewState>>;
}>(() => ({ files: {} }));

export const languagePatch = (key: string, patch: Partial<LanguageViewState>) =>
  languageStore.setState((state) => {
    const current = state.files[key];

    return current === undefined
      ? state
      : { files: { ...state.files, [key]: { ...current, ...patch } } };
  });

export const useLanguage = (key: string) => useStore(languageStore, (state) => state.files[key]);
