/**
 * Open files and their editors: loading (with a kept draft), edits, saving
 * against the version on disk, disk changes (reload in place or the
 * conflict), and drafts kept across restarts. One CodeMirror view per open
 * file, alive while any tab shows it.
 */
import { EditorState, type Extension, type StateEffect } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { harnessHue } from "@polaris/ui";
import {
  type EditorFile,
  editorFile,
  onRegistrationsChanged,
  registeredCompartment,
  registeredExtensions,
} from "../cm/extensions.ts";
import {
  createFileState,
  fileCompartment,
  languageCompartment,
  lineEnding,
  lineEndingCompartment,
  readOnlyCompartment,
  vimCompartment,
} from "./editorState.ts";
import { clearFlash, FLASH_MS, reloadPlan, normalized, reloadChanges } from "../cm/reload.ts";
import { SaveCoordinator, type FormattingPort, type SaveReason } from "../formatting/index.ts";
import { cursorOf } from "../cm/cursor.ts";
import { loadLanguage } from "../cm/languages.ts";
import { currentMode, vimExtension } from "../cm/vim.ts";
import {
  type BufferEffect,
  type BufferEvent,
  type BufferModel,
  canSave,
  type DiskText,
  type FileVersion,
  loaded,
  sameVersion,
  step,
} from "../model/buffer.ts";
import { type Draft, draftMatches, fileKey, type KeyValue, workspaceKey } from "../model/drafts.ts";
import { createDraftStore, type DraftStore, type SpillStore } from "../model/draftStore.ts";
import { indentLabel, type Indent, lineSeparatorOf } from "../model/indent.ts";
import { languageFor } from "../model/language.ts";
import type { Unreadable } from "../model/notices.ts";
import type { EditorFiles, FileTarget } from "../files/port.ts";
import { editorStore, modelOf, patchBuffer, setBufferModel } from "./store.ts";
import { agentReload, staleAgent } from "./agent.ts";

export interface EditorPrefs {
  readonly vim: boolean;
  readonly autosave: boolean;
}

export interface EditorConfig {
  readonly formatting?: FormattingPort;
  readonly files: EditorFiles;
  /** Where drafts are kept; null keeps them in memory only. */
  readonly kv: KeyValue | null;
  /** Where big drafts' text goes (IndexedDB in the app). */
  readonly spill?: SpillStore | null;
  readonly prefs: () => EditorPrefs;
  /** The Host's name for messages ("Mac Studio"). */
  readonly hostLabel: (hostKey: string) => string;
  /** The Host's home directory, for `~` in paths; null until it has said. */
  readonly hostHome: (hostKey: string) => string | null;
  /** Whether a Host's Daemon can save (capability `files.write`). */
  readonly canWrite: (hostKey: string) => boolean;
}

/** Edits settle this long before the exact dirty check and the draft write. */
const SETTLE_MS = 300;

/** "Autosave after a short pause" (spec §3). */
export const AUTOSAVE_MS = 1000;

interface OpenBuffer {
  revision: number;
  save: SaveCoordinator | null;
  /** These three change when the file is renamed under its editor (`moveBuffer`). */
  key: string;
  file: EditorFile;
  target: FileTarget;
  view: EditorView | null;
  indent: Indent | null;
  unwatch: (() => void) | null;
  settle: ReturnType<typeof setTimeout> | null;
  autosave: ReturnType<typeof setTimeout> | null;
  flash: ReturnType<typeof setTimeout> | null;
  /** Where the view was scrolled when its tab was last hidden. */
  scroll: StateEffect<unknown> | null;
  /** A line to reveal once loaded. */
  reveal: { readonly line: number; readonly column: number } | null;
  /** The first edit pins a preview tab. */
  readonly onEdit: (file: EditorFile) => void;
  readonly onDirectory: () => void;
  /** Set for an open the user asked for: it can't be read, so the caller drops the tab and says why. */
  readonly onUnreadable: ((reason: Unreadable) => void) | null;
}

