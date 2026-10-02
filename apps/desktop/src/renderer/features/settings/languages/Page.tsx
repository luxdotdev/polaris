import * as P from "@polaris/protocol";
import { Button } from "@polaris/ui";
import { Schema } from "effect";
import { useEffect, useLayoutEffect, useState } from "react";
import { Column, PageHeader } from "../ui/parts.tsx";
import { LanguagePreferences } from "../../editor/languageSettings/Preferences.tsx";
import { Advanced } from "./Advanced.tsx";
import { CustomServers } from "./CustomServers.tsx";
import { Choice } from "./fields.tsx";
import { Hosts } from "./Hosts.tsx";
import { SettingsOperations } from "./operations.ts";
import type { LanguageSettingsProps, LanguageSettingsAction } from "./contracts.ts";

import {
  acceptSettingsFacts,
  currentSettingsFacts,
  discardSettingsDraft,
  initialSettingsView,
  settingsDraftDirty,
  settingsRevisionConflict,
} from "./viewState.ts";

const same = (a: P.LanguageSettingsScope, b: P.LanguageSettingsScope) =>
  JSON.stringify(a) === JSON.stringify(b);

const ScopePage = ({
  adapter,
  scope,
  onDirty,
}: {
  readonly adapter: LanguageSettingsProps["adapter"];
  readonly scope: P.LanguageSettingsScope;
  readonly onDirty: (dirty: boolean) => void;
}) => {
  const [operations] = useState(() => new SettingsOperations());
  const [view, setView] = useState(initialSettingsView);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [epoch, setEpoch] = useState(0);
  const scopeKey = JSON.stringify(scope);
  const snapshot = view.snapshot;
  const draft = view.draft;
  const dirty = settingsDraftDirty(view);
  const current = currentSettingsFacts(view, adapter, scopeKey, epoch);
  const conflict = current !== null && settingsRevisionConflict(view);

  const setDraft = (settings: P.LanguageSettingsPatch) =>
    setView((previous) => ({ ...previous, draft: settings }));

  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);

  useLayoutEffect(() => {
    setView((previous) => ({ ...previous, valid: false }));
    setBusy(true);
    setNotice("");
    void operations.run(
      (signal) => adapter.load(scope, signal),
      (result) => {
        setBusy(false);

        if (!result.ok) {
          setNotice(result.message);

          return;
        }

        const record = Schema.decodeUnknownSync(P.LanguageSettingsRecord)(result.value.record);

        if (!same(record.scope, scope)) {
          setNotice("Settings response belongs to another scope. Refresh facts to retry.");

          return;
        }

        setView((previous) =>
          acceptSettingsFacts(previous, { ...result.value, record }, adapter, scopeKey, epoch)
        );
        setNotice("");
      },
      () => {
        setBusy(false);
        setNotice("Couldn't load language settings. Refresh facts to retry.");
      }
    );

    return () => operations.cancel();
  }, [adapter, scope, scopeKey, operations, epoch]);

  const refresh = () => {
    setView((previous) => ({ ...previous, valid: false }));
    setEpoch((value) => value + 1);
  };

  const run = (
    work: (signal: AbortSignal) => ReturnType<LanguageSettingsProps["adapter"]["save"]>,
    saving: boolean
  ) => {
    if (current === null || busy || conflict) return;
    setBusy(true);
    setNotice("");
    setView((previous) => ({ ...previous, valid: false, acknowledged: null }));
    void operations.run(
      work,
      (result) => {
        setBusy(false);

        if (!result.ok) {
          setNotice(result.message);

          return;
        }

        if (saving)
          setView((previous) => ({ ...previous, acknowledged: { adapter, settings: draft } }));
        refresh();
      },
      () => {
        setBusy(false);
        setNotice(
          "Language operation failed. Refresh facts before retrying; no success was confirmed."
        );
      }
    );
  };

  const act = (action: LanguageSettingsAction) => {
    if (!dirty && current !== null) run((signal) => adapter.act(action, signal), false);
  };

  const save = () => {
    if (current === null || conflict || !dirty || busy) return;

    try {
      const record = Schema.decodeUnknownSync(P.LanguageSettingsRecord)({
        ...current.record,
        settings: draft,
      });

      run((signal) => adapter.save(record, signal), true);
    } catch {
      setNotice(
        "Settings are invalid. Check field values and limits; private values are not shown in errors."
      );
    }
  };

  return (
    <div className="gap-section flex flex-col" aria-busy={busy}>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={busy} onClick={refresh}>
          Refresh facts
        </Button>
        {busy && (
          <Button
            onClick={() => {
              operations.cancel();
              setBusy(false);
              setView((previous) => ({ ...previous, valid: false, acknowledged: null }));
              setNotice(
                "Request cancelled. A Host action or save may already have completed. Refresh facts to confirm before retrying."
              );
            }}
          >
            Cancel request
          </Button>
        )}
      </div>
      {notice && (
        <p role="alert" className="text-caption break-words">
          {notice}
        </p>
      )}
      {!snapshot && (
        <p role="status" className="text-caption text-text-subtle">
          {notice
            ? "Settings unavailable. Use Refresh facts to try again."
            : "Reading language settings…"}
        </p>
      )}
      {snapshot && (
        <>
          <LanguagePreferences
            snapshot={snapshot}
            settings={draft}
            disabled={busy}
            onChange={setDraft}
          />
          <Advanced
            key={`advanced-${view.editingEpoch}`}
            settings={draft}
            disabled={busy}
            onChange={setDraft}
          />
          <CustomServers
            key={`servers-${view.editingEpoch}`}
            servers={draft.customServers ?? []}
            disabled={busy}
            onChange={(servers) => setDraft({ ...draft, customServers: servers })}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={!dirty || busy || current === null || conflict}
              onClick={save}
            >
              Save language settings
            </Button>
            <Button
              disabled={busy || current === null || (!dirty && !conflict)}
              onClick={() => {
                setView((previous) => discardSettingsDraft(previous));
              }}
            >
              Discard changes
            </Button>
            <Button
              disabled={busy}
              variant="ghost"
              onClick={() => {
                setView((previous) => ({
                  ...previous,
                  draft: {},
                  editingEpoch: previous.editingEpoch + 1,
                }));
              }}
            >
              Reset this scope to inherited settings
            </Button>
          </div>
          <p className="text-caption text-text-subtle">
            Preferences stay on this Client. Saving replaces this scope at revision{" "}
            {view.baseline?.revision ?? "not observed"}; current observed revision{" "}
            {snapshot.record.revision}. Reset applies only after Save.
          </p>
          {current === null && (
            <p role="status" className="text-caption">
              Last-known facts. Host actions and saving are unavailable until Refresh facts confirms
              this adapter and scope.
            </p>
          )}
          {conflict && (
            <p role="alert" className="text-caption">
              Settings changed on this Client: draft revision {view.baseline?.revision}, current
              revision {current.record.revision}. Your draft is retained. Saving is blocked; discard
              changes to use the confirmed settings. No draft has been rebased or retried.
            </p>
          )}
          <Hosts
            hosts={snapshot.hosts}
            busy={busy || dirty || current === null || conflict}
            act={act}
          />
          {dirty && (
            <p className="text-caption">
              Save or discard changes before running Host actions. Refresh facts retains your draft
              and checks the current revision.
            </p>
          )}
        </>
      )}
    </div>
  );
};

export const LanguageSettingsPage = ({
  adapter,
  scopes,
  initialScopeKey,
}: LanguageSettingsProps) => {
  const [key, setKey] = useState(initialScopeKey ?? scopes[0]?.key ?? "");
  const [dirty, setDirty] = useState(false);

  const selected = scopes.find((s) => s.key === key) ?? scopes[0];

  return (
    <Column>
      <PageHeader
        title="Language integrations"
        blurb="Choose providers and formatting, and inspect language tools on each host."
      />
      {selected ? (
        <>
          <Choice label="Settings scope" value={selected.key} disabled={dirty} onChange={setKey}>
            {scopes.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </Choice>
          <p className="text-caption text-text-subtle">
            App → language defaults → host → workspace → workspace language. Save or discard changes
            before switching scope. Apply individual fields before saving.
          </p>
          <ScopePage
            key={selected.key}
            adapter={adapter}
            scope={selected.scope}
            onDirty={setDirty}
          />
        </>
      ) : (
        <p className="text-caption">
          No Settings scopes supplied. Choose a registered host or workspace in the integration.
        </p>
      )}
    </Column>
  );
};
