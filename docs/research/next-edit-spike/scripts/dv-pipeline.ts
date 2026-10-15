// dv-pipeline.ts <states.json> <diag.json> [config…]: shown labels of recorded runs under guard
// configs with or without the diagnostics verifier, and the ground truths each config blocks.
// A config is "+"-joined: guard flags to turn OFF (e.g. -novelNames), "verify", "near" (fallback).
import { EditPredictionRequest } from "../../../../packages/protocol/src/index.ts";
import { request as base } from "../../../../packages/predict/src/edit/fixtures.testing.ts";
import { hardeningRuns } from "../../../../packages/predict/src/edit/hardening.testing.ts";
import { applyEdits, guardEdits } from "../../../../packages/predict/src/edit/guards.ts";
import { nearestChange } from "../../../../packages/predict/src/edit/nearest.ts";
import { buildEditPrompt } from "../../../../packages/predict/src/edit/prompt.ts";
import { editWindow } from "../../../../packages/predict/src/edit/window.ts";
import { editOptions, spikeEditOptions, type EditOptions } from "../../../../packages/predict/src/edit/options.ts";
import { rawEdits } from "./dv-lib.ts";
import { runs } from "./hc-corpus.ts";
import { introduced } from "./dv-score.ts";
import type { CaseStates } from "./dv-states.ts";
import type { CaseDiagnostics } from "./dv-diagnose.ts";
import { loadSet, rawDir, stateHash, variantOf, type Case, type Output } from "./hc-lib.ts";

export const guardFlags = ["novelNames", "declarationRenames", "removedNames", "deletionEvidence", "relevance", "duplicates", "selfReference"] as const;
export type Config = { guards: Partial<Record<(typeof guardFlags)[number], boolean>>; near: boolean; verify: boolean; spikeGuards?: boolean };

export const parseConfig = (name: string): Config => {
  const parts = name.split("+").filter(Boolean);
  const spikeGuards = parts.includes("spike");
  const guards = Object.fromEntries(guardFlags.map((g) => [g, !spikeGuards && !parts.includes(`-${g}`)]));
  return { guards, near: !spikeGuards && !parts.includes("-near"), verify: parts.includes("verify"), spikeGuards };
};

export type Pipeline = { states: Map<string, CaseStates>; diags: Record<string, CaseDiagnostics> };

/** Whether the diagnostics verifier lets this buffer state through (unknown state: null). */
const memo = new Map<string, boolean | null>();
const verifies = (p: Pipeline, c: Case, after: string) => {
  const k = `${c.id}:${stateHash(after)}`;
  if (!memo.has(k)) memo.set(k, verifiesOnce(p, c, after));
  return memo.get(k)!;
};
const verifiesOnce = (p: Pipeline, c: Case, after: string) => {
  const row = p.states.get(c.id)!;
  const s = row.states.find((x) => x.hash === stateHash(after));
  const d = p.diags[c.id];
  if (!s || !d || d.error) return null;
  return introduced(row, s, d)?.length === 0;
};

/** The buffer the config shows for one recorded output. */
export const shown = (p: Pipeline, c: Case, format: EditPredictionRequest["format"], output: string, layout: EditOptions, config: Config) => {
  const options: EditOptions = { ...layout, ...(config.spikeGuards ? {} : config.guards), nearestFallback: config.near && format === "sweep-next-edit" };
  const input = EditPredictionRequest.make({ ...base, path: c.path, buffer: c.buffer, cursor: c.cursor, history: c.history, format });
  const edits = rawEdits(input, output, options);
  const window = buildEditPrompt(input, options).window;
  const whole = guardEdits(input, window, edits, options);
  const ok = (e: readonly { from: number; to: number; text: string }[]) => e.length > 0 && (!config.verify || verifies(p, c, applyEdits(c.buffer, e)) !== false);
  if (ok(whole.edits)) return applyEdits(c.buffer, whole.edits);
  if (!options.nearestFallback) return c.buffer;
  const blocked = { edits: [], suppressed: edits.map(({ from, to }) => ({ reason: "unstable" as const, from, to })) };
  const near = nearestChange(input, window, edits, blocked, options);
  return ok(near.edits) ? applyEdits(c.buffer, near.edits) : c.buffer;
};

export const labelOf = (p: Pipeline, c: Case, after: string) => {
  if (after === c.buffer) return "abstain";
  const s = p.states.get(c.id)?.states.find((x) => x.hash === stateHash(after));
  return s?.label ?? `unlabelled`;
};