let config: EditorConfig | null = null;

const open = new Map<string, OpenBuffer>();

let vim: Extension = [];

let store: DraftStore | null = null;

export const configureEditor = (next: EditorConfig) => {
  config = next;
  store = createDraftStore(next.kv, next.spill ?? null);
};

const drafts = (): DraftStore => {
  if (store === null) throw new Error("the editor isn't configured");

  return store;
};

export const isConfigured = () => config !== null;

export const hostOf = (hostKey: string) => ({
  label: need().hostLabel(hostKey),
  home: need().hostHome(hostKey),
});

const need = (): EditorConfig => {
  if (config === null) throw new Error("the editor isn't configured");

  return config;
};

export const bufferOf = (key: string): OpenBuffer | undefined => open.get(key);

export const viewOf = (key: string): EditorView | null => open.get(key)?.view ?? null;

const textOf = (view: EditorView) => view.state.sliceDoc();

/** Who changed a file on disk, if an agent session is known to be editing it. */
const changedBy = (file: EditorFile): string | null => {
  const kind = editorStore
    .getState()
    .agentFiles[workspaceKey(file.hostKey, file.workspaceId)]?.get(file.path);

  return kind === undefined ? null : harnessHue(kind).name;
};

const keepDraft = (buffer: OpenBuffer) => {
  const model = modelOf(buffer.key);

  if (model === null || buffer.view === null) return;
  const { hostKey, path } = buffer.file;

  let kept = true;

  if (model.dirty)
    kept = drafts().write({ hostKey, path, text: textOf(buffer.view), base: model.version });
  else drafts().drop(hostKey, path);

  if (editorStore.getState().buffers[buffer.key]?.unkept === kept)
    patchBuffer(buffer.key, { unkept: !kept });
};

const applyEffect = (buffer: OpenBuffer, effect: BufferEffect) => {
  const view = buffer.view;

  if (effect === null || view === null) return;
  const separator = lineSeparatorOf(effect.text);

  // The disk switched line endings (QCHECK): adopt them first, so the reload and later saves keep them.
  if (separator !== view.state.lineBreak) {
    view.dispatch({ effects: lineEndingCompartment.reconfigure(lineEnding(separator)) });
  }

  const plan = reloadPlan(view.state, effect.text);

  if (plan === null) return;
  const active = editorStore.getState().active?.view === view;
  const top = view.state.doc.lineAt(view.lineBlockAtHeight(view.scrollDOM.scrollTop).from).number;
  const agent = agentReload(buffer.file, plan.spans, active);

  view.dispatch({ ...plan.spec, effects: [plan.spec.effects ?? [], ...agent.effects].flat() });

  // After the change: these positions are in the reloaded doc.
  if (agent.follow !== null) {
    view.dispatch({ effects: EditorView.scrollIntoView(agent.follow, { y: "center" }) });
  } else if (plan.rewrote) {
    const line = view.state.doc.line(Math.min(top, view.state.doc.lines));

    view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: "start" }) });
  }

  if (buffer.flash !== null) clearTimeout(buffer.flash);
  buffer.flash = setTimeout(() => {
    buffer.flash = null;
    buffer.view?.dispatch(clearFlash);
  }, FLASH_MS);
};

/** Steps the buffer's model and applies what follows; false when the file isn't loaded. */
const send = (buffer: OpenBuffer, event: BufferEvent): BufferModel | null => {
  const model = modelOf(buffer.key);

  if (model === null) return null;
  const next = step(model, event);

  setBufferModel(buffer.key, next.model);
  applyEffect(buffer, next.effect);
  keepDraft(buffer);

  return next.model;
};

