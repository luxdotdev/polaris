// hc-fixtures.ts <variant> <tag:set[:variant]>…: freezes replay fixtures for packages/predict's hill-climb tests.
// hillclimb-corpus.json: every hand-labelled buffer state (as edits); hillclimb-<set>[-<tag>].json: the
// runs' raw outputs with each case's label under <variant>; hillclimb-labels.json: labels by state hash.
import { corpus } from "./hc-corpus.ts";
import { fixtures, loadLabels, loadSet, rawDir, score, variantOf, type Output } from "./hc-lib.ts";

const [name = "", ...runs] = process.argv.slice(2);
const labels = await loadLabels();
const needed: Record<string, Record<string, string>> = {};
const entries = (await corpus()).filter((e) => e.label !== "unlabelled");
await Bun.write(new URL("hillclimb-corpus.json", fixtures), JSON.stringify(entries.map((e) => ({ id: e.id, format: e.input.format, label: e.label, edits: e.edits }))) + "\n");
for (const run of runs) {
  const [tag = "", set = "dev", own = name] = run.split(":");
  const outs: Output[] = await Bun.file(new URL(`${tag}.${set}.json`, rawDir)).json();
  const rows = [];
  for (const c of await loadSet(set)) {
    const o = outs.find((x) => x.id === c.id)!;
    const r = score(c, o, variantOf(own), labels);
    if (r.label === "unlabelled") throw new Error(`${tag} ${c.id} is unlabelled`);
    if (r.label === "acceptable" || r.label === "wrong" || r.label === "dangerous") (needed[c.id] ??= {})[r.hash] = r.label;
    rows.push({ id: c.id, output: o.error ? null : o.output, label: r.label });
  }
  await Bun.write(new URL(`hillclimb-${set}-${tag}.json`, fixtures), JSON.stringify(rows) + "\n");
}
await Bun.write(new URL("hillclimb-labels.json", fixtures), JSON.stringify(needed, null, 1) + "\n");
console.log(`Froze ${entries.length} labelled states and ${runs.length} runs`);
