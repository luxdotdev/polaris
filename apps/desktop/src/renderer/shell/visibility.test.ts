import { describe, expect, test } from "bun:test";
import { type Command, WorkspaceId } from "@polaris/protocol";
import type { ShowToastOptions } from "@polaris/ui";
import { createStore } from "zustand/vanilla";
import { createCommandRegistry, type FollowUp } from "../routes/commands.ts";
import { hostModel, hostView } from "../routes/fixtures.testing.ts";
import { createNavigation } from "../routes/navigation.ts";
import { barHosts } from "../routes/topBar.ts";
import { type AppState, initialState } from "../store/store.ts";
import { afterHiding, createVisibility, hideCommand, workspaceCommands } from "./visibility.ts";

// No animation frames under bun test; the switch timer only needs the function to exist.
globalThis.requestAnimationFrame ??= () => 0;

const ws = (id: string) => WorkspaceId.make(id);

const setup = (opts: { readonly hiddenB?: boolean } = {}) => {
  const app = createStore<AppState>(() => ({
    ...initialState,
    hosts: [hostView("local"), hostView("studio")],
    hostModels: {
      local: hostModel([{ id: "a" }, { id: "b", hidden: opts.hiddenB ?? false }, { id: "c" }]),
      studio: hostModel([{ id: "s" }]),
    },
  }));

  const navigation = createNavigation({ app, storage: null });
  const sent: Array<{ hostKey: string; command: Command }> = [];
  const toasts: Array<ShowToastOptions> = [];
  let accept = true;

  const send = (hostKey: string, command: Command) => {
    sent.push({ hostKey, command });

    return Promise.resolve(accept);
  };

  const input = {
    app: app.getState,
    navigation,
    send,
    notify: (t: ShowToastOptions) => void toasts.push(t),
  };

  return {
    app,
    navigation,
    sent,
    toasts,
    input,
    visibility: createVisibility(input),
    refuse: () => {
      accept = false;
    },
  };
};

const hiding = (workspaceId: string, hidden: boolean) =>
  hideCommand({ hostKey: "local", workspaceId: ws(workspaceId) }, hidden);

describe("hiding a Workspace", () => {
  test("sends SetWorkspaceHidden to its Host, and nothing else", async () => {
    const { visibility, sent, navigation } = setup();

    navigation.actions.selectWorkspace({ hostKey: "local", workspaceId: ws("a") });
    expect(await visibility.hide({ hostKey: "local", workspaceId: ws("c") })).toBe(true);
    expect(sent.map((s) => s.hostKey)).toEqual(["local"]);
    expect(sent[0]?.command).toMatchObject(hiding("c", true));
    // Another Workspace was open: the view stays.
    expect(navigation.current().workspaceId).toEqual(ws("a"));
  });

  test("the open one hands the view to the next chip first", async () => {
    const { visibility, navigation } = setup();

    navigation.actions.selectWorkspace({ hostKey: "local", workspaceId: ws("b") });
    await visibility.hide({ hostKey: "local", workspaceId: ws("b") });
    expect(navigation.current().workspaceId).toEqual(ws("c"));
  });

  test("says what happened, and Undo shows it again and reopens it", async () => {
    const { visibility, toasts, sent, navigation } = setup();
    const target = { hostKey: "local", workspaceId: ws("b") };

    navigation.actions.selectWorkspace(target);
    await visibility.hide(target);
    expect(toasts[0]?.title).toBe("Hid b");
    expect(toasts[0]?.message).toBe(
      "Nothing was deleted; its sessions keep going. Right-click local to show it again."
    );

    toasts[0]?.action?.onAction();
    expect(sent.at(-1)?.command).toMatchObject(hiding("b", false));
    expect(navigation.current().workspaceId).toEqual(ws("b"));
  });

  test("a refusal shows no toast; an already hidden one isn't sent again", async () => {
    const refused = setup();

    refused.refuse();
    expect(await refused.visibility.hide({ hostKey: "local", workspaceId: ws("a") })).toBe(false);
    expect(refused.toasts).toEqual([]);

    const hidden = setup({ hiddenB: true });

    expect(await hidden.visibility.hide({ hostKey: "local", workspaceId: ws("b") })).toBe(false);
    expect(hidden.sent).toEqual([]);
  });

  test("the next chip, else the one before, else nothing (the Host itself)", () => {
    const { app } = setup();
    const state = app.getState();
    const bar = barHosts({ hosts: state.hosts, models: state.hostModels });

    // Bar order: studio first, this Mac last.
    expect(afterHiding(bar, { hostKey: "studio", workspaceId: ws("s") })).toEqual({
      hostKey: "local",
      workspaceId: ws("a"),
    });
    expect(afterHiding(bar, { hostKey: "local", workspaceId: ws("c") })).toEqual({
      hostKey: "local",
      workspaceId: ws("b"),
    });

    const alone = barHosts({
      hosts: [hostView("local")],
      models: { local: hostModel([{ id: "a" }]) },
    });

    expect(afterHiding(alone, { hostKey: "local", workspaceId: ws("a") })).toBeNull();
  });
});

