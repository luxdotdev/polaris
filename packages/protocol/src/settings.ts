import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { PermissionMode } from "./domain.ts";

/** Annotate a setting at its Schema, the source for validation and discovery. */
export const setting = <S extends Schema.Top>(
  schema: S,
  metadata: { readonly description: string; readonly default: S["Type"] }
): S["Rebuild"] => schema.annotate(metadata);

export const SettingDescription = Schema.Struct({
  key: Schema.String,
  description: Schema.String,
  /** JSON Schema document, including refinements, allowed values and definitions. */
  type: Schema.Json,
  default: Schema.Json,
});

export type SettingDescription = typeof SettingDescription.Type;

export const SettingValue = Schema.Struct({
  ...SettingDescription.fields,
  value: Schema.Json,
  overridden: Schema.Boolean,
});

export type SettingValue = typeof SettingValue.Type;

/** Fails discovery and the registry check if a setting has no description or default. */
export const describeSetting = (key: string, schema: Schema.Top): SettingDescription => {
  const annotations = Schema.resolveAnnotations(schema);
  const description = Schema.decodeUnknownSync(Schema.NonEmptyString)(annotations?.description);
  const defaultValue = Schema.decodeUnknownSync(Schema.Json)(annotations?.default);

  return {
    key,
    description,
    type: Schema.decodeUnknownSync(Schema.Json)(Schema.toJsonSchemaDocument(schema)),
    default: defaultValue,
  };
};

export const HostSessionDefault = Schema.Struct({
  model: Schema.NullOr(Schema.String),
  effort: Schema.NullOr(Schema.String),
  permissionMode: PermissionMode,
});

export const HostSessionDefaults = Schema.Record(Schema.String, HostSessionDefault);

export type HostSessionDefaults = typeof HostSessionDefaults.Type;

export class SettingsError extends Schema.TaggedError<SettingsError>()("SettingsError", {
  key: Schema.String,
  message: Schema.String,
}) {}

// TODO(S3): annotate these RPCs as commands once Task A's annotation is integrated.
export const SettingsRpcs = RpcGroup.make(
  Rpc.make("settings.list", {
    payload: {},
    success: Schema.Array(SettingValue),
    error: SettingsError,
  }),
  Rpc.make("settings.describe", {
    payload: { key: Schema.String },
    success: SettingDescription,
    error: SettingsError,
  }),
  Rpc.make("settings.get", {
    payload: { key: Schema.String },
    success: SettingValue,
    error: SettingsError,
  }),
  Rpc.make("settings.set", {
    payload: {
      key: Schema.String,
      value: Schema.Json,
      ifUnset: Schema.optionalKey(Schema.Boolean),
    },
    success: SettingValue,
    error: SettingsError,
  })
);
