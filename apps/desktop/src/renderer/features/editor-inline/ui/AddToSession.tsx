/**
 * ⌘L, "Add to agent session" (spec §6): the selected lines go into an Agent Session's draft
 * as a source (the editor's text, so an unsaved edit can be shared on purpose). A picker of
 * this Workspace's sessions opens on the one last focused; ↵ adds and says where it went.
 */
import type { EditorState } from "@codemirror/state";
import type { SessionId } from "@polaris/protocol";
import {
  CommandDialog,
  CommandEmpty,
  CommandFooter,
  CommandInput,
  CommandItem,
  CommandList,
  PixelCheckIcon,
  showToast,
} from "@polaris/ui";
import { useState } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { workspaceKey } from "../../../routes/selection.ts";
import { SessionGlyph } from "../../../shell/glyphs.tsx";
import { useApp, useNav, useSelection, useShellActions } from "../../../shell/hooks.ts";
import { updateDraft } from "../../session/index.ts";
import type { InlineFile } from "../cm/index.ts";
import { relativeTo } from "../../editor-finder/model.ts";
import { type SelectedSource, sourceBlock, targetOrder, withSource } from "../model/source.ts";

interface Pending {
  readonly file: InlineFile;
  readonly lines: {
    readonly from: number;
    readonly to: number;
    readonly first: number;
    readonly last: number;
  };
  readonly text: string;
}

const pending = createStore<Pending | null>(() => null);

/** The whole lines a selection touches; null when nothing is selected. */
export const selectedLines = (state: EditorState): Omit<Pending, "file"> | null => {
  const { main } = state.selection;

  if (main.empty) return null;
  const first = state.doc.lineAt(main.from);
  const end = state.doc.lineAt(main.to);
  // A selection ending at a line's start doesn't take that line.

  const last =
    main.to === end.from && end.number > first.number ? state.doc.line(end.number - 1) : end;

  return {
    lines: { from: first.from, to: last.to, first: first.number, last: last.number },
    text: state.doc.sliceString(first.from, last.to),
  };
};

/** Opens the picker for the selection in `state`; false when nothing is selected. */
export const addSelectionToSession = (state: EditorState, file: InlineFile): boolean => {
  const selected = selectedLines(state);

  if (selected === null) return false;
  pending.setState({ file, ...selected });

  return true;
};

const close = () => pending.setState(null);

const Picker = ({ source }: { readonly source: Pending }) => {
  const { hostKey, workspaceId } = source.file;
  const model = useApp((s) => s.hostModels[hostKey]);
  const selection = useSelection();
  const remembered = useNav((s) => s.lastSession[workspaceKey(hostKey, workspaceId)] ?? null);
  const { selectSession } = useShellActions();
  const [query, setQuery] = useState("");

  const focused =
    selection.hostKey === hostKey && selection.workspaceId === workspaceId
      ? (selection.sessionId ?? remembered)
      : remembered;

  const sessions = targetOrder(
    [...(model?.sessions.values() ?? [])].flatMap(({ session: s }) =>
      s.workspaceId === workspaceId &&
      s.state !== "archived" &&
      s.title.toLowerCase().includes(query.trim().toLowerCase())
        ? [s]
        : []
    ),
    focused
  );

  const root = model?.workspaces.get(workspaceId)?.path ?? "/";

  const block: SelectedSource = {
    path: relativeTo(root, source.file.path),
    first: source.lines.first,
    last: source.lines.last,
    text: source.text,
  };

  const add = (sessionId: SessionId, title: string) => {
    updateDraft(hostKey, sessionId, (draft) => withSource(draft, sourceBlock(block)));
    close();
    showToast({
      source: "starlight",
      icon: <PixelCheckIcon size={16} />,
      title: `Added ${block.first === block.last ? `line ${block.first}` : `lines ${block.first}–${block.last}`} to ${title}`,
      message: "It's in the composer; nothing is sent yet.",
      action: { label: "Open session", onAction: () => selectSession({ hostKey, sessionId }) },
    });
  };

  return (
    <>
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Add to agent session"
        aria-label="Agent session"
      />
      <CommandList aria-label="Agent sessions">
        <CommandEmpty>No agent sessions in this workspace</CommandEmpty>
        {sessions.map((s) => (
          <CommandItem
            key={s.id}
            value={s.id}
            data-testid="add-target"
            leading={<SessionGlyph state={s.state} harness={s.harness} size={14} />}
            meta={s.id === focused ? "last focused" : undefined}
            onSelect={() => add(s.id, s.title === "" ? "the session" : s.title)}
          >
            {s.title === "" ? "Untitled session" : s.title}
          </CommandItem>
        ))}
      </CommandList>
      <CommandFooter>
        <span>↑↓ Move</span>
        <span>↵ Add</span>
        <span className="flex-1" />
        <span>esc</span>
      </CommandFooter>
    </>
  );
};

/** Mounted once; renders only while a selection waits for its session. */
export const AddToSession = () => {
  const source = useStore(pending, (s) => s);

  if (source === null) return null;

  return (
    <CommandDialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      shouldFilter={false}
      title="Add to agent session"
      description="Add the selected lines to an agent session's composer"
    >
      <Picker source={source} />
    </CommandDialog>
  );
};