/** Exact: compares the whole text, after edits settle (the dirty dot shows at once on any edit). */
const settleDirty = (buffer: OpenBuffer) => {
  buffer.settle = null;
  const model = modelOf(buffer.key);

  if (model === null || buffer.view === null) return;
  send(buffer, { kind: "edited", dirty: textOf(buffer.view) !== model.base });
};

const scheduleAutosave = (buffer: OpenBuffer) => {
  if (buffer.autosave !== null) clearTimeout(buffer.autosave);
  buffer.autosave = need().prefs().autosave
    ? setTimeout(() => {
        buffer.autosave = null;
        void saveBuffer(buffer.key, "autosave");
      }, AUTOSAVE_MS)
    : null;
};

const onEdited = (buffer: OpenBuffer) => {
  const model = modelOf(buffer.key);

  if (model !== null && !model.dirty) setBufferModel(buffer.key, { ...model, dirty: true });
  buffer.onEdit(buffer.file);

  if (buffer.settle !== null) clearTimeout(buffer.settle);
  buffer.settle = setTimeout(() => settleDirty(buffer), SETTLE_MS);
  scheduleAutosave(buffer);
};

let cursorTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * The status bar and breadcrumbs follow the cursor after the keystroke has painted: one
 * report per burst, so typing's own frame only carries the editor's work (QCHECK latency).
 */
const reportCursor = (update: ViewUpdate) => {
  if (editorStore.getState().active?.view !== update.view || cursorTimer !== null) return;
  cursorTimer = setTimeout(() => {
    cursorTimer = null;
    const view = editorStore.getState().active?.view;

    if (view !== undefined) editorStore.setState({ cursor: cursorOf(view.state) });
  }, 0);
};

const updateListener = (buffer: OpenBuffer) =>
  EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      buffer.revision++;
      buffer.save?.invalidate();
    }

    const edited = update.transactions.some((tr) => tr.docChanged && !tr.isUserEvent("reload"));

    if (edited) onEdited(buffer);

    if (update.selectionSet || update.docChanged || update.focusChanged) reportCursor(update);
  });

export const revealLine = (view: EditorView, line: number, column: number) => {
  const doc = view.state.doc;
  const at = doc.line(Math.max(1, Math.min(line, doc.lines)));
  const pos = Math.min(at.from + Math.max(0, column - 1), at.to);

  view.dispatch({
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: "nearest", yMargin: 80 }),
  });
};

interface StartingPoint {
  readonly text: string;
  readonly model: BufferModel;
}

/** The text to show and the model, from the disk and any kept draft. */
const startingPoint = (draft: Draft | null, disk: DiskText): StartingPoint => {
  if (draft === null || draft.text === disk.text) return { text: disk.text, model: loaded(disk) };

  // A draft made on an older disk: keep the edits, and show the disk's change as a conflict.
  if (!draftMatches(draft, disk.version)) {
    return {
      text: draft.text,
      model: { ...loaded(disk), dirty: true, conflict: { theirs: disk, by: null } },
    };
  }

  return { text: draft.text, model: { ...loaded(disk), dirty: true } };
};

const mount = (buffer: OpenBuffer, disk: DiskText, readOnly: boolean, draft: Draft | null) => {
  const { text, model } = startingPoint(draft, disk);

  const { state, indent } = createFileState({
    file: buffer.file,
    text,
    readOnly,
    vim,
    onUpdate: updateListener(buffer),
  });

  buffer.view = new EditorView({ state });
  buffer.indent = indent;
  setBufferModel(buffer.key, model);

  if (buffer.reveal !== null) revealLine(buffer.view, buffer.reveal.line, buffer.reveal.column);
  buffer.reveal = null;
  const view = buffer.view;

  void loadLanguage(languageFor(buffer.file.path, text.slice(0, 200).split("\n")[0])).then(
    (ext) => {
      if (buffer.view !== view) return;
      view.dispatch({ effects: languageCompartment.reconfigure(ext) });
      patchBuffer(buffer.key, { grammar: true });
    }
  );
};