describe("the Command Palette's Workspace commands", () => {
  const palette = (s: ReturnType<typeof setup>) => {
    const registry = createCommandRegistry({ platform: "mac" });
    const followUps: Array<FollowUp> = [];

    registry.provide(() => {
      const { workspaceId, topBar } = s.navigation.current();

      return workspaceId === null
        ? { values: { workspaceList: topBar === "workspaces" ? "top bar" : "sidebar" } }
        : { keys: ["workspace"], values: { workspace: workspaceId, workspaceList: "top bar" } };
    });
    registry.contribute(workspaceCommands({ ...s.input, visibility: s.visibility }));
    registry.onFollowUp((f) => void followUps.push(f));

    return { registry, followUps, titles: () => registry.palette().map((r) => r.title) };
  };

  test("hide the open Workspace, or show it when it's a hidden one", () => {
    const s = setup({ hiddenB: true });
    const { titles, registry } = palette(s);

    s.navigation.actions.selectWorkspace({ hostKey: "local", workspaceId: ws("a") });
    expect(titles()).toContain("Hide a from the top bar");
    expect(titles()).not.toContain("Show a in the top bar");

    s.navigation.actions.selectWorkspace({ hostKey: "local", workspaceId: ws("b") });
    expect(titles()).toContain("Show b in the top bar");
    expect(registry.runAny("workspace.show")).toBe(true);
    expect(s.sent[0]?.command).toMatchObject(hiding("b", false));
  });

  test("hide any shown Workspace by name, on any Host", () => {
    const s = setup({ hiddenB: true });
    const { registry, followUps } = palette(s);

    expect(registry.runAny("workspace.hideOther")).toBe(true);
    expect(followUps[0]?.choices.map((c) => c.title)).toEqual(["s", "a", "c"]);
    expect(followUps[0]?.choices[0]?.detail).toBe("studio · /code/s");

    followUps[0]?.choices[0]?.run();
    expect(s.sent[0]).toMatchObject({ hostKey: "studio", command: hiding("s", true) });
  });

  test("show hidden workspaces lists only hidden ones, and only when there are any", () => {
    const none = palette(setup());

    expect(none.titles()).not.toContain("Show hidden workspaces…");

    const s = setup({ hiddenB: true });
    const { registry, followUps, titles } = palette(s);

    expect(titles()).toContain("Show hidden workspaces…");
    registry.runAny("workspace.showHidden");
    expect(followUps[0]?.choices.map((c) => c.title)).toEqual(["b"]);
    followUps[0]?.choices[0]?.run();
    expect(s.sent[0]).toMatchObject({ hostKey: "local", command: hiding("b", false) });
  });
});
