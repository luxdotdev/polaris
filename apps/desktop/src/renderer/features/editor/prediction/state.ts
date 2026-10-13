import {
  completionStatus,
  hasNextSnippetField,
  hasPrevSnippetField,
} from "@codemirror/autocomplete";
import {
  Annotation,
  ChangeSet,
  StateEffect,
  StateField,
  type EditorState,
} from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { currentMode } from "../cm/vim.ts";
import type { Prediction } from "./types.ts";

export interface Ghost extends Prediction {
  readonly at: number;
}

export const setGhost = StateEffect.define<Ghost | null>();

export const acceptedPrediction = Annotation.define<boolean>();

export const ghost = StateField.define<Ghost | null>({
  create: () => null,
  update(value, tr) {
    let next = tr.docChanged || tr.selection ? null : value;

    for (const effect of tr.effects) if (effect.is(setGhost)) next = effect.value;

    return next;
  },
});

export const popupOrSnippet = (state: EditorState) =>
  completionStatus(state) !== null || hasNextSnippetField(state) || hasPrevSnippetField(state);

export const visibleGhost = (state: EditorState): Ghost | null => {
  const value = state.field(ghost, false);

  return value &&
    state.selection.main.empty &&
    state.selection.main.head === value.at &&
    !popupOrSnippet(state)
    ? value
    : null;
};

class GhostWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly block: boolean
  ) {
    super();
  }
  override eq(other: GhostWidget) {
    return this.text === other.text && this.block === other.block;
  }
  override toDOM() {
    const node = document.createElement(this.block ? "div" : "span");
    node.className = this.block ? "cm-prediction-block" : "cm-prediction-inline";
    node.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.textContent = this.text;
    node.append(text);

    if (!this.block) {
      const cap = document.createElement("span");
      cap.className = "cm-prediction-key";
      cap.textContent = "Tab";
      node.append(cap);
    }

    return node;
  }
  override ignoreEvent() {
    return true;
  }
}

const decorationsOf = (state: EditorState): DecorationSet => {
  const value = visibleGhost(state);

  if (value === null || value.text.length === 0) return Decoration.none;
  const [first = "", ...rest] = value.text.split("\n");

  const inline = Decoration.widget({ widget: new GhostWidget(first, false), side: 1 }).range(
    value.at
  );

  return Decoration.set(
    rest.length === 0
      ? [inline]
      : [
          inline,
          Decoration.widget({
            widget: new GhostWidget(rest.join("\n"), true),
            block: true,
            side: 2,
          }).range(value.at),
        ],
    true
  );
};

export const ghostDecorations = StateField.define<DecorationSet>({
  create: decorationsOf,
  update: (_value, tr) => decorationsOf(tr.state),
  provide: (field) => EditorView.decorations.from(field),
});

export const ghostTheme = EditorView.baseTheme({
  ".cm-prediction-inline, .cm-prediction-block": {
    color: "var(--color-text-faint)",
    whiteSpace: "pre",
    fontFamily: "inherit",
    fontVariantLigatures: "none",
    fontFeatureSettings: '"liga" 0, "calt" 0',
    pointerEvents: "none",
    animation: "none",
    transition: "none",
  },
  ".cm-prediction-block": { padding: "0 2px", lineHeight: "inherit" },
  ".cm-prediction-key": {
    display: "inline-block",
    padding: "0 5px",
    marginLeft: "10px",
    border: "1px solid var(--color-hairline)",
    borderRadius: "4px",
    fontFamily: "var(--font-sans)",
    fontSize: "11px",
    lineHeight: "14px",
    verticalAlign: "middle",
    color: "var(--color-text-faint)",
  },
});

const validEdits = (state: EditorState, value: Ghost) => {
  const edits = value.additionalEdits ?? [];
  let end = -1;

  for (const edit of [...edits].sort((a, b) => a.from - b.from)) {
    if (
      edit.from < 0 ||
      edit.to < edit.from ||
      edit.to > state.doc.length ||
      edit.from < end ||
      (edit.from <= value.at && edit.to >= value.at) ||
      state.sliceDoc(edit.from, edit.to) !== edit.expected
    )
      return false;
    end = edit.to;
  }

  return true;
};

/** Tab and word acceptance share the same popup, snippet and edit fences. */
export const acceptPrediction = (view: EditorView, word = false): boolean => {
  const value = visibleGhost(view.state);
  const mode = currentMode(view);

  if (value === null || value.text.length === 0 || (mode !== null && mode !== "insert"))
    return false;

  if (!validEdits(view.state, value)) {
    view.dispatch({ effects: setGhost.of(null) });

    return false;
  }

  const text = word
    ? (/^\s*(?:[\p{L}\p{N}_$]+|[^\s\p{L}\p{N}_$]+)/u.exec(value.text)?.[0] ?? value.text)
    : value.text;

  const changes = ChangeSet.of(
    [
      { from: value.at, insert: text },
      ...(value.additionalEdits ?? []).map(({ from, to, insert }) => ({ from, to, insert })),
    ],
    view.state.doc.length
  );

  const at = changes.mapPos(value.at, 1);
  const remaining = value.text.slice(text.length);
  view.dispatch({
    changes,
    selection: { anchor: at },
    annotations: acceptedPrediction.of(true),
    effects: setGhost.of(remaining.length === 0 ? null : { at, text: remaining }),
    userEvent: "input.complete",
  });

  return true;
};
