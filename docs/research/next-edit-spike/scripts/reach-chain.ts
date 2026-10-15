// Chaining: after the user writes a commit's first hunk, how far do Tab presses walk the rest of
// the file's hunks? `oracle` accepts the true next hunk whenever a window contains it; `live`
// (POLARIS_PREDICTION_LIVE=1, Sweep on :8093) accepts only exact model outputs.
import { Schema } from "effect";
import { EditPredictionRequest } from "../../../../packages/protocol/src/index.ts";
import { request as baseRequest } from "../../../../packages/predict/src/edit/fixtures.testing.ts";
import { editWindow } from "../../../../packages/predict/src/edit/window.ts";
import { diffEdits } from "../../../../packages/predict/src/edit/diff.ts";
import { applyEdits } from "../../../../packages/predict/src/edit/guards.ts";
import { editResult } from "../../../../packages/predict/src/edit/result.ts";
import { buildEditPrompt } from "../../../../packages/predict/src/edit/prompt.ts";
import { endpointDeltas } from "../../../../packages/predict/src/endpoint.ts";
import { reachFocuses } from "../../../../packages/predict/src/edit/reach/index.ts";
import { changed } from "./build.ts";
import { apply, hunks, landing, show, type Hunk } from "./git.ts";

const [split, mode = "oracle"] = process.argv.slice(2);
if (!["dev", "test"].includes(split ?? "") || !["oracle", "live"].includes(mode))
  throw new Error("Pass dev|test and oracle|live");
if (mode === "live" && process.env.POLARIS_PREDICTION_LIVE !== "1") throw new Error("Set POLARIS_PREDICTION_LIVE=1");
const URL_ = "http://127.0.0.1:8093";
const specs: { id: string; commit: string; path: string; split: string }[] =
  await Bun.file(new URL("./cases.json", import.meta.url)).json();
const norm = (s: string) => s.replace(/\s/g, "");
const isImport = (h: Hunk) => h.oldLines.length === 0 && h.newLines.every((l) => /^\s*(import\b|$)/.test(l));

type Policy = "none" | "spec" | "reach";
interface Walk { applied: number[]; history: { path: string; line: number; before: string; after: string }[]; cursor: number }

const specProbe = (buffer: string, cursor: number, w: { from: number; to: number }, last: Walk["history"][number]) => {
  const words = (s: string) => s.match(/[$A-Z_a-z][$\w]*/g) ?? [];
  const after = words(last.after);
  const removed = new Set(words(last.before).filter((n) => !after.includes(n)));
  return [...buffer.matchAll(/[$A-Z_a-z][$\w]*/g)]
    .filter((m) => removed.has(m[0]) && (m.index < w.from || m.index >= w.to))
    .map((m) => m.index).sort((a, b) => Math.abs(a - cursor) - Math.abs(b - cursor))[0];
};

const step = (base: string[], all: Hunk[], walk: Walk, k: number, path: string): Walk => {
  const before = apply(base, all, walk.applied).join("\n");
  const applied = [...walk.applied, k].sort((a, b) => a - b);
  const lines = apply(base, all, applied);
  const [line, , endAfter] = changed(before.split("\n"), lines);
  const end = Math.max(line, endAfter - 1);
  const cursor = lines.slice(0, end).reduce((n, l) => n + l.length + 1, 0) + (endAfter > line ? (lines[end] ?? "").trimEnd().length : 0);
  const prev = before.split("\n");
  const [l0, eb, ea] = changed(prev, lines);
  return { applied, cursor, history: [...walk.history, { path, line: l0, before: prev.slice(l0, eb).join("\n"), after: lines.slice(l0, ea).join("\n") }] };
};

// Raw outputs by request, so reruns and reviews need no model; a failed request records null.
const cacheFile = new URL(`../reach/chain-${split}.outputs.json`, import.meta.url);
const cache: Record<string, string | null> = (await Bun.file(cacheFile).exists()) ? await Bun.file(cacheFile).json() : {};
const live = async (request: EditPredictionRequest) => {
  const key = new Bun.CryptoHasher("sha256").update(JSON.stringify([request.buffer, request.cursor, request.focus, request.history])).digest("hex");
  if (!(key in cache)) {
    let output: string | null = "";
    try {
      for await (const delta of endpointDeltas(request, buildEditPrompt(request), AbortSignal.timeout(120000), globalThis.fetch)) output += delta;
    } catch {
      output = null;
    }
    cache[key] = output;
    await Bun.write(cacheFile, JSON.stringify(cache) + "\n");
  }
  const output = cache[key];
  return output === null || output === undefined ? { edits: [] } : editResult(request, output);
};

