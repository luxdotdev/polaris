/**
 * The menu bar star (DESIGN.md, Brand: "the flat white star plus the needs-you count"):
 * the count from every Host beside the star, and a menu of the waiting sessions. Windows
 * can't title a tray icon, so there the star carries a needs-you dot and opens on click.
 */
import { Menu, nativeTheme, Tray } from "electron";
import type { NeedsYouSummary } from "../../shared/needsYou.ts";
import { clientPlatform } from "../../shared/platform.ts";
import { menuTemplate, type StarTrayInput } from "./menu.ts";
import { badgeColors, starInk } from "./pixels.ts";
import { inkedStarImage, starImage } from "./star.ts";

export type { StarTrayInput } from "./menu.ts";

export interface StarTray {
  readonly update: (summary: NeedsYouSummary) => void;
  /** The count beside the star, for tests. */
  readonly title: () => string;
  readonly destroy: () => void;
}

/** Windows: the star in the taskbar's ink, with the dot while anything needs you. */
const windowsStar = (count: number) => {
  const dark = nativeTheme.shouldUseDarkColorsForSystemIntegratedUI;

  return inkedStarImage(starInk(dark), count > 0 ? badgeColors(dark).fill : null);
};

export const createStarTray = (input: StarTrayInput): StarTray => {
  const platform = clientPlatform();
  const windows = platform === "win32";
  const tray = new Tray(windows ? windowsStar(0) : starImage());
  let title = "";
  let count = 0;

  const update = (summary: NeedsYouSummary) => {
    count = summary.count;
    title = summary.count > 0 ? String(summary.count) : "";

    if (windows) tray.setImage(windowsStar(count));
    else tray.setTitle(title, { fontType: "monospacedDigit" });
    tray.setToolTip(summary.count > 0 ? `Polaris · ${summary.count} need you` : "Polaris");
    tray.setContextMenu(Menu.buildFromTemplate(menuTemplate(summary, input, platform)));
  };

  const retint = () => tray.setImage(windowsStar(count));

  if (windows) {
    tray.on("click", input.onOpenApp);
    nativeTheme.on("updated", retint);
  }

  update({ count: 0, sessions: [], focused: null });

  return {
    update,
    title: () => title,
    destroy: () => {
      nativeTheme.off("updated", retint);
      tray.destroy();
    },
  };
};
