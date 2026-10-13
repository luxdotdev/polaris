/** The title bar's Windows pieces (Paper W1): the lockup as the app menu, and the caption space. */
import { ChevronDownIcon, Wordmark } from "@polaris/ui";
import { polaris } from "../features/bridge.ts";

/** Windows' caption buttons' width, from the overlay's own geometry (138px at 100%). */
export const CAPTION_BUTTONS =
  "calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, calc(100vw - 138px)))";

/** The lockup as the app menu's button; the menu itself is native (main/menu.ts). */
export const AppMenuButton = () => (
  <button
    type="button"
    aria-label="Menu"
    aria-haspopup="menu"
    onClick={() => void polaris().request("app.menu", {})}
    className="app-no-drag rounded-control hover:bg-fill-hover flex h-7 shrink-0 cursor-default items-center gap-1.5 px-1.5"
  >
    <Wordmark />
    <ChevronDownIcon size={10} className="text-text-subtle" />
  </button>
);

/** Where Windows draws its caption buttons over the bar (main/chrome.ts); still a drag region. */
export const CaptionSpace = () => (
  <span className="shrink-0 self-stretch" style={{ width: CAPTION_BUTTONS }} aria-hidden />
);
