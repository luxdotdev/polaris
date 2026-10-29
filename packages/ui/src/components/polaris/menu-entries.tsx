/**
 * A menu as data: the same entries render as a right-click menu or a ⋯ dropdown, in
 * the one look (DESIGN.md, Menus). Builders return entries; `null` and `false` drop out,
 * and separators never lead, trail or double up.
 */
import type { ComponentType, ReactNode } from "react";

import { MENU_LABEL_TEXT } from "../../lib/menu";
import {
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "../ui/context-menu";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "../ui/dropdown-menu";

export interface MenuAction {
  readonly kind: "item";
  readonly label: string;
  readonly onSelect: () => void;
  /** It asks for more before it runs; the label ends in "…" (rule/ellipsis-means-input). */
  readonly needsInput?: boolean | undefined;
  readonly destructive?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  /** Why it's disabled, in the shortcut lane, when that isn't obvious ("No changes"). */
  readonly reason?: string | undefined;
  /** Its chord, already formatted ("⌥⌘T"), shown only when it would act on this target. */
  readonly shortcut?: string | undefined;
  readonly testId?: string | undefined;
}

export interface MenuSubmenu {
  readonly kind: "sub";
  readonly label: string;
  readonly entries: ReadonlyArray<MenuEntryInput>;
  readonly testId?: string | undefined;
}

export interface MenuSeparatorEntry {
  readonly kind: "separator";
}

export interface MenuLabelEntry {
  readonly kind: "label";
  readonly text: string;
}

export type MenuEntry = MenuAction | MenuSubmenu | MenuSeparatorEntry | MenuLabelEntry;

export type MenuEntryInput = MenuEntry | null | false | undefined;

export const MENU_SEPARATOR_ENTRY: MenuSeparatorEntry = { kind: "separator" };

/** Drops hidden entries and any separator that would lead, trail or follow another. */
export const tidyEntries = (input: ReadonlyArray<MenuEntryInput>): ReadonlyArray<MenuEntry> => {
  const out: Array<MenuEntry> = [];

  for (const entry of input) {
    if (entry === null || entry === false || entry === undefined) continue;
    const previous = out.at(-1);

    if (entry.kind === "separator" && (previous === undefined || previous.kind === "separator"))
      continue;
    out.push(entry);
  }

  while (out.at(-1)?.kind === "separator") out.pop();

  return out;
};

interface Kit {
  readonly Item: ComponentType<{
    readonly onSelect: () => void;
    readonly disabled: boolean;
    readonly needsInput: boolean;
    readonly destructive: boolean;
    readonly children?: ReactNode;
    readonly "data-testid"?: string;
  }>;
  readonly Label: ComponentType<{ readonly children?: ReactNode }>;
  readonly Separator: ComponentType;
  readonly Shortcut: ComponentType<{ readonly children?: ReactNode; readonly title?: string }>;
  readonly Sub: ComponentType<{ readonly children?: ReactNode }>;
  readonly SubTrigger: ComponentType<{
    readonly children?: ReactNode;
    readonly "data-testid"?: string;
  }>;
  readonly SubContent: ComponentType<{ readonly children?: ReactNode }>;
}

const CONTEXT: Kit = {
  Item: ContextMenuItem,
  Label: ContextMenuLabel,
  Separator: ContextMenuSeparator,
  Shortcut: ContextMenuShortcut,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
};

const DROPDOWN: Kit = {
  Item: DropdownMenuItem,
  Label: DropdownMenuLabel,
  Separator: DropdownMenuSeparator,
  Shortcut: DropdownMenuShortcut,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
};

const testId = (id: string | undefined) => (id === undefined ? {} : { "data-testid": id });

const Action = ({ kit, entry }: { readonly kit: Kit; readonly entry: MenuAction }) => {
  const trailing = entry.disabled === true ? (entry.reason ?? entry.shortcut) : entry.shortcut;

  return (
    <kit.Item
      onSelect={entry.onSelect}
      disabled={entry.disabled === true}
      needsInput={entry.needsInput === true}
      destructive={entry.destructive === true}
      {...testId(entry.testId)}
    >
      <span className={MENU_LABEL_TEXT}>{entry.label}</span>
      {trailing === undefined ? null : <kit.Shortcut title={trailing}>{trailing}</kit.Shortcut>}
    </kit.Item>
  );
};

const Entries = ({
  kit,
  entries,
}: {
  readonly kit: Kit;
  readonly entries: ReadonlyArray<MenuEntryInput>;
}) =>
  tidyEntries(entries).map((entry, n) => {
    switch (entry.kind) {
      case "separator":
        return <kit.Separator key={n} />;
      case "label":
        return <kit.Label key={n}>{entry.text}</kit.Label>;
      case "sub":
        return (
          <kit.Sub key={n}>
            <kit.SubTrigger {...testId(entry.testId)}>
              <span className={MENU_LABEL_TEXT}>{entry.label}</span>
            </kit.SubTrigger>
            <kit.SubContent>
              <Entries kit={kit} entries={entry.entries} />
            </kit.SubContent>
          </kit.Sub>
        );
      case "item":
        return <Action key={n} kit={kit} entry={entry} />;
    }
  });

/** Entries inside a ContextMenuContent. */
export const ContextMenuEntries = ({
  entries,
}: {
  readonly entries: ReadonlyArray<MenuEntryInput>;
}) => <Entries kit={CONTEXT} entries={entries} />;

/** Entries inside a DropdownMenuContent. */
export const DropdownMenuEntries = ({
  entries,
}: {
  readonly entries: ReadonlyArray<MenuEntryInput>;
}) => <Entries kit={DROPDOWN} entries={entries} />;
