import { EditPredictionRequest, PredictedEdit } from "@polaris/protocol";
import { Schema } from "effect";
import cases from "./fixtures/hardening-cases.json";
import sweepDev from "./fixtures/hardening-dev.json";
import sweepDevLabels from "./fixtures/hardening-dev.labels.json";
import zetaDev from "./fixtures/hardening-zeta-dev.json";
import zetaDevLabels from "./fixtures/hardening-zeta-dev.labels.json";
import sweepTest from "./fixtures/hardening-test.json";
import sweepTestLabels from "./fixtures/hardening-test.labels.json";
import zetaTest from "./fixtures/hardening-zeta-test.json";
import zetaTestLabels from "./fixtures/hardening-zeta-test.labels.json";
import { request } from "./fixtures.testing.ts";

const Case = Schema.Struct({
  id: Schema.String,
  split: Schema.Literals(["dev", "test"]),
  category: Schema.String,
  path: Schema.String,
  buffer: Schema.String,
  cursor: Schema.Number,
  history: EditPredictionRequest.fields.history,
  expected: Schema.Array(PredictedEdit),
  allowed: Schema.Array(Schema.Array(PredictedEdit)),
});

const Output = Schema.Struct({
  id: Schema.String,
  output: Schema.String,
  elapsedMs: Schema.Number,
});

const Label = Schema.Struct({
  label: Schema.Literals(["exact", "acceptable", "wrong", "dangerous", "abstain"]),
  note: Schema.String,
  edits: Schema.optional(Schema.Array(PredictedEdit)),
});

export const hardeningCases = Schema.decodeUnknownSync(Schema.Array(Case))(cases);

const run = (
  format: EditPredictionRequest["format"],
  split: "dev" | "test",
  outputs: readonly (typeof Output.Type)[],
  labels: Readonly<Record<string, typeof Label.Type>>
) => ({
  format,
  split,
  outputs,
  labels,
});

const decodeOutputs = Schema.decodeUnknownSync(Schema.Array(Output));

const decodeLabels = Schema.decodeUnknownSync(Schema.Record(Schema.String, Label));

export const hardeningRuns = [
  run("sweep-next-edit", "dev", decodeOutputs(sweepDev), decodeLabels(sweepDevLabels)),
  run("zeta-2.1", "dev", decodeOutputs(zetaDev), decodeLabels(zetaDevLabels)),
  run("sweep-next-edit", "test", decodeOutputs(sweepTest), decodeLabels(sweepTestLabels)),
  run("zeta-2.1", "test", decodeOutputs(zetaTest), decodeLabels(zetaTestLabels)),
];

export const hardeningRequest = (
  fixture: typeof Case.Type,
  format: EditPredictionRequest["format"]
) =>
  EditPredictionRequest.make({
    ...request,
    path: fixture.path,
    buffer: fixture.buffer,
    cursor: fixture.cursor,
    history: fixture.history,
    format,
  });
