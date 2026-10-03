import "../../../styles.css";
import { createRoot } from "react-dom/client";
import { Toaster } from "@polaris/ui";
import * as P from "@polaris/protocol";
import type {
  AppEvent,
  PolarisApi,
  RequestInput,
  RequestOutput,
  RequestMethod,
  Result,
  LanguageApi,
} from "../../../../shared/api.ts";
import { LanguageRequestInputs, LanguageRequestOutputs } from "../../../../shared/languages.ts";
import { Schema } from "effect";
import { initialState } from "../../../store/store.ts";
import { standInBridge } from "../../bridge.ts";
import { ensureEditor } from "../runtime/app.ts";
import { saveFile, openFile, closeTab, answerClose, setWorkspaceRoot } from "../runtime/actions.ts";
import {
  viewOf,
  saveAll,
  whenLoaded,
  AUTOSAVE_MS,
  setVim,
  resetBuffers,
} from "../runtime/buffers.ts";
import { modelOf, editorStore } from "../runtime/store.ts";
import { fileKey } from "../model/drafts.ts";
import { createFakeFiles } from "../files/fake.ts";
import { bindFormatter } from "./bridge.ts";
import type { SaveProofControls } from "./proofTypes.ts";

const file = { hostKey: "fixture", workspaceId: "ws_fixture", path: "/fixture/main.ts" };

const key = fileKey(file.hostKey, file.path);

const selected = P.LanguageFormatterSelection.cases.Provider.make({ providerId: "fixture" });

const disk = createFakeFiles({ fixture: { [file.path]: "const n=0" } });

let event: ((input: AppEvent) => void) | null = null;

let quitResult: boolean | null = null;

let writeFailure = false;

let heldWrite: (() => void) | null = null;

let delayWrite = false;

let resolveFormat: ((value: string) => void) | null = null;

const finishFormat = (text: string) => resolveFormat?.(text);

let holdFormat = false;

let failFormat = false;

let formatEnabled = true;

const calls: string[] = [];

const facts: string[] = [];

const check = (ok: boolean, text: string) => {
  if (!ok) throw new Error(text);
  facts.push(text);
};

const languages: LanguageApi = {
  request: async (method, input) => ({
    ok: true,
    value: Schema.decodeUnknownSync(LanguageRequestOutputs[method])({
      scope: Schema.decodeUnknownSync(LanguageRequestInputs["languages.settings.get"])(input).scope,
      revision: 0,
      settings: { formatOnSave: formatEnabled, formatter: selected },
    }),
  }),
  subscribe: () => () => undefined,
};

const api: PolarisApi = {
  languages,
  request: async <M extends RequestMethod>(method: M, input: RequestInput<M>) => {
    if (method === "editor.savedAll") {
      const answer = Schema.decodeUnknownSync(Schema.Struct({ ok: Schema.Boolean }))(input);

      quitResult = answer.ok;
    } else if (method !== "editor.publishDirty")
      throw new Error(`Unexpected fixture request ${method}`);

    // SAFETY: the two admitted fixture methods both return null in RequestOutputs.
    return { ok: true, value: null } as Result<RequestOutput<M>>;
  },
  subscribe: () => () => undefined,
  onAppEvent: (listener) => {
    event = listener;

    return () => {
      event = null;
    };
  },
};

standInBridge(api);

setWorkspaceRoot(file.hostKey, file.workspaceId, "/fixture");

ensureEditor({
  app: () => initialState,
  files: {
    ...disk,
    write: async (...args) => {
      if (delayWrite)
        await new Promise<void>((resolve) => {
          heldWrite = resolve;
        });

      if (writeFailure) throw new Error("Fixture disk write refused");

      return disk.write(...args);
    },
  },
  kv: null,
  canWrite: () => true,
});

const root = document.getElementById("root");

if (root === null) throw new Error("Fixture root missing");

createRoot(root).render(
  <>
    <h1>Save formatting</h1>
    <Toaster />
  </>
);

const bind = () =>
  bindFormatter(file, {
    settings: async () => ({ formatOnSave: formatEnabled, formatter: selected }),
    format: async (snapshot) => {
      calls.push(snapshot.reason);

      if (failFormat) throw new Error("Fixture selected formatter failed");

      if (holdFormat)
        return new Promise<string>((resolve) => {
          resolveFormat = resolve;
        });

      return `${snapshot.text.replace(/;$/, "")};`;
    },
  });

let unbind = bind();

