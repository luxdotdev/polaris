// Scores recorded probe outputs: exact and abstain mechanically, the rest from reach/<split>.labels.json.
import { EditPredictionRequest } from "../../../../packages/protocol/src/index.ts";
import { hardeningCases, hardeningRequest } from "../../../../packages/predict/src/edit/hardening.testing.ts";
import { editWindow } from "../../../../packages/predict/src/edit/window.ts";
import { editResult } from "../../../../packages/predict/src/edit/result.ts";
import { parseRegions } from "../../../../packages/predict/src/edit/parse.ts";
import { buildEditPrompt } from "../../../../packages/predict/src/edit/prompt.ts";
import { applyEdits } from "../../../../packages/predict/src/edit/guards.ts";
import { focusesFor, variants } from "./reach-variants.ts";

const split = process.argv[2];
if (!["dev", "test"].includes(split ?? "")) throw new Error("Pass dev or test");
const mode = process.argv[3] ?? "table";
const dir = new URL("../reach/", import.meta.url);
const outputs: { id: string; focus: number; output: string; elapsedMs: number }[] =
  await Bun.file(new URL(`${split}.outputs.json`, dir)).json();
const labelsFile = Bun.file(new URL(`${split}.labels.json`, dir));
const labels: Record<string, { label: string; note: string }> = (await labelsFile.exists()) ? await labelsFile.json() : {};
const norm = (s: string) => s.replace(/\s/g, "");

type Case = (typeof hardeningCases)[number];
const judge = (c: Case, focus: number) => {
  const key = `${c.id}@${focus}`;
  const recorded = outputs.find((o) => o.id === c.id && o.focus === focus);
  if (!recorded) return { key, label: "missing", raw: "missing" };
  const request = EditPredictionRequest.make({ ...hardeningRequest(c, "sweep-next-edit"), focus });
  const prompt = buildEditPrompt(request);
  const rawAfter = applyEdits(c.buffer, parseRegions(request, prompt.window, recorded.output, prompt.stop).regions);
  const final = editResult(request, recorded.output);
  const after = applyEdits(c.buffer, final.edits);
  const auto = (text: string) => norm(text) === norm(c.buffer) ? "abstain"
    : c.allowed.some((p) => norm(applyEdits(c.buffer, p)) === norm(text)) ? "exact" : undefined;
  const raw = auto(rawAfter) ?? labels[`${key}:raw`]?.label ?? "unreviewed";
  const label = auto(after) ?? (norm(after) === norm(rawAfter) ? raw : labels[key]?.label ?? "unreviewed");
  return { key, label, raw, request, final, rawAfter, after, elapsedMs: recorded.elapsedMs };
};

const cases = hardeningCases.filter((c) => c.split === split);
const outside = cases.filter((c) => { const w = editWindow(hardeningRequest(c, "sweep-next-edit"));
  return !c.expected.every((e) => e.from >= w.from && e.to <= w.to); });

if (mode === "pending") {
  const seen = new Set<string>();
  for (const c of outside) {
    const w = editWindow(hardeningRequest(c, "sweep-next-edit"));
    for (const v of Object.keys(variants)) for (const focus of focusesFor(v, c, w).slice(0, 3)) {
      const j = judge(c, focus);
      if (seen.has(j.key) || (j.label !== "unreviewed" && j.raw !== "unreviewed")) continue;
      seen.add(j.key);
      const show = (text: string) => { const a = c.buffer.split("\n"), b = text.split("\n");
        let p = 0; while (p < a.length && a[p] === b[p]) p++;
        let s = 0; while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
        return `@L${p}\n- ${a.slice(p, a.length - s).join("\n- ")}\n+ ${b.slice(p, b.length - s).join("\n+ ")}`; };
      console.log(`\n### ${j.key} (${c.category}) raw=${j.raw} shown=${j.label}`);
      console.log("TARGET", show(applyEdits(c.buffer, c.expected)));
      if (j.raw === "unreviewed") console.log("RAW", show(j.rawAfter!));
      if (j.label === "unreviewed") console.log("SHOWN", show(j.after!), "suppressed:", JSON.stringify(j.final!.suppressed));
    }
  }
} else {
  const rows: Record<string, Record<string, number | string>> = {};
  const useful = (l: string) => l === "exact" || l === "acceptable";
  for (const v of Object.keys(variants)) {
    const r = { probed: 0, reached: 0, exact: 0, acceptable: 0, wrong: 0, dangerous: 0, abstain: 0, rawDangerous: 0, "useful@3": 0, "dangerous@3": 0, pending: 0 };
    for (const c of outside) {
      const w = editWindow(hardeningRequest(c, "sweep-next-edit"));
      const focuses = focusesFor(v, c, w).slice(0, 3);
      if (!focuses.length) continue;
      r.probed++;
      const first = judge(c, focuses[0]!);
      const pw = editWindow(first.request!);
      if (c.expected.every((e) => e.from >= pw.from && e.to <= pw.to)) r.reached++;
      if (first.label === "unreviewed" || first.raw === "unreviewed") r.pending++;
      else (r as Record<string, number>)[first.label]++;
      if (first.raw === "dangerous") r.rawDangerous++;
      const labels = focuses.map((f) => judge(c, f));
      if (labels.some((j) => useful(j.label))) r["useful@3"]++;
      if (labels.some((j) => j.label === "dangerous")) r["dangerous@3"]++;
      if (labels.some((j) => j.label === "unreviewed" || j.raw === "unreviewed")) r.pending += focuses.length > 1 ? 0 : 0;
    }
    rows[v] = r;
  }
  console.log(`${split}: ${outside.length} cases with the target outside the cursor window; first probe only unless @3`);
  console.table(rows);
}
