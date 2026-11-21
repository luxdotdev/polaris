import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { HarnessKind } from "./harnesses.ts";
import { PermissionMode } from "./domain.ts";
import { CommandAnnotation } from "./commandAnnotations.ts";
import { NotFound, Unsupported } from "./errors.ts";

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

const descriptions = new WeakMap<Schema.Top, Omit<SettingDescription, "key">>();

/** Fails discovery and the registry check if a setting has no description or valid default. */
export const describeSetting = (key: string, schema: Schema.Codec<unknown>): SettingDescription => {
  const cached = descriptions.get(schema);

  if (cached !== undefined) return { key, ...cached };
  const annotations = Schema.resolveAnnotations(schema);
  const description = Schema.decodeUnknownSync(Schema.NonEmptyString)(annotations?.description);
  const decoded = Schema.decodeUnknownSync(schema)(annotations?.default);
  const defaultValue = Schema.encodeSync(Schema.toCodecJson(schema))(decoded);

  const metadata = {
    description,
    type: Schema.decodeUnknownSync(Schema.Json)(Schema.toJsonSchemaDocument(schema)),
    default: defaultValue,
  };

  descriptions.set(schema, metadata);

  return { key, ...metadata };
};

export const HostSessionDefault = Schema.Struct({
  model: Schema.NullOr(Schema.String),
  effort: Schema.NullOr(Schema.String),
  permissionMode: PermissionMode,
});

export const HostSessionDefaults = Schema.Record(HarnessKind, HostSessionDefault);

export type HostSessionDefaults = typeof HostSessionDefaults.Type;

export class SettingsError extends Schema.TaggedError<SettingsError>()("SettingsError", {
  key: Schema.String,
  message: Schema.String,
}) {}

export const SettingsRpcs = RpcGroup.make(
  Rpc.make("settings.list", {
    payload: {},
    success: Schema.Array(SettingValue),
    error: Schema.Union([SettingsError, NotFound, Unsupported]),
  }).annotate(CommandAnnotation, [
    {
      name: "settings.list",
      description: "List the settings on this host.",
      grant: "read",
      examples: ["polaris settings list --json"],
    },
  ]),
  Rpc.make("settings.describe", {
    payload: { key: Schema.String },
    success: SettingDescription,
    error: Schema.Union([SettingsError, NotFound, Unsupported]),
  }).annotate(CommandAnnotation, [
    {
      name: "settings.describe",
      description: "Describe a setting on this host.",
      grant: "read",
      examples: ["polaris settings describe visuals.level"],
      positional: ["key"],
    },
  ]),
  Rpc.make("settings.get", {
    payload: { key: Schema.String },
    success: SettingValue,
    error: Schema.Union([SettingsError, NotFound, Unsupported]),
  }).annotate(CommandAnnotation, [
    {
      name: "settings.get",
      description: "Read a setting on this host.",
      grant: "read",
      examples: ["polaris settings get visuals.level"],
      positional: ["key"],
    },
  ]),
  Rpc.make("settings.set", {
    payload: {
      key: Schema.String,
      value: Schema.Json,
      ifUnset: Schema.optionalKey(Schema.Boolean),
    },
    success: SettingValue,
    error: Schema.Union([SettingsError, NotFound, Unsupported]),
  }).annotate(CommandAnnotation, [
    {
      name: "settings.set",
      description: "Change a setting on this host.",
      grant: "client",
      examples: ['polaris settings set visuals.level "off"'],
      positional: ["key", "value"],
    },
  ])
);
