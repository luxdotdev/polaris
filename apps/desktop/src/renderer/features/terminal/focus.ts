/**
 * A menu item that opens a terminal hands focus to it, so the closing menu
 * must not take focus back: Radix restores it to the trigger when the menu
 * unmounts (after its 160 ms fade), which can land after the terminal focused.
 */
let claimed = false;

/** Call from the menu item's `onSelect` before opening the terminal. */
export const claimFocusFromMenu = () => {
  claimed = true;
};

/** The menu's `onCloseAutoFocus`: skips the restore once after a claim. */
export const keepTerminalFocus = (event: Event) => {
  if (!claimed) return;
  claimed = false;
  event.preventDefault();
};
