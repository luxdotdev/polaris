/**
 * The line-number gutter while a proposal shows (Paper E2): numbers as they will be after
 * Accept. Removed lines go blank, lines below move, and added lines get the new numbers.
 */
import { type Range, RangeSet } from "@codemirror/state";
import { GutterMarker, lineNumberMarkers, lineNumberWidgetMarker } from "@codemirror/view";
import { numbering, shownNumber } from "../model/numbers.ts";
import { AddedLines, hunksIn } from "./decorations.ts";
import { cardField } from "./state.ts";

class Shown extends GutterMarker {
  constructor(readonly text: string) {
    super();
  }

  override eq(other: Shown) {
    return other.text === this.text;
  }

  override toDOM() {
    return document.createTextNode(this.text);
  }
}

class Stacked extends GutterMarker {
  constructor(
    readonly first: number,
    readonly count: number
  ) {
    super();
  }

  override eq(other: Stacked) {
    return other.first === this.first && other.count === this.count;
  }

  override toDOM() {
    const dom = document.createElement("div");

    dom.className = "cm-inline-added-numbers";

    for (let n = 0; n < this.count; n++) {
      const line = document.createElement("div");

      line.textContent = String(this.first + n);
      dom.append(line);
    }

    return dom;
  }
}

const blank = new Shown("");

// SAFETY: the empty set holds no markers, so it is a set of any marker type.
const none = RangeSet.empty as RangeSet<GutterMarker>;

const markers = lineNumberMarkers.compute([cardField], (state) => {
  const card = state.field(cardField);

  if (card === null || card.proposal === null) return none;
  const { doc } = state;
  const numbers = numbering(hunksIn(doc, card.proposal));
  const first = Math.min(...numbers.shifts.map((s) => s.from), ...numbers.removed);
  const ranges: Array<Range<GutterMarker>> = [];

  for (let line = Math.max(1, first); line <= doc.lines; line++) {
    const shown = shownNumber(numbers, line);

    if (shown !== line)
      ranges.push((shown === null ? blank : new Shown(String(shown))).range(doc.line(line).from));
  }

  return RangeSet.of(ranges);
});

const widgetNumbers = lineNumberWidgetMarker.of((_view, widget) =>
  widget instanceof AddedLines ? new Stacked(widget.first, widget.lines.length) : null
);

export const proposalNumbers = [markers, widgetNumbers];
