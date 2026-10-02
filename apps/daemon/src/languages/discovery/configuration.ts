import { createHash } from "node:crypto";
import {
  LanguageEffectiveSettings,
  LanguageSettingsScope,
  LanguageSettingsPatch,
  LanguageFormatterSelection,
} from "@polaris/protocol";
import type { HostId, WorkspaceId, LanguageSyntaxId } from "@polaris/protocol";
import { Schema } from "effect";

type Scope = typeof LanguageSettingsScope.Type;

export interface SettingsInput {
  scope: Scope;
  settings: LanguageSettingsPatch;
}

const rank = (scope: Scope) =>
  LanguageSettingsScope.match(scope, {
    App: () => 0,
    Language: () => 1,
    Host: () => 2,
    Workspace: ({ language }) => (language === null ? 3 : 4),
  });

export function effectiveSettings(
  target: { hostId: HostId; workspaceId: WorkspaceId; language: LanguageSyntaxId },
  records: readonly SettingsInput[],
  revision: number
) {
  const selected = records
    .filter(({ scope }) =>
      LanguageSettingsScope.match(scope, {
        App: () => true,
        Language: ({ language }) => language === target.language,
        Host: ({ hostId }) => hostId === target.hostId,
        Workspace: ({ hostId, workspaceId, language }) =>
          hostId === target.hostId &&
          workspaceId === target.workspaceId &&
          (language === null || language === target.language),
      })
    )
    .toSorted((a, b) => rank(a.scope) - rank(b.scope));

  const settings: LanguageSettingsPatch = {};
  const origins: Record<string, Scope> = {};

  for (const record of selected) {
    const patch = Schema.decodeUnknownSync(LanguageSettingsPatch)(record.settings);
    Object.assign(settings, patch);

    for (const key of Object.keys(patch)) origins[key] = record.scope;
  }

  return LanguageEffectiveSettings.make({
    revision,
    formatOnSave: settings.formatOnSave ?? true,
    formatter: settings.formatter ?? LanguageFormatterSelection.cases.None.make({}),
    providers: settings.providers ?? [],
    settings,
    origins,
  });
}

const stable = (value: typeof Schema.Json.Type): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;

  if (Schema.is(Schema.JsonObject)(value)) {
    return `{${Object.entries(value)
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value) ?? "null";
};

/** Only the digest is public: settings can contain private environment values. */
export const configurationFingerprint = (value: typeof Schema.Json.Type) =>
  createHash("sha256")
    .update(stable(Schema.decodeUnknownSync(Schema.Json)(JSON.parse(JSON.stringify(value)))))
    .digest("hex");
