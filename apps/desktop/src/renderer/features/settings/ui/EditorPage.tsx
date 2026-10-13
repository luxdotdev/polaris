/**
 * Settings → Editor (DESIGN.md, Settings: Editor and Editor · languages): the
 * app wiring around `EditorSettings`, which holds the page itself.
 */
import type * as P from "@polaris/protocol";
import { useCallback } from "react";
import { polaris } from "../../bridge.ts";
import { refreshLanguageSettings } from "../../editor/api.ts";
import { useApp, useConnection } from "../../../shell/hooks.ts";
import { EditorSettings } from "../editor/EditorSettings.tsx";
import { CommitMessagesChoice } from "./CommitMessagesChoice.tsx";
import { setSessionPrefs, useSettings } from "../store.ts";
import { TabCompletion } from "../editor/TabCompletion.tsx";

const refreshPreviews = (hostKey: string, workspaceId: P.WorkspaceId) => {
  void import("../../editor/runtime/actions.ts").then((actions) =>
    actions.refreshMarkdownPolicy(hostKey, workspaceId)
  );
};

export const EditorPage = () => {
  const prefs = useSettings((s) => s.sessions);
  const hosts = useApp((s) => s.hosts);
  const connection = useConnection();

  const workspacesOf = useCallback(
    (hostKey: string) =>
      [...(connection.store.getState().hostModels[hostKey]?.workspaces.values() ?? [])].map(
        (w) => ({ id: w.id, name: w.name })
      ),
    [connection]
  );

  const refreshEditors = useCallback(
    (hostKey: string | null) => {
      const models = connection.store.getState().hostModels;

      for (const [key, model] of Object.entries(models)) {
        if (hostKey !== null && key !== hostKey) continue;

        for (const workspaceId of model.workspaces.keys())
          refreshLanguageSettings(key, workspaceId);
      }
    },
    [connection]
  );

  return (
    <EditorSettings
      tabCompletion={<TabCompletion hosts={hosts} />}
      api={polaris().languages}
      hosts={hosts}
      workspacesOf={workspacesOf}
      keys={{
        vim: prefs.editorVim,
        autosave: prefs.editorAutosave,
        onVim: (on) => setSessionPrefs({ editorVim: on }),
        onAutosave: (on) => setSessionPrefs({ editorAutosave: on }),
        inlineDiagnostics: prefs.editorInlineDiagnostics,
        onInlineDiagnostics: (on) => setSessionPrefs({ editorInlineDiagnostics: on }),
        commitMessages: <CommitMessagesChoice />,
      }}
      refreshEditors={refreshEditors}
      refreshPreviews={refreshPreviews}
    />
  );
};
