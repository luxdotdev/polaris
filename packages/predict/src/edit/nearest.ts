import type { EditPredictionRequest, PredictedEdit } from "@polaris/protocol";
import { changes } from "./deletionGuard.ts";
import { guardEdits } from "./guards.ts";
import { names } from "./novelGuard.ts";
import { changedWords } from "./relevanceGuard.ts";
import type { SweepOptions } from "./options.ts";
import { lineAt, type EditWindow } from "./window.ts";

/** The change adds or removes code names, and at least one of them is in the history. */
const followsHistory = (request: EditPredictionRequest, change: readonly PredictedEdit[]) => {
  const history = new Set(
    request.history
      .filter((hunk) => hunk.path === request.path)
      .flatMap((hunk) => names(`${hunk.before}\n${hunk.after}`))
  );

  return changedWords(request.buffer, change, names).some((name) => history.has(name));
};

/** When the whole rewrite is suppressed, the change nearest the focus may still pass alone. */
export const nearestChange = (
  request: EditPredictionRequest,
  window: EditWindow,
  edits: readonly PredictedEdit[],
  guarded: ReturnType<typeof guardEdits>,
  options: SweepOptions
) => {
  const groups = changes(request.buffer, edits);

  if (guarded.edits.length || groups.length < 2) return guarded;
  const focus = window.focusLine;

  const distance = (group: readonly PredictedEdit[]) =>
    Math.min(
      ...group.flatMap((edit) => [
        Math.abs(lineAt(request.buffer, edit.from) - focus),
        Math.abs(lineAt(request.buffer, edit.to) - focus),
      ])
    );

  const nearest = groups.toSorted((a, b) => distance(a) - distance(b))[0] ?? [];

  if (!followsHistory(request, nearest)) return guarded;
  const alone = guardEdits(request, window, nearest, options);

  if (!alone.edits.length) return guarded;

  return {
    edits: alone.edits,
    suppressed: guarded.suppressed.filter(
      (hunk) => !nearest.some((edit) => edit.from === hunk.from && edit.to === hunk.to)
    ),
  };
};
