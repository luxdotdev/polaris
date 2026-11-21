import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { HarnessKind } from "./harnesses.ts";
import { PermissionMode } from "./domain.ts";
import { CommandAnnotation } from "./commandAnnotations.ts";
import { NotGranted } from "./extensions.ts";
import { NotFound, Unsupported } from "./errors.ts";

/** Annotate a setting at its Schema, the source for validation and discovery. */
export const setting = <S extends Schema.Top>(
  schema: S,
  metadata: {
    readonly description: string;
    readonly default: S["Type"];
    readonly userOnly?: boolean;
  }
): S["Rebuild"] => schema.annotate({ ...metadata, userOnly: metadata.userOnly ?? false });

export const SettingDescription = Schema.Struct({
  key: Schema.String,
  scope: Schema.optionalKey(Schema.Literals(["host", "client"])),
  userOnly: Schema.optionalKey(Schema.Boolean),
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
    userOnly: annotations?.userOnly === true,
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

const settingScope = Schema.optionalKey(Schema.Literals(["host", "client"]));

export const SettingsListInput = Schema.Struct({ scope: settingScope });

export const SettingsQueryInput = Schema.Struct({ key: Schema.String, scope: settingScope });

export const SettingsChangeInput = Schema.Struct({
  key: Schema.String,
  scope: settingScope,
  value: Schema.Json,
  ifUnset: Schema.optionalKey(Schema.Boolean),
});

export const SettingsRpcs = RpcGroup.make(
  Rpc.make("settings.list", {
    payload: SettingsListInput,
    success: Schema.Array(SettingValue),
    error: Schema.Union([SettingsError, NotFound, Unsupported, NotGranted]),
  }).annotate(CommandAnnotation, [
    {
      name: "settings.list",
      description: "List the settings across Host and Client scopes.",
      grant: "read",
      examples: ["polaris settings list --json"],
    },
  ]),
  Rpc.make("settings.describe", {
    payload: SettingsQueryInput,
    success: SettingDescription,
    error: Schema.Union([SettingsError, NotFound, Unsupported, NotGranted]),
  }).annotate(CommandAnnotation, [
    {
      name: "settings.describe",
      description: "Describe a setting across Host and Client scopes.",
      grant: "read",
      examples: ["polaris settings describe visuals.level"],
      positional: ["key"],
    },
  ]),
  Rpc.make("settings.get", {
    payload: SettingsQueryInput,
    success: SettingValue,
    error: Schema.Union([SettingsError, NotFound, Unsupported, NotGranted]),
  }).annotate(CommandAnnotation, [
    {
      name: "settings.get",
      description: "Read a setting across Host and Client scopes.",
      grant: "read",
      examples: ["polaris settings get visuals.level"],
      positional: ["key"],
    },
  ]),
  Rpc.make("settings.set", {
    payload: SettingsChangeInput,
    success: SettingValue,
    error: Schema.Union([SettingsError, NotFound, Unsupported, NotGranted]),
  }).annotate(CommandAnnotation, [
    {
      name: "settings.set",
      description: "Change a setting across Host and Client scopes.",
      grant: "client",
      examples: ['polaris settings set visuals.level "off"'],
      positional: ["key", "value"],
    },
  ])
);
