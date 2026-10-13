/**
 * A Task row's menu, from ⋯ or a right-click (DESIGN.md, Claims): Approve, Accept… A,
 * Send back… S, Open in Review, Focus; "Message the lead about this" and Copy task ID.
 */
import type { MessageAuthority } from "@polaris/protocol";
import {
  ContextMenuContent,
  ContextMenuEntries,
  DotsIcon,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuEntries,
  DropdownMenuTrigger,
  IconButton,
  MENU_SEPARATOR_ENTRY,
  type MenuEntry,
  type MenuEntryInput,
} from "@polaris/ui";
import { acceleratorLabel } from "../../../../shared/chord.ts";
import { copyEntry } from "../../../shell/menu/index.ts";
import type { TaskRow } from "../model/index.ts";
import { RAIL_KEYS } from "../model/keys.ts";

export interface MenuActions {
  readonly onReview: (row: TaskRow, mode: "accept" | "send-back") => void;
  /** Records the user's verdict; the Lead still merges and accepts (spec §7). */
  readonly onApprove: (row: TaskRow) => void;
  readonly onFocus: (row: TaskRow) => void;
  readonly onOpenInReview: (row: TaskRow) => void;
  readonly onMessageLead: (row: TaskRow, authority: MessageAuthority) => void;
}

export const menuEntries = (row: TaskRow, on: MenuActions): ReadonlyArray<MenuEntryInput> => {
  const id = row.task.id;
  const review = row.projection.state === "review";

  const focus: MenuEntry = {
    kind: "item",
    label: `Focus ${id}`,
    shortcut: acceleratorLabel(RAIL_KEYS.focus),
    onSelect: () => on.onFocus(row),
  };

  const open: MenuEntry = {
    kind: "item",
    label: "Open in Review",
    onSelect: () => on.onOpenInReview(row),
  };

  const message: MenuEntry = {
    kind: "sub",
    label: "Message the lead about this",
    entries: [
      {
        kind: "item",
        label: "Ask for a recommendation",
        onSelect: () => on.onMessageLead(row, "recommend_and_return"),
      },
      {
        kind: "item",
        label: "Let it decide",
        onSelect: () => on.onMessageLead(row, "may_decide_and_continue"),
      },
    ],
  };

  const copy = copyEntry("Copy task ID", id);

  if (!review) return [focus, open, MENU_SEPARATOR_ENTRY, message, copy];

  return [
    row.attempt?.approvedByUserAt == null
      ? { kind: "item", label: "Approve", onSelect: () => on.onApprove(row) }
      : { kind: "label", text: "You approved · the lead merges" },
    {
      kind: "item",
      label: "Accept…",
      needsInput: true,
      shortcut: acceleratorLabel(RAIL_KEYS.accept),
      onSelect: () => on.onReview(row, "accept"),
    },
    {
      kind: "item",
      label: "Send back…",
      needsInput: true,
      shortcut: acceleratorLabel(RAIL_KEYS.sendBack),
      onSelect: () => on.onReview(row, "send-back"),
    },
    MENU_SEPARATOR_ENTRY,
    open,
    focus,
    message,
    copy,
    !row.promoted && { kind: "label", text: "The lead is reviewing this claim" },
  ];
};

/** The ⋯ button and its menu; `open` lets the a/s keys and previews drive it. */
export const RowMenu = ({
  row,
  on,
  open,
  onOpenChange,
}: {
  readonly row: TaskRow;
  readonly on: MenuActions;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) => (
  <DropdownMenu open={open} onOpenChange={onOpenChange}>
    <DropdownMenuTrigger asChild>
      <IconButton
        size="sm"
        label={`${row.task.id} actions`}
        icon={<DotsIcon size={14} />}
        className="opacity-0 group-hover/row:opacity-100 group-data-[selected]/row:opacity-100 data-[state=open]:opacity-100"
      />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="min-w-56">
      <DropdownMenuEntries entries={menuEntries(row, on)} />
    </DropdownMenuContent>
  </DropdownMenu>
);

export const RowContextMenu = ({
  row,
  on,
}: {
  readonly row: TaskRow;
  readonly on: MenuActions;
}) => (
  <ContextMenuContent className="min-w-56" data-testid="task-context-menu">
    <ContextMenuEntries entries={menuEntries(row, on)} />
  </ContextMenuContent>
);
