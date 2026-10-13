/**
 * An editor tab's right-click menu (Paper M3): Close, Close others, Close to the right,
 * Close saved · Keep open · Copy path, Copy relative path, Reveal in file tree and Finder.
 */
import { MENU_SEPARATOR_ENTRY, type MenuEntryInput } from "@polaris/ui";
import { copyEntry, menuShortcut, revealInFinderEntry } from "../../../shell/menu/index.ts";
import { revealInExplorer } from "../explorer/index.ts";
import {
  closeOtherTabs,
  closeSavedTabs,
  closeTab,
  closeTabsToRight,
  pinFile,
} from "../runtime/actions.ts";
import type { TabView } from "../runtime/hooks.ts";

export interface TabMenuPlace {
  readonly hostKey: string;
  readonly workspaceId: string;
  readonly root: string;
  readonly tabs: ReadonlyArray<TabView>;
}

const relative = (path: string, root: string) =>
  path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;

/** ⌘W and ⌥⌘T show on the active tab only, the one they'd close around. */
export const tabEntries = (
  place: TabMenuPlace,
  tab: TabView,
  selected: boolean
): ReadonlyArray<MenuEntryInput> => {
  const { hostKey, workspaceId, root, tabs } = place;
  const at = tabs.findIndex((t) => t.id === tab.id);
  const files = tabs.filter((t) => t.view !== "log");

  const shortcut = (id: Parameters<typeof menuShortcut>[0]) =>
    selected ? menuShortcut(id) : undefined;

  return [
    {
      kind: "item",
      label: "Close",
      shortcut: shortcut("tab.close"),
      onSelect: () => closeTab(hostKey, workspaceId, tab.id),
    },
    files.length > 1 && {
      kind: "item",
      label: "Close others",
      shortcut: shortcut("tab.closeOthers"),
      onSelect: () => closeOtherTabs(hostKey, workspaceId, tab.id),
    },
    at < tabs.length - 1 && {
      kind: "item",
      label: "Close to the right",
      onSelect: () => closeTabsToRight(hostKey, workspaceId, tab.id),
    },
    files.some((t) => !t.dirty) && {
      kind: "item",
      label: "Close saved",
      onSelect: () => closeSavedTabs(hostKey, workspaceId),
    },
    MENU_SEPARATOR_ENTRY,
    tab.preview && {
      kind: "item",
      label: "Keep open",
      onSelect: () => pinFile(hostKey, workspaceId, tab.path),
    },
    MENU_SEPARATOR_ENTRY,
    copyEntry("Copy path", tab.path),
    copyEntry("Copy relative path", relative(tab.path, root)),
    {
      kind: "item",
      label: "Reveal in file tree",
      onSelect: () => revealInExplorer({ hostKey, workspaceId, path: tab.path }),
    },
    revealInFinderEntry(hostKey, tab.path),
  ];
};
