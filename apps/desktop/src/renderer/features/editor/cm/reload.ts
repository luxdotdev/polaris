/**
 * Reloading a clean buffer in place (spec §3): the disk's text goes in as the
 * changed chunks only, so the cursor and scroll map through them, and the
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
import { diff } from "@codemirror/merge";

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

export interface Span {
  readonly from: number;
  readonly to: number;
}

const flash = StateEffect.define<ReadonlyArray<Span> | null>();

const litLine = Decoration.line({ class: "cm-reloaded" });

const lines = (doc: Text, spans: ReadonlyArray<Span>): DecorationSet => {
  const numbers = new Set<number>();

  for (const { from, to } of spans) {
    const last = doc.lineAt(Math.min(to, doc.length)).number;

    for (let n = doc.lineAt(Math.min(from, doc.length)).number; n <= last; n++) numbers.add(n);
  }

  const builder = new RangeSetBuilder<Decoration>();

  for (const n of [...numbers].sort((x, y) => x - y)) {
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
        next = effect.value === null ? Decoration.none : lines(tr.state.doc, effect.value);
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

/** Disk text in the doc's own form: positions count a line break as one character. */
export const normalized = (state: EditorState, text: string): string =>
  state.lineBreak === "\n" ? text.replace(/\r\n?/g, "\n") : text.split(state.lineBreak).join("\n");

/** The changes from `before` to `after`, chunk by chunk, so positions outside them keep their place. */
export const reloadChanges = (before: string, after: string): ReadonlyArray<Change> => {
  const outer = minimalChange(before, after);

  if (outer === null) return [];

  const inner = diff(before.slice(outer.from, outer.to), outer.insert, {
    scanLimit: 2000,
    timeout: 50,
  });

  return inner.map((c) => ({
    from: outer.from + c.fromA,
    to: outer.from + c.toA,
    insert: outer.insert.slice(c.fromB, c.toB),
  }));
};

/** Where each change lands in the reloaded doc. */
const newSpans = (changes: ReadonlyArray<Change>): ReadonlyArray<Span> => {
  let shift = 0;

  return changes.map((c) => {
    const from = c.from + shift;

    shift += c.insert.length - (c.to - c.from);

    return { from, to: from + c.insert.length };
  });
};

export interface Reload {
  readonly spec: TransactionSpec;
  /** What changed, in the reloaded doc. */
  readonly spans: ReadonlyArray<Span>;
  /** One change rewrote most of the file under the cursor: put it back by line and column. */
  readonly rewrote: boolean;
}

const lineCol = (doc: Text, pos: number) => {
  const line = doc.lineAt(pos);

  return { line: line.number, column: pos - line.from };
};

const posAt = (text: string, line: number, column: number): number => {
  let at = 0;

  for (let n = 1; n < line; n++) {
    const next = text.indexOf("\n", at);

    if (next === -1) return text.length;
    at = next + 1;
  }

  const end = text.indexOf("\n", at);

  return Math.min(at + column, end === -1 ? text.length : end);
};

/** Reloads `state` to the disk's `text` in place and lights what changed; null if equal. */
export const reloadPlan = (state: EditorState, text: string): Reload | null => {
  const before = state.doc.toString();
  const after = normalized(state, text);
  const changes = reloadChanges(before, after);

  if (changes.length === 0) return null;
  const spans = newSpans(changes);
  const head = state.selection.main.head;
  const covering = changes.find((c) => c.from <= head && c.to >= head);
  const rewrote = covering !== undefined && covering.to - covering.from > before.length / 2;
  const { line, column } = lineCol(state.doc, head);

  const insert = (s: string) =>
    state.lineBreak === "\n" ? s : s.split("\n").join(state.lineBreak);

  return {
    spans,
    rewrote,
    spec: {
      changes: changes.map((c) => ({ ...c, insert: insert(c.insert) })),
      // The cursor maps through the chunks; after a rewrite it goes back to its line and column.
      selection: rewrote ? { anchor: posAt(after, line, column) } : undefined,
      effects: flash.of(spans),
      // A reload is the disk's, not an edit: it never joins the user's undo history.
      annotations: Transaction.addToHistory.of(false),
      userEvent: "reload",
    },
  };
};

export const clearFlash: TransactionSpec = { effects: flash.of(null) };
