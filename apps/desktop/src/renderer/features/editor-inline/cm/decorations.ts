/**
 * What the card draws in the text (Paper E2): the card itself as a block above the selection,
 * the selected lines on a Starlight fill, and a proposal inline as a diff (removed lines on
 * the removed fill, added lines below them on the added fill).
 */
import { type EditorState, type Range, RangeSet, type Text } from "@codemirror/state";
import { highlightingFor, language } from "@codemirror/language";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { highlightTree } from "@lezer/highlight";
import { createStore } from "zustand/vanilla";
import { type Hunk, hunksOf, type Replacement } from "../model/patch.ts";
import { numbering } from "../model/numbers.ts";
import { type StyledSpan, styledLines } from "../model/styled.ts";
import { cardField, cardHeight, cardOf, type CardPlace, lastLine } from "./state.ts";

/** Card containers by card id: the React layer portals each card into its own. */
export const cardHosts = createStore<Readonly<Record<number, HTMLElement>>>(() => ({}));

const observers = new WeakMap<HTMLElement, ResizeObserver>();

class CardWidget extends WidgetType {
  constructor(
    readonly id: number,
    readonly height: number
  ) {
    super();
  }

  override eq(other: CardWidget) {
    return other.id === this.id && other.height === this.height;
  }

  /** A new height keeps the same container (the card is portalled into it), measured again. */
  override updateDOM(_dom: HTMLElement, _view: EditorView, from: WidgetType) {
    return from instanceof CardWidget && from.id === this.id;
  }

  override toDOM(view: EditorView) {
    const dom = document.createElement("div");

    dom.className = "cm-inline-card";
    dom.contentEditable = "false";
    dom.dataset["testid"] = "inline-card-host";
    // The card grows as the proposal streams in; CodeMirror re-measures block heights on request.

    const observer = new ResizeObserver(() => {
      const height = dom.offsetHeight;

      if (cardOf(view.state)?.height !== height) view.dispatch({ effects: cardHeight.of(height) });
    });

    observer.observe(dom);
    observers.set(dom, observer);
    cardHosts.setState((s) => ({ ...s, [this.id]: dom }));

    return dom;
  }

  override destroy(dom: HTMLElement) {
    observers.get(dom)?.disconnect();
    cardHosts.setState((s) => {
      if (s[this.id] !== dom) return s;
      const { [this.id]: _gone, ...rest } = s;

      return rest;
    }, true);
  }

  override get estimatedHeight() {
    return 104;
  }

  override ignoreEvent() {
    return true;
  }
}

/** The added text highlighted by the editor's language and theme, as the lines around it are. */
const spansIn = (view: EditorView, text: string): Array<StyledSpan> => {
  const lang = view.state.facet(language);
  const spans: Array<StyledSpan> = [];

  if (lang === null) return spans;
  highlightTree(
    lang.parser.parse(text),
    { style: (tags) => highlightingFor(view.state, tags) },
    (from, to, className) => spans.push({ from, to, className })
  );

  return spans;
};

export class AddedLines extends WidgetType {
  constructor(
    readonly lines: ReadonlyArray<string>,
    /** The new number of the first line, for the line-number gutter beside it. */
    readonly first: number
  ) {
    super();
  }

  override eq(other: AddedLines) {
    return other.first === this.first && other.lines.join("\n") === this.lines.join("\n");
  }

  override toDOM(view: EditorView) {
    const dom = document.createElement("div");
    const text = this.lines.join("\n");

    dom.className = "cm-inline-added";
    dom.dataset["testid"] = "inline-added";

    for (const pieces of styledLines(text, spansIn(view, text))) {
      const line = document.createElement("div");

      line.className = "cm-inline-added-line";

      for (const piece of pieces) {
        const span = document.createElement("span");

        span.textContent = piece.text;

        if (piece.className !== null) span.className = piece.className;
        line.append(span);
      }

      if (pieces.length === 0) line.textContent = "\u200b";
      dom.append(line);
    }

    return dom;
  }

  override ignoreEvent() {
    return true;
  }
}

const selectedLine = Decoration.line({ class: "cm-inline-selected" });

const removedLine = Decoration.line({ class: "cm-inline-removed" });

/** The hunks of `replacements`, each worked out on just the lines it touches. */
export const hunksIn = (doc: Text, replacements: ReadonlyArray<Replacement>): Array<Hunk> =>
  replacements.flatMap((r) => {
    const first = doc.lineAt(r.from);
    const end = doc.lineAt(r.to);

    const last =
      r.to > r.from && r.to === end.from && end.number > 1 ? doc.line(end.number - 1) : end;

    const slice = doc.sliceString(first.from, last.to);
    const local = { from: r.from - first.from, to: r.to - first.from, text: r.text };

    return hunksOf(slice, [local]).map((h) => ({ ...h, line: h.line + first.number - 1 }));
  });

const diffRanges = (doc: Text, hunk: Hunk, first: number): Array<Range<Decoration>> => {
  const ranges: Array<Range<Decoration>> = [];

  for (let n = 0; n < hunk.removed.length; n++)
    ranges.push(removedLine.range(doc.line(hunk.line + n).from));

  if (hunk.added.length === 0) return ranges;
  const widget = Decoration.widget({ widget: new AddedLines(hunk.added, first), block: true });
  const after = hunk.line + Math.max(hunk.removed.length, 1) - 1;

  // A pure insertion at the very top sits before line 1.
  if (after < 1) ranges.push(widget.range(0));
  else
    ranges.push(
      Decoration.widget({
        widget: new AddedLines(hunk.added, first),
        block: true,
        side: 1,
      }).range(doc.line(after).to)
    );

  return ranges;
};

const cardRanges = (state: EditorState, card: CardPlace): Array<Range<Decoration>> => {
  const { doc } = state;
  const first = doc.lineAt(card.from);

  const ranges: Array<Range<Decoration>> = [
    Decoration.widget({
      widget: new CardWidget(card.id, card.height),
      block: true,
      side: -1,
    }).range(first.from),
  ];

  const last = lastLine(doc, card.from, card.to);

  for (let n = first.number; n <= last; n++) ranges.push(selectedLine.range(doc.line(n).from));

  const hunks = hunksIn(doc, card.proposal ?? []);
  const added = [...numbering(hunks).added];

  for (const hunk of hunks) {
    const first = hunk.added.length === 0 ? 0 : (added.shift()?.first ?? 0);

    ranges.push(...diffRanges(doc, hunk, first));
  }

  return ranges;
};

export const cardDecorations = EditorView.decorations.compute(
  [cardField],
  (state): DecorationSet => {
    const card = state.field(cardField);

    return card === null ? RangeSet.empty : Decoration.set(cardRanges(state, card), true);
  }
);
