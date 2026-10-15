import type { EditPredictionRequest, PredictedEdit } from "@polaris/protocol";

const balance = (source: string) => {
  const counts = [0, 0, 0];

  const code = source.replace(
    /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g,
    ""
  );

  for (const char of code) {
    const open = "({[".indexOf(char),
      close = ")}]".indexOf(char);

    if (open >= 0) counts[open] = (counts[open] ?? 0) + 1;
    else if (close >= 0) counts[close] = (counts[close] ?? 0) - 1;
  }

  return counts;
};

/** Compare imbalance, allowing a cursor continuation to leave a construct unfinished. */
export const unbalancesDelimiters = (
  request: EditPredictionRequest,
  after: string,
  edits: readonly PredictedEdit[]
) => {
  if (edits.every((edit) => edit.from === request.cursor && edit.to === request.cursor))
    return false;

  const before = balance(request.buffer),
    next = balance(after);

  return next.some((count, i) => Math.abs(count) > Math.abs(before[i] ?? 0));
};

export const changesBlankLines = (buffer: string, edit: PredictedEdit, start: number) => {
  if (buffer.slice(start, edit.from).trim()) return false;
  const blankLines = /^(?:[ \t]*\r?\n)+$/;

  return (
    (!edit.text && blankLines.test(buffer.slice(edit.from, edit.to))) ||
    (edit.from === edit.to && blankLines.test(edit.text))
  );
};
