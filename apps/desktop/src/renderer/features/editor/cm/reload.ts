/**
 * Reloading a clean buffer in place (spec §3): the disk's text goes in as the
 * smallest single change, so the cursor and scroll map through it, and the
 * changed lines are lit briefly, fading on opacity alone.
 */
import {
  type EditorState,
  type Extension,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Text,
  Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

/** How long the changed lines stay lit; the CSS fade runs inside it. */
export const FLASH_MS = 1600;

/** The one change that turns `before` into `after`: their common head and tail stay put. */
export interface Change {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

export const minimalChange = (before: string, after: string): Change | null => {
  if (before === after) return null;
  const limit = Math.min(before.length, after.length);
  let head = 0;

  while (head < limit && before.charCodeAt(head) === after.charCodeAt(head)) head++;

  let tail = 0;

  while (
    tail < limit - head &&
    before.charCodeAt(before.length - 1 - tail) === after.charCodeAt(after.length - 1 - tail)
  ) {
    tail++;
  }

  return { from: head, to: before.length - tail, insert: after.slice(head, after.length - tail) };
};

const flash = StateEffect.define<{ readonly from: number; readonly to: number } | null>();

const litLine = Decoration.line({ class: "cm-reloaded" });

const lines = (doc: Text, from: number, to: number): DecorationSet => {
  const builder = new RangeSetBuilder<Decoration>();
  const last = doc.lineAt(Math.min(to, doc.length)).number;

  for (let n = doc.lineAt(from).number; n <= last; n++) {
    const line = doc.line(n);

    builder.add(line.from, line.from, litLine);
  }

  return builder.finish();
};

const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let next = value.map(tr.changes);

    for (const effect of tr.effects) {
      if (effect.is(flash)) {
        next =
          effect.value === null
            ? Decoration.none
            : lines(tr.state.doc, effect.value.from, effect.value.to);
      }
    }

    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const flashTheme = EditorView.theme({
  ".cm-reloaded": { position: "relative" },
  ".cm-reloaded::before": {
    content: '""',
    position: "absolute",
    inset: "0",
    pointerEvents: "none",
    backgroundColor: "var(--color-diff-added-bg)",
    animation: `polaris-editor-reload ${FLASH_MS}ms var(--ease-out) forwards`,
  },
  ":root[data-reduce-motion=true] & .cm-reloaded::before": { animation: "none" },
  "@media (prefers-reduced-motion: reduce)": {
    ":root:not([data-reduce-motion=false]) & .cm-reloaded::before": { animation: "none" },
  },
  "@keyframes polaris-editor-reload": {
    "0%, 40%": { opacity: "1" },
    "100%": { opacity: "0" },
  },
});

export const reloadHighlight: Extension = [flashField, flashTheme];

/** The transaction that reloads `state` to `text` in place and lights what changed; null if equal. */
export const reloadSpec = (state: EditorState, text: string): TransactionSpec | null => {
  const change = minimalChange(state.doc.toString(), text);

  if (change === null) return null;
  const { from, insert } = change;
  const to = from + insert.length;

  return {
    changes: change,
    effects: flash.of({ from, to }),
    annotations: Transaction.addToHistory.of(false),
    // A reload is the disk's, not an edit: it never joins the user's undo history.
    userEvent: "reload",
  };
};

export const clearFlash: TransactionSpec = { effects: flash.of(null) };
