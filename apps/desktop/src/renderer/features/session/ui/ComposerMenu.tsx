/**
 * The composer's right-click menu (Paper M2): Cut, Copy, Paste and Select all with the
 * standard chords, then Attach files…, which opens the macOS file picker.
 */
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuEntries,
  ContextMenuTrigger,
  MENU_SEPARATOR_ENTRY,
  type MenuEntryInput,
} from "@polaris/ui";
import { type ReactNode, useRef, useState } from "react";
import { editShortcut } from "../../../shell/menu/index.ts";
import { polaris } from "../../bridge.ts";

type EditAction = "cut" | "copy" | "paste" | "selectAll";

export const ComposerMenu = ({
  onFiles,
  children,
}: {
  /** Unset: the composer takes no files, and Attach files… is left out. */
  readonly onFiles: ((files: ReadonlyArray<File>) => void) | undefined;
  readonly children: ReactNode;
}) => {
  const picker = useRef<HTMLInputElement>(null);
  const field = useRef<HTMLElement | null>(null);
  const pending = useRef<EditAction | null>(null);
  const [selected, setSelected] = useState(false);

  // Run once the menu has closed and the field has its focus (and selection) back.
  const edit = (action: EditAction) => () => {
    pending.current = action;
  };

  const entries: ReadonlyArray<MenuEntryInput> = [
    {
      kind: "item",
      label: "Cut",
      shortcut: editShortcut("cut"),
      disabled: !selected,
      onSelect: edit("cut"),
    },
    {
      kind: "item",
      label: "Copy",
      shortcut: editShortcut("copy"),
      disabled: !selected,
      onSelect: edit("copy"),
    },
    { kind: "item", label: "Paste", shortcut: editShortcut("paste"), onSelect: edit("paste") },
    {
      kind: "item",
      label: "Select all",
      shortcut: editShortcut("selectAll"),
      onSelect: edit("selectAll"),
    },
    MENU_SEPARATOR_ENTRY,
    onFiles !== undefined && {
      kind: "item",
      label: "Attach files…",
      needsInput: true,
      onSelect: () => picker.current?.click(),
    },
  ];

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger
          asChild
          onContextMenu={(event) => {
            field.current =
              event.target instanceof Element
                ? event.target.closest<HTMLElement>("[contenteditable], textarea")
                : null;
            setSelected((window.getSelection()?.toString() ?? "") !== "");
          }}
        >
          <div className="contents">{children}</div>
        </ContextMenuTrigger>
        <ContextMenuContent
          data-testid="composer-menu"
          onCloseAutoFocus={(event) => {
            const action = pending.current;

            pending.current = null;

            if (action === null) return;
            event.preventDefault();
            field.current?.focus();
            void polaris().request("edit.run", { action });
          }}
        >
          <ContextMenuEntries entries={entries} />
        </ContextMenuContent>
      </ContextMenu>
      {onFiles === undefined ? null : (
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          data-testid="attach-files-input"
          onChange={(event) => {
            const files = [...(event.currentTarget.files ?? [])];

            event.currentTarget.value = "";

            if (files.length > 0) onFiles(files);
          }}
        />
      )}
    </>
  );
};
