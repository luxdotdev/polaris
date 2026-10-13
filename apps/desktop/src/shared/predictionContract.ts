import {
  PredictionCapability,
  PredictionContextRequest,
  PredictionStreamItem,
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

export const PredictionFeedItem = Schema.TaggedUnion({
  Reset: {},
  Delta: PredictionStreamItem.cases.Delta.fields,
  Final: {
    text: Schema.String,
    elapsedMs: Schema.Number,
    model: Schema.String,
    machine: Schema.String,
    timings: Schema.optional(Schema.Record(Schema.String, Schema.Number)),
  },
});

export type PredictionFeedItem = typeof PredictionFeedItem.Type;

export const PredictionCompletionInput = Schema.Struct({
  hostKey: Schema.String,
  dispatchedAt: Schema.optional(Schema.Number),
  ...PredictionContextRequest.fields,
});

export type PredictionCompletionInput = typeof PredictionCompletionInput.Type;

export const PredictionUiInputs = {
  "prediction.enabled.get": Schema.Struct({}),
  "prediction.enabled.set": Schema.Struct({ enabled: Schema.Boolean }),
  "prediction.inspect": Schema.Struct({ hostKey: Schema.String }),
  "prediction.release": Schema.Struct({ hostKey: Schema.String, workspaceId: Schema.String }),
  "prediction.discoveryShown": Schema.Struct({}),
} as const;

export interface PredictionUiOutputs {
  readonly "prediction.enabled.get": PredictionEnabled;
  readonly "prediction.enabled.set": PredictionEnabled;
  readonly "prediction.inspect": PredictionInspection;
  readonly "prediction.release": null;
  readonly "prediction.discoveryShown": null;
}
