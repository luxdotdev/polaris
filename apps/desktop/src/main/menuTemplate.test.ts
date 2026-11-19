import { describe, expect, test } from "bun:test";
import type { MenuItemConstructorOptions } from "electron";
import type { AppUpdateView } from "../shared/appUpdates.ts";
import type { ClientPlatform } from "../shared/platform.ts";
import { menuTemplate, type TemplateInput } from "./menuTemplate.ts";

const MB = 1_000_000;

const updates = (phase: AppUpdateView["phase"]): AppUpdateView =>
  // SAFETY: the template reads only phase, supported, readyVersion and download.
  ({
    phase,
    supported: true,
    readyVersion: phase === "ready" ? "1.2.0" : null,
    download:
      phase === "downloading"
        ? { version: "0.12.1", receivedBytes: 48 * MB, totalBytes: 131 * MB }
        : null,
  }) as AppUpdateView;

const input = (
  platform: ClientPlatform,
  phase: AppUpdateView["phase"] = "idle"
): TemplateInput => ({
  platform,
  send: () => {},
  // SAFETY: the template reads only theme, density and wordWrap.
  appearance: {
    theme: "system",
    density: "balanced",
    wordWrap: false,
  } as TemplateInput["appearance"],
  setAppearance: () => {},
  dev: false,
  proofHostKey: null,
  updates: updates(phase),
  checkUpdates: () => {},
  restartToUpdate: () => {},
});

const labels = (items: ReadonlyArray<MenuItemConstructorOptions>) =>
  items.map((item) => item.label ?? item.role ?? item.type);

const submenu = (items: ReadonlyArray<MenuItemConstructorOptions>, label: string) => {
  const found = items.find((item) => item.label === label || item.role === label)?.submenu;

  // SAFETY: the template builds every submenu as an array of options.
  return (found ?? []) as ReadonlyArray<MenuItemConstructorOptions>;
};

describe("menuTemplate", () => {
  test("macOS keeps the app menu and the Window menu", () => {
    expect(labels(menuTemplate(input("darwin")))).toEqual([
      "appMenu",
      "File",
      "editMenu",
      "View",
      "Go",
      "Session",
      "windowMenu",
      "help",
    ]);
  });

  test("Linux is unchanged: the same menus as macOS", () => {
    expect(labels(menuTemplate(input("linux")))).toEqual(labels(menuTemplate(input("darwin"))));
  });

  test("Windows: File … Help, no app or Window menu", () => {
    expect(labels(menuTemplate(input("win32")))).toEqual([
      "&File",
      "&Edit",
      "&View",
      "&Go",
      "&Session",
      "&Help",
    ]);
  });

  test("Windows ends File with Settings… then Exit", () => {
    const file = submenu(menuTemplate(input("win32")), "&File");

    expect(file.at(-1)).toMatchObject({ role: "quit", label: "Exit" });
    expect(file.at(-2)?.type).toBe("separator");
    expect(file.at(-3)).toMatchObject({ id: "settings.open", label: "Settings…" });
  });

  test("Windows says Exit and update when an update is ready", () => {
    const file = submenu(menuTemplate(input("win32", "ready")), "&File");

    expect(file.at(-1)?.label).toBe("Exit and update");
  });

  test("a download shows its progress as a disabled line; a staged Update offers the restart", () => {
    const item = (platform: ClientPlatform, phase: AppUpdateView["phase"]) =>
      platform === "win32"
        ? submenu(menuTemplate(input(platform, phase)), "&Help").at(-4)
        : submenu(menuTemplate(input(platform, phase)), "appMenu")[1];

    for (const platform of ["darwin", "win32"] as const) {
      expect(item(platform, "downloading")).toMatchObject({
        label: "Downloading Polaris 0.12.1 · 48 of 131 MB · 37%",
        enabled: false,
      });
      expect(item(platform, "ready")).toMatchObject({ label: "Restart to update to 1.2.0" });
      expect(item(platform, "ready")?.enabled).not.toBe(false);
      expect(item(platform, "checking")).toMatchObject({
        label: "Check for updates…",
        enabled: false,
      });
    }
  });

  test("Windows ends Help with the update check, About, then developer tools", () => {
    const help = submenu(menuTemplate(input("win32")), "&Help");

    expect(labels(help.slice(-4))).toEqual([
      "Check for updates…",
      "About Polaris",
      "separator",
      "Toggle developer tools",
    ]);
  });

  test.each(["darwin", "win32", "linux"] as const)(
    "a packaged build on %s can open developer tools from Help",
    (platform) => {
      const template = menuTemplate(input(platform));
      const help = template.find((item) => item.role === "help" || item.label === "&Help");
      // SAFETY: the template builds every submenu as an array of options.
      const items = (help?.submenu ?? []) as ReadonlyArray<MenuItemConstructorOptions>;

      expect(items.at(-1)).toMatchObject({ role: "toggleDevTools" });
    }
  );

  test("accelerators follow the platform's keymap", () => {
    const accelerator = (platform: "darwin" | "win32" | "linux", menu: string, id: string) =>
      submenu(menuTemplate(input(platform)), menu).find((item) => item.id === id)?.accelerator;

    expect(accelerator("darwin", "Go", "session.next")).toBe("CmdOrCtrl+Alt+Down");
    expect(accelerator("win32", "&Go", "session.next")).toBe("CmdOrCtrl+PageDown");
    expect(accelerator("linux", "Go", "session.next")).toBe("CmdOrCtrl+PageDown");
    expect(accelerator("win32", "&File", "tab.closeOthers")).toBeUndefined();
  });

  test("Windows and Linux menus leave out chords Chromium would name Comma or Period", () => {
    const accelerator = (platform: "darwin" | "win32" | "linux", menu: string, id: string) =>
      submenu(menuTemplate(input(platform)), menu).find((item) => item.id === id)?.accelerator;

    expect(accelerator("darwin", "Session", "session.interrupt")).toBe("CmdOrCtrl+.");
    expect(accelerator("win32", "&Session", "session.interrupt")).toBeUndefined();
    expect(accelerator("linux", "Session", "session.interrupt")).toBeUndefined();
    expect(accelerator("win32", "&File", "settings.open")).toBeUndefined();
  });

  test("View → Word wrap is a checkbox showing the setting, and its click flips it", () => {
    const wordWrap = (on: boolean) => {
      const patches: Array<Partial<TemplateInput["appearance"]>> = [];
      const base = input("darwin");

      const item = submenu(
        menuTemplate({
          ...base,
          appearance: { ...base.appearance, wordWrap: on },
          setAppearance: (patch) => patches.push(patch),
        }),
        "View"
      ).find((i) => i.label === "Word wrap");

      // SAFETY: Electron passes the clicked item, window and event; the template uses none.
      const click = item?.click as (() => void) | undefined;
      click?.();

      return { item, patches };
    };

    expect(wordWrap(false).item).toMatchObject({
      type: "checkbox",
      checked: false,
      accelerator: "Alt+Z",
    });
    expect(wordWrap(false).patches).toEqual([{ wordWrap: true }]);
    expect(wordWrap(true).item?.checked).toBe(true);
    expect(wordWrap(true).patches).toEqual([{ wordWrap: false }]);
  });
});
