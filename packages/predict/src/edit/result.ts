import { EditPredictionItem, type EditPredictionRequest } from "@polaris/protocol";
import { diffEdits } from "./diff.ts";
import { applyEdits, guardEdits } from "./guards.ts";
import { nearestChange } from "./nearest.ts";
import { parseRegions } from "./parse.ts";
import { editOptions, type EditOptions } from "./options.ts";
import { buildEditPrompt } from "./prompt.ts";

export const editResult = (
  request: EditPredictionRequest,
  output: string,
  elapsedMs = 0,
  options: EditOptions = editOptions
) => {
  const built = buildEditPrompt(request, options);
  const { regions, outside } = parseRegions(request, built.window, output, built.stop);
  const window = { from: built.window.from, to: built.window.to };

  if (outside)
    return EditPredictionItem.cases.Final.make({
      edits: [],
      cursor: null,
      window,
      suppressed: [{ reason: "outside-window", ...window }],
      elapsedMs,
    });

  const rewritten = applyEdits(
    request.buffer.slice(window.from, window.to),
    regions.map((region) => ({
      from: region.from - window.from,
      to: region.to - window.from,
      text: region.text,
    }))
  );

  const original = request.buffer.slice(window.from, window.to);

  const edits = diffEdits(original, rewritten, window.from);

  const whole = guardEdits(request, built.window, edits, options);

  const guarded =
    options.nearestFallback && request.format === "sweep-next-edit"
      ? nearestChange(request, built.window, edits, whole, options)
      : whole;

  let cursor: number | null = null;
  let shift = 0;

  for (const region of regions) {
    if (region.cursor !== null) cursor = region.from + shift + region.cursor;
    shift += region.text.length - (region.to - region.from);
  }

  if (!guarded.edits.length) cursor = null;
  else if (cursor === null) {
    const last = guarded.edits.at(-1);
    cursor = last
      ? last.to +
        guarded.edits.reduce((delta, edit) => delta + edit.text.length - (edit.to - edit.from), 0)
      : null;
  }

  return EditPredictionItem.cases.Final.make({ ...guarded, cursor, window, elapsedMs });
};