const rows = [];
const seen = new Set<string>();
for (const spec of specs.filter((s) => s.split === split)) {
  const key = `${spec.commit}:${spec.path}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const all = await hunks(spec.commit, spec.path);
  const work = all.map((_, i) => i).filter((i) => !isImport(all[i]!));
  if (work.length < 2) continue;
  const base = (await show(`${spec.commit}^`, spec.path)).split("\n");
  const imports = all.map((_, i) => i).filter((i) => isImport(all[i]!));
  for (const policy of (mode === "live" ? ["spec", "reach"] : ["none", "spec", "reach"]) as Policy[]) {
    // The user writes the first non-import hunk; imports are the language server's.
    let walk = step(base, all, { applied: [], history: [], cursor: 0 }, work[0]!, spec.path);
    const presses: string[] = [];
    for (;;) {
      const remaining = work.filter((i) => !walk.applied.includes(i));
      if (!remaining.length) break;
      const buffer = apply(base, all, walk.applied).join("\n");
      const fields = { ...baseRequest, path: spec.path, buffer, cursor: walk.cursor,
        history: walk.history.slice(-32), format: "sweep-next-edit", endpoint: { kind: "openai", url: URL_ },
        model: "sweep-next-edit", maxTokens: 512 };
      const decoded = Schema.decodeUnknownExit(EditPredictionRequest)(fields);
      if (decoded._tag === "Failure") { console.error(spec.commit, String(decoded).slice(0, 400)); break; }
      const request = decoded.value;
      const inside = (focus: number | null) => {
        const w = editWindow(EditPredictionRequest.make({ ...request, focus }));
        return remaining.filter((i) => diffEdits(buffer, apply(base, all, [...walk.applied, i].sort((a, b) => a - b)).join("\n"))
          .every((e) => e.from >= w.from && e.to <= w.to))
          .sort((a, b) => Math.abs(landing(all, walk.applied, a) - landing(all, walk.applied, walk.applied.at(-1)!)) -
            Math.abs(landing(all, walk.applied, b) - landing(all, walk.applied, walk.applied.at(-1)!)));
      };
      const w = editWindow(request);
      const probe = policy === "none" ? undefined : policy === "spec"
        ? specProbe(buffer, walk.cursor, w, walk.history.at(-1)!)
        : reachFocuses({ buffer, path: spec.path, cursor: walk.cursor, window: w, history: walk.history })[0];
      let next: number[] | undefined;
      let press = "";
      if (mode === "oracle") {
        const here = inside(null)[0];
        const there = probe === undefined ? undefined : inside(probe)[0];
        next = here !== undefined ? [here] : there !== undefined ? [there] : undefined;
        press = here !== undefined ? "tab" : "jump";
      } else {
        // Accept an output only when it equals some non-empty set of the remaining hunks.
        const exact = async (focus: number | null) => {
          const result = await live(EditPredictionRequest.make({ ...request, focus }));
          if (!result.edits.length) return { label: "abstain" as const };
          const after = norm(applyEdits(buffer, result.edits));
          const subsets = remaining.reduce<number[][]>((acc, x) => acc.concat(acc.map((s) => [...s, x])), [[]]).slice(1);
          const hit = subsets.find((s) => norm(apply(base, all, [...walk.applied, ...s].sort((a, b) => a - b)).join("\n")) === after);
          return hit ? { label: "exact" as const, hit } : { label: "other" as const, edits: result.edits };
        };
        const here = await exact(null);
        const there = here.label === "abstain" && probe !== undefined ? await exact(probe) : undefined;
        const chosen = here.label !== "abstain" ? here : there;
        next = chosen?.label === "exact" ? chosen.hit : undefined;
        press = here.label !== "abstain" ? "tab" : "jump";
        if (chosen?.label === "other") presses.push(`${press}:other ${JSON.stringify(chosen.edits).slice(0, 300)}`);
      }
      if (!next) break;
      presses.push(press);
      for (const k of next) walk = step(base, all, walk, k, spec.path);
    }
    const reached = walk.applied.filter((i) => work.includes(i)).length - 1;
    rows.push({ commit: spec.commit, path: spec.path, policy, hunks: work.length - 1, imports: imports.length, reached,
      complete: reached === work.length - 1, presses });
    process.stderr.write(".");
  }
}
const out = new URL(`../reach/chain-${split}-${mode}.json`, import.meta.url);
await Bun.write(out, JSON.stringify(rows, null, 1) + "\n");
const summary: Record<string, Record<string, number>> = {};
for (const r of rows) {
  const s = (summary[r.policy] ??= { files: 0, hunks: 0, reached: 0, complete: 0, tab: 0, jump: 0, other: 0 });
  s.files!++; s.hunks! += r.hunks; s.reached! += r.reached; s.complete! += Number(r.complete);
  for (const p of r.presses) if (p === "tab") s.tab!++; else if (p === "jump") s.jump!++; else s.other!++;
}
console.log(`\n${split} ${mode}: multi-hunk files, hunks after the user's first`);
console.table(summary);
