import type { EditPredictionRequest, PredictedEdit } from "@polaris/protocol";

export const lineCounts = (text: string) => {
  const result = new Map<string, number>();

  for (const line of text
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean))
    result.set(line, (result.get(line) ?? 0) + 1);

  return result;
};

const changedLines = (before: string, after: string) => {
  const existing = lineCounts(before);

  return [...lineCounts(after)].filter(([line, count]) => count > (existing.get(line) ?? 0));
};

const continuesLine = (
  request: EditPredictionRequest,
  edits: readonly PredictedEdit[],
  line: string
) => {
  const start = request.buffer.lastIndexOf("\n", request.cursor - 1) + 1;
  const end = request.buffer.indexOf("\n", request.cursor);
  const to = end < 0 ? request.buffer.length : end;

  if (request.buffer.slice(start, to).trim() !== line) return false;

  if (request.buffer.slice(request.cursor, to).trim()) return false;

  const touching = edits.filter((edit) => edit.from <= to && edit.to >= start);

  return (
    touching.length > 0 &&
    touching.every((edit) => edit.from === request.cursor && edit.to === request.cursor)
  );
};

/** Frozen history protects authored lines as well as the older text they replaced. */
export const changesHistory = (
  request: EditPredictionRequest,
  after: string,
  edits: readonly PredictedEdit[]
) => {
  const beforeCounts = lineCounts(request.buffer),
    afterCounts = lineCounts(after);

  return request.history
    .filter((hunk) => hunk.path === request.path)
    .some((hunk) => {
      const restored = changedLines(hunk.after, hunk.before).some(
        ([line]) => (afterCounts.get(line) ?? 0) > (beforeCounts.get(line) ?? 0)
      );

      const overwritten = changedLines(hunk.before, hunk.after).some(
        ([line]) =>
          /[\p{L}\p{N}_$]/u.test(line) &&
          (beforeCounts.get(line) ?? 0) > (afterCounts.get(line) ?? 0) &&
          ((beforeCounts.get(line) ?? 0) - (afterCounts.get(line) ?? 0) !== 1 ||
            !continuesLine(request, edits, line))
      );

      return restored || overwritten;
    });
};
