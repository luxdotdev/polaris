/**
 * What the drawer does: open the Workspace's shell, run a command in a new
 * tab (a Harness's terminal UI, a sign-in), reopen an ended one in the same
 * cwd, and close tabs. Other features call `runInTerminal` and `toggleTerminal`.
 */
import type { TerminalId } from "@polaris/protocol";
import { showRefusal } from "../session/dispatch.ts";
import { polaris } from "../session/bridge.ts";
import {
  holdsProcess,
  patchTab,
  putTab,
  removeTab,
  SHELL_TAB,
  tabOf,
  type TerminalTab,
} from "./model/tabs.ts";
import { loaded } from "./loaded.ts";
import { drawerKey, getDrawer, updateDrawer } from "./store.ts";

/** Opens at a size the first fit corrects straight away. */
const INITIAL = { cols: 100, rows: 24 };

export interface TerminalPlace {
  readonly hostKey: string;
  readonly workspaceId: string;
}

export interface TerminalRun {
  /** Also the tab's identity: running again with the same key replaces that tab. */
  readonly key: string;
  readonly title: string;
  readonly cwd: string;
  readonly argv: ReadonlyArray<string> | null;
  readonly sessionId?: string | null;
}

const closeProcess = (hostKey: string, tab: TerminalTab) => {
  if (tab.terminalId === null) return;
  loaded.runtime?.disposeTerminal(hostKey, tab.terminalId);

  if (holdsProcess(tab))
    void polaris().request("terminal.close", {
      hostKey,
      // SAFETY: terminal ids come from `terminal.open` answers, persisted as strings.
      terminalId: tab.terminalId as TerminalId,
    });
};

/** Opens a terminal running `run` in a tab (replacing an ended tab with its key) and shows the drawer. */
export const runInTerminal = async (
  place: TerminalPlace,
  run: TerminalRun
): Promise<string | null> => {
  const key = drawerKey(place.hostKey, place.workspaceId);
  const previous = tabOf(getDrawer(key), run.key);

  if (previous !== undefined) closeProcess(place.hostKey, previous);

  updateDrawer(key, (d) =>
    putTab(d, {
      key: run.key,
      title: run.title,
      cwd: run.cwd,
      argv: run.argv,
      sessionId: run.sessionId ?? null,
      terminalId: null,
      status: { kind: "opening" },
    })
  );

  const result = await polaris().request("terminal.open", {
    hostKey: place.hostKey,
    cwd: run.cwd,
    argv: run.argv === null ? null : [...run.argv],
    ...INITIAL,
  });

  if (!result.ok) {
    updateDrawer(key, (d) =>
      patchTab(d, run.key, { status: { kind: "failed", message: result.error.message } })
    );
    showRefusal("Couldn't open a terminal", result.error);

    return null;
  }

  updateDrawer(key, (d) =>
    patchTab(d, run.key, { terminalId: result.value.terminalId, status: { kind: "live" } })
  );

  return result.value.terminalId;
};

/** Runs the tab's command again in its cwd. */
export const reopenTab = (place: TerminalPlace, tab: TerminalTab) =>
  runInTerminal(place, { ...tab, sessionId: tab.sessionId });

export const openShell = (place: TerminalPlace, cwd: string, title: string) =>
  runInTerminal(place, { key: SHELL_TAB, title, cwd, argv: null });

export const closeTab = (place: TerminalPlace, tabKey: string) => {
  const key = drawerKey(place.hostKey, place.workspaceId);
  const tab = tabOf(getDrawer(key), tabKey);

  if (tab !== undefined) closeProcess(place.hostKey, tab);
  updateDrawer(key, (d) => removeTab(d, tabKey));
};

export const activateTab = (place: TerminalPlace, tabKey: string) =>
  updateDrawer(drawerKey(place.hostKey, place.workspaceId), (d) => ({ ...d, active: tabKey }));

export const setDrawerHeight = (place: TerminalPlace, height: number) =>
  updateDrawer(drawerKey(place.hostKey, place.workspaceId), (d) => ({ ...d, height }));

/** Shows or hides the drawer; showing an empty one opens the Workspace's shell in `cwd`. */
export const toggleTerminal = (place: TerminalPlace, cwd: string, title: string) => {
  const key = drawerKey(place.hostKey, place.workspaceId);
  const drawer = getDrawer(key);

  if (drawer.open) {
    updateDrawer(key, (d) => ({ ...d, open: false }));

    return;
  }

  if (drawer.tabs.length === 0) void openShell(place, cwd, title);
  else updateDrawer(key, (d) => ({ ...d, open: true }));
};
