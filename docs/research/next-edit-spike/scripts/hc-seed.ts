// Seeds the hill-climb label store with the hand labels of every earlier recorded output,
// keyed by the buffer that output produces (labels describe buffer states, not prompts).
import { EditPredictionRequest } from "../../../../packages/protocol/src/index.ts";
import { request } from "../../../../packages/predict/src/edit/fixtures.testing.ts";
import { fixtures as spike } from "../../../../packages/predict/src/edit/fixtures.testing.ts";
import { hardeningCases, hardeningRuns } from "../../../../packages/predict/src/edit/hardening.testing.ts";
import { buildEditPrompt } from "../../../../packages/predict/src/edit/prompt.ts";
import { parseRegions } from "../../../../packages/predict/src/edit/parse.ts";
import { applyEdits } from "../../../../packages/predict/src/edit/guards.ts";
import { spikeSweepOptions } from "../../../../packages/predict/src/edit/options.ts";
import { labelsFile, loadLabels, stateHash, type Label } from "./hc-lib.ts";

const labels = await loadLabels();
let added = 0;
const put = (id: string, buffer: string, label: Label, note: string) => {
  const hash = stateHash(buffer);
  const slot = (labels[id] ??= {});
  if (slot[hash]) return;
  slot[hash] = { label, note: `seed: ${note}` };
  added++;
};
const after = (fixture: { path: string; buffer: string; cursor: number; history: EditPredictionRequest["history"] }, format: EditPredictionRequest["format"], output: string) => {
  const input = EditPredictionRequest.make({ ...request, path: fixture.path, buffer: fixture.buffer, cursor: fixture.cursor, history: fixture.history, format });
  const built = buildEditPrompt(input, spikeSweepOptions);
  return applyEdits(input.buffer, parseRegions(input, built.window, output, built.stop).regions);
};
for (const run of hardeningRuns)
  for (const o of run.outputs) {
    const c = hardeningCases.find((x) => x.id === o.id)!;
    const l = run.labels[o.id]!;
    if (l.label !== "abstain") put(o.id, after(c, run.format, o.output), l.label, `${run.format} ${run.split}: ${l.note}`);
  }
for (const f of spike)
  for (const o of f.outputs) if (o.label !== "abstain") put(f.id, after(f, o.format, o.output), o.label, `spike ${o.format}`);
await Bun.write(labelsFile, JSON.stringify(labels, null, 1) + "\n");
console.log(`Seeded ${added} labelled buffer states`);
