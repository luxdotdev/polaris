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

const released: string[] = [];

void mock.module("./buffers.ts", () => ({
  configureEditor: () => {},
  discardBuffer: () => {},
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

console.log(
  "12 held-save runtime scenarios passed; real answerClose + SaveCoordinator, fake buffer authority/ports, no renderer or disk proof"
);
