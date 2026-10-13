/**
 * The transcript's right-click menus (Paper M2): on an agent row, what was clicked (a link,
 * a file, a command) and then Copy (the selection), Copy message and Copy turn output; on
 * a prompt, Copy, Copy prompt and Fold turn. Each copy answers in a short toast.
 */
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuEntries,
  ContextMenuTrigger,
  type CopyWrite,
  MENU_SEPARATOR_ENTRY,
  type MenuEntryInput,
  tidyEntries,
  useCopyWrite,
} from "@polaris/ui";
import { Predicate } from "effect";
import { type ReactElement, useState } from "react";
import { resolvePath } from "../../../routes/editor.ts";
import { useApp, useShellActions } from "../../../shell/hooks.ts";
import { copyWithToast } from "../../../shell/menu/index.ts";
import type { TurnView } from "../../../store/sessionModel.ts";
import { sessionKey } from "../../../store/store.ts";
import { polaris } from "../../bridge.ts";
import { revealInExplorer } from "../../editor/explorer/index.ts";
import { type EditorPlace, useEditorPlace, useOpenInEditor } from "../../editor-links/index.ts";
import { completedItemView, type ItemView, turnOutput } from "../model/items.ts";
import { subjectAt, type Subject } from "./menuSubject.ts";

const replies = (view: TurnView) =>
  view.items.filter((item) => Predicate.isTagged(item, "AssistantMessage")).length;

/** The text selected now, when the selection sits inside `root`. */
const selectionIn = (root: Element): string => {
  const selection = window.getSelection();

  if (selection === null || selection.isCollapsed) return "";
  const { anchorNode } = selection;

  return anchorNode !== null && root.contains(anchorNode) ? selection.toString() : "";
};

const copy = (write: CopyWrite, label: string, text: string, what: string): MenuEntryInput => ({
  kind: "item",
  label,
  onSelect: () => copyWithToast(text, what, write),
});

/** A command the row ran, by its item id, from the Turn's finished items. */
const commandOf = (view: TurnView | undefined, id: string) => {
  const found = view?.items.find((item) => item.id === id);
  const shown: ItemView | undefined = found === undefined ? undefined : completedItemView(found);

  return shown?.kind === "command" ? shown : null;
};

interface FileActions {
  readonly place: EditorPlace | null;
  readonly openInEditor: ReturnType<typeof useOpenInEditor>;
  readonly revealInTree: (path: string) => void;
  readonly onOpenDiff: () => void;
}

const fileEntries = (subject: Subject, files: FileActions): ReadonlyArray<MenuEntryInput> => {
  const { path } = subject;
  const { place } = files;

  if (path === null || place === null) return [];

  return [
    {
      kind: "item",
      label: "Open in Editor",
      onSelect: () =>
        void files.openInEditor({
          hostKey: place.hostKey,
          path,
          root: place.root,
          workspaceId: place.workspaceId ?? null,
          line: subject.line,
        }),
    },
    subject.diff && { kind: "item", label: "Open diff", onSelect: files.onOpenDiff },
    MENU_SEPARATOR_ENTRY,
    {
      kind: "item",
      label: "Copy path",
      onSelect: () => copyWithToast(resolvePath(path, place.root), "path"),
    },
    { kind: "item", label: "Reveal in file tree", onSelect: () => files.revealInTree(path) },
    MENU_SEPARATOR_ENTRY,
  ];
};

const linkEntries = (subject: Subject, write: CopyWrite): ReadonlyArray<MenuEntryInput> =>
  subject.link === null
    ? []
    : [
        {
          kind: "item",
          label: subject.image ? "Open image" : "Open link",
          onSelect: () => void polaris().request("shell.openExternal", { url: subject.link ?? "" }),
        },
        copy(write, "Copy link", subject.link, "link"),
        MENU_SEPARATOR_ENTRY,
      ];

