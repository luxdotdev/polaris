import { win32 } from "node:path";
import type { ShortcutDetails } from "electron";
import { windowsAppId } from "./platform.ts";

export interface ShortcutFolders {
  readonly desktop: string;
  readonly programs: string;
}

export interface ShortcutPort {
  readonly mkdir: (path: string) => void;
  readonly remove: (path: string) => void;
  readonly write: (path: string, details: ShortcutDetails) => boolean;
}

// UUIDv5 (OID namespace) of windowsAppId, matching Squirrel 5.4.4's activation IDs.
const TOAST_IDS = {
  arm64: "b7a186ff-6a93-521d-a48c-3797311c74e4",
  x64: "08a514c9-1c36-509b-b689-5bc3339a35d6",
};

export const maintainWindowsShortcuts = (
  executable: string,
  arch: string,
  create: boolean,
  folders: ShortcutFolders,
  port: ShortcutPort
): void => {
  const root = win32.resolve(win32.dirname(executable), "..");

  const paths = [
    win32.join(folders.desktop, "Polaris.lnk"),
    win32.join(folders.programs, "Polaris.lnk"),
  ];

  for (const path of paths) {
    if (!create) {
      port.remove(path);
      continue;
    }

    port.mkdir(win32.dirname(path));

    const written = port.write(path, {
      target: win32.join(root, "Polaris.exe"),
      cwd: root,
      description: "Polaris",
      appUserModelId: windowsAppId(arch),
      toastActivatorClsid: arch === "arm64" ? TOAST_IDS.arm64 : TOAST_IDS.x64,
    });

    if (!written) throw new Error(`Windows shortcut creation failed: ${path}`);
  }
};
