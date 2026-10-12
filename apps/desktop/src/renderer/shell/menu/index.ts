/**
 * What every right-click menu shares: shortcuts read from KEYMAP (or a feature's own key
 * table) through the app's chord formatting, never typed by hand (DESIGN.md, Menus).
 */
import { acceleratorLabel } from "../../../shared/chord.ts";
import { chordOf, type CommandId, EDIT_CHORDS } from "../../../shared/keymap.ts";

/** A command's chord as the menu shows it ("⌥⌘T"), or nothing when it has none. */
export const menuShortcut = (id: CommandId): string | undefined => acceleratorLabel(chordOf(id));

/** The standard edit chords the native Edit menu owns ("⌘C"). */
export const editShortcut = (action: keyof typeof EDIT_CHORDS): string =>
  acceleratorLabel(EDIT_CHORDS[action]) ?? "";
