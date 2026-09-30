/**
 * The menu bar star (DESIGN.md, Brand: "the flat white star plus the needs-you count"):
 * the count from every Host beside the star, and a menu of the waiting sessions.
 */
import { Menu, type MenuItemConstructorOptions, Tray } from "electron";
import type { NeedsYouSession, NeedsYouSummary } from "../../shared/needsYou.ts";
import { starImage } from "./star.ts";

export interface StarTrayInput {
  readonly onOpenSession: (session: NeedsYouSession) => void;
  readonly onOpenApp: () => void;
  readonly onQuit: () => void;
}

export interface StarTray {
  readonly update: (summary: NeedsYouSummary) => void;
  /** The count beside the star, for tests. */
  readonly title: () => string;
  readonly destroy: () => void;
}

const sessionLabel = (session: NeedsYouSession) => {
  const where =
    session.workspace === null ? session.hostLabel : `${session.hostLabel} · ${session.workspace}`;

  return `${session.title || "Untitled session"} — ${where}`;
};

export const menuTemplate = (
  summary: NeedsYouSummary,
  input: StarTrayInput
): Array<MenuItemConstructorOptions> => [
  { label: summary.count === 0 ? "Nothing needs you" : "Needs you", enabled: false },
  ...summary.sessions.map((session): MenuItemConstructorOptions => ({
    label: sessionLabel(session),
    click: () => input.onOpenSession(session),
  })),
  { type: "separator" },
  { label: "Open Polaris", click: input.onOpenApp },
  { label: "Quit Polaris", accelerator: "Command+Q", click: input.onQuit },
];

export const createStarTray = (input: StarTrayInput): StarTray => {
  const tray = new Tray(starImage());
  let title = "";

  const update = (summary: NeedsYouSummary) => {
    title = summary.count > 0 ? String(summary.count) : "";
    tray.setTitle(title, { fontType: "monospacedDigit" });
    tray.setToolTip(summary.count > 0 ? `Polaris · ${summary.count} need you` : "Polaris");
    tray.setContextMenu(Menu.buildFromTemplate(menuTemplate(summary, input)));
  };

  update({ count: 0, sessions: [], focused: null });

  return { update, title: () => title, destroy: () => tray.destroy() };
};
