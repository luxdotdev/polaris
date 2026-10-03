import { strict as assert } from "node:assert";
import { mock } from "bun:test";
import { LanguageFormatterSelection } from "@polaris/protocol";
import { SaveCoordinator } from "../formatting/index.ts";
import { editorStore, tabsOf } from "./store.ts";
import { workspaceKey } from "../model/drafts.ts";

const deferred = () => {
  let finish = () => {};

  const promise = new Promise<void>((resolve) => {
    finish = resolve;
  });

  return { promise, finish: () => finish() };
};

const host = "fake";

const ws = "fixture";

const a = "/fixture/a.md";

const b = "/fixture/b.md";

const key = workspaceKey(host, ws);

const authority = { text: "# Dirty A", dirty: true, undo: ["# Original A"] };

let save = async () => false;

let loaded = async () => {};

let discard = async (_current?: () => boolean) => true;

const released: string[] = [];

void mock.module("./buffers.ts", () => ({
  configureEditor: () => {},
  discardBuffer: (_host: string, _path: string, current?: () => boolean) => discard(current),
  ensureBuffer: () => {},
  hasUnsaved: (_host: string, path: string) => path === a && authority.dirty,
  hostOf: () => ({ label: "Fake", home: null }),
  moveBuffer: () => {},
  isConfigured: () => true,
  keepMine: () => {},
  releaseBuffer: (bufferKey: string) => released.push(bufferKey),
  saveBuffer: (_key: string, reason: string) => {
    assert.equal(reason, "close");

    return save();
  },
  takeTheirs: () => {},
  whenLoaded: () => loaded(),
}));

const actions = await import("./actions.ts");

const scenario = async (
  phase: "format" | "write" | "load",
  change: "follow" | "reopen" | "none",
  ok = true
) => {
  const gate = deferred();
  const entered = deferred();
  authority.text = "# Dirty A";
  authority.dirty = true;
  released.length = 0;
  editorStore.setState({
    tabs: {
      [key]: {
        tabs: [
          { path: a, preview: false, view: "markdown", locked: false },
          { path: b, preview: false },
        ],
        active: a,
        activeView: "markdown",
      },
    },
    closing: null,
  });
  loaded = async () => {
    if (phase === "load") {
      entered.finish();
      await gate.promise;
    }
  };

  const coordinator = new SaveCoordinator(
    {
      snapshot: (reason) => ({
        file: { hostKey: host, workspaceId: ws, path: a },
        text: authority.text,
        version: 1,
        diskVersion: null,
        reason,
      }),
      current: () => true,
      apply: (text) => {
        authority.text = text;
      },
      write: async () => {
        if (phase === "write") {
          entered.finish();
          await gate.promise;
        }

        if (ok) authority.dirty = false;

        return ok;
      },
    },
    {
      settings: async () => ({
        formatOnSave: true,
        formatter: LanguageFormatterSelection.cases.Provider.make({ providerId: "fake" }),
      }),
      format: async (snapshot) => {
        if (phase === "format") {
          entered.finish();
          await gate.promise;
        }

        return snapshot.text;
      },
      failure: () => {},
    }
  );

  save = () => coordinator.save("close");
  actions.closeTab(host, ws, "markdown-preview");
  assert.equal(editorStore.getState().closing?.path, a);
  const pending = actions.answerClose("save");
  await entered.promise;

  if (change === "follow") {
    actions.activateTab(host, ws, b);
    actions.openMarkdownPreview(host, ws);
  }

  if (change === "reopen") {
    const set = tabsOf(editorStore.getState(), key);
    editorStore.setState({
      tabs: { [key]: { ...set, tabs: set.tabs.filter((t) => t.view !== "markdown") } },
    });
    editorStore.setState({ tabs: { [key]: { ...set, tabs: set.tabs.map((t) => ({ ...t })) } } });
  }

  gate.finish();
  await pending;
  const after = tabsOf(editorStore.getState(), key);
  const preview = after.tabs.find((t) => t.view === "markdown");

  if (change === "none" && ok) assert.equal(preview, undefined);
  else
    assert.equal(
      preview?.path,
      change === "follow" ? b : a,
      `${phase}/${change}: save decision must preserve changed view`
    );

  if (change === "follow") {
    assert.equal(after.active, b);
    assert.equal(after.activeView, "markdown");
    assert.ok(after.tabs.some((t) => t.path === a && t.view === undefined));
    assert.equal(released.includes(`${host}\u0000${a}`), false);
  }

  assert.equal(authority.text, "# Dirty A");
  assert.deepEqual(authority.undo, ["# Original A"]);
  assert.equal(authority.dirty, !ok);
};

for (const phase of ["format", "write", "load"] as const) {
  await scenario(phase, "follow");
  await scenario(phase, "reopen");
  await scenario(phase, "none");
  await scenario(phase, "none", false);
}

const discardScenario = async (change: "follow" | "reopen" | "shared" | "none" | "failure") => {
  const gate = deferred();
  const entered = deferred();
  authority.dirty = true;
  editorStore.setState({
    tabs: {
      [key]: {
        tabs: [
          { path: a, preview: false, view: "markdown", locked: false },
          { path: b, preview: false },
        ],
        active: a,
        activeView: "markdown",
      },
    },
    closing: null,
  });
  discard = async (current) => {
    entered.finish();
    await gate.promise;

    if (change === "failure") throw new Error("Durable intervention failed");

    assert.ok(current, "Discard requires a post-await lifetime/shared-view guard");

    if (!current()) return false;
    authority.dirty = false;

    return true;
  };

  actions.closeTab(host, ws, "markdown-preview");
  const pending = actions.answerClose("discard");
  await entered.promise;
  assert.ok(tabsOf(editorStore.getState(), key).tabs.some((tab) => tab.view === "markdown"));

  if (change === "follow") {
    actions.activateTab(host, ws, b);
    actions.openMarkdownPreview(host, ws);
  } else if (change === "reopen") {
    const set = tabsOf(editorStore.getState(), key);
    editorStore.setState({
      tabs: { [key]: { ...set, tabs: set.tabs.map((tab) => ({ ...tab })) } },
    });
  } else if (change === "shared") {
    const set = tabsOf(editorStore.getState(), key);
    editorStore.setState({
      tabs: { [key]: { ...set, tabs: [...set.tabs, { path: a, preview: false }] } },
    });
  }

  gate.finish();

  if (change === "failure") await assert.rejects(pending, /Durable intervention failed/);
  else await pending;
  const preview = tabsOf(editorStore.getState(), key).tabs.find((tab) => tab.view === "markdown");
  let expected: string | undefined = a;

  if (change === "none") expected = undefined;
  else if (change === "follow") expected = b;
  assert.equal(preview?.path, expected);
  assert.equal(authority.dirty, change !== "none");
};

for (const change of ["follow", "reopen", "shared", "none", "failure"] as const)
  await discardScenario(change);

console.log(
  "12 held-save runtime scenarios passed; real answerClose + SaveCoordinator, fake buffer authority/ports, no renderer or disk proof"
);

console.log(
  "5 held-discard runtime scenarios passed; injected durable intervention, no renderer proof"
);