/** Ground truth blocked by the config's guards or the verifier. */
export const blocksTruth = (p: Pipeline, c: Case, config: Config) => {
  const input = EditPredictionRequest.make({ ...base, path: c.path, buffer: c.buffer, cursor: c.cursor, history: c.history, format: "sweep-next-edit" });
  const options = config.spikeGuards ? spikeEditOptions : { ...editOptions, ...config.guards };
  const window = { ...editWindow(input, options), from: 0, to: c.buffer.length };
  if (!guardEdits(input, window, c.expected, options).edits.length) return "guards";
  return config.verify && verifies(p, c, applyEdits(c.buffer, c.expected)) === false ? "verifier" : null;
};

export type Run = { name: string; set: string; format: EditPredictionRequest["format"]; layout: EditOptions; outputs: { id: string; output: string | null }[] };

export const allRuns = async (fresh2 = false): Promise<Run[]> => {
  const out: Run[] = [];
  const read = async (tag: string, set: string) => ((await Bun.file(new URL(`${tag}.${set}.json`, rawDir)).json()) as Output[]).map((o) => ({ id: o.id, output: o.error ? null : o.output }));
  const devRuns = process.env.DV_ALL_RUNS === "1" ? Object.entries(runs).filter(([tag]) => tag !== "final") : [["a10b20", "a10b20"], ["base", "base"]];
  for (const [tag, variant] of devRuns)
    if (await Bun.file(new URL(`${tag}.dev.json`, rawDir)).exists())
      out.push({ name: `sweep-${tag}`, set: "dev", format: "sweep-next-edit", layout: variantOf(variant).options, outputs: await read(tag, "dev") });
  out.push({ name: "sweep-final", set: "fresh", format: "sweep-next-edit", layout: variantOf("a10b20").options, outputs: await read("final", "fresh") });
  out.push({ name: "sweep-base", set: "fresh", format: "sweep-next-edit", layout: spikeEditOptions, outputs: await read("base", "fresh") });
  for (const r of hardeningRuns.filter((x) => x.format === "zeta-2.1")) out.push({ name: `zeta-hardening-${r.split}`, set: "dev", format: r.format, layout: spikeEditOptions, outputs: [...r.outputs] });
  if (fresh2) for (const [tag, layout] of [["main", "a10b20"], ["best", "a10b20"]] as const)
    if (await Bun.file(new URL(`${tag}.fresh2.json`, rawDir)).exists()) out.push({ name: `sweep-${tag}`, set: "fresh2", format: "sweep-next-edit", layout: variantOf(layout).options, outputs: await read(tag, "fresh2") });
  return out;
};

export const casesOf = async (set: string) => {
  process.env.HC_FINAL = "1";
  return loadSet(set);
};

export const tally = (p: Pipeline, run: Run, cases: Case[], config: Config) => {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const counts: Record<string, string[]> = { exact: [], acceptable: [], wrong: [], dangerous: [], abstain: [], unlabelled: [] };
  for (const o of run.outputs) {
    const c = byId.get(o.id);
    if (!c) continue;
    const after = o.output === null ? c.buffer : shown(p, c, run.format, o.output, run.layout, config);
    const label = labelOf(p, c, after);
    (counts[label] ??= []).push(label === "unlabelled" ? `${c.id}:${stateHash(after)}` : c.id);
  }
  return counts;
};

if (import.meta.main) {
  const [statesFile = "", diagFile = "", ...configs] = process.argv.slice(2);
  const rows: CaseStates[] = await Bun.file(statesFile).json();
  const p: Pipeline = { states: new Map(rows.map((r) => [r.id, r])), diags: await Bun.file(diagFile).json() };
  const runs = await allRuns(process.env.DV_FRESH2 === "1");
  const sets = new Map<string, Case[]>();
  for (const r of runs) if (!sets.has(r.set)) sets.set(r.set, await casesOf(r.set === "dev" ? "dev" : r.set));
  console.log("| Config | Run | Set | Useful | Exact | Acc | Wrong | Dangerous | Abstain | Unlabelled | Truth blocked |\n|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const name of configs) {
    const config = parseConfig(name);
    for (const run of runs) {
      const cases = sets.get(run.set)!;
      const t = tally(p, run, cases, config);
      const truth = cases.filter((c) => blocksTruth(p, c, config)).length;
      console.log(`| ${name} | ${run.name} | ${run.set} | ${t.exact!.length + t.acceptable!.length} | ${t.exact!.length} | ${t.acceptable!.length} | ${t.wrong!.length} | ${t.dangerous!.length} ${t.dangerous!.join(" ")} | ${t.abstain!.length} | ${t.unlabelled!.length} ${t.unlabelled!.join(" ")} | ${truth}/${cases.length} |`);
    }
  }
}
