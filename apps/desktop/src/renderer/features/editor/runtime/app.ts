/**
 * The Editor in the app: started the first time an editor pane mounts, with
 * the Daemon's files, drafts in `localStorage`, Settings → Editor, and the
 * vim commands wired to tabs and saving.
 */
import { settingsStore } from "../../settings/index.ts";
import type { AppState } from "../../../store/store.ts";
import { createBridgeFiles } from "../files/bridge.ts";
import type { EditorFiles } from "../files/port.ts";
import type { KeyValue } from "../model/drafts.ts";
import { setVimHandlers } from "../cm/vim.ts";
import { closeTab, saveFile, startEditor } from "./actions.ts";
import { dirtyKeys, isConfigured, saveAll, setVim } from "./buffers.ts";
import { polaris } from "../../bridge.ts";
import { editorStore } from "./store.ts";

let finder: (query: string) => void = () => undefined;

/** `:e <path>` and the like open the ⌘P finder through this; the finder feature sets it. */
export const setFileFinder = (open: (query: string) => void) => {
  finder = open;
};

const prefs = () => {
  const { editorVim, editorAutosave } = settingsStore.getState().sessions;

  return { vim: editorVim, autosave: editorAutosave };
};

const storage = (): KeyValue | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

export interface StartInput {
  readonly app: () => AppState;
  /** Previews pass fake files; the app uses the Daemon's. */
  readonly files?: EditorFiles;
  readonly kv?: KeyValue | null;
  readonly canWrite?: (hostKey: string) => boolean;
}

const splitKey = (key: string) => {
  const at = key.indexOf("\u0000");

  return { hostKey: key.slice(0, at), path: key.slice(at + 1) };
};

/** Tells main which files have unsaved edits, so quitting asks only when one does. */
const publishDirty = () => {
  let last = "";

  const publish = () => {
    const keys = dirtyKeys();
    const sig = keys.join("\n");

    if (sig === last) return;
    last = sig;
    void polaris().request("editor.publishDirty", { files: keys.map(splitKey) });
  };

  editorStore.subscribe((state, previous) => {
    if (state.buffers !== previous.buffers) publish();
  });
  polaris().onAppEvent((event) => {
    if (event.kind !== "editor-save-all") return;
    void saveAll().then((ok) => polaris().request("editor.savedAll", { ok }));
  });
};

/** Starts the Editor once per window; later calls do nothing. */
export const ensureEditor = ({ app, files, kv, canWrite }: StartInput) => {
  if (isConfigured()) return;

  const has = (hostKey: string, capability: string) =>
    app()
      .hosts.find((h) => h.key === hostKey)
      ?.status.capabilities.some((c) => c === capability) ?? false;

  startEditor({
    files: files ?? createBridgeFiles(has),
    kv: kv === undefined ? storage() : kv,
    prefs,
    canWrite: canWrite ?? ((hostKey) => has(hostKey, "files.write")),
    hostLabel: (hostKey) => app().hosts.find((h) => h.key === hostKey)?.label ?? hostKey,
  });

  setVimHandlers({
    save: (file) => saveFile(file.hostKey, file.path),
    close: (file) => closeTab(file.hostKey, file.workspaceId, file.path),
    find: (query) => finder(query),
    mode: (view, mode) => {
      if (editorStore.getState().active?.view === view) editorStore.setState({ vimMode: mode });
    },
  });

  publishDirty();

  if (prefs().vim) void setVim(true);
  settingsStore.subscribe((state, previous) => {
    if (state.sessions.editorVim !== previous.sessions.editorVim)
      void setVim(state.sessions.editorVim);
  });
};