const onDiskChange = async (buffer: OpenBuffer, version: FileVersion | null) => {
  if (version === null) {
    buffer.save?.invalidate();
    patchBuffer(buffer.key, { deleted: true });

    return;
  }

  const model = modelOf(buffer.key);

  if (model === null || buffer.view === null) return;

  if (model.version !== null && sameVersion(model.version, version)) return;
  buffer.save?.invalidate();
  const result = await need().files.read(buffer.target);

  if (result.kind !== "text" || buffer.view === null) return;
  patchBuffer(buffer.key, { deleted: false });
  send(buffer, {
    kind: "disk",
    disk: result,
    doc: textOf(buffer.view),
    by: changedBy(buffer.file),
  });
};

const load = async (buffer: OpenBuffer) => {
  const { files } = need();

  try {
    const result = await files.read(buffer.target);

    if (!open.has(buffer.key)) return;

    if (result.kind === "missing" && buffer.onUnreadable !== null) {
      buffer.onUnreadable(result);

      return;
    }

    if (result.kind !== "text") {
      patchBuffer(buffer.key, { status: result.kind === "binary" ? result : { kind: "missing" } });

      return;
    }

    const draft = await drafts().read(buffer.file.hostKey, buffer.file.path);

    if (!open.has(buffer.key)) return;
    mount(buffer, result, editorStore.getState().buffers[buffer.key]?.readOnly ?? false, draft);
    buffer.unwatch = files.watch(buffer.target, (version) => void onDiskChange(buffer, version));
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);

    if (/EISDIR|is a directory/i.test(message)) {
      buffer.onDirectory();

      return;
    }

    if (buffer.onUnreadable === null)
      patchBuffer(buffer.key, { status: { kind: "error", message } });
    else buffer.onUnreadable({ kind: "error", message });
  }
};

export interface OpenInput {
  readonly file: EditorFile;
  readonly root: string;
  readonly line: number | null;
  readonly column: number | null;
  readonly onEdit: (file: EditorFile) => void;
  /** The path was a folder: the caller drops its tab. */
  readonly onDirectory: () => void;
  readonly onUnreadable?: (reason: Unreadable) => void;
}

/** The file's buffer, loading it if new; reveals `line` once it has loaded. */
export const ensureBuffer = (input: OpenInput): OpenBuffer => {
  const key = fileKey(input.file.hostKey, input.file.path);
  const reveal = input.line === null ? null : { line: input.line, column: input.column ?? 1 };
  const existing = open.get(key);

  if (existing !== undefined) {
    if (reveal !== null && existing.view !== null)
      revealLine(existing.view, reveal.line, reveal.column);
    else if (reveal !== null) existing.reveal = reveal;

    return existing;
  }

  const buffer: OpenBuffer = {
    revision: 0,
    save: null,
    key,
    file: input.file,
    target: { hostKey: input.file.hostKey, path: input.file.path, root: input.root },
    view: null,
    indent: null,
    unwatch: null,
    settle: null,
    autosave: null,
    flash: null,
    scroll: null,
    reveal,
    onEdit: input.onEdit,
    onDirectory: input.onDirectory,
    onUnreadable: input.onUnreadable ?? null,
  };

  const draft = drafts().has(input.file.hostKey, input.file.path);

  open.set(key, buffer);
  editorStore.setState((s) => ({
    buffers: {
      ...s.buffers,
      [key]: {
        status: { kind: "loading" },
        language: languageFor(input.file.path),
        deleted: false,
        readOnly: !need().canWrite(input.file.hostKey),
        draft,
        grammar: false,
        unkept: false,
      },
    },
  }));
  void load(buffer);

  return buffer;
};

