// hc-table.ts <dev|fresh> <post> <baseline-tag> <tag…>: one markdown row per run, scored with the run's
// variant plus <post> ("" or e.g. "near+guards"), and the useful cases lost against the baseline.
import { loadLabels, loadSet, rawDir, score, variantOf, type Output } from "./hc-lib.ts";
import { runs } from "./hc-corpus.ts";

const [set = "dev", post = "", baseline = "base", ...tags] = process.argv.slice(2);
const labels = await loadLabels();
const cases = await loadSet(set);
const useful = (l: string) => l === "exact" || l === "acceptable";
const scored = async (tag: string) => {
  const outs: Output[] = await Bun.file(new URL(`${tag}.${set}.json`, rawDir)).json();
  const name = [runs[tag] ?? tag, post].filter(Boolean).join("+");
  const rows = new Map(cases.map((c) => [c.id, score(c, outs.find((o) => o.id === c.id)!, variantOf(name), labels).label]));
  const times = outs.map((o) => o.elapsedMs).sort((a, b) => a - b);
  return { rows, p50: Math.round(times[Math.floor(times.length / 2)]!) };
};
const base = await scored(baseline);
console.log("| Run | Useful | Exact | Acceptable | Wrong | Dangerous | Abstain | Unlabelled | p50 ms | Lost vs baseline |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---|");
for (const tag of tags) {
  const { rows, p50 } = await scored(tag);
  const n = (l: string) => [...rows.values()].filter((x) => x === l).length;
  const lost = cases.filter((c) => useful(base.rows.get(c.id)!) && !useful(rows.get(c.id)!)).map((c) => c.id);
  console.log(`| ${tag} | ${n("exact") + n("acceptable")} | ${n("exact")} | ${n("acceptable")} | ${n("wrong")} | ${n("dangerous")} | ${n("abstain")} | ${n("unlabelled")} | ${p50} | ${lost.join(" ") || "–"} |`);
}
