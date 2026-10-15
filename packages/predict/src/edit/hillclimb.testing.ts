import { createHash } from "node:crypto";
import { EditPredictionRequest, PredictedEdit } from "@polaris/protocol";
import { Schema } from "effect";
import corpus from "./fixtures/hillclimb-corpus.json";
import devBase from "./fixtures/hillclimb-dev-base.json";
import devFinal from "./fixtures/hillclimb-dev-a10b20.json";
import freshBase from "./fixtures/hillclimb-fresh-base.json";
import freshFinal from "./fixtures/hillclimb-fresh-final.json";
import fresh from "./fixtures/fresh-cases.json";
import labels from "./fixtures/hillclimb-labels.json";
import { request } from "./fixtures.testing.ts";
import { hardeningCases } from "./hardening.testing.ts";

const Verdict = Schema.Literals(["exact", "acceptable", "wrong", "dangerous", "abstain"]);

const Recorded = Schema.Struct({
  id: Schema.String,
  output: Schema.NullOr(Schema.String),
  label: Verdict,
});

const Labelled = Schema.Struct({
  id: Schema.String,
  format: Schema.Literals(["zeta-2.1", "sweep-next-edit"]),
  label: Verdict,
  edits: Schema.Array(PredictedEdit),
});

/** Rubric labels of reviewed buffer states, by case and `stateHash`. */
export const hillclimbLabels = Schema.decodeUnknownSync(
  Schema.Record(Schema.String, Schema.Record(Schema.String, Verdict))
)(labels);

/** Every hand-labelled buffer state the hill-climb produced, from any run. */
export const hillclimbCorpus = Schema.decodeUnknownSync(Schema.Array(Labelled))(corpus);

const decodeRun = Schema.decodeUnknownSync(Schema.Array(Recorded));

/** Live Sweep runs of the spike layout and the hill-climbed one: 100 dev cases, 56 held out. */
export const hillclimbRuns = {
  dev: { base: decodeRun(devBase), final: decodeRun(devFinal) },
  fresh: { base: decodeRun(freshBase), final: decodeRun(freshFinal) },
};

const FreshCase = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  buffer: Schema.String,
  cursor: Schema.Number,
  history: EditPredictionRequest.fields.history,
  allowed: Schema.Array(Schema.Array(PredictedEdit)),
});

const cases = [...hardeningCases, ...Schema.decodeUnknownSync(Schema.Array(FreshCase))(fresh)];

export const stateHash = (buffer: string) =>
  createHash("sha256").update(buffer.replace(/\s/g, "")).digest("hex").slice(0, 16);

export const hillclimbCase = (id: string) => {
  const found = cases.find((fixture) => fixture.id === id);

  if (!found) throw new Error(`No hill-climb case ${id}`);

  return found;
};

export const hillclimbRequest = (id: string, format: EditPredictionRequest["format"]) => {
  const fixture = hillclimbCase(id);

  return EditPredictionRequest.make({
    ...request,
    path: fixture.path,
    buffer: fixture.buffer,
    cursor: fixture.cursor,
    history: fixture.history,
    format,
  });
};
