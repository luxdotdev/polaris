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
import type { SpillStore } from "../model/draftStore.ts";
import { indexedDbSpill } from "./idbSpill.ts";
import { setVimHandlers } from "../cm/vim.ts";
import { closeTab, saveFile, startEditor } from "./actions.ts";
import { dirtyKeys, isConfigured, saveAll, setVim, unkeptKeys } from "./buffers.ts";
import { polaris } from "../../bridge.ts";
import { editorStore } from "./store.ts";
import { openFinder } from "../api.ts";

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
  /** Where big drafts go when `kv` is given (previews); the app uses IndexedDB. */
  readonly spill?: SpillStore | null;
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
    const sig = `${keys.join("\n")}|${[...unkeptKeys()].join("\n")}`;

    if (sig === last) return;
    last = sig;
    const unkept = unkeptKeys();

    void polaris().request("editor.publishDirty", {
      files: keys.map((key) => ({ ...splitKey(key), unkept: unkept.has(key) })),
    });
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
export const ensureEditor = ({ app, files, kv, spill, canWrite }: StartInput) => {
  if (isConfigured()) return;

  const has = (hostKey: string, capability: string) =>
    app()
      .hosts.find((h) => h.key === hostKey)
      ?.status.capabilities.some((c) => c === capability) ?? false;

  startEditor({
    files: files ?? createBridgeFiles(has),
    kv: kv === undefined ? storage() : kv,
    spill: kv === undefined ? indexedDbSpill() : (spill ?? null),
    prefs,
    canWrite: canWrite ?? ((hostKey) => has(hostKey, "files.write")),
    hostLabel: (hostKey) => app().hosts.find((h) => h.key === hostKey)?.label ?? hostKey,
    hostHome: (hostKey) => app().hosts.find((h) => h.key === hostKey)?.status.host?.homeDir ?? null,
  });

  setVimHandlers({
    save: (file) => saveFile(file.hostKey, file.path),
    // After vim has finished the command: closing destroys the view it is still using.
    close: (file) => setTimeout(() => closeTab(file.hostKey, file.workspaceId, file.path), 0),
    find: openFinder,
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
