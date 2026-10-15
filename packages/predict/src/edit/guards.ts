import type { EditPredictionRequest, PredictedEdit, SuppressedReason } from "@polaris/protocol";
import { changesBlankLines, unbalancesDelimiters } from "./delimiterGuard.ts";
import { unsafeIdentifiers } from "./identifierGuard.ts";
import { changesHistory } from "./historyGuard.ts";
import type { EditWindow } from "./window.ts";

export const applyEdits = (buffer: string, edits: readonly PredictedEdit[]) => {
  let result = buffer;

  for (const edit of edits.toReversed())
    result = result.slice(0, edit.from) + edit.text + result.slice(edit.to);

  return result;
};

const unstable = (request: EditPredictionRequest, edit: PredictedEdit) => {
  const start = request.buffer.lastIndexOf("\n", edit.from - 1) + 1;
  const end = request.buffer.indexOf("\n", edit.to);
  const oldLine = request.buffer.slice(start, end < 0 ? request.buffer.length : end);

  const newLine =
    request.buffer.slice(start, edit.from) +
    edit.text +
    request.buffer.slice(edit.to, end < 0 ? request.buffer.length : end);

  const focus = request.focus ?? request.cursor;
  const focused = focus >= start && (end < 0 || focus <= end);

  if (focused || changesBlankLines(request.buffer, edit, start)) return false;

  if (oldLine.replace(/\s/g, "") === newLine.replace(/\s/g, "")) return true;

  if (/^\s*[}\])`'";,]+\s*$/.test(oldLine)) return true;
  // Expanding a healthy shorthand can bypass a local default or normalization.
  const shorthand = /^\s*([\w$]+),\s*$/.exec(oldLine);

  return shorthand !== null && newLine.trimStart().startsWith(`${shorthand[1]}:`);
};

export const guardEdits = (
  request: EditPredictionRequest,
  window: EditWindow,
  edits: readonly PredictedEdit[]
) => {
  if (!edits.length) return { edits: [], suppressed: [] };

  let reason: SuppressedReason | undefined;
  const after = applyEdits(request.buffer, edits);

  if (edits.some((edit) => edit.from < window.from || edit.to > window.to))
    reason = "outside-window";
  else if (changesHistory(request, after, edits)) reason = "revert";
  else if (edits.length && request.buffer.replace(/\s/g, "") === after.replace(/\s/g, ""))
    reason = "unstable";
  else if (edits.some((edit) => unstable(request, edit))) reason = "unstable";
  else if (unbalancesDelimiters(request, after, edits)) reason = "unstable";
  else if (unsafeIdentifiers(request, after, edits)) reason = "unstable";

  // Treat a region rewrite atomically: retained hunks may depend on a dropped hunk.
  return reason
    ? { edits: [], suppressed: edits.map(({ from, to }) => ({ reason, from, to })) }
    : { edits: [...edits], suppressed: [] };
};
