/**
 * The inline card's place in one editor (DESIGN.md, Editor: inline chat): the selected range
 * it asks about, mapped through edits, and the proposal's replacements once they arrive.
 * Any other edit to the buffer while a request runs or a proposal shows makes it stale, since
 * the patch was made against the exact text sent (`inline.propose`).
 */
import { type EditorState, StateEffect, StateField, type Transaction } from "@codemirror/state";
import type { Replacement } from "../model/patch.ts";

export interface CardPlace {
  /** Unique per card; the React layer keys its session by it. */
  readonly id: number;
  readonly from: number;
  readonly to: number;
  /** Bumped by every edit since the card opened; a request remembers the one it was sent at. */
  readonly version: number;
  readonly proposal: ReadonlyArray<Replacement> | null;
}

let nextId = 0;

export const openCard = StateEffect.define<{ readonly from: number; readonly to: number }>();

export const closeCard = StateEffect.define<null>();

export const showProposal = StateEffect.define<{
  readonly version: number;
  readonly replacements: ReadonlyArray<Replacement>;
}>();

/** Goes with Accept's edit: the card closes rather than going stale. */
export const acceptCard = StateEffect.define<null>();

const mapped = (card: CardPlace, tr: Transaction): CardPlace => {
  if (!tr.docChanged) return card;

  return {
    ...card,
    from: tr.changes.mapPos(card.from, -1),
    to: tr.changes.mapPos(card.to, 1),
    version: card.version + 1,
    proposal: null,
  };
};

const applyEffects = (card: CardPlace | null, tr: Transaction): CardPlace | null => {
  let next = card;

  for (const effect of tr.effects) {
    if (effect.is(openCard)) {
      nextId += 1;
      next = { id: nextId, ...effect.value, version: 0, proposal: null };
    } else if (effect.is(closeCard) || effect.is(acceptCard)) next = null;
    else if (effect.is(showProposal) && next !== null && next.version === effect.value.version)
      next = { ...next, proposal: effect.value.replacements };
  }

  return next;
};

export const cardField = StateField.define<CardPlace | null>({
  create: () => null,
  update: (card, tr) => applyEffects(card === null ? null : mapped(card, tr), tr),
});

export const cardOf = (state: EditorState): CardPlace | null =>
  state.field(cardField, false) ?? null;
