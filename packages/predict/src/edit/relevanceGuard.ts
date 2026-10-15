import type { EditPredictionRequest, PredictedEdit } from "@polaris/protocol";
import { applyEdits } from "./apply.ts";
import { changes } from "./deletionGuard.ts";
import { counts } from "./novelGuard.ts";
import { lineAt } from "./window.ts";

const words = (source: string) => source.match(/[\p{L}_$][\p{L}\p{N}_$]*/gu) ?? [];

const lines = (source: string, from: number, to: number) => {
  const start = source.lastIndexOf("\n", from - 1) + 1;
  const end = source.indexOf("\n", to);

  return source.slice(start, end < 0 ? source.length : end);
};

/** Words the change adds or removes, counting each line it touches before and after. */
export const changedWords = (
  buffer: string,
  change: readonly PredictedEdit[],
  tokens: (source: string) => readonly string[] = words
) => {
  const first = change[0],
    last = change.at(-1);

  if (!first || !last) return [];
  const shift = change.reduce((sum, edit) => sum + edit.text.length - (edit.to - edit.from), 0);
  const was = counts(tokens(lines(buffer, first.from, last.to)));
  const now = counts(tokens(lines(applyEdits(buffer, change), first.from, last.to + shift)));

  return [...new Set([...was.keys(), ...now.keys()])].filter(
    (word) => was.get(word) !== now.get(word)
  );
};

/** A change away from the focus line must touch a word of the history. */
export const strays = (request: EditPredictionRequest, edits: readonly PredictedEdit[]) => {
  const history = request.history.filter((hunk) => hunk.path === request.path);

  if (!history.length) return false;
  const known = new Set(history.flatMap((hunk) => words(`${hunk.before}\n${hunk.after}`)));
  const focus = lineAt(request.buffer, request.focus ?? request.cursor);

  return changes(request.buffer, edits).some((change) => {
    const first = change[0],
      last = change.at(-1);

    if (!first || !last) return false;

    const near =
      Math.abs(lineAt(request.buffer, first.from) - focus) <= 1 ||
      Math.abs(lineAt(request.buffer, last.to) - focus) <= 1;

    const changed = changedWords(request.buffer, change);

    return !near && changed.length > 0 && !changed.some((word) => known.has(word));
  });
};
