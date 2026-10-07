/**
 * The editor pane right of the explorer (DESIGN.md, Editor; Paper E1–E3):
 * tabs, breadcrumbs, the strip that needs a decision, and the code. ⌘S saves,
 * ⌃⇥ cycles tabs; the pane starts the Editor on first mount.
 */
import { EmptyState, PixelFolderIcon } from "@polaris/ui";
import { useEffect, useState } from "react";
import { useCommands, useConnection, useShellActions } from "../../../shell/hooks.ts";
import { bannerFor, type BannerAction } from "../model/banner.ts";
import { fileKey, workspaceKey } from "../model/drafts.ts";
import { viewOf } from "../runtime/buffers.ts";
import {
  activateTab,
  closeActiveTab,
  openMarkdownPreview,
  closeTab,
  cycleTabs,
  keepMyEdits,
  loadTab,
  pinFile,
  saveFile,
  setWorkspaceRoot,
  takeDiskVersion,
} from "../runtime/actions.ts";
import { languageFor } from "../model/language.ts";
import { MarkdownBuffer, PreviewControls, useMarkdownDocument } from "./MarkdownHost.tsx";
import { ensureEditor } from "../runtime/app.ts";
import { useBuffer, useEditorTabs } from "../runtime/hooks.ts";
import { type BufferView, useEditor } from "../runtime/store.ts";
import { AgentStrip } from "./AgentStrip.tsx";
import { Banner } from "./Banner.tsx";
import { Breadcrumbs } from "./Breadcrumbs.tsx";
import { RefactorPreview } from "./RefactorPreview.tsx";
import { CloseDialog } from "./CloseDialog.tsx";
import { CodeHost } from "./CodeHost.tsx";
import { Compare } from "./Compare.tsx";
import { FileNotice } from "./FileNotice.tsx";
import { Tabs } from "./Tabs.tsx";
import { LanguagePanel } from "./LanguagePanel.tsx";
import { RenameField } from "../navigation/RenameField.tsx";
import { SymbolSearch } from "../navigation/SymbolSearch.tsx";
import { useLanguageNavigationCommands } from "../navigation/contribute.ts";
import { EditorTrust } from "../trust/TrustCard.tsx";
import { activateLogTab, closeLogTab, isLogTab, useLogTabs } from "../status/logTabs.ts";
import { LogTabBody, useLogTabViews } from "../status/LogTab.tsx";

export interface EditorPaneProps {
  readonly hostKey: string;
  readonly workspaceId: string;
  /** The folder the explorer is rooted at: the Workspace, or one of its Worktrees or checkouts. */
  readonly root: string;
}

const useEditorCommands = (hostKey: string, workspaceId: string, active: string | null) => {
  const commands = useCommands();

  useEffect(
    () =>
      commands.register({
        "editor.markdownPreview": {
          run: () => openMarkdownPreview(hostKey, workspaceId),
          enabled: () => active !== null && languageFor(active) === "markdown",
        },
        "editor.save": {
          run: () => void (active === null ? null : saveFile(hostKey, active)),
          enabled: () => active !== null,
        },
        "editor.nextTab": { run: () => cycleTabs(hostKey, workspaceId, 1) },
        "editor.previousTab": { run: () => cycleTabs(hostKey, workspaceId, -1) },
      }),
    [commands, hostKey, workspaceId, active]
  );
};

const theirsOf = (buffer: BufferView | null) =>
  buffer?.status.kind === "ready" ? (buffer.status.model.conflict?.theirs.text ?? null) : null;

