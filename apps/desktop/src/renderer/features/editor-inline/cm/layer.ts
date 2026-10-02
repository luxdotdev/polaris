/**
 * Each editor view's overlay layer, a box inside its scroller that the React layer portals
 * the selection bar into, and where the bar goes (DESIGN.md, Editor: selection actions): at
 * the end of the selection's first line, clear of the selected text, or above the selection
 * when the line runs too far right. Measured only when the selection, focus or layout changes.
 */
import { type EditorState, Facet } from "@codemirror/state";
import type { WorkspaceId } from "@polaris/protocol";
import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { createStore } from "zustand/vanilla";
import { cardOf } from "./state.ts";

/** Which file a view shows; given by the editor per tab (its `editorFile` facet's value). */
export interface InlineFile {
  readonly hostKey: string;
  readonly workspaceId: WorkspaceId;
  /** Absolute on the Host. */
  readonly path: string;
}

export const inlineFile = Facet.define<InlineFile, InlineFile | null>({
  combine: (values) => values[0] ?? null,
});

export interface BarPlace {
  /** In the scroller's content box. */
  readonly top: number;
  readonly left: number;
}

/** The open card and the lines it covers, 1-based. */
export interface CardLines {
  readonly id: number;
  readonly first: number;
  readonly last: number;
}

export interface ViewLayer {
  readonly view: EditorView;
  readonly file: InlineFile | null;
  readonly dom: HTMLElement;
  readonly bar: BarPlace | null;
  readonly card: CardLines | null;
}

interface Measured {
  readonly bar: BarPlace | null;
  readonly card: CardLines | null;
}

const sameBar = (a: BarPlace | null, b: BarPlace | null) =>
  a === b || (a !== null && b !== null && a.top === b.top && a.left === b.left);

const sameCard = (a: CardLines | null, b: CardLines | null) =>
  a === b ||
  (a !== null && b !== null && a.id === b.id && a.first === b.first && a.last === b.last);

const cardLines = (state: EditorState): CardLines | null => {
  const card = cardOf(state);

  if (card === null) return null;

  return {
    id: card.id,
    first: state.doc.lineAt(card.from).number,
    last: state.doc.lineAt(card.to).number,
  };
};

/** Every mounted editor view's layer, in mount order. */
export const layers = createStore<ReadonlyArray<ViewLayer>>(() => []);

/** Publishes a view's measurement; nothing re-renders when it hasn't moved. */
const publish = (view: EditorView, next: Measured) => {
  const current = layers.getState().find((l) => l.view === view);

  if (
    current === undefined ||
    (sameBar(current.bar, next.bar) && sameCard(current.card, next.card))
  )
    return;
  layers.setState((all) => all.map((l) => (l.view === view ? { ...l, ...next } : l)), true);
};

/** Wide enough for both actions; a guess, so the bar flips above a little early, never late. */
const BAR_WIDTH = 340;

const BAR_HEIGHT = 34;

const GAP = 16;

/** Whether the bar should show at all: a selection, focus, and no card open. */
export const wantsBar = (state: EditorState, focused: boolean) =>
  focused && !state.selection.main.empty && cardOf(state) === null;

const measure = (view: EditorView): BarPlace | null => {
  const { state, scrollDOM } = view;

  if (!wantsBar(state, view.hasFocus)) return null;
  const { from, to } = state.selection.main;
  const first = state.doc.lineAt(from);
  const ends = [first.to];

  if (first.number < state.doc.lines && state.doc.line(first.number + 1).from < to)
    ends.push(state.doc.line(first.number + 1).to);
  const right = Math.max(...ends.map((pos) => view.coordsAtPos(pos)?.right ?? -Infinity));
  const line = view.coordsAtPos(first.from);

  if (line === null || right === -Infinity) return null;
  const box = scrollDOM.getBoundingClientRect();
  const x = (client: number) => client - box.left + scrollDOM.scrollLeft;
  const y = (client: number) => client - box.top + scrollDOM.scrollTop;
  const beside = x(right) + GAP;

  if (beside + BAR_WIDTH <= scrollDOM.clientWidth + scrollDOM.scrollLeft)
    return { left: beside, top: y((line.top + line.bottom) / 2) - BAR_HEIGHT / 2 };

  return {
    left: x(view.contentDOM.getBoundingClientRect().left) + GAP,
    top: y(line.top) - BAR_HEIGHT - 4,
  };
};

class LayerPlugin {
  readonly dom: HTMLElement;

  constructor(readonly view: EditorView) {
    this.dom = document.createElement("div");
    this.dom.className = "cm-inline-layer";
    view.scrollDOM.append(this.dom);
    layers.setState(
      (all) => [
        ...all,
        { view, file: view.state.facet(inlineFile), dom: this.dom, bar: null, card: null },
      ],
      true
    );
  }

  update(update: ViewUpdate) {
    const moved = update.selectionSet || update.focusChanged || update.geometryChanged;

    if (!moved && !update.docChanged && !update.transactions.some((t) => t.effects.length > 0))
      return;
    this.view.requestMeasure({
      key: this,
      read: (view): Measured => ({ bar: measure(view), card: cardLines(view.state) }),
      write: (measured, view) => publish(view, measured),
    });
  }

  destroy() {
    this.dom.remove();
    layers.setState((all) => all.filter((l) => l.view !== this.view), true);
  }
}

export const layerPlugin = ViewPlugin.fromClass(LayerPlugin);
