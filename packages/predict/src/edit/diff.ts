import { PredictedEdit, PredictionError } from "@polaris/protocol";
import { myers, TooComplex } from "@polaris/syntax-diff";

interface Change {
  from: number;
  to: number;
  text: string;
}

const differences = (
  before: readonly string[],
  after: readonly string[],
  offset: number
): Change[] => {
  const changes: Change[] = [];
  let at = offset;
  let pending: Change | undefined;

  for (const op of myers(before.length, after.length, (a, b) => before[a] === after[b], 2048)) {
    if (op.type === "equal") {
      if (pending) changes.push(pending);
      pending = undefined;
      at += before[op.a]?.length ?? 0;
    } else {
      pending ??= { from: at, to: at, text: "" };

      if (op.type === "delete") {
        at += before[op.a]?.length ?? 0;
        pending.to = at;
      } else pending.text += after[op.b] ?? "";
    }
  }

  if (pending) changes.push(pending);

  return changes;
};

/** Line alignment keeps unchanged lines intact; code-point alignment preserves UTF-16 boundaries. */
export const diffEdits = (before: string, after: string, offset = 0): PredictedEdit[] => {
  try {
    const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
    const blocks = differences(lines(before), lines(after), 0);

    const edits = blocks.flatMap((block) =>
      differences(
        Array.from(before.slice(block.from, block.to)),
        Array.from(block.text),
        block.from + offset
      )
    );

    if (edits.length > 64) throw new TooComplex(64);

    return edits.map((edit) => PredictedEdit.make(edit));
  } catch (error) {
    if (!(error instanceof TooComplex)) throw error;
    throw new PredictionError({
      reason: "invalid-response",
      message: "Edit prediction is too complex",
    });
  }
};
