/**
 * Settings → Editor (DESIGN.md, Settings: Editor · languages; Paper L4): the
 * preferences, then Languages on the picked Host, then Advanced, collapsed.
 */
import * as P from "@polaris/protocol";
import { useCallback, useMemo, useState } from "react";
import type { HostView, LanguageApi } from "../../../../shared/api.ts";
import { hostInSentence } from "../../../shell/hostCopy.ts";
import { Column, PageHeader } from "../ui/parts.tsx";
import { Advanced } from "./Advanced.tsx";
import { useHostLanguages, useLanguageRecords, useRecord } from "./hooks.ts";
import { HostPicker, pickable } from "./HostPicker.tsx";
import { LanguageList } from "./Languages.tsx";
import type { PolicyWorkspace } from "./MarkdownImages.tsx";
import { languageRows, rowEnabled, syntaxOnly, syntaxOnlyLine } from "./model.ts";
import { Preferences, type EditorKeys } from "./Preferences.tsx";
import { APP_SCOPE, type SettingsScope } from "./records.ts";

export interface EditorSettingsProps {
  readonly api: LanguageApi | undefined;
  readonly hosts: ReadonlyArray<HostView>;
  readonly workspacesOf: (hostKey: string) => ReadonlyArray<PolicyWorkspace>;
  readonly keys: EditorKeys;
  /** Open editors re-read their settings: every Host's when `hostKey` is null. */
  readonly refreshEditors: (hostKey: string | null) => void;
  readonly refreshPreviews: (hostKey: string, workspaceId: P.WorkspaceId) => void;
}

const firstPickable = (hosts: ReadonlyArray<HostView>) =>
  (hosts.find((h) => pickable(h) && h.alias === null) ?? hosts.find(pickable))?.key ?? null;

const notice = (
  api: LanguageApi | undefined,
  picked: HostView | undefined,
  failed: boolean,
  loaded: boolean
) => {
  if (!api)
    return "Language tools need a newer Polaris on this Mac. Syntax highlighting still works.";

  if (picked === undefined || !pickable(picked))
    return "Pick a connected host to see its languages.";

  if (failed)
    return `Couldn't read the languages on ${hostInSentence(picked)}. Try again in a moment.`;

  return loaded ? null : `Checking ${hostInSentence(picked)}…`;
};

const NO_LANGUAGES: ReadonlyArray<P.LanguageSyntaxId> = [];

export const EditorSettings = ({
  api,
  hosts,
  workspacesOf,
  keys,
  refreshEditors,
  refreshPreviews,
}: EditorSettingsProps) => {
  const [chosen, setChosen] = useState<string | null>(null);
  const hostKey = chosen ?? firstPickable(hosts);
  const picked = hosts.find((h) => h.key === hostKey);
  const live = picked !== undefined && pickable(picked) ? picked.key : null;

  const committed = useCallback(
    (scope: SettingsScope) =>
      refreshEditors(
        P.LanguageSettingsScope.match(scope, {
          App: () => null,
          Language: () => null,
          Host: () => live,
          Workspace: () => live,
        })
      ),
    [refreshEditors, live]
  );

  const app = useRecord(api, hosts[0]?.key ?? "local", APP_SCOPE, committed);

  const facts = useHostLanguages(api, live);

  const rows = useMemo(
    () =>
      facts.catalog === null
        ? []
        : languageRows(facts.catalog, facts.availability, {
            host: hostInSentence(picked),
            downloadAutomatically: app.record?.settings.downloadLanguageToolsAutomatically ?? true,
          }),
    [facts, picked, app.record]
  );

  const languages = useMemo(
    () => (rows.length === 0 ? NO_LANGUAGES : [...new Set(rows.flatMap((r) => r.syntaxIds))]),
    [rows]
  );

  const switches = useLanguageRecords(api, hosts[0]?.key ?? null, languages, committed);

  const settingsOf = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(switches.records).map(([language, record]) => [language, record?.settings])
      ),
    [switches.records]
  );

  const identity = picked?.status.host ?? null;

  return (
    <Column>
      <PageHeader
        title="Editor"
        blurb="How code reads and behaves in the Edit view. Language tools run on each host; this Mac keeps your preferences."
      />
      <Preferences
        record={app.record}
        failed={app.failed}
        onChange={(change) => void app.update(change)}
        keys={keys}
      />
      <div className="flex items-end justify-between gap-4 pt-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-heading-sm text-text-strong leading-[18px] font-medium">Languages</h2>
          <p className="text-caption text-text-subtle">
            What each language has on the host you pick.
          </p>
        </div>
        <HostPicker hosts={hosts} value={hostKey} onChange={setChosen} />
      </div>
      <LanguageList
        rows={rows}
        enabled={(row) => rowEnabled(row, settingsOf)}
        onToggle={(row, on) => void switches.toggle(row.syntaxIds, on)}
        footLine={facts.catalog === null ? null : syntaxOnlyLine(syntaxOnly(facts.catalog))}
        notice={notice(api, picked, facts.failed, facts.catalog !== null)}
      />
      <Advanced
        api={api}
        host={
          live !== null && identity !== null && picked !== undefined
            ? { key: live, id: identity.hostId, label: picked.label }
            : null
        }
        providers={facts.catalog?.integrations.flatMap((i) => i.providers.map((p) => p.id)) ?? []}
        workspaces={live === null ? [] : workspacesOf(live)}
        committed={committed}
        onPolicySaved={(workspaceId) => live !== null && refreshPreviews(live, workspaceId)}
      />
    </Column>
  );
};
