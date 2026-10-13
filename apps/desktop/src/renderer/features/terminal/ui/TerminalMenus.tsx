/**
 * The terminal's right-click menus (Paper M2): in a terminal, Copy, Paste, Select all ·
 * Clear · Close terminal; on its tab, New terminal · Close terminal, Close other terminals.
 */
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuEntries,
  ContextMenuTrigger,
  MENU_SEPARATOR_ENTRY,
  type MenuEntryInput,
} from "@polaris/ui";
import { type ReactElement, useRef, useState } from "react";
import { copyWithToast, editShortcut } from "../../../shell/menu/index.ts";
import { polaris } from "../../bridge.ts";
import { closeTab, runInTerminal, type TerminalPlace } from "../actions.ts";
import { loaded } from "../loaded.ts";
import type { Drawer, TerminalTab } from "../model/tabs.ts";

const Menu = ({
  entries,
  testId,
  onOpen,
  onClosed,
  children,
}: {
  readonly entries: ReadonlyArray<MenuEntryInput>;
  readonly testId: string;
  readonly onOpen?: () => void;
  /** After the menu closed; false keeps the default focus return. */
  readonly onClosed?: () => boolean;
  readonly children: ReactElement;
}) => (
  <ContextMenu>
    <ContextMenuTrigger asChild onContextMenu={onOpen}>
      <div className="contents">{children}</div>
    </ContextMenuTrigger>
    <ContextMenuContent
      data-testid={testId}
      onCloseAutoFocus={(event) => {
        if (onClosed?.() === true) event.preventDefault();
      }}
    >
      <ContextMenuEntries entries={entries} />
    </ContextMenuContent>
  </ContextMenu>
);

export const SurfaceMenu = ({
  place,
  tab,
  terminalId,
  children,
}: {
  readonly place: TerminalPlace;
  readonly tab: TerminalTab;
  readonly terminalId: string;
  readonly children: ReactElement;
}) => {
  const [selection, setSelection] = useState("");
  // Paste goes through the Edit menu once the terminal has its focus back.
  const pasting = useRef(false);
  const runtime = () => loaded.runtime;

  const entries: ReadonlyArray<MenuEntryInput> = [
    {
      kind: "item",
      label: "Copy",
      shortcut: editShortcut("copy"),
      disabled: selection === "",
      onSelect: () => copyWithToast(selection, "selection"),
    },
    {
      kind: "item",
      label: "Paste",
      shortcut: editShortcut("paste"),
      onSelect: () => {
        pasting.current = true;
      },
    },
    {
      kind: "item",
      label: "Select all",
      shortcut: editShortcut("selectAll"),
      onSelect: () => runtime()?.selectAll(place.hostKey, terminalId),
    },
    MENU_SEPARATOR_ENTRY,
    { kind: "item", label: "Clear", onSelect: () => runtime()?.clear(place.hostKey, terminalId) },
    MENU_SEPARATOR_ENTRY,
    { kind: "item", label: "Close terminal", onSelect: () => closeTab(place, tab.key) },
  ];

  return (
    <Menu
      entries={entries}
      testId="terminal-menu"
      onOpen={() => setSelection(runtime()?.selection(place.hostKey, terminalId) ?? "")}
      onClosed={() => {
        runtime()?.focusTerminal(place.hostKey, terminalId);

        if (pasting.current) void polaris().request("edit.run", { action: "paste" });
        pasting.current = false;

        return true;
      }}
    >
      {children}
    </Menu>
  );
};

export const TabMenu = ({
  place,
  drawer,
  tab,
  cwd,
  title,
  children,
}: {
  readonly place: TerminalPlace;
  readonly drawer: Drawer;
  readonly tab: TerminalTab;
  /** Where a new terminal starts: the Workspace's folder. */
  readonly cwd: string;
  readonly title: string;
  readonly children: ReactElement;
}) => {
  const others = drawer.tabs.filter((t) => t.key !== tab.key);

  const entries: ReadonlyArray<MenuEntryInput> = [
    {
      kind: "item",
      label: "New terminal",
      onSelect: () =>
        void runInTerminal(place, { key: `shell:${crypto.randomUUID()}`, title, cwd, argv: null }),
    },
    MENU_SEPARATOR_ENTRY,
    { kind: "item", label: "Close terminal", onSelect: () => closeTab(place, tab.key) },
    others.length > 0 && {
      kind: "item",
      label: "Close other terminals",
      onSelect: () => {
        for (const other of others) closeTab(place, other.key);
      },
    },
  ];

  return (
    <Menu entries={entries} testId="terminal-tab-menu">
      {children}
    </Menu>
  );
};
