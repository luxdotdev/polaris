/**
 * What the Editor has unsaved, as the renderers say it, for the quit prompt
 * (`editorQuit.ts`). No Electron here: the IPC handlers import it.
 */

export interface DirtyFile {
  readonly hostKey: string;
  readonly path: string;
}

/** What each window last said it has unsaved, by window id. */
const dirtyByWindow = new Map<number, ReadonlyArray<DirtyFile>>();

let pending: ((ok: boolean) => void) | null = null;

/** A renderer's unsaved files, as they change. */
export const publishDirty = (windowId: number, files: ReadonlyArray<DirtyFile>) => {
  if (files.length === 0) dirtyByWindow.delete(windowId);
  else dirtyByWindow.set(windowId, files);
};

/** A renderer finished "Save and quit": true when every file saved. */
export const savedAll = (ok: boolean) => {
  pending?.(ok);
  pending = null;
};

/** Waits for `savedAll`. */
export const onSavedAll = (resolve: (ok: boolean) => void) => {
  pending = resolve;
};

export const allDirty = () => [...dirtyByWindow.values()].flat();

const name = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** "reconnect.ts", "reconnect.ts and transport.ts", "reconnect.ts, transport.ts and 3 more". */
export const fileList = (files: ReadonlyArray<DirtyFile>): string => {
  const names = files.map((f) => name(f.path));

  if (names.length <= 2) return names.join(" and ");

  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
};

export const quitMessage = (files: ReadonlyArray<DirtyFile>) => ({
  message:
    files.length === 1
      ? `Save changes to ${name(files[0]?.path ?? "")} before quitting?`
      : `Save changes to ${files.length} files before quitting?`,
  detail: `${fileList(files)} ${files.length === 1 ? "has" : "have"} unsaved edits. If you quit without saving, Polaris keeps them on this Mac and brings them back next time.`,
});
