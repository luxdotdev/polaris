// Shared pieces of the diagnostics-verifier measurements (2026-10-15).
import type { EditPredictionRequest } from "../../../../packages/protocol/src/index.ts";
import { applyEdits } from "../../../../packages/predict/src/edit/guards.ts";
import { buildEditPrompt } from "../../../../packages/predict/src/edit/prompt.ts";
import { parseRegions } from "../../../../packages/predict/src/edit/parse.ts";
import { diffEdits } from "../../../../packages/predict/src/edit/diff.ts";
import type { EditOptions } from "../../../../packages/predict/src/edit/options.ts";

/** All edits of the output, before any check, as `editResult` computes them. */
export const rawEdits = (input: EditPredictionRequest, output: string, options: EditOptions) => {
  const built = buildEditPrompt(input, options);
  const { regions, outside } = parseRegions(input, built.window, output, built.stop);
  if (outside) return [];
  const { from, to } = built.window;
  const rewritten = applyEdits(input.buffer.slice(from, to), regions.map((r) => ({ from: r.from - from, to: r.to - from, text: r.text })));
  return diffEdits(input.buffer.slice(from, to), rewritten, from);
};
