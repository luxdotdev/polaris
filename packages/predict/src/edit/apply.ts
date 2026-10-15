import type { PredictedEdit } from "@polaris/protocol";

export const applyEdits = (buffer: string, edits: readonly PredictedEdit[]) => {
  let result = buffer;

  for (const edit of edits.toReversed())
    result = result.slice(0, edit.from) + edit.text + result.slice(edit.to);

  return result;
};
