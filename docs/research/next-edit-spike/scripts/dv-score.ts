// dv-score.ts <states.json> <diag.json>: does "new error" separate dangerous/wrong from useful?
// One row per model, set and label: states whose edits introduce an error, and ground truths blocked.
import type { Diag } from "./dv-lsp.ts";
import type { CaseStates, State } from "./dv-states.ts";
import type { CaseDiagnostics } from "./dv-diagnose.ts";
import { introducedErrors, shadowedImports, type BufferDiagnostic } from "../../../../packages/predict/src/edit/diagnostics.ts";
import { diffEdits } from "../../../../packages/predict/src/edit/diff.ts";

const severities = ["error", "error", "warning", "information", "hint"] as const;
export const toBuffer = (text: string, d: Diag): BufferDiagnostic => {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return { from: (starts[d.line] ?? text.length) + d.character, to: (starts[d.endLine] ?? text.length) + d.endCharacter, severity: severities[d.severity] ?? "error", code: d.code, message: d.message };
};

const cursors = new Map<string, number>();
for (const f of ["hardening-cases.json", "fresh-cases.json", "fresh2-cases.json"])
  for (const c of (await Bun.file(new URL(`../../../../packages/predict/src/edit/fixtures/${f}`, import.meta.url)).json()) as { id: string; cursor: number }[]) cursors.set(c.id, c.cursor);
const fixes: Record<string, CaseDiagnostics> = process.env.DV_FIXES_FILE ? await Bun.file(process.env.DV_FIXES_FILE).json() : {};
const importFix = (titles: string[]) => titles.some((t) => /^(Add|Update) import from/.test(t));

/** The verifier's verdict on a state ("shadow" needs DV_FIXES_FILE), or null when undiagnosed. */
export const verdictOf = (c: CaseStates, s: State, diags: CaseDiagnostics) => {
  const after = diags.states[s.hash];
  if (!after) return null;
  const importable = (fixes[c.id]?.fixes ?? []).filter((f) => importFix(f.titles)).map((f) => toBuffer(c.buffer, f.diag));
  const check = { buffer: c.buffer, cursor: cursors.get(c.id), edits: diffEdits(c.buffer, s.after), before: diags.pre.map((d) => toBuffer(c.buffer, d)), after: after.map((d) => toBuffer(s.after, d)), importable };
  return { introduced: introducedErrors(check), shadowed: shadowedImports(check) };
};

export const introduced = (c: CaseStates, s: State, diags: CaseDiagnostics) => {
  const v = verdictOf(c, s, diags);
  return v && [...v.introduced, ...v.shadowed];
};

export const modelsOf = (s: State) => [...new Set(s.sources.map((x) => (x === "truth" ? "truth" : x.includes("zeta") ? "zeta" : "sweep")))];

if (import.meta.main) {
  const [statesFile = "", diagFile = ""] = process.argv.slice(2);
  const rows: CaseStates[] = await Bun.file(statesFile).json();
  const diags: Record<string, CaseDiagnostics> = await Bun.file(diagFile).json();
  const table = new Map<string, { n: number; caught: string[]; shadow: string[] }>();
  const detail: string[] = [];
  for (const c of rows) {
    const d = diags[c.id];
    if (!d || d.error) { console.error(`no diagnostics for ${c.id} ${d?.error ?? ""}`); continue; }
    for (const s of c.states) {
      const v = verdictOf(c, s, d);
      if (!v) continue;
      const found = [...v.introduced, ...v.shadowed];
      for (const model of modelsOf(s)) {
        const set = c.set === "test" ? "hardening-test" : c.set;
        const k = `${model}\t${set}\t${s.truth && model === "truth" ? "truth" : s.label}`;
        const row = table.get(k) ?? { n: 0, caught: [], shadow: [] };
        row.n++;
        if (v.introduced.length) row.caught.push(c.id);
        else if (v.shadowed.length) row.shadow.push(c.id);
        table.set(k, row);
      }
      if (found.length) detail.push(`${c.id}\t${s.hash}\t${s.truth ? "truth" : s.label}\t${modelsOf(s).join(",")}\t${found.map((f) => `${f.code}: ${f.message.split("\n")[0]}`).join(" | ").slice(0, 200)}`);
    }
  }
  console.log("model\tset\tlabel\tstates\tintroduce an error\tonly shadow an import\tcases");
  for (const [k, v] of [...table].sort()) console.log(`${k}\t${v.n}\t${v.caught.length}\t${v.shadow.length}\t${v.caught.join(" ")} | ${v.shadow.join(" ")}`);
  if (process.env.DV_DETAIL) console.log(detail.join("\n"));
}
