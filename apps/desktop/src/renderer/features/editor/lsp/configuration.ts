import * as P from "@polaris/protocol";
import { Schema } from "effect";
import type { LanguageApi } from "../../../../shared/api.ts";
import { languageFor, type LanguageId } from "../model/language.ts";

/** Bounded glob matching, with no regex construction from Settings. */
export const matchesAssociation = (pattern: string, path: string): boolean => {
  if (pattern.length > 4096 || path.length > 4096) return false;
  const parts = pattern.split("*");
  let offset = 0;

  for (let index = 0; index < parts.length; index++) {
    const part = parts[index] ?? "";
    const found = path.indexOf(part, offset);

    if (found < 0 || (index === 0 && found !== 0)) return false;
    offset = found + part.length;
  }

  return pattern.endsWith("*") || offset === path.length;
};

export const associatedLanguage = (
  path: string,
  associations: readonly (typeof P.LanguageAssociation.Type)[],
  fallback: LanguageId
): LanguageId => {
  const name = path.split("/").pop() ?? path;
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  let selected = fallback;

  for (const association of associations) {
    if (
      association.filenames?.includes(name) ||
      association.extensions?.includes(extension) ||
      association.patterns?.some((pattern) =>
        matchesAssociation(pattern, pattern.includes("/") ? path : name)
      )
    )
      selected = association.language;
  }

  return selected;
};

interface SettingsInput {
  readonly hostKey: string;
  readonly hostId: P.HostId;
  readonly workspaceId: P.WorkspaceId;
  readonly path: string;
  readonly firstLine?: string;
  readonly manual: LanguageId | null;
  readonly signal: AbortSignal;
}

const effective = async (api: LanguageApi, input: SettingsInput, language: LanguageId) => {
  const scopes = [
    P.LanguageSettingsScope.cases.App.make({}),
    P.LanguageSettingsScope.cases.Language.make({ language }),
    P.LanguageSettingsScope.cases.Host.make({ hostId: input.hostId }),
    P.LanguageSettingsScope.cases.Workspace.make({
      hostId: input.hostId,
      workspaceId: input.workspaceId,
      language: null,
    }),
    P.LanguageSettingsScope.cases.Workspace.make({
      hostId: input.hostId,
      workspaceId: input.workspaceId,
      language,
    }),
  ];

  const records = await Promise.all(
    scopes.map(async (scope) => {
      const reply = await api.request("languages.settings.get", { hostKey: input.hostKey, scope });

      if (!reply.ok) throw new Error(reply.error.message);
      const record = Schema.decodeUnknownSync(P.LanguageSettingsRecord)(reply.value);

      if (input.signal.aborted || JSON.stringify(record.scope) !== JSON.stringify(scope))
        throw new Error("Language Settings changed.");

      return record;
    })
  );

  const settings: P.LanguageSettingsPatch = {};
  const origins: Record<string, P.LanguageSettingsScope> = {};

  for (const record of records) {
    Object.assign(settings, record.settings);

    for (const key of Object.keys(record.settings)) origins[key] = record.scope;
  }

  return P.LanguageEffectiveSettings.make({
    revision: Math.max(...records.map((record) => record.revision)),
    formatOnSave: settings.formatOnSave ?? true,
    formatter: settings.formatter ?? P.LanguageFormatterSelection.cases.None.make({}),
    providers: [...new Set(settings.providers ?? [])],
    settings,
    origins,
  });
};

/** Manual selection is per buffer; persistent association ownership remains Settings. */
export const readLanguageConfiguration = async (api: LanguageApi, input: SettingsInput) => {
  const detected = input.manual ?? languageFor(input.path, input.firstLine);
  let settings = await effective(api, input, detected);

  const language =
    input.manual ?? associatedLanguage(input.path, settings.settings.associations ?? [], detected);

  if (language !== detected) settings = await effective(api, input, language);

  return { language, settings };
};
