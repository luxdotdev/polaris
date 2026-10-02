import * as P from "@polaris/protocol";
import { Button } from "@polaris/ui";
import { Schema } from "effect";
import { useEffect, useState } from "react";
import { Column, PageHeader } from "../ui/parts.tsx";
import { LanguagePreferences } from "../../editor/languageSettings/Preferences.tsx";
import { Advanced } from "./Advanced.tsx";
import { CustomServers } from "./CustomServers.tsx";
import { Choice } from "./fields.tsx";
import { Hosts } from "./Hosts.tsx";
import { SettingsOperations } from "./operations.ts";
import type {
  LanguageSettingsProps,
  LanguageSettingsAction,
  LanguageSettingsSnapshot,
} from "./contracts.ts";

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
  const [snapshot, setSnapshot] = useState<LanguageSettingsSnapshot | null>(null);
  const [draft, setDraft] = useState<P.LanguageSettingsPatch>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [epoch, setEpoch] = useState(0);
  const [editingEpoch, setEditingEpoch] = useState(0);

  const dirty =
    snapshot !== null && JSON.stringify(draft) !== JSON.stringify(snapshot.record.settings);

  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);

  useEffect(() => {
    setBusy(true);
    void operations.run(
      async (signal) => adapter.load(scope, signal),
      (result) => {
        setBusy(false);

        if (!result.ok) {
          setNotice(result.message);

          return;
        }

        if (!same(result.value.record.scope, scope)) {
          setNotice("Settings response belongs to another scope. Retry loading.");

          return;
        }

        setSnapshot(result.value);
        setDraft(result.value.record.settings);
        setNotice("");
        setEditingEpoch((value) => value + 1);
      },
      () => {
        setBusy(false);
        setNotice("Couldn't load language settings. Retry loading.");
      }
    );

    return () => operations.cancel();
  }, [adapter, scope, operations, epoch]);

  const run = (
    work: (signal: AbortSignal) => ReturnType<LanguageSettingsProps["adapter"]["save"]>
  ) => {
    setBusy(true);
    setNotice("");
    void operations.run(
      work,
      (result) => {
        setBusy(false);

        if (!result.ok) {
          setNotice(result.message);

          return;
        }

        setSnapshot(null);
        setEpoch((value) => value + 1);
      },
      () => {
        setBusy(false);
        setNotice(
          "Language operation failed. Refresh facts before retrying; no success was confirmed."
        );
      }
    );
  };

  const act = (action: LanguageSettingsAction) => run((signal) => adapter.act(action, signal));

  const save = () => {
    if (!snapshot) return;

    try {
      const record = Schema.decodeUnknownSync(P.LanguageSettingsRecord)({
        ...snapshot.record,
        settings: draft,
      });

      run((signal) => adapter.save(record, signal));
    } catch {
      setNotice(
        "Settings are invalid. Check field values and limits; private values are not shown in errors."
      );
    }
  };

  return (
    <div className="gap-section flex flex-col" aria-busy={busy}>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={busy || dirty}
          onClick={() => {
            setSnapshot(null);
            setEpoch((value) => value + 1);
          }}
        >
          Refresh facts
        </Button>
        {busy && (
          <Button
            onClick={() => {
              operations.cancel();
              setBusy(false);
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
            key={`advanced-${editingEpoch}`}
            settings={draft}
            disabled={busy}
            onChange={setDraft}
          />
          <CustomServers
            key={`servers-${editingEpoch}`}
            servers={draft.customServers ?? []}
            disabled={busy}
            onChange={(servers) => setDraft({ ...draft, customServers: servers })}
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={!dirty || busy} onClick={save}>
              Save language settings
            </Button>
            <Button
              disabled={busy || !dirty}
              onClick={() => {
                setDraft(snapshot.record.settings);
                setEditingEpoch((value) => value + 1);
              }}
            >
              Discard changes
            </Button>
            <Button
              disabled={busy}
              variant="ghost"
              onClick={() => {
                setDraft({});
                setEditingEpoch((value) => value + 1);
              }}
            >
              Reset this scope to inherited settings
            </Button>
          </div>
          <p className="text-caption text-text-subtle">
            Preferences stay on this Client. Saving replaces this scope at revision{" "}
            {snapshot.record.revision}; conflicting changes must be reloaded. Reset applies only
            after Save.
          </p>
          <Hosts hosts={snapshot.hosts} busy={busy || dirty} act={act} />
          {dirty && (
            <p className="text-caption">
              Save or discard changes before running Host actions or refreshing facts.
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
