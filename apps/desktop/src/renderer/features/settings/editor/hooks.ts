/** Reads and writes for Settings → Editor; each hook owns its lifetime and ignores late replies. */
import * as P from "@polaris/protocol";
import { Schema } from "effect";
import { useCallback, useEffect, useState } from "react";
import type { LanguageApi } from "../../../../shared/api.ts";
import { languageIpcError } from "../../../../shared/languageError.ts";
import { LanguageSubscriptionItems } from "../../../../shared/languages.ts";
import { toolIdsOf } from "./model.ts";
import { readRecord, updateRecord, type SettingsRecord, type SettingsScope } from "./records.ts";

type Change = (settings: P.LanguageSettingsPatch) => P.LanguageSettingsPatch;

export type Committed = (scope: SettingsScope) => void;

/** One scope's record, with an update that keeps the revision check; pass a stable `scope`. */
export const useRecord = (
  api: LanguageApi | undefined,
  hostKey: string | null,
  scope: SettingsScope | null,
  committed: Committed
) => {
  const [record, setRecord] = useState<SettingsRecord | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setRecord(null);
    setFailed(false);

    if (!api || hostKey === null || scope === null) return;
    let live = true;

    readRecord(api, hostKey, scope).then(
      (value) => live && setRecord(value),
      () => live && setFailed(true)
    );

    return () => {
      live = false;
    };
  }, [api, hostKey, scope]);

  const update = useCallback(
    async (change: Change) => {
      if (!api || hostKey === null || record === null) return;

      try {
        const next = await updateRecord(api, hostKey, record, change);
        setRecord(next);
        setFailed(false);
        committed(next.scope);
      } catch {
        setFailed(true);
      }
    },
    [api, hostKey, record, committed]
  );

  return { record, failed, update };
};

/** Language-scope records for every row's languages (a stable array), so switches show what's stored. */
export const useLanguageRecords = (
  api: LanguageApi | undefined,
  hostKey: string | null,
  languages: ReadonlyArray<P.LanguageSyntaxId>,
  committed: Committed
) => {
  const [records, setRecords] = useState<Partial<Record<P.LanguageSyntaxId, SettingsRecord>>>({});

  useEffect(() => {
    if (!api || hostKey === null) return;
    let live = true;

    void Promise.all(
      languages.map((language) =>
        readRecord(api, hostKey, P.LanguageSettingsScope.cases.Language.make({ language }))
      )
    ).then(
      (values) => live && setRecords(Object.fromEntries(values.map((v) => [scopeLanguage(v), v]))),
      () => undefined
    );

    return () => {
      live = false;
    };
  }, [api, hostKey, languages]);

  const toggle = useCallback(
    async (ids: ReadonlyArray<P.LanguageSyntaxId>, on: boolean) => {
      if (!api || hostKey === null) return;

      const change: Change = (settings) => {
        const { providers: _providers, ...rest } = settings;

        return on ? rest : { ...rest, providers: [] };
      };

      const written = await Promise.all(
        ids.map(async (language) => {
          const scope = P.LanguageSettingsScope.cases.Language.make({ language });
          const current = records[language] ?? (await readRecord(api, hostKey, scope));

          return updateRecord(api, hostKey, current, change);
        })
      );

      setRecords((previous) => ({
        ...previous,
        ...Object.fromEntries(written.map((v) => [scopeLanguage(v), v])),
      }));
      written.forEach((v) => committed(v.scope));
    },
    [api, hostKey, records, committed]
  );

  return { records, toggle };
};

const scopeLanguage = (record: SettingsRecord) =>
  P.LanguageSettingsScope.match(record.scope, {
    App: () => "app",
    Language: (scope) => scope.language,
    Host: () => "host",
    Workspace: () => "workspace",
  });

export interface HostLanguages {
  readonly catalog: P.LanguageCatalog | null;
  readonly availability: ReadonlyArray<P.LanguageAvailability>;
  readonly failed: boolean;
}

const EMPTY: HostLanguages = { catalog: null, availability: [], failed: false };

const merge = (
  previous: ReadonlyArray<P.LanguageAvailability>,
  updates: ReadonlyArray<P.LanguageAvailability>
) => {
  const byTool = new Map(previous.map((a) => [a.toolId, a]));

  for (const update of updates) byTool.set(update.toolId, update);

  return [...byTool.values()];
};

/** The picked Host's catalog and availability, kept current by its availability feed. */
export const useHostLanguages = (
  api: LanguageApi | undefined,
  hostKey: string | null
): HostLanguages => {
  const [state, setState] = useState<HostLanguages>(EMPTY);

  useEffect(() => {
    setState(EMPTY);

    if (!api || hostKey === null) return;
    let live = true;
    let unsubscribe = () => {};

    const merged = (facts: readonly P.LanguageAvailability[]) => {
      if (live) setState((s) => ({ ...s, availability: merge(s.availability, facts) }));
    };

    // Rows show from the catalog at once; each tool's facts fill in as its probe answers.
    const factsOf = async (toolId: string) => {
      const answer = await api.request("languages.availability", {
        hostKey,
        toolIds: [toolId],
        checkout: null,
        refresh: false,
        phase: "install",
      });

      if (!answer.ok) return null;
      merged(Schema.decodeUnknownSync(Schema.Array(P.LanguageAvailability))(answer.value));

      return toolId;
    };

    const watch = (toolIds: readonly string[]) => {
      if (!live || toolIds.length === 0) return;
      unsubscribe = api.subscribe(
        "languages.availability.watch",
        { hostKey, toolIds, checkout: null },
        {
          items: (items) =>
            merged(
              items.flatMap((item) =>
                Schema.decodeUnknownSync(LanguageSubscriptionItems["languages.availability.watch"])(
                  item
                )
              )
            ),
          end: () => undefined,
        }
      );
    };

    const load = async () => {
      const reply = await api.request("languages.catalog", { hostKey });

      if (!reply.ok) throw languageIpcError(reply.error);
      const catalog = Schema.decodeUnknownSync(P.LanguageCatalog)(reply.value);

      if (live) setState({ catalog, availability: [], failed: false });

      const answered = await Promise.all([...toolIdsOf(catalog)].map(factsOf));

      watch(answered.filter((id) => id !== null));
    };

    load().catch(() => live && setState({ ...EMPTY, failed: true }));

    return () => {
      live = false;
      unsubscribe();
    };
  }, [api, hostKey]);

  return state;
};
