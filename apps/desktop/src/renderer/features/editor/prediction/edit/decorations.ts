/**
 * How an Edit Prediction is drawn (DESIGN.md "Edit Predictions"): removed text struck on the
 * diff-removed tints, new text as ghost text in `diff-added-text`, one hint per prediction, and
 * only the keycap in Subtle display. Decorations only; nothing animates.
 */
import { type EditorState, type Range, type Text } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import type { PredictedEdit } from "@polaris/protocol";
import {
  type EditPrediction,
  hunkKind,
  isJump,
  jumpPending,
  linesRemoved,
  removesWholeLines,
  targetLine,
} from "./model.ts";
import { drawsInPlace, visibleEditPrediction } from "./state.ts";

/** The keycap, then an optional label; null draws the bare keycap. */
type Hint = { readonly label: string | null };

const hintNode = (hint: Hint) => {
  const node = document.createElement("span");
  node.className = "cm-ep-hint";
  const cap = document.createElement("span");
  cap.className = "cm-prediction-key";
  cap.textContent = "Tab";
  node.append(cap);

  if (hint.label !== null) {
    const label = document.createElement("span");
    label.className = "cm-ep-label";
    label.textContent = hint.label;
    node.append(label);
  }

  return node;
};

class HintWidget extends WidgetType {
  constructor(readonly hint: Hint) {
    super();
  }
  override eq(other: HintWidget) {
    return this.hint.label === other.hint.label;
  }
  override toDOM() {
    return hintNode(this.hint);
  }
  override ignoreEvent() {
    return true;
  }
}

class GhostSpan extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  override eq(other: GhostSpan) {
    return this.text === other.text;
  }
  override toDOM() {
    const node = document.createElement("span");
    node.className = "cm-ep-added";
    node.setAttribute("aria-hidden", "true");
    node.textContent = this.text;

    return node;
  }
  override ignoreEvent() {
    return true;
  }
}

class GhostBlock extends WidgetType {
  constructor(
    readonly lines: ReadonlyArray<string>,
    readonly hint: Hint | null
  ) {
    super();
  }
  override eq(other: GhostBlock) {
    return (
      this.lines.length === other.lines.length &&
      this.lines.every((line, i) => line === other.lines[i]) &&
      this.hint?.label === other.hint?.label &&
      (this.hint === null) === (other.hint === null)
    );
  }
  override toDOM() {
    const node = document.createElement("div");
    node.className = "cm-ep-block";
    node.setAttribute("aria-hidden", "true");
    this.lines.forEach((line, i) => {
      const row = document.createElement("div");
      row.className = "cm-ep-block-line";
      const text = document.createElement("span");
      text.textContent = line;
      row.append(text);

      if (i === 0 && this.hint !== null) row.append(hintNode(this.hint));
      node.append(row);
    });

    return node;
  }
  override ignoreEvent() {
    return true;
  }
}

const removedLine = Decoration.line({ class: "cm-ep-removed-line" });

const removedSpan = Decoration.mark({ class: "cm-ep-removed" });

const struck = Decoration.mark({ class: "cm-ep-struck" });

