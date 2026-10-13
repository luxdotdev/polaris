import { expect, test } from "bun:test";
import type { ShortcutDetails } from "electron";
import { maintainWindowsShortcuts } from "./shortcuts.ts";

const root = "C:\\Users\\me\\AppData\\Local\\Polaris-arm64-win";

const folders = { desktop: "C:\\Desktop", programs: "C:\\Programs\\lux.dev LLC" };

test.each(["arm64", "x64"])(
  "native %s shortcuts use stable installed paths and activation identity",
  (arch) => {
    const writes: Array<{ path: string; details: ShortcutDetails }> = [];
    const removed: string[] = [];

    const port = {
      mkdir: () => {},
      write: (path: string, details: ShortcutDetails) => {
        writes.push({ path, details });

        return true;
      },
      remove: (path: string) => {
        removed.push(path);
      },
    };

    for (const version of ["0.0.1-dev", "1.2.3"])
      maintainWindowsShortcuts(`${root}\\app-${version}\\Polaris.exe`, arch, true, folders, port);

    expect(writes.map((entry) => entry.path)).toEqual([
      "C:\\Desktop\\Polaris.lnk",
      "C:\\Programs\\lux.dev LLC\\Polaris.lnk",
      "C:\\Desktop\\Polaris.lnk",
      "C:\\Programs\\lux.dev LLC\\Polaris.lnk",
    ]);

    for (const { details } of writes)
      expect(details).toEqual({
        target: `${root}\\Polaris.exe`,
        cwd: root,
        description: "Polaris",
        appUserModelId: `com.squirrel.Polaris-${arch}-win.Polaris`,
        toastActivatorClsid:
          arch === "arm64"
            ? "b7a186ff-6a93-521d-a48c-3797311c74e4"
            : "08a514c9-1c36-509b-b689-5bc3339a35d6",
      });

    maintainWindowsShortcuts(`${root}\\app-1.2.3\\Polaris.exe`, arch, false, folders, port);
    expect(removed).toEqual(["C:\\Desktop\\Polaris.lnk", "C:\\Programs\\lux.dev LLC\\Polaris.lnk"]);
    expect(writes).toHaveLength(4);
  }
);

test("failed native shortcut writes fail maintenance instead of reporting success", () => {
  expect(() =>
    maintainWindowsShortcuts(`${root}\\app-1.2.3\\Polaris.exe`, "arm64", true, folders, {
      mkdir: () => {},
      remove: () => {},
      write: () => false,
    })
  ).toThrow("Windows shortcut creation failed");
});
