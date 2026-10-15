import {
  EditPredictionItem,
  EditPredictionRequest,
  EditPredictionFormat,
  PredictionFormat,
  PredictionCapability,
  PredictionContextRequest,
  PredictionEndpoint,
  PredictionServerRequest,
  PredictionStreamItem,
  type PredictionServerReport,
} from "@polaris/protocol";
import { Schema } from "effect";

export const PredictionEnabled = Schema.Struct({
  enabled: Schema.Boolean,
  configured: Schema.Boolean,
});

export type PredictionEnabled = typeof PredictionEnabled.Type;

export const PredictionInspection = Schema.Struct({
  clientLabel: Schema.String,
  hostLabel: Schema.String,
  client: PredictionCapability,
  host: Schema.NullOr(PredictionCapability),
  offer: Schema.Boolean,
});

export type PredictionInspection = typeof PredictionInspection.Type;

export const PredictionContextSummary = Schema.Struct({
  pieces: Schema.Number,
  /** Definitions and diagnostics: present only once the Workspace is trusted. */
  languageServer: Schema.Number,
  tokens: Schema.Number,
});

export type PredictionContextSummary = typeof PredictionContextSummary.Type;

export const PredictionFeedItem = Schema.TaggedUnion({
  Reset: {},
  Delta: PredictionStreamItem.cases.Delta.fields,
  Final: {
    text: Schema.String,
    elapsedMs: Schema.Number,
    model: Schema.String,
    machine: Schema.String,
    timings: Schema.optional(Schema.Record(Schema.String, Schema.Number)),
    /** Where it ran, for the status card: which side and endpoint answered. */
    side: Schema.optional(Schema.Literals(["client", "host"])),
    endpoint: Schema.optional(PredictionEndpoint),
    /** Round trips through placement on that side and endpoint, this one included. */
    latency: Schema.optional(
      Schema.NullOr(
        Schema.Struct({ p50: Schema.Number, last: Schema.Number, count: Schema.Number })
      )
    ),
    /** What the Host sent as context; null when it can't send any. */
    context: Schema.optional(Schema.NullOr(PredictionContextSummary)),
  },
});

export type PredictionFeedItem = typeof PredictionFeedItem.Type;

export const PredictionCompletionInput = Schema.Struct({
  hostKey: Schema.String,
  dispatchedAt: Schema.optional(Schema.Number),
  ...PredictionContextRequest.fields,
});

export type PredictionCompletionInput = typeof PredictionCompletionInput.Type;

export const EditPredictionInput = Schema.Struct({
  ...PredictionCompletionInput.fields,
  focus: EditPredictionRequest.fields.focus,
  history: EditPredictionRequest.fields.history,
});

export type EditPredictionInput = typeof EditPredictionInput.Type;

export const EditPredictionFeedItem = Schema.TaggedUnion({
  Final: {
    ...EditPredictionItem.cases.Final.fields,
    model: Schema.String,
    format: EditPredictionFormat,
    side: Schema.Literals(["client", "host"]),
    machine: Schema.String,
    endpoint: PredictionEndpoint,
    timings: Schema.Record(Schema.String, Schema.Number),
    context: Schema.NullOr(PredictionContextSummary),
    latency: Schema.NullOr(
      Schema.Struct({ p50: Schema.Number, last: Schema.Number, count: Schema.Number })
    ),
  },
});

export type EditPredictionFeedItem = typeof EditPredictionFeedItem.Type;

export const PredictionWorkspaceTarget = Schema.Struct({
  editAvailable: Schema.Boolean,
  target: Schema.NullOr(
    Schema.Struct({
      side: Schema.Literals(["client", "host"]),
      model: Schema.String,
      format: Schema.Union([PredictionFormat, EditPredictionFormat]),
      endpoint: PredictionEndpoint,
    })
  ),
});

export type PredictionWorkspaceTarget = typeof PredictionWorkspaceTarget.Type;

export const PredictionUiInputs = {
  "prediction.target": Schema.Struct({ hostKey: Schema.String, workspaceId: Schema.String }),
  "prediction.enabled.get": Schema.Struct({}),
  "prediction.enabled.set": Schema.Struct({ enabled: Schema.Boolean }),
  "prediction.inspect": Schema.Struct({ hostKey: Schema.String }),
  "prediction.release": Schema.Struct({ hostKey: Schema.String, workspaceId: Schema.String }),
  "prediction.discoveryShown": Schema.Struct({}),
  "prediction.server": Schema.Struct({
    hostKey: Schema.String,
    side: Schema.Literals(["client", "host"]),
    ...PredictionServerRequest.fields,
  }),
} as const;

export interface PredictionUiOutputs {
  readonly "prediction.target": PredictionWorkspaceTarget;
  readonly "prediction.enabled.get": PredictionEnabled;
  readonly "prediction.enabled.set": PredictionEnabled;
  readonly "prediction.inspect": PredictionInspection;
  readonly "prediction.release": null;
  readonly "prediction.discoveryShown": null;
  readonly "prediction.server": PredictionServerReport;
}