const blockLines = (text: string) => (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n");

const hintAt = (pos: number, hint: Hint) =>
  Decoration.widget({ widget: new HintWidget(hint), side: 10 }).range(pos);

const blockAfter = (pos: number, lines: ReadonlyArray<string>, hint: Hint | null) =>
  Decoration.widget({ widget: new GhostBlock(lines, hint), block: true, side: 2 }).range(pos);

/** A hunk's decorations; the hint goes with it when it is the first hunk (else null). */
const hunkDecorations = (
  doc: Text,
  hunk: PredictedEdit,
  hint: Hint | null
): Range<Decoration>[] => {
  const out: Range<Decoration>[] = [];
  const wholeLines = removesWholeLines(doc, hunk);

  if (wholeLines) {
    const last = doc.lineAt(hunk.to - 1);

    for (let n = doc.lineAt(hunk.from).number; n <= last.number; n++)
      out.push(removedLine.range(doc.line(n).from));

    if (last.to > hunk.from) out.push(struck.range(hunk.from, last.to));

    if (hunk.text.length > 0) out.push(blockAfter(last.to, blockLines(hunk.text), hint));
    else if (hint !== null) out.push(hintAt(doc.lineAt(hunk.from).to, hint));

    return out;
  }

  if (hunk.to > hunk.from) out.push(removedSpan.range(hunk.from, hunk.to));

  if (
    hunk.from === hunk.to &&
    doc.lineAt(hunk.from).from === hunk.from &&
    hunk.text.endsWith("\n")
  ) {
    out.push(
      Decoration.widget({
        widget: new GhostBlock(blockLines(hunk.text), hint),
        block: true,
        side: -2,
      }).range(hunk.from)
    );

    return out;
  }

  const [first = "", ...rest] = hunk.text.split("\n");
  const line = doc.lineAt(hunk.to);

  if (first.length > 0)
    out.push(Decoration.widget({ widget: new GhostSpan(first), side: 1 }).range(hunk.to));

  if (hint !== null) out.push(hintAt(line.to, hint));

  if (rest.length > 0) out.push(blockAfter(line.to, rest, null));

  return out;
};

const jumpLabel = (doc: Text, prediction: EditPrediction, subtle: boolean) => {
  const target = targetLine(doc, prediction.hunks);
  const arrow = target > doc.lineAt(prediction.anchor).number ? "↓" : "↑";

  return subtle ? arrow : `Ln ${target} ${arrow}`;
};

const editLabel = (doc: Text, prediction: EditPrediction): string | null => {
  if (hunkKind(prediction.hunks) !== "delete") return null;
  const lines = linesRemoved(doc, prediction.hunks);

  if (lines === 0) return null;

  return prediction.phase === "armed" ? `again to delete ${lines} lines` : `delete ${lines} lines`;
};

export const decorationsOf = (state: EditorState): DecorationSet => {
  const prediction = visibleEditPrediction(state);

  if (prediction === null) return Decoration.none;
  const { doc } = state;
  const subtle = !drawsInPlace(state);
  const cursorLine = doc.lineAt(state.selection.main.head);

  if (jumpPending(prediction))
    return Decoration.set([hintAt(cursorLine.to, { label: jumpLabel(doc, prediction, subtle) })]);

  if (subtle) return Decoration.set([hintAt(cursorLine.to, { label: null })]);
  const hint: Hint = { label: editLabel(doc, prediction) };

  return Decoration.set(
    prediction.hunks.flatMap((hunk, i) => hunkDecorations(doc, hunk, i === 0 ? hint : null)),
    true
  );
};

/** Whether the prediction's target is a jump whose line is at `line`, for the edge marker. */
export const jumpTarget = (state: EditorState): number | null => {
  const prediction = visibleEditPrediction(state);

  return prediction !== null &&
    isJump(state.doc, prediction.hunks, prediction.anchor) &&
    jumpPending(prediction)
    ? (prediction.hunks[0]?.from ?? null)
    : null;
};

const GHOST = {
  whiteSpace: "pre",
  fontFamily: "inherit",
  fontVariantLigatures: "none",
  fontFeatureSettings: '"liga" 0, "calt" 0',
  pointerEvents: "none",
  animation: "none",
  transition: "none",
} as const;

export const editTheme = EditorView.baseTheme({
  ".cm-ep-removed": {
    backgroundColor: "var(--color-diff-removed-emphasis)",
    textDecoration: "line-through",
  },
  // Two classes outrank the theme's `.cm-activeLine`, so the cursor line reads as part of the block.
  ".cm-ep-removed-line, .cm-activeLine.cm-ep-removed-line": {
    backgroundColor: "var(--color-diff-removed-bg)",
  },
  ".cm-ep-struck": { textDecoration: "line-through" },
  ".cm-ep-added, .cm-ep-block": { ...GHOST, color: "var(--color-diff-added-text)" },
  ".cm-ep-block": { padding: "0 2px", lineHeight: "inherit" },
  ".cm-ep-hint": {
    display: "inline-flex",
    alignItems: "center",
    marginLeft: "12px",
    verticalAlign: "middle",
    whiteSpace: "pre",
    pointerEvents: "none",
    fontFamily: "var(--font-sans)",
  },
  ".cm-ep-hint .cm-prediction-key": { marginLeft: "0" },
  ".cm-ep-label": {
    marginLeft: "6px",
    fontSize: "12px",
    lineHeight: "14px",
    color: "var(--color-text-subtle)",
  },
  ".cm-ep-edge": {
    position: "absolute",
    right: "16px",
    bottom: "8px",
    height: "20px",
    padding: "0 8px",
    display: "flex",
    alignItems: "center",
    borderRadius: "var(--radius-control)",
    border: "1px solid var(--color-hairline)",
    backgroundColor: "var(--color-surface-raised)",
    color: "var(--color-text-subtle)",
    fontFamily: "var(--font-sans)",
    fontSize: "12px",
    lineHeight: "14px",
    whiteSpace: "pre",
    pointerEvents: "none",
    zIndex: "3",
  },
  ".cm-ep-edge-top": { top: "8px", bottom: "auto" },
});
