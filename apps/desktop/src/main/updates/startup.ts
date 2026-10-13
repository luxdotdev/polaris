import { mkdirSync, rmSync } from "node:fs";
import { win32 } from "node:path";
import { app, shell } from "electron";
import { handleSquirrelStartup, repairSquirrelFirstRun } from "./squirrel.ts";
import { maintainWindowsShortcuts } from "./shortcuts.ts";

const shortcuts = async (_exe: string, args: string[]) => {
  maintainWindowsShortcuts(
    process.execPath,
    process.arch,
    args[0] === "--createShortcut",
    {
      desktop: app.getPath("desktop"),
      programs: win32.join(
        app.getPath("appData"),
        "Microsoft/Windows/Start Menu/Programs/lux.dev LLC"
      ),
    },
    {
      mkdir: (path) => {
        mkdirSync(path, { recursive: true });
      },
      remove: (path) => rmSync(path, { force: true }),
      write: (path, details) => shell.writeShortcutLink(path, "create", details),
    }
  );
};

// Squirrel's hook deadline includes startup; load the Client only for normal launches.
if (await handleSquirrelStartup(process.platform, process.argv, process.execPath, shortcuts))
  app.exit(0);
else {
  await repairSquirrelFirstRun(process.platform, process.argv, process.execPath, shortcuts);
  await import(new URL("./index.js", import.meta.url).href);
}
