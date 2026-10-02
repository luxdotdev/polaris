/**
 * The selection bar, ⌘I and ⌘L on whichever editor is active. The editor feature supplies the
 * active view and runs `inlineExtensions` in every editor; this registers the two commands.
 */
import type { EditorView } from "@codemirror/view";
import { useEffect } from "react";
import { useCommands } from "../../shell/hooks.ts";
import { openInlineCard } from "./actions.ts";
import type { InlineFile } from "./cm/index.ts";
import { addSelectionToSession } from "./ui/AddToSession.tsx";

export interface ActiveEditor {
  readonly view: EditorView;
  readonly file: InlineFile;
}

/** Registers ⌘I and ⌘L while mounted; both act on `active()` and are off without an editor. */
export const useInlineCommands = (active: () => ActiveEditor | null) => {
  const commands = useCommands();

  useEffect(
    () =>
      commands.register({
        "editor.inlineChat": {
          run: () => {
            const editor = active();

            if (editor !== null) openInlineCard(editor.view);
          },
          enabled: () => active() !== null,
        },
        "editor.addToSession": {
          run: () => {
            const editor = active();

            if (editor !== null) addSelectionToSession(editor.view.state, editor.file);
          },
          enabled: () => active()?.view.state.selection.main.empty === false,
        },
      }),
    [commands, active]
  );
};
