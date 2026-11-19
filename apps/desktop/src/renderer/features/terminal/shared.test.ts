import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PolarisApi } from "../../../shared/api.ts";
import { standInBridge } from "../bridge.ts";
import { closeTab, toggleTerminal, tuckTerminal } from "./actions.ts";
import { putTab, type TerminalTab } from "./model/tabs.ts";
import {
  drawerKey,
  drawers,
  getDrawer,
  isTerminalShown,
  terminalHoldsOutput,
  updateDrawer,
} from "./store.ts";

const place = { hostKey: "mac", workspaceId: "w1" };

const key = drawerKey(place.hostKey, place.workspaceId);

const shell: TerminalTab = {
  key: "shell",
  title: "polaris",
  cwd: "/home/me/polaris",
  argv: null,
  sessionId: null,
  terminalId: "t-1",
  status: { kind: "live" },
};

/** What each mode's drawer shows: Edit ignores a tuck, Orchestrate's Output doesn't. */
const shownInEdit = () => getDrawer(key).open;

const shownInOrchestrate = () => isTerminalShown(place.hostKey, place.workspaceId);

/** Whether Orchestrate's Output shows as the panel for the drawer's sake (else the rail). */
const holdsOutput = () => terminalHoldsOutput(place.hostKey, place.workspaceId);

beforeEach(() => {
  drawers.setState({}, true);
  updateDrawer(key, (d) => putTab(d, shell));
  standInBridge({
    // SAFETY: closing a tab ignores the `terminal.close` answer.
    request: () => Promise.resolve({ ok: true, value: null }) as never,
    subscribe: () => () => undefined,
    onAppEvent: () => () => undefined,
  } satisfies PolarisApi);
});

afterEach(() => standInBridge(null));

describe("one drawer for Orchestrate and Edit", () => {
  test("hiding it in either mode hides it in both", () => {
    toggleTerminal(place, shell.cwd, shell.title, shownInEdit());

    expect(shownInEdit()).toBe(false);
    expect(shownInOrchestrate()).toBe(false);
  });

  test("collapsing Output tucks it in Orchestrate and leaves Edit's open", () => {
    tuckTerminal(place);

    expect(shownInOrchestrate()).toBe(false);
    expect(shownInEdit()).toBe(true);
  });

  test("⌃` in Orchestrate reveals a tucked drawer rather than closing it", () => {
    tuckTerminal(place);
    toggleTerminal(place, shell.cwd, shell.title);

    expect(shownInOrchestrate()).toBe(true);
  });

  test("⌃` in Edit closes a tucked drawer it shows", () => {
    tuckTerminal(place);
    toggleTerminal(place, shell.cwd, shell.title, shownInEdit());

    expect(shownInEdit()).toBe(false);
    expect(getDrawer(key).tucked).toBe(false);
  });

  test("a new tab untucks, so it shows in the current mode", () => {
    tuckTerminal(place);
    updateDrawer(key, (d) => putTab(d, { ...shell, key: "shell:2", terminalId: "t-2" }));

    expect(shownInOrchestrate()).toBe(true);
  });
});

describe("closing the drawer's last tab", () => {
  test("closes only the drawer: Output stays open until the user hides it", () => {
    closeTab(place, shell.key);

    expect(shownInOrchestrate()).toBe(false);
    expect(holdsOutput()).toBe(true);

    tuckTerminal(place);

    expect(holdsOutput()).toBe(false);
  });

  test("leaves Output collapsed when the user had collapsed it over the drawer", () => {
    tuckTerminal(place);
    closeTab(place, shell.key);

    expect(holdsOutput()).toBe(false);
  });
});
