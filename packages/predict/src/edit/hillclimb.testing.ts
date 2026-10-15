import { createHash } from "node:crypto";
import { EditPredictionRequest, PredictedEdit } from "@polaris/protocol";
import { Schema } from "effect";
import corpus from "./fixtures/hillclimb-corpus.json";
import devBase from "./fixtures/hillclimb-dev-base.json";
import devFinal from "./fixtures/hillclimb-dev-a10b20.json";
import labels from "./fixtures/hillclimb-labels.json";
import { hardeningCases, hardeningRequest } from "./hardening.testing.ts";

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

/** Live Sweep runs over the 100 dev cases: the spike layout and the hill-climbed one. */
export const hillclimbRuns = { base: decodeRun(devBase), final: decodeRun(devFinal) };

export const stateHash = (buffer: string) =>
  createHash("sha256").update(buffer.replace(/\s/g, "")).digest("hex").slice(0, 16);

export const devCase = (id: string) => {
  const found = hardeningCases.find((fixture) => fixture.id === id);

  if (!found) throw new Error(`No dev case ${id}`);

  return found;
};

export const devRequest = (id: string, format: EditPredictionRequest["format"]) =>
  hardeningRequest(devCase(id), format);
