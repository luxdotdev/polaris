import type { EditPredictionRequest, PredictedEdit, SuppressedReason } from "@polaris/protocol";
import type { EditWindow } from "./window.ts";

export const applyEdits = (buffer: string, edits: readonly PredictedEdit[]) => {
  let result = buffer;

  for (const edit of edits.toReversed())
    result = result.slice(0, edit.from) + edit.text + result.slice(edit.to);

  return result;
};

const counts = (text: string) => {
  const result = new Map<string, number>();

  for (const line of text
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean))
    result.set(line, (result.get(line) ?? 0) + 1);

  return result;
};

const reverts = (request: EditPredictionRequest, after: string) => {
  const old = new Set(
    request.history
      .filter((hunk) => hunk.path === request.path)
      .flatMap((hunk) => {
        const remaining = new Set(hunk.after.split("\n").map((line) => line.trim()));

        return hunk.before
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line && !remaining.has(line));
      })
  );

  const beforeCounts = counts(request.buffer),
    afterCounts = counts(after);

  return [...old].some((line) => (afterCounts.get(line) ?? 0) > (beforeCounts.get(line) ?? 0));
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

  if (focused) return false;

  if (oldLine.replace(/\s/g, "") === newLine.replace(/\s/g, "")) return true;

  if (/^\s*[}\])]+[,;]?\s*$/.test(oldLine) && /^\s*[}\])]+[,;]?\s*$/.test(newLine)) return true;
  // Expanding a healthy shorthand can bypass a local default or normalization.
  const shorthand = /^\s*([\w$]+),\s*$/.exec(oldLine);

  return shorthand !== null && newLine.trimStart().startsWith(`${shorthand[1]}:`);
};

export const guardEdits = (
  request: EditPredictionRequest,
  window: EditWindow,
  edits: readonly PredictedEdit[]
) => {
  let reason: SuppressedReason | undefined;
  const after = applyEdits(request.buffer, edits);

  if (edits.some((edit) => edit.from < window.from || edit.to > window.to))
    reason = "outside-window";
  else if (reverts(request, after)) reason = "revert";
  else if (edits.length && request.buffer.replace(/\s/g, "") === after.replace(/\s/g, ""))
    reason = "unstable";
  else if (edits.some((edit) => unstable(request, edit))) reason = "unstable";

  // Treat a region rewrite atomically: retained hunks may depend on a dropped hunk.
  return reason
    ? { edits: [], suppressed: edits.map(({ from, to }) => ({ reason, from, to })) }
    : { edits: [...edits], suppressed: [] };
};
