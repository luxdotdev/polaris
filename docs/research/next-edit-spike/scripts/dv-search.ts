// dv-search.ts <states.json> <diag.json>: every subset of the seven hill-climb guards, with and without
// the nearest-change fallback and the verifier, scored on the dev runs (never the second held-out set).
// Ranks by dangerous shown (fewest), useful (most), wrong (fewest), then ground truths blocked.
import { allRuns, blocksTruth, casesOf, guardFlags, tally, type Config, type Pipeline } from "./dv-pipeline.ts";
import type { CaseStates } from "./dv-states.ts";

const [statesFile = "", diagFile = ""] = process.argv.slice(2);
const rows: CaseStates[] = await Bun.file(statesFile).json();
const p: Pipeline = { states: new Map(rows.map((r) => [r.id, r])), diags: await Bun.file(diagFile).json() };
const runs = await allRuns(false);
const sets = new Map([["dev", await casesOf("dev")], ["fresh", await casesOf("fresh")]]);
const results = [];
for (let mask = 0; mask < 1 << guardFlags.length; mask++)
  for (const near of [true, false])
    for (const verify of [true, false]) {
      const guards = Object.fromEntries(guardFlags.map((g, i) => [g, (mask & (1 << i)) !== 0]));
      const config: Config = { guards, near, verify };
      const sum = { useful: 0, wrong: 0, dangerous: [] as string[], unlabelled: [] as string[], truth: 0, sweepUseful: 0 };
      for (const run of runs) {
        const t = tally(p, run, sets.get(run.set)!, config);
        sum.useful += t.exact!.length + t.acceptable!.length;
        if (run.format === "sweep-next-edit") sum.sweepUseful += t.exact!.length + t.acceptable!.length;
        sum.wrong += t.wrong!.length;
        sum.dangerous.push(...t.dangerous!.map((id) => `${run.name}/${id}`));
        sum.unlabelled.push(...t.unlabelled!);
      }
      for (const cases of sets.values()) sum.truth += cases.filter((c) => blocksTruth(p, c, config)).length;
      const name = [verify ? "verify" : "", near ? "near" : "", ...guardFlags.filter((g) => guards[g])].filter(Boolean).join("+");
      results.push({ name, ...sum });
    }
results.sort((a, b) => a.dangerous.length - b.dangerous.length || b.useful - a.useful || a.wrong - b.wrong || a.truth - b.truth);
for (const r of results.slice(0, Number(process.env.DV_TOP ?? 40)))
  console.log(`${r.dangerous.length}\t${r.useful}\t${r.sweepUseful}\t${r.wrong}\t${r.truth}\t${r.unlabelled.length}\t${r.name}\t${r.dangerous.join(" ")}\t${[...new Set(r.unlabelled)].join(" ")}`);
