import * as P from "@polaris/protocol";
import { Match } from "effect";
import { decodeLanguage, languageFailure } from "@polaris/client";
import type { Settings } from "../settings.ts";

const scopeKey = (scope: P.LanguageSettingsScope) => JSON.stringify(scope);

/** Whole-file synchronous commit is supplied by main, preserving other app preferences. */
export class LanguagePreferences {
  constructor(
    private readonly read: () => Settings,
    private readonly commit: (value: Settings) => void
  ) {}

  get(scope: P.LanguageSettingsScope): typeof P.LanguageSettingsRecord.Type {
    const valid = decodeLanguage(P.LanguageSettingsScope, scope);

    return (
      this.read().languageSettings?.find((record) => scopeKey(record.scope) === scopeKey(valid)) ??
      P.LanguageSettingsRecord.make({ scope: valid, revision: 0, settings: {} })
    );
  }

  set(scope: P.LanguageSettingsScope, expectedRevision: number, settings: P.LanguageSettingsPatch) {
    const input = decodeLanguage(P.SetLanguageSettings.payloadSchema, {
      scope,
      expectedRevision,
      settings,
    });

    const previous = this.get(input.scope);

    if (previous.revision !== input.expectedRevision) throw languageFailure("conflict");
    const records = this.read().languageSettings ?? [];

    const record = P.LanguageSettingsRecord.make({
      scope: input.scope,
      revision: previous.revision + 1,
      settings: input.settings,
    });

    if (
      records.length >= 4096 &&
      !records.some((value) => scopeKey(value.scope) === scopeKey(input.scope))
    )
      throw languageFailure("too-large");
    this.commit({
      ...this.read(),
      languageSettings: [
        ...records.filter((value) => scopeKey(value.scope) !== scopeKey(input.scope)),
        record,
      ],
    });

    return record;
  }

  effective(
    hostId: P.HostId,
    workspaceId: P.WorkspaceId,
    language: P.LanguageSyntaxId
  ): typeof P.LanguageEffectiveSettings.Type {
    const scopes = [
      P.LanguageSettingsScope.cases.App.make({}),
      P.LanguageSettingsScope.cases.Language.make({ language }),
      P.LanguageSettingsScope.cases.Host.make({ hostId }),
      P.LanguageSettingsScope.cases.Workspace.make({ hostId, workspaceId, language: null }),
      P.LanguageSettingsScope.cases.Workspace.make({ hostId, workspaceId, language }),
    ];

    const settings: P.LanguageSettingsPatch = {};
    const origins: Record<string, P.LanguageSettingsScope> = {};
    let revision = 0;

    for (const scope of scopes) {
      const record = this.get(scope);
      revision += record.revision;
      Object.assign(settings, record.settings);

      for (const key of Object.keys(record.settings)) origins[key] = scope;
    }

    return P.LanguageEffectiveSettings.make({
      revision,
      settings,
      origins,
      formatOnSave: settings.formatOnSave ?? true,
      formatter: settings.formatter ?? P.LanguageFormatterSelection.cases.None.make({}),
      providers: settings.providers ?? [],
    });
  }

  policy(hostId: P.HostId, workspaceId: P.WorkspaceId): P.LanguagePreviewPolicy {
    return (
      this.read().languagePreviewPolicies?.find(
        (p) => p.hostId === hostId && p.workspaceId === workspaceId
      ) ?? P.LanguagePreviewPolicy.make({ ...P.LANGUAGE_EDITOR_DEFAULTS, hostId, workspaceId })
    );
  }

  setPolicy(policy: P.LanguagePreviewPolicy): P.LanguagePreviewPolicy {
    const valid = decodeLanguage(P.LanguagePreviewPolicy, policy);
    const policies = this.read().languagePreviewPolicies ?? [];

    const retained = policies.filter(
      (p) => p.hostId !== valid.hostId || p.workspaceId !== valid.workspaceId
    );

    if (retained.length >= 4096) throw languageFailure("too-large");
    this.commit({ ...this.read(), languagePreviewPolicies: [...retained, valid] });

    return valid;
  }
}

export const settingsScopeHost = (scope: P.LanguageSettingsScope): P.HostId | null =>
  Match.value(scope).pipe(
    Match.tag("Host", (value) => value.hostId),
    Match.tag("Workspace", (value) => value.hostId),
    Match.orElse(() => null)
  );

export const scopeWorkspace = (scope: P.LanguageSettingsScope): P.WorkspaceId | null =>
  Match.value(scope).pipe(
    Match.tag("Workspace", (value) => value.workspaceId),
    Match.orElse(() => null)
  );
