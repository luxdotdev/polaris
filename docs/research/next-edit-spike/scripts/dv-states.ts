// dv-states.ts [out.json]: every buffer state any recorded output can show (all its edits, or the
// change nearest the focus alone), plus each case's ground truth, with commit, label and sources.
import { EditPredictionRequest, type PredictedEdit } from "../../../../packages/protocol/src/index.ts";
import { request as base, fixtures as spike } from "../../../../packages/predict/src/edit/fixtures.testing.ts";
import { hardeningRuns } from "../../../../packages/predict/src/edit/hardening.testing.ts";
import { applyEdits } from "../../../../packages/predict/src/edit/guards.ts";
import { changes } from "../../../../packages/predict/src/edit/deletionGuard.ts";
import { rawEdits } from "./dv-lib.ts";
import { editWindow, lineAt } from "../../../../packages/predict/src/edit/window.ts";
import { spikeEditOptions, type EditOptions } from "../../../../packages/predict/src/edit/options.ts";
import { runs } from "./hc-corpus.ts";
import { loadLabels, loadSet, normalized, rawDir, stateHash, variantOf, type Case, type Output } from "./hc-lib.ts";

export type State = { hash: string; after: string; label: string; truth: boolean; sources: string[] };
export type CaseStates = { id: string; set: string; commit: string; path: string; buffer: string; states: State[] };

const specs: { id: string; commit: string }[] = [
  ...(await Bun.file(new URL("./cases.json", import.meta.url)).json()),
  ...(await Bun.file(new URL("./fresh-cases.json", import.meta.url)).json()),
  ...(await Bun.file(new URL("./fresh2-cases.json", import.meta.url)).json()),
];
const commitOf = new Map(specs.map((s) => [s.id, s.commit]));
const labels = await loadLabels();
const out = new Map<string, CaseStates>();
const caseLabels: Record<string, Record<string, string>> = {};

const entry = (c: Case, set: string) => {
  let e = out.get(c.id);
  if (!e) {
    e = { id: c.id, set, commit: commitOf.get(c.id)!, path: c.path, buffer: c.buffer, states: [] };
    out.set(c.id, e);
    const truth = applyEdits(c.buffer, c.expected);
    e.states.push({ hash: stateHash(truth), after: truth, label: "exact", truth: true, sources: ["truth"] });
  }
  return e;
};

const labelOf = (c: Case, after: string, fallback?: string) =>
  c.allowed.some((p) => normalized(applyEdits(c.buffer, p)) === normalized(after)) ? "exact"
    : labels[c.id]?.[stateHash(after)]?.label ?? caseLabels[c.id]?.[stateHash(after)] ?? fallback ?? "unlabelled";

const add = (c: Case, set: string, source: string, after: string, fallback?: string) => {
  if (normalized(after) === normalized(c.buffer)) return;
  const e = entry(c, set);
  const hash = stateHash(after);
  const found = e.states.find((s) => s.hash === hash);
  if (found) return void (found.sources.includes(source) || found.sources.push(source));
  e.states.push({ hash, after, label: labelOf(c, after, fallback), truth: false, sources: [source] });
};

/** All edits of the output and the change nearest the focus alone. */
const record = (c: Case, set: string, source: string, format: EditPredictionRequest["format"], output: string, options: EditOptions, fallback?: string) => {
  const input = EditPredictionRequest.make({ ...base, path: c.path, buffer: c.buffer, cursor: c.cursor, history: c.history, format });
  const edits = rawEdits(input, output, options);
  if (!edits.length) return;
  add(c, set, source, applyEdits(c.buffer, edits), fallback);
  const groups = changes(c.buffer, edits);
  if (groups.length < 2 || format !== "sweep-next-edit") return;
  const focus = editWindow(input, options).focusLine;
  const distance = (g: readonly PredictedEdit[]) => Math.min(...g.flatMap((e) => [Math.abs(lineAt(c.buffer, e.from) - focus), Math.abs(lineAt(c.buffer, e.to) - focus)]));
  add(c, set, `${source}~near`, applyEdits(c.buffer, groups.toSorted((a, b) => distance(a) - distance(b))[0]!));
};

const dev = await loadSet("dev");
const byId = new Map(dev.map((c) => [c.id, c]));
for (const run of hardeningRuns)
  for (const o of run.outputs) {
    const c = byId.get(o.id)!;
    const l = run.labels[o.id]?.label;
    record(c, c.split, `hardening-${run.format}-${run.split}`, run.format, o.output, spikeEditOptions, l);
  }
for (const f of spike)
  for (const o of f.outputs) {
    const c = byId.get(f.id)!;
    if (normalized(c.buffer) !== normalized(f.buffer)) throw new Error(`spike ${f.id} buffer differs`);
    record(c, c.split, `spike-${o.format}`, o.format, o.output, spikeEditOptions, o.label);
  }
for (const [tag, variant] of Object.entries(runs)) {
  const file = Bun.file(new URL(`${tag}.dev.json`, rawDir));
  if (!(await file.exists())) continue;
  for (const o of (await file.json()) as Output[]) if (!o.error) record(byId.get(o.id)!, byId.get(o.id)!.split, `hc-${tag}`, "sweep-next-edit", o.output, variantOf(variant).options);
}
process.env.HC_FINAL = "1";
// The second held-out set stays unread until DV_FRESH2=1, after the config is chosen on the others.
for (const [set, file, tags] of [["fresh", "fresh", ["base", "final"]], ["fresh2", "fresh2", ["main", "best"]]] as const) {
  if (set === "fresh2" && process.env.DV_FRESH2 !== "1") continue;
  const cases = await loadSet(file);
  for (const c of cases) entry(c, set);
  for (const tag of tags) {
    const f = Bun.file(new URL(`${tag}.${file}.json`, rawDir));
    if (!(await f.exists())) continue;
    for (const o of (await f.json()) as Output[]) if (!o.error) record(cases.find((c) => c.id === o.id)!, set, `${set}-${tag}`, "sweep-next-edit", o.output, variantOf(set === "fresh2" ? "a10b20" : runs[tag] ?? tag).options);
  }
}
for (const c of dev) entry(c, c.split);
const rows = [...out.values()];
await Bun.write(process.argv[2] ?? "states.json", JSON.stringify(rows));
const n = rows.flatMap((r) => r.states);
console.log(`${rows.length} cases, ${n.length} states, ${new Set(rows.map((r) => r.commit)).size} commits, unlabelled ${n.filter((s) => s.label === "unlabelled").length}`);
