/**
 * Each open card's session by card id (`cm/state.ts` gives the id): the prompt, the Harness
 * picked, and its phase. Requests in flight keep their cancel functions here too.
 */
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { type CardSession, draftCard, type InlineHarness, isInlineHarness } from "./model/card.ts";

export const cards = createStore<Readonly<Record<number, CardSession>>>(() => ({}));

export const useCard = (id: number): CardSession | undefined => useStore(cards, (s) => s[id]);

export const patchCard = (id: number, patch: (card: CardSession) => Partial<CardSession>) =>
  cards.setState((s) => {
    const card = s[id];

    return card === undefined ? s : { ...s, [id]: { ...card, ...patch(card) } };
  });

const cancels = new Map<number, () => void>();

export const keepCancel = (id: number, cancel: () => void) => cancels.set(id, cancel);

/** Cancels the card's request, if one is running. */
export const cancelRequest = (id: number) => {
  cancels.get(id)?.();
  cancels.delete(id);
};

export const dropCard = (id: number) => {
  cancelRequest(id);
  cards.setState((s) => {
    const { [id]: _gone, ...rest } = s;

    return rest;
  }, true);
};

const HARNESS_KEY = "polaris.inline.harness.v1";

/** The Harness the last card used; Claude Code before any. */
export const lastHarness = (): InlineHarness => {
  try {
    const saved = localStorage.getItem(HARNESS_KEY) ?? "";

    return isInlineHarness(saved) ? saved : "claude";
  } catch {
    return "claude";
  }
};

export const rememberHarness = (harness: InlineHarness) => {
  try {
    localStorage.setItem(HARNESS_KEY, harness);
  } catch {
    // Storage unavailable: the next card starts on the default again.
  }
};

export const startCard = (id: number) =>
  cards.setState((s) => ({ ...s, [id]: draftCard(lastHarness()) }));