/** Closes a file's editor; a dirty buffer's draft stays for next time. */
export const releaseBuffer = (key: string) => {
  const buffer = open.get(key);

  if (buffer === undefined) return;
  buffer.save?.invalidate();

  if (buffer.settle !== null) {
    clearTimeout(buffer.settle);
    settleDirty(buffer);
  }

  for (const timer of [buffer.autosave, buffer.flash]) if (timer !== null) clearTimeout(timer);
  buffer.unwatch?.();
  buffer.view?.destroy();
  open.delete(key);
  editorStore.setState((s) => {
    const { [key]: _gone, ...buffers } = s.buffers;

    return { buffers, active: s.active?.view === buffer.view ? null : s.active };
  });
};

const savingNow = async (buffer: OpenBuffer, view: EditorView, model: BufferModel) => {
  const text = textOf(view);
  const target = buffer.target;

  send(buffer, { kind: "save-started", text });

  try {
    const result = await need().files.write(target, text, model.version);

    if (open.get(buffer.key) !== buffer || buffer.view !== view) return false;

    if (buffer.target !== target) {
      send(buffer, { kind: "save-failed", message: "The file moved while saving. Try again." });

      return false;
    }

    if (result.kind === "written") {
      send(buffer, { kind: "saved", version: result.version, doc: textOf(view) });

      return !modelOf(buffer.key)?.dirty && modelOf(buffer.key)?.conflict === null;
    }

    if (result.kind === "unsupported") {
      // The banner says the Daemon can't save; the edits stay, unsaved.
      send(buffer, { kind: "save-failed", message: "" });
      patchBuffer(buffer.key, { readOnly: true });

      return false;
    }

    if (result.current === null) {
      send(buffer, { kind: "save-failed", message: "This file was deleted on disk." });
      patchBuffer(buffer.key, { deleted: true });

      return false;
    }

    send(buffer, { kind: "save-rejected", current: result.current, by: changedBy(buffer.file) });

    return false;
  } catch (cause) {
    if (open.get(buffer.key) !== buffer || buffer.view !== view) return false;
    send(buffer, {
      kind: "save-failed",
      message: cause instanceof Error ? cause.message : String(cause),
    });

    return false;
  }
};

/** Saves one file; true when it is saved (or had nothing to save). */
const writeBuffer = async (key: string): Promise<boolean> => {
  const buffer = open.get(key);
  const model = modelOf(key);

  if (buffer?.view === null || buffer === undefined || model === null) return false;

  if (editorStore.getState().buffers[key]?.readOnly) return false;

  if (buffer.settle !== null) {
    clearTimeout(buffer.settle);
    settleDirty(buffer);
  }

  const settled = modelOf(key) ?? model;

  if (!settled.dirty) return true;

  if (!canSave(settled)) return false;

  return savingNow(buffer, buffer.view, settled);
};

const coordinator = (buffer: OpenBuffer) =>
  new SaveCoordinator(
    {
      snapshot: (reason) => {
        const model = modelOf(buffer.key);
        const status = editorStore.getState().buffers[buffer.key];

        if (
          buffer.view === null ||
          model === null ||
          !canSave(model) ||
          status?.readOnly ||
          status?.deleted
        )
          return null;

        return {
          file: buffer.file,
          text: textOf(buffer.view),
          version: buffer.revision,
          diskVersion: model.version,
          reason,
        };
      },
      current: (snapshot) => {
        const model = modelOf(buffer.key);
        const status = editorStore.getState().buffers[buffer.key];

        return (
          open.get(buffer.key) === buffer &&
          buffer.view !== null &&
          buffer.file === snapshot.file &&
          buffer.revision === snapshot.version &&
          model !== null &&
          model.version === snapshot.diskVersion &&
          model.conflict === null &&
          !status?.deleted &&
          !status?.readOnly
        );
      },
      apply: (text) => {
        const view = buffer.view;

        if (view === null) return;
        view.dispatch({
          changes: reloadChanges(view.state.doc.toString(), normalized(view.state, text)),
          userEvent: "input.format",
        });
      },
      write: () =>
        open.get(buffer.key) === buffer ? writeBuffer(buffer.key) : Promise.resolve(false),
    },
    need().formatting
  );

