/** Device-local settings relayed to a connected Client (ADR 0120). */
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { NotGranted } from "./extensions.ts";
import { SessionId } from "./ids.ts";
import { SettingDescription, SettingValue } from "./settings.ts";

export class ClientSettingsError extends Schema.TaggedError<ClientSettingsError>()(
  "ClientSettingsError",
  { message: Schema.String }
) {}

export const ClientSettingsSnapshot = Schema.Struct({
  settings: Schema.Array(SettingValue).check(Schema.isMaxLength(256)),
  sessionId: Schema.NullOr(SessionId),
  active: Schema.Boolean,
});

export type ClientSettingsSnapshot = typeof ClientSettingsSnapshot.Type;

export const ClientSettingChange = Schema.Struct({
  requestId: Schema.String,
  key: Schema.String,
  value: Schema.Json,
});

export type ClientSettingChange = typeof ClientSettingChange.Type;

const target = { sessionId: Schema.optionalKey(SessionId) };

export class ClientSettingsRpcs extends RpcGroup.make(
  Rpc.make("clientSettings.list", {
    payload: target,
    success: Schema.Array(SettingValue),
    error: ClientSettingsError,
  }),
  Rpc.make("clientSettings.describe", {
    payload: { ...target, key: Schema.String },
    success: SettingDescription,
    error: ClientSettingsError,
  }),
  Rpc.make("clientSettings.get", {
    payload: { ...target, key: Schema.String },
    success: SettingValue,
    error: ClientSettingsError,
  }),
  Rpc.make("clientSettings.set", {
    payload: { ...target, key: Schema.String, value: Schema.Json },
    success: SettingValue,
    error: Schema.Union([ClientSettingsError, NotGranted]),
  }),
  Rpc.make("clientSettings.connect", {
    payload: ClientSettingsSnapshot,
    success: Schema.NullOr(ClientSettingChange),
    stream: true,
    error: ClientSettingsError,
  }),
  Rpc.make("clientSettings.publish", {
    payload: ClientSettingsSnapshot,
    error: ClientSettingsError,
  }),
  Rpc.make("clientSettings.complete", {
    payload: {
      requestId: Schema.String,
      error: Schema.NullOr(Schema.String),
      settings: Schema.Array(SettingValue),
    },
    error: ClientSettingsError,
  })
) {}
