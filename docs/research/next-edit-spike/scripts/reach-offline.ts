// Jump reach without a model: does a probe's window contain the whole target? Pass dev or test.
import { hardeningCases, hardeningRequest } from "../../../../packages/predict/src/edit/hardening.testing.ts";
import { reachFocuses, type ReachSignal } from "../../../../packages/predict/src/edit/reach/index.ts";
import { editWindow } from "../../../../packages/predict/src/edit/window.ts";
import { EditPredictionRequest } from "../../../../packages/protocol/src/index.ts";

const split = process.argv[2];
if (!["dev", "test"].includes(split ?? "")) throw new Error("Pass dev or test");
const verbose = process.argv.includes("-v");

// The spec's rule as written: every identifier the last edit removed, nearest occurrence first.
const specBaseline = (c: (typeof hardeningCases)[number], w: { from: number; to: number }) => {
  const last = c.history.at(-1)!;
  const words = (s: string) => s.match(/[$A-Z_a-z][$\w]*/g) ?? [];
  const after = words(last.after);
  const removed = new Set(words(last.before).filter((n) => !after.includes(n)));
  return [...c.buffer.matchAll(/[$A-Z_a-z][$\w]*/g)]
    .filter((m) => removed.has(m[0]) && (m.index < w.from || m.index >= w.to))
    .map((m) => m.index)
    .sort((a, b) => Math.abs(a - c.cursor) - Math.abs(b - c.cursor));
};

const variants: Record<string, ReachSignal[] | "spec"> = {
  spec: "spec",
  last: ["last"],
  "last+history": ["last", "history"],
  "orphan+last+history": ["orphan", "last", "history"],
  "+moved": ["orphan", "moved", "last", "history"],
  "+callee": ["orphan", "moved", "last", "callee", "history"],
  "+signature": ["orphan", "moved", "last", "callee", "history", "signature"],
  all: ["orphan", "moved", "last", "callee", "history", "signature", "kept"],
};

const reached = (c: (typeof hardeningCases)[number], focus: number) => {
  const w = editWindow(EditPredictionRequest.make({ ...hardeningRequest(c, "sweep-next-edit"), focus }));
  return c.expected.every((e) => e.from >= w.from && e.to <= w.to);
};

const cases = hardeningCases.filter((c) => c.split === split);
const outside = cases.filter((c) => !reached(c, c.cursor));
console.log(`${split}: ${outside.length}/${cases.length} targets outside the cursor window`);
const table: Record<string, Record<string, string>> = {};
for (const [name, signals] of Object.entries(variants)) {
  const row = { at1: 0, at3: 0, any: 0, none: 0, probes: 0 };
  const byCat: Record<string, number> = {};
  for (const c of outside) {
    const w = editWindow(hardeningRequest(c, "sweep-next-edit"));
    const focuses = signals === "spec" ? specBaseline(c, w) : reachFocuses({ ...c, window: w }, { signals });
    const hits = focuses.map((f) => reached(c, f));
    const first = hits.indexOf(true);
    if (focuses.length === 0) row.none++;
    row.probes += Math.min(3, focuses.length);
    if (first === 0) row.at1++;
    if (first >= 0 && first < 3) row.at3++;
    if (first >= 0) row.any++;
    if (first === 0) byCat[c.category] = (byCat[c.category] ?? 0) + 1;
    if (verbose && name === "all") console.log(c.id, c.category, `first hit #${first}`, `of ${focuses.length}`);
  }
  table[name] = { "@1": `${row.at1}`, "@3": `${row.at3}`, any: `${row.any}`, "no probe": `${row.none}`,
    "probes (≤3)": `${row.probes}`, "@1 by category": JSON.stringify(byCat) };
}
console.table(table);
const byCategory: Record<string, number> = {};
for (const c of outside) byCategory[c.category] = (byCategory[c.category] ?? 0) + 1;
console.log("outside by category", byCategory);
