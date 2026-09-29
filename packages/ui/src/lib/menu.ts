import { FLOAT_MOTION, FLOAT_SURFACE } from "./float";

/** Shared by DropdownMenu, ContextMenu and Select: a floating list of rows. */
export const MENU_CONTENT = `z-50 min-w-44 overflow-x-hidden overflow-y-auto p-1.5 ${FLOAT_SURFACE} ${FLOAT_MOTION}`;

export const MENU_ITEM =
  "relative flex h-row cursor-default items-center gap-gap rounded-row px-row-x text-label text-text-default outline-hidden select-none data-[highlighted]:bg-fill-selected data-[highlighted]:text-text-strong data-[disabled]:pointer-events-none data-[disabled]:opacity-(--opacity-dimmed) data-[inset]:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='text-'])]:text-text-subtle";

export const MENU_INDICATOR =
  "pointer-events-none absolute left-2.5 flex size-4 items-center justify-center";

export const MENU_LABEL = "px-row-x pt-2 pb-1.5 text-caption text-text-subtle";

export const MENU_SEPARATOR = "-mx-1.5 my-1.5 h-px bg-hairline";

export const MENU_SHORTCUT = "ml-auto pl-4 font-sans text-micro tabular text-text-faint";
