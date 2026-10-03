import * as P from "@polaris/protocol";
import { Match, Schema } from "effect";
import type { LanguageApi } from "../../../../shared/api.ts";

export const sameScope = Schema.toEquivalence(P.LanguageSettingsScope);

export const preferenceScopes = (scope: P.LanguageSettingsScope, language: P.LanguageSyntaxId) => {
  const app = P.LanguageSettingsScope.cases.App.make({});
  const defaults = P.LanguageSettingsScope.cases.Language.make({ language });

  return Match.value(scope).pipe(
    Match.tag("App", () => [app]),
    Match.tag("Language", () => [app, scope]),
    Match.tag("Host", () => [app, defaults, scope]),
    Match.tag("Workspace", (value) => [
      app,
      defaults,
      P.LanguageSettingsScope.cases.Host.make({ hostId: value.hostId }),
      P.LanguageSettingsScope.cases.Workspace.make({ ...value, language: null }),
      ...(value.language === null ? [] : [scope]),
    ]),
    Match.exhaustive
  );
};

export const effectivePreferences = (
  records: ReadonlyArray<typeof P.LanguageSettingsRecord.Type>
) => {
  const settings: P.LanguageSettingsPatch = {};
  const origins: Record<string, P.LanguageSettingsScope> = {};
  let revision = 0;

  for (const record of records) {
    Object.assign(settings, record.settings);
    revision += record.revision;

    for (const key of Object.keys(record.settings)) origins[key] = record.scope;
  }

  return P.LanguageEffectiveSettings.make({
    revision,
    settings,
    origins,
    providers: settings.providers ?? [],
    formatter: settings.formatter ?? P.LanguageFormatterSelection.cases.None.make({}),
    formatOnSave: settings.formatOnSave ?? true,
  });
};

export const readPreferences = async (
  api: LanguageApi,
  hostKeyFor: (scope: P.LanguageSettingsScope) => string,
  scope: P.LanguageSettingsScope,
  effectiveScope: P.LanguageSettingsScope,
  language: P.LanguageSyntaxId,
  signal: AbortSignal
) => {
  const read = async (requested: P.LanguageSettingsScope) => {
    signal.throwIfAborted();

    const result = await api.request("languages.settings.get", {
      hostKey: hostKeyFor(requested),
      scope: requested,
    });

    signal.throwIfAborted();

    if (!result.ok) throw new Error("Couldn't read saved language settings");

    const record = Schema.decodeUnknownSync(P.LanguageSettingsRecord)(result.value);

    if (!sameScope(record.scope, requested)) throw new Error("Settings scope mismatch");

    return record;
  };

  const record = await read(scope);
  const records = [];

  for (const requested of preferenceScopes(effectiveScope, language)) {
    records.push(sameScope(requested, scope) ? record : await read(requested));
  }

  return { record, effective: effectivePreferences(records) };
};
