// Scores recorded import runs against the commit's import: exact, right (same bindings and
// modules, other placement), partial, wrong, or nothing. Pass dev, test or extra.
import { hardeningCases } from "../../../../packages/predict/src/edit/hardening.testing.ts";
import { applyEdits } from "../../../../packages/predict/src/edit/guards.ts";
import { bindings, type ImportCase } from "./imports-shared.ts";

const split = process.argv[2];
const verbose = process.argv.includes("-v");
const runs: { id: string; runs: { rule: string; scope: string; rounds: { choice: unknown }[]; final: string }[] }[] =
  await Bun.file(new URL(`../reach/imports-${split}.lsp.json`, import.meta.url)).json();
const cases: ImportCase[] = split === "extra"
  ? await Bun.file(new URL("../reach/imports-extra.cases.json", import.meta.url)).json()
  : hardeningCases.filter((c) => c.category === "import" && c.split === split).map((c) => ({ ...c, commit: "" }));
const norm = (s: string) => s.replace(/\s/g, "");

export const outcome = (c: ImportCase, final: string) => {
  const target = applyEdits(c.buffer, c.expected);
  if (norm(final) === norm(target)) return "exact";
  if (norm(final) === norm(c.buffer)) return "nothing";
  const before = bindings(c.buffer);
  const added = (text: string) => new Map([...bindings(text)].filter(([n]) => !before.has(n)));
  const want = added(target);
  const got = added(final);
  if ([...got].some(([n, m]) => want.get(n) !== m)) return "wrong";
  return got.size === want.size ? "right" : "partial";
};

const table: Record<string, Record<string, number>> = {};
for (const row of runs) {
  const c = cases.find((x) => x.id === row.id)!;
  for (const r of row.runs) {
    const key = `${r.rule} / ${r.scope}`;
    const o = outcome(c, r.final);
    table[key] ??= { exact: 0, right: 0, partial: 0, wrong: 0, nothing: 0, tabs: 0 };
    table[key][o]!++;
    table[key].tabs! += r.rounds.filter((x) => x.choice).length;
    if (verbose && o !== "exact") console.log(row.id, key, o, r.rounds.map((x) => (x.choice as { module?: string } | null)?.module ?? "-").join(" → "));
  }
}
console.log(`${split}: ${runs.length} import cases`);
console.table(table);
