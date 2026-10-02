/**
 * The editor pane right of the explorer (DESIGN.md, Editor; Paper E1–E3):
 * tabs, breadcrumbs, the strip that needs a decision, and the code. ⌘S saves,
 * ⌃⇥ cycles tabs; the pane starts the Editor on first mount.
 */
import { EmptyState, PixelFolderIcon } from "@polaris/ui";
import { useEffect, useState } from "react";
import { useApp, useCommands, useConnection, useShellActions } from "../../../shell/hooks.ts";
import { bannerFor, type BannerAction } from "../model/banner.ts";
import { fileKey } from "../model/drafts.ts";
import { viewOf } from "../runtime/buffers.ts";
import {
  activateTab,
  closeTab,
  cycleTabs,
  keepMyEdits,
  loadTab,
  pinFile,
  saveFile,
  setWorkspaceRoot,
  takeDiskVersion,
} from "../runtime/actions.ts";
import { ensureEditor } from "../runtime/app.ts";
import { useBuffer, useEditorTabs } from "../runtime/hooks.ts";
import type { BufferView } from "../runtime/store.ts";
import { Banner } from "./Banner.tsx";
import { Breadcrumbs } from "./Breadcrumbs.tsx";
import { CloseDialog } from "./CloseDialog.tsx";
import { CodeHost } from "./CodeHost.tsx";
import { Compare } from "./Compare.tsx";
import { FileNotice } from "./FileNotice.tsx";
import { Tabs } from "./Tabs.tsx";

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

  ensureEditor({ app: () => connection.store.getState() });

  const { tabs, active } = useEditorTabs(hostKey, workspaceId);
  const buffer = useBuffer(hostKey, active);
  const hostLabel = useApp((s) => s.hosts.find((h) => h.key === hostKey)?.label ?? "this host");
  const { openSettings } = useShellActions();
  const [comparing, setComparing] = useState(false);
  const theirs = theirsOf(buffer);

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

  const onAction = (action: BannerAction) => {
    if (active === null) return;

    const run: Record<BannerAction, () => void> = {
      compare: () => setComparing((c) => !c),
      "keep-mine": () => keepMyEdits(hostKey, active),
      "take-theirs": () => takeDiskVersion(hostKey, active),
      close: () => closeTab(hostKey, workspaceId, active),
      retry: () => void saveFile(hostKey, active),
      "update-daemon": () => openSettings("hosts"),
    };

    run[action]();
  };

  if (tabs.length === 0 || active === null) {
    return (
      <section aria-label="Editor" className="bg-bg grid min-w-0 flex-1 place-items-center">
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
      <Tabs
        tabs={tabs}
        active={active}
        onSelect={(path) => activateTab(hostKey, workspaceId, path)}
        onPin={(path) => pinFile(hostKey, workspaceId, path)}
        onClose={(path) => closeTab(hostKey, workspaceId, path)}
      />
      <Breadcrumbs path={active} root={root} />
      {banner === null ? null : (
        <Banner banner={banner} comparing={comparing} onAction={onAction} />
      )}
      {mine !== null && theirs !== null && buffer !== null ? (
        <Compare mine={mine} theirs={theirs} language={buffer.language} />
      ) : null}
      <div className={mine === null ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
        {ready ? null : (
          <FileNotice
            buffer={buffer}
            path={active}
            onClose={() => closeTab(hostKey, workspaceId, active)}
          />
        )}
        <CodeHost bufferKey={fileKey(hostKey, active)} ready={ready} focus />
      </div>
      <CloseDialog hostKey={hostKey} workspaceId={workspaceId} />
    </section>
  );
};
