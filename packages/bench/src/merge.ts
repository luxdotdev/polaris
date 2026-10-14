/**
 * Merge result files into one baseline: each metric's median over the results that have it.
 * CI's baseline is built this way from several runners' `bench-result` artifacts (README "CI").
 *
 *   bun packages/bench/src/merge.ts <out.json> <result.json>...
 */
import { readFileSync, writeFileSync } from "node:fs";
import { memoryClass } from "./compare.ts";
import { median } from "./stats.ts";
import {
  type AggregatedMetric,
  type BenchResult,
  parseBenchResult,
  type ScenarioResult,
} from "./types.ts";

const mergeScenario = (results: ReadonlyArray<ScenarioResult>): ScenarioResult => {
  const names = [...new Set(results.flatMap((r) => Object.keys(r.metrics)))];
  const metrics: Record<string, AggregatedMetric> = {};

  for (const name of names) {
    const found = results.flatMap((r) => r.metrics[name] ?? []);
    const values = found.map((m) => m.value);
    const newest = found.at(-1);

    if (newest === undefined) continue;

    metrics[name] = {
      ...newest,
      value: median(values),
      runs: values,
      min: Math.min(...values),
      max: Math.max(...values),
    };
  }

  return {
    metrics,
    notes: [`median of ${results.length} results`],
    durationMs: median(results.map((r) => r.durationMs)),
  };
};

/**
 * One result from many taken on the same OS, arch and core count (any CPU model). Its env is the
 * newest result's, named for the CPUs it spans, so its timings gate no single CPU model.
 */
export const mergeResults = (results: ReadonlyArray<BenchResult>): BenchResult => {
  const newest = results.at(-1);

  if (newest === undefined) throw new Error("nothing to merge");

  const classes = new Set(results.map((r) => memoryClass(r.env)));

  if (classes.size > 1) throw new Error(`results span ${[...classes].join(", ")}; merge one class`);

  const cpus = [...new Set(results.map((r) => r.env.cpu))].sort();
  const scenarios: Record<string, ScenarioResult> = {};

  for (const name of new Set(results.flatMap((r) => Object.keys(r.scenarios)))) {
    const ran = results.flatMap((r) => {
      const scenario = r.scenarios[name];

      return scenario === undefined || scenario.error !== undefined ? [] : [scenario];
    });

    if (ran.length > 0) scenarios[name] = mergeScenario(ran);
  }

  return {
    ...newest,
    env: {
      ...newest.env,
      cpu: cpus.length === 1 ? newest.env.cpu : cpus.join(" | "),
      machineSlug: cpus.length === 1 ? newest.env.machineSlug : `${memoryClass(newest.env)}-mixed`,
    },
    scenarios,
  };
};

if (import.meta.main) {
  const [out, ...inputs] = process.argv.slice(2);

  if (out === undefined || inputs.length === 0) {
    console.error("usage: bun packages/bench/src/merge.ts <out.json> <result.json>...");
    process.exit(2);
  }

  const results = inputs
    .map((path) => parseBenchResult(readFileSync(path, "utf8")))
    .sort((a, b) => a.env.date.localeCompare(b.env.date));

  writeFileSync(out, `${JSON.stringify(mergeResults(results), null, 2)}\n`);
  console.log(`merged ${results.length} results into ${out}`);
}
