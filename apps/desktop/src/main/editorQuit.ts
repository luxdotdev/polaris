/**
 * Quitting with unsaved edits in the Editor (spec §3): ask only when a file
 * changed. "Save and quit" has the renderers save; "Quit" keeps the edits as
 * drafts on this Mac, so they come back next launch; "Cancel" stays.
 */
import { BrowserWindow, dialog } from "electron";
import { type AppEvent, CHANNELS } from "../shared/api.ts";
import { allDirty, onSavedAll, quitMessage } from "./editorDirty.ts";

let released = false;

let asking = false;

/** Whether a quit must wait for the question. */
export const holdsQuit = () => !released && allDirty().length > 0;

const saveEverywhere = () =>
  new Promise<boolean>((resolve) => {
    const event: AppEvent = { kind: "editor-save-all" };
    const timer = setTimeout(() => resolve(false), 15_000);

    onSavedAll((ok) => {
      clearTimeout(timer);
      resolve(ok);
    });

    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(CHANNELS.app, event);
  });

/** Asks, and says whether to go on quitting. */
export const askToQuit = async (): Promise<boolean> => {
  if (asking) return false;
  asking = true;
  const files = allDirty();
  const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];

  const options: Electron.MessageBoxOptions = {
    type: "warning",
    ...quitMessage(files),
    buttons: ["Save and quit", "Quit", "Cancel"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  };

  try {
    const { response } =
      parent === undefined
        ? await dialog.showMessageBox(options)
        : await dialog.showMessageBox(parent, options);

    if (response === 2) return false;

    if (response === 0 && !(await saveEverywhere())) return false;
    released = true;

    return true;
  } finally {
    asking = false;
  }
};
