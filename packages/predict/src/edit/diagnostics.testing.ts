import { EditPredictionRequest, PredictedEdit } from "@polaris/protocol";
import { Schema } from "effect";
import measured from "./fixtures/diagnostics.json";
import fresh from "./fixtures/fresh-cases.json";
import fresh2 from "./fixtures/fresh2-cases.json";
import { hardeningCases } from "./hardening.testing.ts";
import type { DiagnosticsCheck } from "./diagnostics.ts";

const Diagnostic = Schema.Struct({
  from: Schema.Number,
  to: Schema.Number,
  severity: Schema.Literals(["error", "warning", "information", "hint"]),
  code: Schema.String,
  message: Schema.String,
});

const Measured = Schema.Struct({
  cases: Schema.Record(
    Schema.String,
    Schema.Struct({
      set: Schema.String,
      before: Schema.Array(Diagnostic),
      importable: Schema.Array(Diagnostic),
    })
  ),
  states: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      models: Schema.Array(Schema.String),
      label: Schema.Literals(["exact", "acceptable", "wrong", "dangerous"]),
      edits: Schema.Array(PredictedEdit),
      after: Schema.Array(Diagnostic),
    })
  ),
});

const FreshCase = Schema.Struct({
  id: Schema.String,
  buffer: Schema.String,
  cursor: Schema.Number,
  history: EditPredictionRequest.fields.history,
});

const buffers = new Map(
  [
    ...hardeningCases,
    ...Schema.decodeUnknownSync(Schema.Array(FreshCase))([...fresh, ...fresh2]),
  ].map((fixture) => [fixture.id, fixture])
);

const decoded = Schema.decodeUnknownSync(Measured)(measured);

/**
 * Every labelled buffer state of the recorded runs (Sweep, Zeta and the ground truths), with the
 * TypeScript server's errors before and after, measured on each case's commit (2026-10-15).
 */
export const measuredStates = decoded.states.map((state) => {
  const fixture = buffers.get(state.id);
  const diagnostics = decoded.cases[state.id];

  if (!fixture || !diagnostics) throw new Error(`No diagnostics case ${state.id}`);

  const check: DiagnosticsCheck = {
    buffer: fixture.buffer,
    cursor: fixture.cursor,
    edits: state.edits,
    before: diagnostics.before,
    after: state.after,
    importable: diagnostics.importable,
  };

  return { ...state, set: diagnostics.set, check };
});
