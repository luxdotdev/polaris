/**
 * Language settings records (main's `LanguagePreferences`): read one scope, and
 * write it with the revision check, re-reading once when another writer won.
 */
import * as P from "@polaris/protocol";
import { Schema } from "effect";
import type { LanguageApi } from "../../../../shared/api.ts";
import { languageIpcError } from "../../../../shared/languageError.ts";

export type SettingsRecord = typeof P.LanguageSettingsRecord.Type;

export type SettingsScope = typeof P.LanguageSettingsScope.Type;

export const APP_SCOPE: SettingsScope = P.LanguageSettingsScope.cases.App.make({});

export const readRecord = async (
  api: LanguageApi,
  hostKey: string,
  scope: SettingsScope
): Promise<SettingsRecord> => {
  const reply = await api.request("languages.settings.get", { hostKey, scope });

  if (!reply.ok) throw languageIpcError(reply.error);

  return Schema.decodeUnknownSync(P.LanguageSettingsRecord)(reply.value);
};

const write = async (
  api: LanguageApi,
  hostKey: string,
  record: SettingsRecord,
  change: (settings: P.LanguageSettingsPatch) => P.LanguageSettingsPatch
) => {
  const reply = await api.request("languages.settings.set", {
    hostKey,
    scope: record.scope,
    expectedRevision: record.revision,
    settings: change(record.settings),
  });

  if (!reply.ok) throw languageIpcError(reply.error);

  return Schema.decodeUnknownSync(P.LanguageSettingsRecord)(reply.value);
};

/** Applies `change` to the latest record; a lost race re-reads and applies it once more. */
export const updateRecord = async (
  api: LanguageApi,
  hostKey: string,
  record: SettingsRecord,
  change: (settings: P.LanguageSettingsPatch) => P.LanguageSettingsPatch
): Promise<SettingsRecord> => {
  try {
    return await write(api, hostKey, record, change);
  } catch (error) {
    if (!(error instanceof P.LanguageError) || error.reason !== "conflict") throw error;

    return write(api, hostKey, await readRecord(api, hostKey, record.scope), change);
  }
};

/** Sets one key, or removes it when `value` is undefined. */
export const withKey =
  <K extends keyof P.LanguageSettingsPatch>(
    key: K,
    value: P.LanguageSettingsPatch[K] | undefined
  ) =>
  (settings: P.LanguageSettingsPatch): P.LanguageSettingsPatch => {
    const { [key]: _previous, ...rest } = settings;

    return value === undefined ? rest : { ...rest, [key]: value };
  };
