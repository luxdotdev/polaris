// Every labelled buffer state reachable from recorded outputs: hill-climb runs (parsed with their
// variant), the hardening runs and the spike fixtures. Guard ideas are scored against this corpus.
import { EditPredictionRequest, type PredictedEdit } from "../../../../packages/protocol/src/index.ts";
import { request } from "../../../../packages/predict/src/edit/fixtures.testing.ts";
import { hardeningRuns } from "../../../../packages/predict/src/edit/hardening.testing.ts";
import { buildEditPrompt } from "../../../../packages/predict/src/edit/prompt.ts";
import { parseRegions } from "../../../../packages/predict/src/edit/parse.ts";
import { applyEdits } from "../../../../packages/predict/src/edit/guards.ts";
import { diffEdits } from "../../../../packages/predict/src/edit/diff.ts";
import { spikeSweepOptions } from "../../../../packages/predict/src/edit/options.ts";
import { loadLabels, loadSet, normalized, rawDir, stateHash, variantOf, type Case, type Label } from "./hc-lib.ts";

export type Entry = { id: string; source: string; input: EditPredictionRequest; after: string; edits: PredictedEdit[]; label: Label | "unlabelled" };

export const runs: Record<string, string> = await Bun.file(new URL("runs.json", rawDir)).json();

export const corpus = async (): Promise<Entry[]> => {
  const labels = await loadLabels();
  const cases = await loadSet("dev");
  const seen = new Set<string>();
  const out: Entry[] = [];
  const add = (c: Case, source: string, format: EditPredictionRequest["format"], output: string, options = spikeSweepOptions) => {
    const input = EditPredictionRequest.make({ ...request, path: c.path, buffer: c.buffer, cursor: c.cursor, history: c.history, format });
    const built = buildEditPrompt(input, options);
    const after = applyEdits(c.buffer, parseRegions(input, built.window, output, built.stop).regions);
    const key = `${c.id}:${stateHash(after)}`;
    if (normalized(after) === normalized(c.buffer) || seen.has(key)) return;
    seen.add(key);
    const label = c.allowed.some((p) => normalized(applyEdits(c.buffer, p)) === normalized(after)) ? "exact" : labels[c.id]?.[stateHash(after)]?.label ?? "unlabelled";
    out.push({ id: c.id, source, input, after, edits: diffEdits(c.buffer, after), label });
  };
  for (const run of hardeningRuns) for (const o of run.outputs) add(cases.find((c) => c.id === o.id)!, `${run.format}-${run.split}`, run.format, o.output);
  for (const [tag, variant] of Object.entries(runs)) {
    const file = Bun.file(new URL(`${tag}.dev.json`, rawDir));
    if (!(await file.exists())) continue;
    for (const o of await file.json()) if (!o.error) add(cases.find((c) => c.id === o.id)!, tag, "sweep-next-edit", o.output, variantOf(variant).options);
  }
  return out;
};
