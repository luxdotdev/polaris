// dv-fixtures.ts <states.json> <diag.json> <fixes.json>: freezes packages/predict's diagnostics-verifier
// fixture: each case's measured errors and importable errors, and every labelled state's edits and errors.
import { diffEdits } from "../../../../packages/predict/src/edit/diff.ts";
import type { Diag } from "./dv-lsp.ts";
import type { CaseStates } from "./dv-states.ts";
import type { CaseDiagnostics } from "./dv-diagnose.ts";
import { modelsOf, toBuffer } from "./dv-score.ts";

const [statesFile = "", diagFile = "", fixesFile = ""] = process.argv.slice(2);
const rows: CaseStates[] = await Bun.file(statesFile).json();
const diags: Record<string, CaseDiagnostics> = await Bun.file(diagFile).json();
const fixes: Record<string, CaseDiagnostics> = await Bun.file(fixesFile).json();
const errors = (text: string, ds: Diag[]) => ds.filter((d) => d.severity === 1).map((d) => toBuffer(text, d));
const cases: Record<string, unknown> = {};
const states = [];
for (const c of rows) {
  const d = diags[c.id];
  if (!d || d.error) continue;
  const importable = (fixes[c.id]?.fixes ?? []).filter((f) => f.titles.some((t) => /^(Add|Update) import from/.test(t))).map((f) => toBuffer(c.buffer, f.diag));
  cases[c.id] = { set: c.set, before: errors(c.buffer, d.pre), importable };
  for (const s of c.states) {
    if (s.label === "unlabelled" || !d.states[s.hash]) continue;
    states.push({ id: c.id, models: modelsOf(s), label: s.label, edits: diffEdits(c.buffer, s.after), after: errors(s.after, d.states[s.hash]!) });
  }
}
const out = new URL("../../../../packages/predict/src/edit/fixtures/diagnostics.json", import.meta.url);
await Bun.write(out, JSON.stringify({ cases, states }) + "\n");
console.log(`Froze ${Object.keys(cases).length} cases and ${states.length} labelled states`);
