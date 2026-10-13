import { describe, expect, test } from "bun:test";
import type { MenuItemConstructorOptions } from "electron";
import type { AppUpdateView } from "../shared/appUpdates.ts";
import type { ClientPlatform } from "../shared/platform.ts";
import { menuTemplate, type TemplateInput } from "./menuTemplate.ts";

const updates = (phase: AppUpdateView["phase"]): AppUpdateView =>
  // SAFETY: the template reads only phase, supported and availableVersion.
  ({ phase, supported: true, availableVersion: "1.2.0" }) as AppUpdateView;

const input = (
  platform: ClientPlatform,
  phase: AppUpdateView["phase"] = "idle"
): TemplateInput => ({
  platform,
  send: () => {},
  // SAFETY: the template reads only theme and density.
  appearance: { theme: "system", density: "balanced" } as TemplateInput["appearance"],
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
  const found = items.find((item) => item.label === label)?.submenu;

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

  test("Windows ends Help with the update check and About", () => {
    const help = submenu(menuTemplate(input("win32")), "&Help");

    expect(labels(help.slice(-2))).toEqual(["Check for updates…", "About Polaris"]);
  });
});
