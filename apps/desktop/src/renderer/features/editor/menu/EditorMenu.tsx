/**
 * The Editor's right-click menu around the code (Paper 19–19c). A right-click moves the caret
 * there unless it lands inside the selection; the chosen row runs once the code has focus again.
 */
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuEntries,
  ContextMenuTrigger,
  type MenuEntry,
} from "@polaris/ui";
import type { EditorView } from "@codemirror/view";
import { type KeyboardEvent, type MouseEvent, type ReactNode, useRef, useState } from "react";
import { copyWithToast, revealInFinderEntry } from "../../../shell/menu/index.ts";
import { useCommands } from "../../../shell/hooks.ts";
import { polaris } from "../../bridge.ts";
import { openTerminalIn } from "../../terminal/index.ts";
import { revealInExplorer } from "../explorer/index.ts";
import { dirname, relative } from "../explorer/model/paths.ts";
import { languageStore } from "../lsp/state.ts";
import { fileKey } from "../model/drafts.ts";
import { runNavigation } from "../navigation/run.ts";
import { editorLanguageQueries } from "../runtime/app.ts";
import { viewOf } from "../runtime/buffers.ts";
import { statusStore } from "../status/store.ts";
import { placeCaret, selectLineIfEmpty } from "./caret.ts";
import { type EditorMenuActions, editorMenuEntries, serverStateOf } from "./entries.ts";

export interface EditorMenuProps {
  readonly hostKey: string;
  readonly workspaceId: string;
  /** The folder the explorer is rooted at; relative paths start here. */
  readonly root: string;
  readonly path: string;
  readonly children: ReactNode;
}

/** Rows run once the menu has closed and the code has focus again, so edits land in it. */
const deferred = (
  entries: ReadonlyArray<MenuEntry>,
  defer: (run: () => void) => void
): ReadonlyArray<MenuEntry> =>
  entries.map((entry) =>
    entry.kind === "item" ? { ...entry, onSelect: () => defer(entry.onSelect) } : entry
  );

/** ⇧F10 or the menu key: the menu opens at the caret, which stays where it is. */
const openAtCaret = (event: KeyboardEvent, view: EditorView | null) => {
  const menuKey = event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey);
  const coords = menuKey && view !== null ? view.coordsAtPos(view.state.selection.main.head) : null;

  if (coords === null || !(event.target instanceof HTMLElement)) return;
  event.preventDefault();
  event.target.dispatchEvent(
    new globalThis.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: coords.left,
      clientY: coords.bottom,
    })
  );
};

export const EditorMenu = ({ hostKey, workspaceId, root, path, children }: EditorMenuProps) => {
  const commands = useCommands();
  const key = fileKey(hostKey, path);
  const [entries, setEntries] = useState<ReadonlyArray<MenuEntry>>([]);
  const pending = useRef<(() => void) | null>(null);

  const actions = (view: EditorView): EditorMenuActions => ({
    navigate: (action) => runNavigation(key, action, editorLanguageQueries),
    command: (id) => void commands.run(id),
    addToSession: () => {
      selectLineIfEmpty(view);
      commands.run("editor.addToSession");
    },
    // The native Edit menu's own action, as ⌘X/⌘C/⌘V would run it in the focused code.
    clipboard: (action) => void polaris().request("edit.run", { action }),
    copyPath: (isRelative) =>
      isRelative
        ? copyWithToast(relative(path, root), "relative path")
        : copyWithToast(path, "path"),
    revealInTree: () => revealInExplorer({ hostKey, workspaceId, path }),
    // A new tab in the file's folder, in the drawer of the mode on screen.
    openInTerminal: () => void openTerminalIn({ hostKey, workspaceId }, dirname(path)),
  });

  const open = (event: MouseEvent) => {
    const view = viewOf(key);

    if (view === null) return;

    // A real click moves the caret; the keyboard's opening (openAtCaret) leaves it.
    if (event.nativeEvent.isTrusted) placeCaret(view, event.clientX, event.clientY);

    const defer = (run: () => void) => {
      pending.current = run;
    };

    setEntries(
      deferred(
        editorMenuEntries({
          server: serverStateOf(
            languageStore.getState().files[key],
            statusStore.getState().files[key]
          ),
          enabled: (id) => commands.enabled(id),
          actions: actions(view),
          finder: revealInFinderEntry(hostKey, path),
        }),
        defer
      )
    );
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="flex min-h-0 flex-1 flex-col"
          onContextMenu={open}
          onKeyDown={(event) => openAtCaret(event, viewOf(key))}
        >
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
        <ContextMenuEntries entries={entries} />
      </ContextMenuContent>
    </ContextMenu>
  );
};
