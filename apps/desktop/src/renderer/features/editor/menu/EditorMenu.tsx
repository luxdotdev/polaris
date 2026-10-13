/**
 * The Editor's right-click menu around the code (Paper 19–19c). A right-click moves the caret
 * there unless it lands inside the selection; the chosen row runs once the code has focus again.
 */
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
  COPY_FAILED,
  PixelCheckIcon,
  PixelFailedIcon,
  showToast,
  useCopyWrite,
} from "@polaris/ui";
import type { EditorView } from "@codemirror/view";
import { createElement, type MouseEvent, type ReactNode, useRef, useState } from "react";
import { useCommands, useShellActions } from "../../../shell/hooks.ts";
import { readClipboard } from "../../clipboard.ts";
import { runInTerminal } from "../../terminal/actions.ts";
import { revealInExplorer } from "../explorer/index.ts";
import { basename, dirname, relative } from "../explorer/model/paths.ts";
import { languageStore } from "../lsp/state.ts";
import { fileKey } from "../model/drafts.ts";
import { runNavigation } from "../navigation/run.ts";
import { editorLanguageQueries } from "../runtime/app.ts";
import { viewOf } from "../runtime/buffers.ts";
import { statusStore } from "../status/store.ts";
import { placeCaret, selectLineIfEmpty } from "./caret.ts";
import {
  type Clipboard,
  type EditorMenuActions,
  editorMenuEntries,
  type MenuEntry,
  serverStateOf,
} from "./entries.ts";

export interface EditorMenuProps {
  readonly hostKey: string;
  readonly workspaceId: string;
  /** The folder the explorer is rooted at; relative paths start here. */
  readonly root: string;
  readonly path: string;
  readonly children: ReactNode;
}

/** Cut and copy go through CodeMirror's own handlers; paste reads the clipboard through main. */
const clipboard = (view: EditorView, what: Clipboard) => {
  if (what !== "paste") {
    document.execCommand(what);

    return;
  }

  void readClipboard().then((text) => {
    if (text !== null && text !== "")
      view.dispatch(view.state.replaceSelection(text), {
        userEvent: "input.paste",
        scrollIntoView: true,
      });
  });
};

const Rows = ({
  entries,
  choose,
}: {
  readonly entries: ReadonlyArray<MenuEntry>;
  readonly choose: (run: () => void) => void;
}) =>
  entries.map((entry, index) => {
    if (entry.kind === "separator") return <ContextMenuSeparator key={index} />;
    const trailing = entry.disabled === true ? entry.reason : entry.shortcut;

    return (
      <ContextMenuItem
        key={index}
        disabled={entry.disabled === true}
        data-needs-input={entry.needsInput === true ? "" : undefined}
        data-testid={entry.testId}
        onSelect={() => choose(entry.onSelect)}
      >
        <span className="min-w-0 flex-1 truncate">{entry.label}</span>
        {trailing === undefined || trailing === "" ? null : (
          <ContextMenuShortcut>{trailing}</ContextMenuShortcut>
        )}
      </ContextMenuItem>
    );
  });

export const EditorMenu = ({ hostKey, workspaceId, root, path, children }: EditorMenuProps) => {
  const commands = useCommands();
  const shell = useShellActions();
  const write = useCopyWrite();
  const key = fileKey(hostKey, path);
  const [entries, setEntries] = useState<ReadonlyArray<MenuEntry>>([]);
  const pending = useRef<(() => void) | null>(null);

  const copyPath = (text: string, what: string) =>
    void write(text)
      .catch(() => false)
      .then((ok) =>
        showToast({
          source: "starlight",
          icon: createElement(ok ? PixelCheckIcon : PixelFailedIcon, { size: 16 }),
          title: ok ? `Copied ${what}` : COPY_FAILED,
          message: text,
          duration: 1500,
        })
      );

  const actions = (view: EditorView): EditorMenuActions => ({
    navigate: (action) => runNavigation(key, action, editorLanguageQueries),
    command: (id) => void commands.run(id),
    addToSession: () => {
      selectLineIfEmpty(view);
      commands.run("editor.addToSession");
    },
    clipboard: (what) => clipboard(view, what),
    copyPath: (isRelative) =>
      isRelative ? copyPath(relative(path, root), "relative path") : copyPath(path, "path"),
    revealInTree: () => revealInExplorer({ hostKey, workspaceId, path }),
    // A new tab in the file's folder; the drawer lives in Orchestrate, so that is where it shows.
    openInTerminal: () => {
      const cwd = dirname(path);

      void runInTerminal(
        { hostKey, workspaceId },
        { key: crypto.randomUUID(), title: basename(cwd), cwd, argv: null }
      );
      shell.setMode("orchestrate");
    },
  });

  const open = (event: MouseEvent) => {
    const view = viewOf(key);

    if (view === null) return;
    placeCaret(view, event.clientX, event.clientY);
    setEntries(
      editorMenuEntries({
        server: serverStateOf(
          languageStore.getState().files[key],
          statusStore.getState().files[key]
        ),
        enabled: (id) => commands.enabled(id),
        actions: actions(view),
      })
    );
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="flex min-h-0 flex-1 flex-col" onContextMenu={open}>
          {children}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent
        data-testid="editor-menu"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const run = pending.current;

          pending.current = null;
          viewOf(key)?.focus();
          run?.();
        }}
      >
        <Rows
          entries={entries}
          choose={(run) => {
            pending.current = run;
          }}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
};
