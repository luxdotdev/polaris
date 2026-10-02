/**
 * A Task row's menu, from ⋯ or a right-click (DESIGN.md, Claims): Accept… a, Send back… s,
 * Open in Review, Focus; and "Message the lead about this" with the two authorities.
 */
import type { MessageAuthority } from "@polaris/protocol";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  IconButton,
  DotsIcon,
} from "@polaris/ui";
import type { ReactNode } from "react";
import type { TaskRow } from "../model/index.ts";

export interface MenuActions {
  readonly onReview: (row: TaskRow, mode: "accept" | "send-back") => void;
  /** Records the user's verdict; the Lead still merges and accepts (spec §7). */
  readonly onApprove: (row: TaskRow) => void;
  readonly onFocus: (row: TaskRow) => void;
  readonly onOpenInReview: (row: TaskRow) => void;
  readonly onMessageLead: (row: TaskRow, authority: MessageAuthority) => void;
}

type Entry =
  | {
      readonly kind: "item";
      readonly label: string;
      readonly key?: string;
      readonly run: () => void;
    }
  | { readonly kind: "separator" }
  | { readonly kind: "label"; readonly text: string }
  | { readonly kind: "sub"; readonly label: string; readonly items: ReadonlyArray<Entry> };

export const menuEntries = (row: TaskRow, on: MenuActions): ReadonlyArray<Entry> => {
  const id = row.task.id;
  const review = row.projection.state === "review";

  const focus: Entry = { kind: "item", label: `Focus ${id}`, key: "↵", run: () => on.onFocus(row) };

  const open: Entry = { kind: "item", label: "Open in Review", run: () => on.onOpenInReview(row) };

  const message: Entry = {
    kind: "sub",
    label: "Message the lead about this",
    items: [
      {
        kind: "item",
        label: "Ask for a recommendation",
        run: () => on.onMessageLead(row, "recommend_and_return"),
      },
      {
        kind: "item",
        label: "Let it decide",
        run: () => on.onMessageLead(row, "may_decide_and_continue"),
      },
    ],
  };

  if (!review) return [focus, open, { kind: "separator" }, message];

  return [
    { kind: "item", label: "Accept…", key: "a", run: () => on.onReview(row, "accept") },
    { kind: "item", label: "Send back…", key: "s", run: () => on.onReview(row, "send-back") },
    ...(row.attempt?.approvedByUserAt == null
      ? [{ kind: "item", label: "Approve", run: () => on.onApprove(row) } satisfies Entry]
      : []),
    { kind: "separator" },
    open,
    focus,
    message,
    ...(row.promoted
      ? []
      : [{ kind: "label", text: "The lead is reviewing this claim" } satisfies Entry]),
  ];
};

const Dropdown = ({ entries }: { readonly entries: ReadonlyArray<Entry> }): ReactNode =>
  entries.map((e, n) => {
    switch (e.kind) {
      case "item":
        return (
          <DropdownMenuItem key={n} onSelect={e.run}>
            {e.label}
            {e.key === undefined ? null : <DropdownMenuShortcut>{e.key}</DropdownMenuShortcut>}
          </DropdownMenuItem>
        );
      case "separator":
        return <DropdownMenuSeparator key={n} />;
      case "label":
        return <DropdownMenuLabel key={n}>{e.text}</DropdownMenuLabel>;
      case "sub":
        return (
          <DropdownMenuSub key={n}>
            <DropdownMenuSubTrigger>{e.label}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <Dropdown entries={e.items} />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        );
    }
  });

const Context = ({ entries }: { readonly entries: ReadonlyArray<Entry> }): ReactNode =>
  entries.map((e, n) => {
    switch (e.kind) {
      case "item":
        return (
          <ContextMenuItem key={n} onSelect={e.run}>
            {e.label}
            {e.key === undefined ? null : <ContextMenuShortcut>{e.key}</ContextMenuShortcut>}
          </ContextMenuItem>
        );
      case "separator":
        return <ContextMenuSeparator key={n} />;
      case "label":
        return <ContextMenuLabel key={n}>{e.text}</ContextMenuLabel>;
      case "sub":
        return (
          <ContextMenuSub key={n}>
            <ContextMenuSubTrigger>{e.label}</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <Context entries={e.items} />
            </ContextMenuSubContent>
          </ContextMenuSub>
        );
    }
  });

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
      <Dropdown entries={menuEntries(row, on)} />
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
  <ContextMenuContent className="min-w-56">
    <Context entries={menuEntries(row, on)} />
  </ContextMenuContent>
);
