import { beforeEach, describe, expect, test } from "bun:test";
import { toggleTerminal, tuckTerminal } from "./actions.ts";
import { putTab, type TerminalTab } from "./model/tabs.ts";
import { drawerKey, drawers, getDrawer, isTerminalShown, updateDrawer } from "./store.ts";

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

beforeEach(() => {
  drawers.setState({});
  updateDrawer(key, (d) => putTab(d, shell));
});

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
