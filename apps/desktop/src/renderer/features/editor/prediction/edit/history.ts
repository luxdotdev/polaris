/**
 * The buffer's edit history for `prediction.edit` (docs/specs/edit-prediction-v1.1.md §5): bursts
 * of typing coalesced into hunks, frozen at the first keystroke after a 500 ms pause so the
 * prompt prefix stays cached. An accepted Edit Prediction is a hunk of its own.
 */
import {
  Annotation,
  type ChangeSet,
  type EditorState,
  StateField,
  type Text,
  Transaction,
} from "@codemirror/state";
import type { EditHistoryHunk } from "@polaris/protocol";
import { editorFile } from "../../cm/extensions.ts";
import type { EditPrediction } from "./model.ts";

export const FREEZE_PAUSE_MS = 500;

export const MAX_HISTORY_HUNKS = 32;

/** Past this many characters a change is a reload or a paste, not an edit worth prompting with. */
const MAX_HUNK_CHARS = 4096;

/** The accept transaction carries the prediction it applied. */
export const editAccepted = Annotation.define<EditPrediction>();

/** Typing since the last freeze: the buffer it started from and everything since, composed. */
export interface Burst {
  readonly before: Text;
  readonly changes: ChangeSet;
}

export interface EditHistory {
  /** Oldest first, at most `MAX_HISTORY_HUNKS`; what a request sends. */
  readonly frozen: ReadonlyArray<EditHistoryHunk>;
  readonly burst: Burst | null;
  readonly lastEditAt: number;
}

const EMPTY: EditHistory = { frozen: [], burst: null, lastEditAt: 0 };

const hunksOf = (path: string, before: Text, changes: ChangeSet): EditHistoryHunk[] => {
  const after = changes.apply(before);
  const hunks: EditHistoryHunk[] = [];

  changes.iterChanges((fromA, toA, fromB, _toB, inserted) => {
    const removed = before.sliceString(fromA, toA);
    const added = inserted.toString();

    if (removed.length + added.length > MAX_HUNK_CHARS || removed === added) return;
    hunks.push({ path, line: after.lineAt(fromB).number - 1, before: removed, after: added });
  });

  return hunks;
};

const cap = (hunks: ReadonlyArray<EditHistoryHunk>) =>
  hunks.length > MAX_HISTORY_HUNKS ? hunks.slice(hunks.length - MAX_HISTORY_HUNKS) : hunks;

const frozenWith = (value: EditHistory, path: string, extra: ReadonlyArray<EditHistoryHunk>) =>
  cap([
    ...value.frozen,
    ...(value.burst ? hunksOf(path, value.burst.before, value.burst.changes) : []),
    ...extra,
  ]);

const record = (value: EditHistory, tr: Transaction): EditHistory => {
  const path = tr.state.facet(editorFile)?.path ?? "";
  const at = tr.annotation(Transaction.time) ?? Date.now();

  if (tr.annotation(editAccepted) !== undefined)
    return {
      frozen: frozenWith(value, path, hunksOf(path, tr.startState.doc, tr.changes)),
      burst: null,
      lastEditAt: at,
    };
  const paused = value.burst !== null && at - value.lastEditAt >= FREEZE_PAUSE_MS;
  const frozen = paused ? frozenWith(value, path, []) : value.frozen;

  const burst =
    value.burst === null || paused
      ? { before: tr.startState.doc, changes: tr.changes }
      : { before: value.burst.before, changes: value.burst.changes.compose(tr.changes) };

  return { frozen, burst, lastEditAt: at };
};

export const editHistory = StateField.define<EditHistory>({
  create: () => EMPTY,
  update: (value, tr) => (tr.docChanged ? record(value, tr) : value),
});

export const historyOf = (state: EditorState): EditHistory =>
  state.field(editHistory, false) ?? EMPTY;

/** What the current burst removed and where it inserted, in the live buffer. */
export const burstEdits = (burst: Burst) => {
  const deleted: string[] = [];
  const inserted: Array<{ from: number; to: number; text: string }> = [];

  burst.changes.iterChanges((fromA, toA, fromB, toB, text) => {
    if (toA > fromA) deleted.push(burst.before.sliceString(fromA, toA));

    if (toB > fromB) inserted.push({ from: fromB, to: toB, text: text.toString() });
  });

  return { deleted, inserted };
};

export interface LastEdit {
  readonly removed: string;
  readonly added: string;
}

/** The most recent edit's text, for the jump probe: the live burst, else the last frozen hunk. */
export const lastEditText = (history: EditHistory): LastEdit => {
  if (history.burst !== null) {
    const { deleted, inserted } = burstEdits(history.burst);

    return { removed: deleted.join("\n"), added: inserted.map((i) => i.text).join("\n") };
  }

  const last = history.frozen.at(-1);

  return { removed: last?.before ?? "", added: last?.after ?? "" };
};
