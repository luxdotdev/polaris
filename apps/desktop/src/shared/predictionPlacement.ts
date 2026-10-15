import {
  EditPredictionFormat,
  ManagedModelId,
  PredictionEndpoint,
  PredictionEndpointUrl,
  PredictionFormat,
} from "@polaris/protocol";
import { Effect, Schema } from "effect";

export const PredictionAggressiveness = Schema.Literals(["conservative", "balanced", "eager"]);

export type PredictionAggressiveness = typeof PredictionAggressiveness.Type;

/** Where a jump probe looks after an empty answer: nowhere, §4's rule, or the reach signals. */
export type JumpProbe = "off" | "spec" | "reach";

export const predictionRestraints = (aggressiveness: PredictionAggressiveness) => ({
  pauseMs: { conservative: 300, balanced: 150, eager: 75 }[aggressiveness],
  jumpsOffered: aggressiveness !== "conservative",
  jumpProbe: ({ conservative: "off", balanced: "spec", eager: "reach" } as const)[aggressiveness],
  largeDeletionsOffered: aggressiveness !== "conservative",
});

export const PREDICTION_ACCEPT_BINDING = "editor.prediction.accept" as const;

const LanguageId = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_+-]{0,63}$/));

const EditModel = Schema.String.check(
  Schema.isMaxLength(512),
  Schema.isPattern(/zeta[\W_]*2[._-]?1|sweep.*next[\W_]*edit/i)
);

export const PredictionPlacementChoice = Schema.Literals(["auto", "client", "host", "off"]);

export type PredictionPlacementChoice = typeof PredictionPlacementChoice.Type;

export const ConfiguredPredictionEndpoint = Schema.Struct({
  ...PredictionEndpoint.fields,
  url: PredictionEndpointUrl,
});

export const PredictionPreferences = Schema.Struct({
  placement: PredictionPlacementChoice,
  model: Schema.NullOr(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512))),
  format: Schema.NullOr(Schema.Union([PredictionFormat, EditPredictionFormat])),
  hostEndpoints: Schema.Array(ConfiguredPredictionEndpoint).check(Schema.isMaxLength(16)),
  display: Schema.Literals(["full", "subtle"]).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("full"))
  ),
  aggressiveness: PredictionAggressiveness.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("balanced"))
  ),
  acceptKey: Schema.Literal(PREDICTION_ACCEPT_BINDING).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(PREDICTION_ACCEPT_BINDING))
  ),
  disabledLanguages: Schema.Array(LanguageId)
    .check(Schema.isMaxLength(256))
    .pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  editModel: Schema.NullOr(EditModel).pipe(Schema.withDecodingDefaultKey(Effect.succeed(null))),
  /** Where this Host's managed model lives (ADR 0049); null is the Daemon's default folder. */
  modelsDir: Schema.NullOr(Schema.String.check(Schema.isMaxLength(4096))).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null))
  ),
  /** The managed model (ADR 0049): null is Sweep; "zeta-2.1" is the higher-quality opt-in. */
  managedModel: Schema.NullOr(ManagedModelId).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null))
  ),
});

export type PredictionPreferences = typeof PredictionPreferences.Type;

export const predictionPreferenceView = (preferences: PredictionPreferences) => ({
  ...preferences,
  restraints: predictionRestraints(preferences.aggressiveness),
});

export type PredictionPreferenceView = ReturnType<typeof predictionPreferenceView>;

export const DEFAULT_PREDICTION_PREFERENCES: PredictionPreferences = {
  placement: "auto",
  model: null,
  format: null,
  hostEndpoints: [],
  display: "full",
  aggressiveness: "balanced",
  acceptKey: PREDICTION_ACCEPT_BINDING,
  disabledLanguages: [],
  editModel: null,
  modelsDir: null,
  managedModel: null,
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
  readonly "prediction.resources.get": {
    readonly rssBytes: number;
    readonly processes: number;
    readonly servers: ReadonlyArray<{ readonly name: string; readonly rssBytes: number }>;
  };
  readonly "prediction.settings.get": PredictionPreferences &
    Partial<Pick<PredictionPreferenceView, "restraints">>;
  readonly "prediction.settings.set": PredictionPreferences &
    Partial<Pick<PredictionPreferenceView, "restraints">>;
}
