/** The star's menu, free of Electron so each platform's is testable anywhere. */
import type { MenuItemConstructorOptions } from "electron";
import type { NeedsYouSession, NeedsYouSummary } from "../../shared/needsYou.ts";
import type { ClientPlatform } from "../../shared/platform.ts";

export interface StarTrayInput {
  readonly onOpenSession: (session: NeedsYouSession) => void;
  readonly onOpenApp: () => void;
  readonly onQuit: () => void;
}

const sessionLabel = (session: NeedsYouSession) => {
  const where =
    session.workspace === null ? session.hostLabel : `${session.hostLabel} · ${session.workspace}`;

  return `${session.title || "Untitled session"} — ${where}`;
};

/** Quit shows its chord except on Windows, whose notification-area menus show none (Paper W2). */
const quit = (platform: ClientPlatform, onQuit: () => void): MenuItemConstructorOptions =>
  platform === "win32"
    ? { label: "Quit Polaris", click: onQuit }
    : { label: "Quit Polaris", accelerator: "CmdOrCtrl+Q", click: onQuit };

export const menuTemplate = (
  summary: NeedsYouSummary,
  input: StarTrayInput,
  platform: ClientPlatform
): Array<MenuItemConstructorOptions> => [
  { label: summary.count === 0 ? "Nothing needs you" : "Needs you", enabled: false },
  ...summary.sessions.map((session): MenuItemConstructorOptions => ({
    label: sessionLabel(session),
    click: () => input.onOpenSession(session),
  })),
  { type: "separator" },
  { label: "Open Polaris", click: input.onOpenApp },
  quit(platform, input.onQuit),
];