const waitUntil = async (predicate: () => boolean) => {
  const start = performance.now();

  while (!predicate()) {
    if (performance.now() - start > 5000) throw new Error("Fixture condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

const open = async () => {
  openFile(file);
  await whenLoaded(key);
  const view = viewOf(key);

  if (view === null) throw new Error("Fixture buffer absent");
  document.getElementById("editor")?.append(view.dom);

  return view;
};

const edit = async (text: string) => {
  const view = await open();

  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    userEvent: "input.type",
  });

  return view;
};

const run = async () => {
  await edit("manual");
  check(await saveFile(file.hostKey, file.path), "manual save succeeds");
  check(disk.text(file.hostKey, file.path) === "manual;", "manual waits for formatted text");
  await edit("all");
  check(await saveAll(), "Save All succeeds");
  check(calls.at(-1) === "save-all", "Save All uses common preflight");
  await edit("close");
  closeTab(file.hostKey, file.workspaceId, file.path);
  await answerClose("save");
  check(
    viewOf(key) === null && disk.text(file.hostKey, file.path) === "close;",
    "save before close awaits format/write"
  );
  check(calls.at(-1) === "close", "close reason reaches formatter");
  await edit("quit");
  event?.({ kind: "editor-save-all" });
  await waitUntil(() => quitResult !== null);
  check(
    quitResult === true && calls.at(-1) === "quit",
    "actual quit event awaits save and reports success"
  );
  const view = await edit("vim");
  const { settingsStore } = await import("../../settings/index.ts");

  settingsStore.setState((state) => ({ sessions: { ...state.sessions, editorVim: true } }));
  await setVim(true);
  const { Vim, getCM } = await import("@replit/codemirror-vim");
  const cm = getCM(view);

  if (cm === null || cm.state.vim === null) throw new Error("Vim not attached");
  // SAFETY: setVim installed Vim and the non-null Vim state was checked above.
  Vim.handleEx(cm as Parameters<typeof Vim.handleEx>[0], "w");
  await waitUntil(() => disk.text(file.hostKey, file.path) === "vim;");
  check(calls.at(-1) === "vim", "real Vim :w awaits common formatter");
  settingsStore.setState((state) => ({
    sessions: { ...state.sessions, editorVim: false, editorAutosave: true },
  }));
  await setVim(false);
  await edit("auto");
  await waitUntil(() => disk.text(file.hostKey, file.path) === "auto;");
  check(calls.at(-1) === "autosave", `real autosave awaits formatter after ${AUTOSAVE_MS}ms`);
  settingsStore.setState((state) => ({ sessions: { ...state.sessions, editorAutosave: false } }));
  holdFormat = true;
  await edit("before");
  const typing = saveFile(file.hostKey, file.path);

  await waitUntil(() => resolveFormat !== null);
  await edit("newer");
  check(await typing, "typing race saves newest snapshot");
  finishFormat("obsolete;");
  holdFormat = false;
  resolveFormat = null;
  check(disk.text(file.hostKey, file.path) === "newer", "late format cannot replace newer typing");
  delayWrite = true;
  await edit("write snapshot");
  const write = saveFile(file.hostKey, file.path);

  await waitUntil(() => heldWrite !== null);
  await edit("during write");
  heldWrite?.();
  delayWrite = false;
  check(
    !(await write) && modelOf(key)?.dirty === true,
    "typing during disk write prevents false close/quit success"
  );
  await saveFile(file.hostKey, file.path);
  holdFormat = true;
  await edit("dirty conflict");
  const conflict = saveFile(file.hostKey, file.path);

  await waitUntil(() => resolveFormat !== null);
  disk.agentWrite(file.hostKey, file.path, "agent text");
  await waitUntil(() => modelOf(key)?.conflict !== null);
  finishFormat("obsolete;");
  holdFormat = false;
  check(!(await conflict), "Agent disk edit prevents save");
  check(
    disk.text(file.hostKey, file.path) === "agent text",
    "Agent text retained by version checks"
  );
  resetBuffers();
  editorStore.setState({ tabs: {}, closing: null });
  await edit("disk fail");
  writeFailure = true;
  quitResult = null;
  event?.({ kind: "editor-save-all" });
  await waitUntil(() => quitResult !== null);
  check(
    quitResult === false && modelOf(key)?.dirty === true,
    "actual quit event reports disk failure and keeps draft"
  );
  writeFailure = false;
  await edit("formatter fail");
  failFormat = true;
  check(await saveFile(file.hostKey, file.path), "formatter failure still saves");
  check(
    disk.text(file.hostKey, file.path) === "formatter fail",
    "formatter failure writes unformatted text"
  );
  failFormat = false;
  unbind();
  await edit("selected unavailable");
  check(await saveFile(file.hostKey, file.path), "selected unavailable formatter still saves");
  unbind = bind();

  return { facts, calls, disk: disk.text(file.hostKey, file.path), watches: disk.watching() };
};

window.saveProof = {
  run,
  edit,
  save: () => saveFile(file.hostKey, file.path),
  enable: (value) => {
    formatEnabled = value;
  },
  cleanup: () => {
    unbind();
    resetBuffers();

    return disk.watching();
  },
} satisfies SaveProofControls;
