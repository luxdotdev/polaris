/**
 * The Editor's light entry for features the shell loads at startup (open in
 * editor, the finder, the inline chat): no CodeMirror here, so an app that
 * never opens the Editor never loads it. Calls made before the Editor starts
 * wait for it; `index.ts` re-exports all of this for code inside Edit mode.
 */
import type { Extension } from "@codemirror/state";

export interface EditorFile {
  readonly hostKey: string;
  readonly workspaceId: string;
  /** Absolute on the Host. */
  readonly path: string;
}

export interface OpenFileRequest {
  readonly hostKey: string;
  readonly workspaceId: string;
  /** Absolute on the Host, or relative to the Workspace's root. */
  readonly path: string;
  /** 1-based. */
  readonly line?: number;
  readonly column?: number;
  /** A single click in the explorer: replaced by the next preview until edited. */
  readonly preview?: boolean;
}

export type EditorExtensionFactory = (file: EditorFile) => Extension;

let opener: ((request: OpenFileRequest) => void) | null = null;

const waiting: Array<OpenFileRequest> = [];

/** Opens a file in its Workspace's editor; before the Editor has started, once it does. */
export const openFile = (request: OpenFileRequest) => {
  if (opener === null) waiting.push(request);
  else opener(request);
};

/** The Editor, starting: from now on it takes the opens, the waiting ones first. */
export const takeOpens = (open: (request: OpenFileRequest) => void) => {
  opener = open;

  for (const request of waiting.splice(0)) open(request);
};

let finder: (query: string) => void = () => undefined;

/** `:e <path>` and the like open the ⌘P finder through this; the finder feature sets it. */
export const setFileFinder = (open: (query: string) => void) => {
  finder = open;
};

export const openFinder = (query: string) => finder(query);

const factories: Array<EditorExtensionFactory> = [];

const listeners = new Set<() => void>();

const changed = () => {
  for (const listener of listeners) listener();
};

/** Adds extensions to every editor, open ones included; call the result to remove them. */
export const registerEditorExtensions = (factory: EditorExtensionFactory): (() => void) => {
  factories.push(factory);
  changed();

  return () => {
    const at = factories.indexOf(factory);

    if (at === -1) return;
    factories.splice(at, 1);
    changed();
  };
};

const lazy: Array<() => Promise<EditorExtensionFactory>> = [];

/**
 * Like `registerEditorExtensions`, for a feature whose CodeMirror code is its own chunk: `load`
 * runs when the Editor starts, so startup doesn't pay for it.
 */
export const registerLazyEditorExtensions = (load: () => Promise<EditorExtensionFactory>) => {
  lazy.push(load);

  if (opener !== null) void load().then(registerEditorExtensions);
};

/** The Editor, starting: loads the lazy registrations. */
export const loadLazyExtensions = () => {
  for (const load of lazy) void load().then(registerEditorExtensions);
};

/** Every registered factory's extensions for one file. */
export const registeredFor = (file: EditorFile): ReadonlyArray<Extension> =>
  factories.map((factory) => factory(file));

/** Called when the registered set changes, so open editors reconfigure. */
export const onRegistrationsChanged = (listener: () => void): (() => void) => {
  listeners.add(listener);

  return () => listeners.delete(listener);
};

export { getActiveEditor, useActiveEditor } from "./runtime/hooks.ts";

export type { ActiveEditor } from "./runtime/store.ts";
