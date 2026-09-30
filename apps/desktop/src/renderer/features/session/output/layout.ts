/**
 * The Output lane's geometry (DESIGN.md, Output): a 240px rail while
 * collapsed; open, a panel the user resizes from its left edge, by default
 * 80% of what Intent's 448px used to leave it.
 */

/** The collapsed rail; toasts clear it (`--toast-inset-right`). */
export const RAIL_WIDTH = 240;

/** The narrowest open panel: a diff line keeps its gutter and some text. */
export const MIN_WIDTH = 360;

/** Intent never gets narrower than this; the panel gives way first. */
export const INTENT_MIN = 320;

/** The Intent width the old layout fixed; the default panel is 80% of what it left. */
const OLD_INTENT = 448;

const DEFAULT_SHARE = 0.8;

/** The default panel width as CSS, for when the user hasn't dragged it. */
export const DEFAULT_WIDTH_CSS = `calc((100% - ${OLD_INTENT}px) * ${DEFAULT_SHARE})`;

/** The default panel width in a lane `available` px wide (Intent and Output together). */
export const defaultWidth = (available: number) =>
  clampWidth(Math.round((available - OLD_INTENT) * DEFAULT_SHARE), available);

/** A width the panel can take in a lane `available` px wide. */
export const clampWidth = (width: number, available: number) =>
  Math.round(Math.max(MIN_WIDTH, Math.min(width, available - INTENT_MIN)));

/** The stored width as CSS: clamped again live, since the window may have shrunk since. */
export const widthCss = (width: number | null) =>
  width === null
    ? `max(${MIN_WIDTH}px, ${DEFAULT_WIDTH_CSS})`
    : `clamp(${MIN_WIDTH}px, ${width}px, calc(100% - ${INTENT_MIN}px))`;

/** How far a keyboard arrow moves the edge. */
export const KEY_STEP = 16;
