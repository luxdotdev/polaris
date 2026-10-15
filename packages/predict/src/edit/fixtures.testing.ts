import { EditPredictionRequest, PredictedEdit } from "@polaris/protocol";
import { Schema } from "effect";
import rename from "./fixtures/rename.json";
import refactor from "./fixtures/refactor.json";
import deadCode from "./fixtures/dead-code.json";
import imports from "./fixtures/import.json";
import insertion from "./fixtures/insertion.json";

const Fixture = Schema.Struct({
  id: Schema.String,
  category: Schema.String,
  path: Schema.String,
  buffer: Schema.String,
  cursor: Schema.Number,
  history: EditPredictionRequest.fields.history,
  expected: Schema.Array(PredictedEdit),
  allowed: Schema.Array(Schema.Array(PredictedEdit)),
  outputs: Schema.Array(
    Schema.Struct({
      format: EditPredictionRequest.fields.format,
      output: Schema.String,
      label: Schema.Literals(["exact", "acceptable", "wrong", "dangerous", "abstain"]),
    })
  ),
});

export const fixtures = Schema.decodeUnknownSync(Schema.Array(Fixture))([
  ...rename,
  ...refactor,
  ...deadCode,
  ...imports,
  ...insertion,
]);

export const request = EditPredictionRequest.make({
  buffer: "const value = 1;\n",
  cursor: 14,
  focus: null,
  history: [],
  context: [],
  path: "file.ts",
  model: "test",
  format: "zeta-2.1",
  maxTokens: 512,
  endpoint: { kind: "openai", url: "http://127.0.0.1:9999" },
});

export const fixtureRequest = (
  fixture: typeof Fixture.Type,
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