export const EditorPane = ({ hostKey, workspaceId, root }: EditorPaneProps) => {
  const connection = useConnection();

  ensureEditor({
    app: () => connection.store.getState(),
    subscribeApp: (changed) => connection.store.subscribe(changed),
  });

  const { tabs: fileTabs, active, activeId, rendered } = useEditorTabs(hostKey, workspaceId);
  const logs = useLogTabs(hostKey, workspaceId);
  const logViews = useLogTabViews(logs.tabs);
  const tabs = logViews.length === 0 ? fileTabs : [...fileTabs, ...logViews];
  const shownLog = logs.tabs.find((tab) => tab.id === logs.active) ?? null;
  const buffer = useBuffer(hostKey, active);

  const { document, epoch, connectionState, hostLabel } = useMarkdownDocument(
    hostKey,
    workspaceId,
    active
  );

  const { openSettings } = useShellActions();
  const [comparing, setComparing] = useState(false);
  const theirs = theirsOf(buffer);

  const agent = useEditor((s) =>
    active === null ? null : (s.agentEdits[workspaceKey(hostKey, workspaceId)]?.get(active) ?? null)
  );

  useEffect(() => {
    setWorkspaceRoot(hostKey, workspaceId, root);
  }, [hostKey, workspaceId, root]);

  // After a restart the tabs come back first; the active one's file loads when shown.
  useEffect(() => {
    if (active !== null && buffer === null) loadTab(hostKey, workspaceId, active);
  }, [hostKey, workspaceId, active, buffer]);

  useEffect(() => {
    if (theirs === null) setComparing(false);
  }, [theirs]);

  useEditorCommands(hostKey, workspaceId, active);
  useLanguageNavigationCommands();

  const onAction = (action: BannerAction) => {
    if (active === null) return;

    const run: Record<BannerAction, () => void> = {
      compare: () => setComparing((c) => !c),
      "keep-mine": () => keepMyEdits(hostKey, active),
      "take-theirs": () => takeDiskVersion(hostKey, active),
      close: () => closeActiveTab(hostKey, workspaceId),
      retry: () => void saveFile(hostKey, active),
      "update-daemon": () => openSettings("hosts"),
      save: () => void saveFile(hostKey, active),
    };

    run[action]();
  };

  const strip = (
    <Tabs
      tabs={tabs}
      active={shownLog?.id ?? activeId ?? active}
      onSelect={(id) =>
        isLogTab(id)
          ? activateLogTab(hostKey, workspaceId, id)
          : activateTab(hostKey, workspaceId, id)
      }
      onPin={(path) => pinFile(hostKey, workspaceId, path)}
      onClose={(id) =>
        isLogTab(id) ? closeLogTab(hostKey, workspaceId, id) : closeTab(hostKey, workspaceId, id)
      }
    />
  );

  if (shownLog !== null) {
    return (
      <section
        aria-label="Editor"
        className="bg-bg flex min-w-0 flex-1 flex-col"
        data-testid="editor-pane"
      >
        {strip}
        <LogTabBody tab={shownLog} />
      </section>
    );
  }

  if (fileTabs.length === 0 || active === null) {
    return (
      <section aria-label="Editor" className="bg-bg grid min-w-0 flex-1 place-items-center">
        <RefactorPreview hostKey={hostKey} root={root} />
        <EmptyState
          icon={<PixelFolderIcon size={24} className="text-text-strong" />}
          title="No file open"
          fact="Pick a file in the explorer, or press ⌘P to find one."
        />
      </section>
    );
  }

  const banner = buffer === null ? null : bannerFor(buffer, hostLabel);
  const ready = buffer?.status.kind === "ready";

  const mine =
    comparing && theirs !== null
      ? (viewOf(fileKey(hostKey, active))?.state.sliceDoc() ?? "")
      : null;

  return (
    <section
      aria-label="Editor"
      className="bg-bg flex min-w-0 flex-1 flex-col"
      data-testid="editor-pane"
    >
      <RefactorPreview hostKey={hostKey} root={root} />
      {strip}
      <PreviewControls
        visible={rendered ?? false}
        hostKey={hostKey}
        workspaceId={workspaceId}
        path={active}
        hostLabel={hostLabel}
        connectionState={connectionState}
        locked={tabs.find((t) => t.id === activeId)?.locked ?? false}
      />
      {agent === null || rendered ? (
        <Breadcrumbs hostKey={hostKey} path={active} root={root} />
      ) : (
        <AgentStrip hostKey={hostKey} edit={agent} />
      )}
      {banner === null ? null : (
        <Banner banner={banner} comparing={comparing} onAction={onAction} />
      )}
      {mine !== null && theirs !== null && buffer !== null ? (
        <Compare mine={mine} theirs={theirs} language={buffer.language} />
      ) : null}
      <div className={mine === null ? "relative flex min-h-0 flex-1 flex-col" : "hidden"}>
        {rendered ? null : (
          <EditorTrust hostKey={hostKey} workspaceId={workspaceId} path={active} />
        )}
        {ready ? null : (
          <FileNotice
            buffer={buffer}
            path={active}
            onClose={() => closeActiveTab(hostKey, workspaceId)}
          />
        )}
        {rendered ? (
          <MarkdownBuffer
            key={JSON.stringify([hostKey, active, epoch, connectionState])}
            ready={ready}
            document={document}
            epoch={epoch}
            connectionState={connectionState}
            bufferKey={fileKey(hostKey, active)}
            hostLabel={hostLabel}
          />
        ) : (
          <CodeHost bufferKey={fileKey(hostKey, active)} ready={ready} focus />
        )}
      </div>
      <CloseDialog hostKey={hostKey} workspaceId={workspaceId} />
      {rendered ? null : <LanguagePanel hostKey={hostKey} path={active} />}
      <RenameField />
      <SymbolSearch />
    </section>
  );
};
