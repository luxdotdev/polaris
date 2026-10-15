// Produce review material and scores; acquisition never invokes this automatically.
import { Schema } from "effect";
import { EditPredictionRequest, PredictedEdit } from "../../../../packages/protocol/src/index.ts";
import { request } from "../../../../packages/predict/src/edit/fixtures.testing.ts";
import { buildEditPrompt } from "../../../../packages/predict/src/edit/prompt.ts";
import { parseRegions } from "../../../../packages/predict/src/edit/parse.ts";
import { diffEdits } from "../../../../packages/predict/src/edit/diff.ts";
import { applyEdits } from "../../../../packages/predict/src/edit/guards.ts";
import { editResult } from "../../../../packages/predict/src/edit/result.ts";

const split = process.argv[2];
const format = process.argv[3] === "zeta-2.1" ? "zeta-2.1" : "sweep-next-edit";
const prefix = format === "zeta-2.1" ? "hardening-zeta" : "hardening";
if (!["dev", "test"].includes(split ?? "")) throw new Error("Pass dev or test");
const root = new URL("../../../../packages/predict/src/edit/fixtures/", import.meta.url);
const Case = Schema.Struct({ id: Schema.String, split: Schema.String, category: Schema.String,
  path: Schema.String, buffer: Schema.String, cursor: Schema.Number, history: EditPredictionRequest.fields.history,
  expected: Schema.Array(PredictedEdit), allowed: Schema.Array(Schema.Array(PredictedEdit)) });
const Output = Schema.Struct({ id: Schema.String, output: Schema.String, elapsedMs: Schema.Number });
const cases = Schema.decodeUnknownSync(Schema.Array(Case))(await Bun.file(new URL("hardening-cases.json", root)).json());
const outputs = Schema.decodeUnknownSync(Schema.Array(Output))(await Bun.file(new URL(`${prefix}-${split}.json`, root)).json());
const labelsFile = Bun.file(new URL(`${prefix}-${split}.labels.json`, root));
const Label = Schema.Struct({ label: Schema.Literals(["exact", "acceptable", "wrong", "dangerous", "abstain"]), note: Schema.String });
const labels = await labelsFile.exists() ? Schema.decodeUnknownSync(Schema.Record(Schema.String, Label))(await labelsFile.json()) : {};
const normalized = (s: string) => s.replace(/\s/g, "");
const rows = [];
for (const fixture of cases.filter((c) => c.split === split)) {
  const recorded = outputs.find((o) => o.id === fixture.id);
  if (!recorded) throw new Error(`Missing ${fixture.id}`);
  const input = EditPredictionRequest.make({ ...request, ...fixture, format });
  const built = buildEditPrompt(input);
  const parsed = parseRegions(input, built.window, recorded.output, built.stop);
  const after = applyEdits(input.buffer, parsed.regions);
  const rawEdits = diffEdits(input.buffer, after);
  const result = editResult(input, recorded.output);
  const auto = normalized(after) === normalized(input.buffer) ? "abstain" :
    fixture.allowed.some((p) => normalized(applyEdits(input.buffer, p)) === normalized(after)) ? "exact" : "unreviewed";
  const label = labels[fixture.id]?.label ?? auto;
  rows.push({ id: fixture.id, category: fixture.category, path: fixture.path, history: fixture.history,
    before: fixture.buffer, after, expected: applyEdits(input.buffer, fixture.expected), rawEdits,
    auto, label, guarded: result.edits.length ? label : "abstain", edits: result.edits, suppressed: result.suppressed,
    elapsedMs: recorded.elapsedMs });
}
console.log(JSON.stringify(rows));