/** Reveal in file tree: Edit, its explorer opened down to the file. */
const useRevealInTree = (place: EditorPlace | null) => {
  const { setMode } = useShellActions();

  return (path: string) => {
    if (place === null || place.workspaceId == null) return;
    revealInExplorer({
      hostKey: place.hostKey,
      workspaceId: place.workspaceId,
      path: resolvePath(path, place.root),
    });
    setMode("edit");
  };
};

export interface TurnMenuProps {
  readonly hostKey: string;
  readonly sessionId: string;
  readonly turnId: string;
  /** The row's own Markdown, when the row is a finished reply. */
  readonly message: string | null;
  readonly live: boolean;
  readonly onOpenDiff: () => void;
  readonly children: ReactElement;
}

const NOTHING: Subject = {
  link: null,
  image: false,
  path: null,
  line: null,
  diff: false,
  command: null,
};

export const TurnMenu = ({
  hostKey,
  sessionId,
  turnId,
  message,
  live,
  onOpenDiff,
  children,
}: TurnMenuProps) => {
  const write = useCopyWrite();
  const place = useEditorPlace();
  const openInEditor = useOpenInEditor();
  const revealInTree = useRevealInTree(place);
  const [selected, setSelected] = useState("");
  const [subject, setSubject] = useState<Subject>(NOTHING);

  const view = useApp((s) =>
    s.sessions[sessionKey(hostKey, sessionId)]?.turns.find((t) => t.turn.id === turnId)
  );

  // One reply's output is its message: the menu offers it once.
  const output =
    live || view === undefined || replies(view) === 0 || (message !== null && replies(view) < 2)
      ? null
      : view;

  const entriesFor = (at: Subject, selection: string): ReadonlyArray<MenuEntryInput> => {
    const command = at.command === null || live ? null : commandOf(view, at.command);

    return [
      ...linkEntries(at, write),
      ...fileEntries(at, { place, openInEditor, revealInTree, onOpenDiff }),
      command !== null && copy(write, "Copy command", command.command, "command"),
      command !== null &&
        command.output !== "" &&
        copy(write, "Copy output", command.output, "output"),
      MENU_SEPARATOR_ENTRY,
      selection !== "" && copy(write, "Copy", selection, "selection"),
      message !== null && copy(write, "Copy message", message, "message"),
      output !== null &&
        copy(
          write,
          "Copy turn output",
          turnOutput(output.items.map(completedItemView)),
          "turn output"
        ),
    ];
  };

  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (!open) {
          setSelected("");
          setSubject(NOTHING);
        }
      }}
    >
      <ContextMenuTrigger
        asChild
        onContextMenu={(event) => {
          const at = event.target instanceof Element ? subjectAt(event.target) : NOTHING;
          const selection = selectionIn(event.currentTarget);

          // Nothing to offer here (a live reply): no menu, rather than an empty one.
          if (tidyEntries(entriesFor(at, selection)).length === 0) event.preventDefault();
          setSelected(selection);
          setSubject(at);
        }}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent data-testid="turn-menu">
        <ContextMenuEntries entries={entriesFor(subject, selected)} />
      </ContextMenuContent>
    </ContextMenu>
  );
};

/** A prompt's menu: Copy (the selection), Copy prompt · Fold turn. */
export const PromptMenu = ({
  text,
  onFold,
  children,
}: {
  readonly text: string;
  readonly onFold: () => void;
  readonly children: ReactElement;
}) => {
  const write = useCopyWrite();
  const [selected, setSelected] = useState("");

  const entries: ReadonlyArray<MenuEntryInput> = [
    selected !== "" && copy(write, "Copy", selected, "selection"),
    text !== "" && copy(write, "Copy prompt", text, "prompt"),
    MENU_SEPARATOR_ENTRY,
    { kind: "item", label: "Fold turn", onSelect: onFold },
  ];

  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (!open) setSelected("");
      }}
    >
      <ContextMenuTrigger
        asChild
        onContextMenu={(event) => setSelected(selectionIn(event.currentTarget))}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent data-testid="prompt-menu">
        <ContextMenuEntries entries={entries} />
      </ContextMenuContent>
    </ContextMenu>
  );
};