/** Every save path awaits the same preflight; newer dirty text prevents close/quit success. */
export const saveBuffer = (key: string, reason: SaveReason = "manual"): Promise<boolean> => {
  const buffer = open.get(key);

  if (buffer === undefined) return Promise.resolve(false);
  buffer.save ??= coordinator(buffer);

  return buffer.save.save(reason);
};

export const keepMine = (key: string) => {
  const buffer = open.get(key);

  if (buffer !== undefined) send(buffer, { kind: "keep-mine" });
};

export const takeTheirs = (key: string) => {
  const buffer = open.get(key);

  if (buffer !== undefined) send(buffer, { kind: "take-theirs" });
};

/** The view and file shown in a pane, for the status bar and other features. */
export const activate = (key: string | null) => {
  const buffer = key === null ? undefined : open.get(key);
  const previous = editorStore.getState().active;

  if (previous?.view === buffer?.view) return;

  editorStore.setState({
    active: buffer?.view == null ? null : { ...buffer.file, view: buffer.view },
    indent: buffer?.indent == null ? "Spaces 2" : indentLabel(buffer.indent),
    cursor: buffer?.view == null ? null : cursorOf(buffer.view.state),
    vimMode:
      buffer?.view == null || !need().prefs().vim
        ? editorStore.getState().vimMode
        : currentMode(buffer.view),
  });
};

/** Shows a file's editor in a pane, scrolled where it was; false while it is still loading. */
export const attachView = (key: string, parent: HTMLElement): boolean => {
  const buffer = open.get(key);
  const view = buffer?.view ?? null;

  if (buffer === undefined || view === null) return false;

  if (view.dom.parentElement !== parent) parent.replaceChildren(view.dom);

  if (buffer.scroll !== null) view.dispatch({ effects: buffer.scroll });
  buffer.scroll = null;
  view.requestMeasure();
  activate(key);

  return true;
};

/** Takes a file's editor out of its pane, remembering the scroll. */
export const detachView = (key: string) => {
  const buffer = open.get(key);
  const view = buffer?.view ?? null;

  if (buffer === undefined || view === null || !view.dom.isConnected) return;
  buffer.scroll = view.scrollSnapshot();
  view.dom.remove();

  if (editorStore.getState().active?.view === view) activate(null);
};

/** Every open file whose view exists, for reconfiguring them all. */
const views = () =>
  [...open.values()].flatMap((b) => (b.view === null ? [] : [{ buffer: b, view: b.view }]));

/** Turns vim mode on or off in every open editor (Settings → Editor → Vim mode). */
export const setVim = async (on: boolean) => {
  const next = on ? await vimExtension() : [];

  if (on !== need().prefs().vim) return;
  vim = next;

  for (const { view } of views()) view.dispatch({ effects: vimCompartment.reconfigure(next) });

  editorStore.setState({ vimMode: on ? "normal" : null });
};

export const setReadOnly = (key: string, readOnly: boolean) => {
  const view = open.get(key)?.view;

  patchBuffer(key, { readOnly });
  view?.dispatch({
    effects: readOnlyCompartment.reconfigure(readOnly ? EditorState.readOnly.of(true) : []),
  });
};

// The agent stopped editing a file, or started a new Turn: last Turn's marks go.
editorStore.subscribe((state, previous) => {
  if (state.agentEdits === previous.agentEdits) return;

  for (const { buffer, view } of views()) {
    const stale = staleAgent(buffer.file, view.state);

    if (stale !== null) view.dispatch({ effects: stale });
  }
});

onRegistrationsChanged(() => {
  for (const { buffer, view } of views()) {
    view.dispatch({
      effects: registeredCompartment.reconfigure(registeredExtensions(buffer.file)),
    });
  }
});

