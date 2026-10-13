/**
 * A Review file's right-click menu (Paper M4), on its header in the diff and its row in the
 * file list: Mark as viewed, Collapse · Open in Editor, Copy path.
 */
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuEntries,
  ContextMenuTrigger,
  MENU_SEPARATOR_ENTRY,
  type MenuEntryInput,
} from "@polaris/ui";
import type { ReactElement } from "react";
import { resolvePath } from "../../../routes/editor.ts";
import { copyEntry } from "../../../shell/menu/index.ts";
import { useEditorPlace, useOpenInEditor } from "../../editor-links/index.ts";

export interface ReviewFileMenuProps {
  /** As the diff names it: relative to the repository. */
  readonly path: string;
  readonly deleted: boolean;
  readonly viewed: boolean;
  readonly onViewed: (viewed: boolean) => void;
  /** The header's fold; a list row has none. */
  readonly fold?: { readonly collapsed: boolean; readonly toggle: () => void };
  readonly children: ReactElement;
}

export const ReviewFileMenu = ({
  path,
  deleted,
  viewed,
  onViewed,
  fold,
  children,
}: ReviewFileMenuProps) => {
  const place = useEditorPlace();
  const open = useOpenInEditor();

  const entries: ReadonlyArray<MenuEntryInput> = [
    {
      kind: "item",
      label: viewed ? "Mark as not viewed" : "Mark as viewed",
      onSelect: () => onViewed(!viewed),
    },
    fold !== undefined && {
      kind: "item",
      label: fold.collapsed ? "Expand" : "Collapse",
      onSelect: fold.toggle,
    },
    MENU_SEPARATOR_ENTRY,
    place !== null &&
      !deleted && {
        kind: "item",
        label: "Open in Editor",
        onSelect: () =>
          open({
            hostKey: place.hostKey,
            root: place.root,
            workspaceId: place.workspaceId ?? null,
            path,
            line: null,
            column: null,
          }),
      },
    copyEntry("Copy path", place === null ? path : resolvePath(path, place.root)),
  ];

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent data-testid="review-file-menu">
        <ContextMenuEntries entries={entries} />
      </ContextMenuContent>
    </ContextMenu>
  );
};
