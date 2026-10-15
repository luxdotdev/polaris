import type { EditPredictionRequest, PredictedEdit } from "@polaris/protocol";
import { guardEdits } from "./guards.ts";
import type { SweepOptions } from "./options.ts";
import { lineAt, type EditWindow } from "./window.ts";

/** Hunks on adjacent lines form one change; a rewrite may hold several. */
const changes = (buffer: string, edits: readonly PredictedEdit[]) => {
  const groups: PredictedEdit[][] = [];

  for (const edit of edits) {
    const group = groups.at(-1);
    const last = group?.at(-1);

    if (group && last && lineAt(buffer, edit.from) - lineAt(buffer, last.to) <= 1) group.push(edit);
    else groups.push([edit]);
  }

  return groups;
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
  const alone = guardEdits(request, window, nearest, options);

  if (!alone.edits.length) return guarded;

  return {
    edits: alone.edits,
    suppressed: guarded.suppressed.filter(
      (hunk) => !nearest.some((edit) => edit.from === hunk.from && edit.to === hunk.to)
    ),
  };
};