/** Files whose unsaved edit couldn't be kept on this Mac, for the quit prompt. */
export const unkeptKeys = (): ReadonlySet<string> =>
  new Set(
    Object.entries(editorStore.getState().buffers)
      .filter(([, b]) => b.unkept)
      .map(([key]) => key)
  );

/** The files with unsaved edits, open or kept as drafts, for the quit prompt. */
export const dirtyKeys = (): ReadonlyArray<string> =>
  Object.entries(editorStore.getState().buffers)
    .filter(([, b]) => (b.status.kind === "ready" && b.status.model.dirty) || b.draft)
    .map(([key]) => key);

/** Saves every open file with unsaved edits; true when all of them saved. */
export const saveAll = async (reason: SaveReason = "save-all"): Promise<boolean> => {
  const keys = dirtyKeys();

  await Promise.all(keys.map(whenLoaded));
  const results = await Promise.all(keys.map((key) => saveBuffer(key, reason)));

  return results.every(Boolean);
};

/** An open editor follows its file to the new path: view, undo, cursor, dirty state and draft. */
const rekey = (buffer: OpenBuffer, to: string) => {
  buffer.save?.invalidate();
  const from = buffer.key;
  const key = fileKey(buffer.file.hostKey, to);

  buffer.key = key;
  buffer.file = { ...buffer.file, path: to };
  buffer.target = { ...buffer.target, path: to };
  open.delete(from);
  open.set(key, buffer);
  buffer.view?.dispatch({
    effects: [
      fileCompartment.reconfigure(editorFile.of(buffer.file)),
      registeredCompartment.reconfigure(registeredExtensions(buffer.file)),
    ],
  });
  buffer.unwatch?.();
  buffer.unwatch = need().files.watch(
    buffer.target,
    (version) => void onDiskChange(buffer, version)
  );
  editorStore.setState((s) => {
    const { [from]: moved, ...buffers } = s.buffers;

    const active =
      s.active !== null && s.active.view === buffer.view ? { ...s.active, path: to } : s.active;

    return { buffers: moved === undefined ? buffers : { ...buffers, [key]: moved }, active };
  });
};

/** A renamed file keeps its editor, or (not loaded yet) its draft, at the new path. */
export const moveBuffer = async (hostKey: string, from: string, to: string) => {
  const buffer = open.get(fileKey(hostKey, from));
  const draft = await drafts().read(hostKey, from);

  if (buffer !== undefined) rekey(buffer, to);

  if (buffer?.view != null) keepDraft(buffer);
  // The renamed file holds the same bytes, so a kept draft still applies to its version.
  else if (draft !== null)
    drafts().write({ hostKey, path: to, text: draft.text, base: draft.base });
  drafts().drop(hostKey, from);
};

/** Unsaved edits a close would lose: a dirty buffer, or a kept draft for a file not loaded yet. */
export const hasUnsaved = (hostKey: string, path: string): boolean => {
  const key = fileKey(hostKey, path);
  const status = editorStore.getState().buffers[key]?.status;

  if (status?.kind === "ready") return status.model.dirty;

  return drafts().has(hostKey, path);
};

/** Closes a file's editor and forgets its unsaved edits ("Don't save"). */
export const discardBuffer = (hostKey: string, path: string) => {
  releaseBuffer(fileKey(hostKey, path));
  drafts().drop(hostKey, path);
};

/** Resolves once the file has loaded (or couldn't be). */
export const whenLoaded = (key: string): Promise<void> =>
  new Promise((resolve) => {
    const done = () => editorStore.getState().buffers[key]?.status.kind !== "loading";

    if (done()) {
      resolve();

      return;
    }

    const off = editorStore.subscribe(() => {
      if (!done()) return;
      off();
      resolve();
    });
  });

/** Test and preview hook: drop every open buffer. */
export const resetBuffers = () => {
  for (const key of Array.from(open.keys())) releaseBuffer(key);
};
