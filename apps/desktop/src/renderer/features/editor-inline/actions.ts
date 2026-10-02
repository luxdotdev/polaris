/**
 * What the card does to its editor: open on the selection (⌘I), send the prompt, apply an
 * accepted proposal to the buffer as one undoable edit (not to disk), reject, cancel.
 */
import type { EditorView } from "@codemirror/view";
import { cardHosts } from "./cm/decorations.ts";
import { inlineFile } from "./cm/layer.ts";
import { acceptCard, cardOf, closeCard, openCard, showProposal } from "./cm/state.ts";
import { proposer } from "./data/proposer.ts";
import { type InlineRequest, landed } from "./model/card.ts";
import { checkedReplacements } from "./model/patch.ts";
import {
  cancelRequest,
  cards,
  dropCard,
  keepCancel,
  patchCard,
  rememberHarness,
  startCard,
} from "./store.ts";

/** Focuses the card's prompt once its container has rendered. */
export const focusCard = (id: number) =>
  requestAnimationFrame(() =>
    cardHosts.getState()[id]?.querySelector<HTMLElement>("[data-inline-prompt]")?.focus()
  );

/** ⌘I: a card on the selection (the cursor's line when nothing is selected), or the open one. */
export const openInlineCard = (view: EditorView): boolean => {
  const open = cardOf(view.state);

  if (open !== null) {
    focusCard(open.id);

    return true;
  }

  const { main } = view.state.selection;
  const line = view.state.doc.lineAt(main.head);
  const range = main.empty ? { from: line.from, to: line.to } : { from: main.from, to: main.to };

  view.dispatch({ effects: openCard.of(range) });
  const card = cardOf(view.state);

  if (card === null) return false;
  startCard(card.id);
  focusCard(card.id);

  return true;
};

const requestFor = (view: EditorView, id: number): InlineRequest | null => {
  const card = cardOf(view.state);
  const file = view.state.facet(inlineFile);
  const session = cards.getState()[id];

  if (card?.id !== id || file === null || session === undefined || session.prompt.trim() === "")
    return null;

  return {
    workspaceId: file.workspaceId,
    path: file.path,
    content: view.state.doc.toString(),
    selection: { from: card.from, to: card.to },
    prompt: session.prompt.trim(),
    harness: session.harness,
    model: session.model,
    effort: session.effort,
  };
};

const onProposed = (
  view: EditorView,
  id: number,
  patch: Parameters<typeof landed>[1],
  ms: number
) => {
  const session = cards.getState()[id];

  if (session?.phase.kind !== "running") return;
  const card = cardOf(view.state);
  const phase = landed(session.phase, patch, ms, card?.id === id ? card.version : null);

  patchCard(id, () => ({ phase }));

  if (phase.kind !== "proposed") return;
  const replacements = checkedReplacements(patch, phase.request.content.length) ?? [];

  view.dispatch({ effects: showProposal.of({ version: session.phase.version, replacements }) });
};

/** Sends the prompt; the card shows the Harness thinking, then its proposal. */
export const submitCard = (view: EditorView, id: number) => {
  const request = requestFor(view, id);
  const file = view.state.facet(inlineFile);
  const card = cardOf(view.state);

  if (request === null || file === null || card === null) return;
  rememberHarness(request.harness);
  patchCard(id, () => ({
    phase: { kind: "running", request, version: card.version, startedAt: Date.now(), text: "" },
  }));

  const cancel = proposer()(file.hostKey, request, {
    onDelta: (text) =>
      patchCard(id, (c) =>
        c.phase.kind === "running" ? { phase: { ...c.phase, text: c.phase.text + text } } : {}
      ),
    onProposed: (patch, ms) => onProposed(view, id, patch, ms),
    onFailed: (message) => patchCard(id, () => ({ phase: { kind: "failed", message, request } })),
  });

  keepCancel(id, cancel);
};

/** Applies the proposal to the buffer: one edit, undoable, saved like any other. */
export const acceptCardProposal = (view: EditorView, id: number): boolean => {
  const card = cardOf(view.state);

  if (card?.id !== id || card.proposal === null) return false;
  view.dispatch({
    changes: card.proposal.map((r) => ({ from: r.from, to: r.to, insert: r.text })),
    effects: acceptCard.of(null),
    userEvent: "input.inline",
  });
  dropCard(id);
  view.focus();

  return true;
};

/** ⌘↵ in the editor while a proposal shows. */
export const acceptOpenProposal = (view: EditorView): boolean => {
  const card = cardOf(view.state);

  return card !== null && acceptCardProposal(view, card.id);
};

/** Reject, ✕ or esc in the card: it closes, the buffer as it was. */
export const closeInlineCard = (view: EditorView, id: number) => {
  if (cardOf(view.state)?.id === id) view.dispatch({ effects: closeCard.of(null) });
  dropCard(id);
  view.focus();
};

/** Stops the Harness and goes back to the prompt. */
export const stopCard = (id: number) => {
  cancelRequest(id);
  patchCard(id, () => ({ phase: { kind: "draft" } }));
};
