import { PredictionEndpoint, PredictionEndpointUrl, PredictionFormat } from "@polaris/protocol";
import { Schema } from "effect";

export const PredictionPlacementChoice = Schema.Literals(["auto", "client", "host", "off"]);

export type PredictionPlacementChoice = typeof PredictionPlacementChoice.Type;

export const ConfiguredPredictionEndpoint = Schema.Struct({
  ...PredictionEndpoint.fields,
  url: PredictionEndpointUrl,
});

export const PredictionPreferences = Schema.Struct({
  placement: PredictionPlacementChoice,
  model: Schema.NullOr(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512))),
  format: Schema.NullOr(PredictionFormat),
  hostEndpoints: Schema.Array(ConfiguredPredictionEndpoint).check(Schema.isMaxLength(16)),
});

export type PredictionPreferences = typeof PredictionPreferences.Type;

export const DEFAULT_PREDICTION_PREFERENCES: PredictionPreferences = {
  placement: "auto",
  model: null,
  format: null,
  hostEndpoints: [],
};

export const PredictionClientEndpoints = Schema.Array(ConfiguredPredictionEndpoint).check(
  Schema.isMaxLength(16)
);

export type PredictionClientEndpoints = typeof PredictionClientEndpoints.Type;

export const PredictionPlacementInputs = {
  "prediction.clientEndpoints.get": Schema.Struct({}),
  "prediction.clientEndpoints.set": Schema.Struct({ endpoints: PredictionClientEndpoints }),
  "prediction.resources.get": Schema.Struct({}),
  "prediction.settings.get": Schema.Struct({ hostKey: Schema.String }),
  "prediction.settings.set": Schema.Struct({
    hostKey: Schema.String,
    preferences: PredictionPreferences,
  }),
} as const;

export interface PredictionPlacementOutputs {
  readonly "prediction.clientEndpoints.get": PredictionClientEndpoints;
  readonly "prediction.clientEndpoints.set": PredictionClientEndpoints;
  readonly "prediction.resources.get": { readonly rssBytes: number; readonly processes: number };
  readonly "prediction.settings.get": PredictionPreferences;
  readonly "prediction.settings.set": PredictionPreferences;
}
