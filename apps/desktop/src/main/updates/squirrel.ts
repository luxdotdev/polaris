import { spawn } from "node:child_process";
import { win32 } from "node:path";

export const squirrelCommand = (platform: string, argv: ReadonlyArray<string>, exe: string) => {
  if (platform !== "win32") return null;
  const event = argv[1];
  const executable = win32.basename(exe);

  switch (event) {
    case "--squirrel-install":
    case "--squirrel-updated":
      return {
        executable: win32.resolve(win32.dirname(exe), "../Update.exe"),
        args: ["--createShortcut", executable],
      };
    case "--squirrel-uninstall":
      return {
        executable: win32.resolve(win32.dirname(exe), "../Update.exe"),
        args: ["--removeShortcut", executable],
      };
    case "--squirrel-obsolete":
      return { executable: null, args: [] };
    default:
      return null;
  }
};

/** Maintenance launches finish before the single-instance lock or any Client runtime starts. */
export const handleSquirrelStartup = async (
  platform: string,
  argv: ReadonlyArray<string>,
  exe: string,
  execute: (exe: string, args: string[]) => Promise<void> = runShortcut
): Promise<boolean> => {
  const command = squirrelCommand(platform, argv, exe);

  if (command === null) return false;

  if (command.executable !== null) await execute(command.executable, command.args);

  return true;
};

const runShortcut = (exe: string, args: string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true, timeout: 10_000 });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("Squirrel shortcut operation failed"))
    );
  });
