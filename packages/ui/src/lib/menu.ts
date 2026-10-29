import { FLOAT_MOTION } from "./float";

/**
 * Shared by DropdownMenu, ContextMenu and Select: a plain list of rows on the raised surface
 * (DESIGN.md, Menus and popovers; Paper X-F 06): 14px corners, 6px rows inset 4px, no icons.
 */
export const MENU_CONTENT = `z-50 min-w-50 max-w-80 overflow-x-hidden overflow-y-auto p-1 rounded-card border border-hairline bg-raised text-text-default shadow-float outline-hidden ${FLOAT_MOTION}`;

export const MENU_ITEM =
  "relative flex min-h-tree-row cursor-default items-center gap-4 rounded-control px-row-x text-body text-text-default outline-hidden select-none data-[highlighted]:bg-fill-selected data-[highlighted]:text-text-strong data-[disabled]:pointer-events-none data-[disabled]:opacity-(--opacity-dimmed) data-[inset]:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='text-'])]:text-text-subtle";

/** Only what Polaris can't undo (Delete, Discard changes…): the label in failed-text. */
export const MENU_DESTRUCTIVE = "text-failed-text data-[highlighted]:text-failed-text";

export const MENU_LABEL_TEXT = "min-w-0 flex-1 truncate";

export const MENU_INDICATOR =
  "pointer-events-none absolute left-2.5 flex size-4 items-center justify-center";

/** Mono caps with `·` separators, text-subtle: data labels and menu group headers. */
export const KICKER =
  "font-mono text-[10px] leading-[14px] font-medium tracking-[0.08em] uppercase text-text-subtle tabular";

/** A group header: a kicker ("MOVE"), never a sentence; a long one truncates on its one line. */
export const MENU_LABEL = `block h-[26px] truncate px-row-x pt-1 ${KICKER} leading-[22px]`;

export const MENU_SEPARATOR = "mx-2 my-1 h-px bg-hairline";

/** A key hint, or a disabled entry's reason, which truncates before the label gives way. */
export const MENU_SHORTCUT =
  "ml-auto min-w-0 max-w-1/2 shrink-0 truncate font-sans text-caption tracking-[0.04em] tabular text-text-subtle";

/** The one ellipsis a menu label may end in (U+2026), never three dots. */
export const ELLIPSIS = "…";

/**
 * macOS's rule (DESIGN.md, rule/ellipsis-means-input): a label ends in "…" exactly
 * when the command asks for more (a dialog, picker or confirmation) before it runs.
 */
export const ellipsisProblem = (label: string, needsInput: boolean): string | null => {
  if (label.trimEnd().endsWith("...")) return `"${label}" uses three dots; write "${ELLIPSIS}"`;
  const ends = label.trimEnd().endsWith(ELLIPSIS);

  if (ends && !needsInput) return `"${label}" ends in ${ELLIPSIS} but runs at once`;

  if (!ends && needsInput) return `"${label}" asks for input but has no ${ELLIPSIS}`;

  return null;
};
