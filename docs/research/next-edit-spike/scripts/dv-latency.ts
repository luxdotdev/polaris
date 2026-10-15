// dv-latency.ts <states.json> <tsgo|tsls> [cases]: diagnostics round trip for a predicted edit on a
// warm language server in this checkout: open the case buffer, then replace it with a state 3 times.
import { existsSync } from "node:fs";
import { Lsp } from "./dv-lsp.ts";
import type { CaseStates } from "./dv-states.ts";

const [statesFile = "", server = "tsgo", limit = "60"] = process.argv.slice(2);
const here = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const rows = ((await Bun.file(statesFile).json()) as CaseStates[]).filter((r) => existsSync(`${here}/${r.path}`) && r.states.some((s) => !s.truth));
const sample = rows.toSorted((a, b) => a.id.localeCompare(b.id)).slice(0, Number(limit));
const argv = server === "tsgo"
  ? [`${here}/node_modules/.bun/@typescript+typescript-darwin-arm64@7.0.2/node_modules/@typescript/typescript-darwin-arm64/lib/tsc`, "--lsp", "--stdio"]
  : ["node", process.env.DV_TSLS!, "--stdio"];
const lsp = new Lsp(argv, here);
const t0 = performance.now();
await lsp.initialize(here, server === "tsgo" ? {} : { tsserver: { path: process.env.DV_TSSERVER } });
const init = performance.now() - t0;
const diagnose = async (uri: string, text: string, open: boolean) => {
  const wait = server === "tsgo" ? null : lsp.nextPush(uri, 10_000);
  if (open) lsp.open(uri, text);
  else lsp.change(uri, text);
  const start = performance.now();
  try {
    await (wait ?? lsp.pull(uri));
  } catch {
    missed++;
    return Number.POSITIVE_INFINITY;
  }
  return performance.now() - start;
};
let missed = 0;
const first: number[] = [], warm: number[] = [];
for (const c of sample) {
  const uri = `file://${here}/${c.path}`;
  const state = c.states.find((s) => !s.truth)!;
  first.push(await diagnose(uri, c.buffer, true));
  const times: number[] = [];
  for (let i = 0; i < 3; i++) {
    times.push(await diagnose(uri, state.after, false));
    await diagnose(uri, c.buffer, false);
  }
  warm.push(...times);
  if (process.env.DV_DETAIL) console.error(`${c.id}\t${c.path}\t${c.buffer.split("\n").length}\t${times.map(Math.round).join(" ")}`);
  lsp.close(uri);
  process.stderr.write(".");
}
await lsp.stop();
const q = (xs: number[], p: number) => Math.round(xs.toSorted((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))]! * 10) / 10;
console.log(JSON.stringify({ server, files: sample.length, initMs: Math.round(init), firstOpen: { p50: q(first, 0.5), p95: q(first, 0.95), max: q(first, 1) }, missed, warmEdit: { n: warm.length, p50: q(warm, 0.5), p95: q(warm, 0.95), max: q(warm, 1) } }));
