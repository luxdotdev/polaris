// hc-score.ts <variant> <dev|fresh> [tag] [--baseline tag]: counts after guards, lost useful cases,
// and a review file (raw/hc/<tag>.<set>.pending.md) of every unlabelled shown edit.
import { loadLabels, loadSet, rawDir, review, score, variantOf, type Output } from "./hc-lib.ts";
import { applyEdits } from "../../../../packages/predict/src/edit/guards.ts";

const args = process.argv.slice(2);
const bi = args.indexOf("--baseline");
const baseline = bi >= 0 ? args.splice(bi, 2)[1] : undefined;
const [name = "", set = "dev", tag = name] = args;
const variant = variantOf(name);
const labels = await loadLabels();
const cases = await loadSet(set);
const read = async (t: string): Promise<Output[]> => Bun.file(new URL(`${t}.${set}.json`, rawDir)).json();
const outputs = await read(tag);
const results = new Map(cases.map((c) => [c.id, score(c, outputs.find((o) => o.id === c.id)!, variant, labels)]));
const table: Record<string, number> = { exact: 0, acceptable: 0, wrong: 0, dangerous: 0, abstain: 0, unlabelled: 0 };
const pending: string[] = [];
for (const c of cases) {
  const r = results.get(c.id)!;
  table[r.label]!++;
  if (r.label !== "unlabelled") continue;
  pending.push(review(c, r.shown));
}
const useful = (l: string) => l === "exact" || l === "acceptable";
const times = outputs.map((o) => o.elapsedMs).sort((a, b) => a - b);
console.log(JSON.stringify({ tag, set, ...table, useful: table.exact! + table.acceptable!, p50: Math.round(times[Math.floor(times.length / 2)]!), errors: outputs.filter((o) => o.error).map((o) => `${o.id}: ${o.error}`) }));
const dangerous = cases.filter((c) => results.get(c.id)!.label === "dangerous").map((c) => c.id);
if (dangerous.length) console.log("DANGEROUS after guards:", dangerous.join(" "));
console.log("useful:", cases.filter((c) => useful(results.get(c.id)!.label)).map((c) => c.id).join(" "));
console.log("wrong:", cases.filter((c) => results.get(c.id)!.label === "wrong").map((c) => c.id).join(" "));
if (baseline) {
  const bout = await read(baseline);
  const bvar = variantOf(process.env.HC_BASELINE_VARIANT ?? "base");
  const before = new Map(cases.map((c) => [c.id, score(c, bout.find((o) => o.id === c.id)!, bvar, labels).label]));
  console.log("lost useful:", cases.filter((c) => useful(before.get(c.id)!) && !useful(results.get(c.id)!.label)).map((c) => c.id).join(" ") || "none");
  console.log("gained useful:", cases.filter((c) => !useful(before.get(c.id)!) && useful(results.get(c.id)!.label)).map((c) => c.id).join(" ") || "none");
}
const pendingFile = new URL(`${tag}.${set}.pending.md`, rawDir);
if (pending.length) await Bun.write(pendingFile, pending.join("\n"));
console.log(`${pending.length} unlabelled${pending.length ? ` → ${pendingFile.pathname}` : ""}`);
