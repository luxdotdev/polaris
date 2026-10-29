/**
 * Where the main window opens: the saved state from settings, checked against the
 * displays that exist now, or the default size centred on the primary display.
 */
import { Option, Schema } from "effect";

const Size = Schema.Int.check(Schema.isGreaterThan(0));

export const WindowRect = Schema.Struct({
  x: Schema.Int,
  y: Schema.Int,
  width: Size,
  height: Size,
});

export type WindowRect = typeof WindowRect.Type;

/** What `settings.json` keeps under `window`: the unmaximized bounds and how it was shown. */
export const WindowState = Schema.Struct({
  bounds: WindowRect,
  displayId: Schema.Number,
  maximized: Schema.Boolean,
  fullScreen: Schema.Boolean,
});

export type WindowState = typeof WindowState.Type;

export interface DisplayArea {
  readonly id: number;
  readonly workArea: WindowRect;
}

export interface WindowSize {
  readonly width: number;
  readonly height: number;
}

export interface PlacementInput {
  /** The stored state, parsed with `decodeWindowState`. */
  readonly saved: Option.Option<WindowState>;
  readonly displays: readonly DisplayArea[];
  readonly primary: DisplayArea;
  readonly defaults: WindowSize;
  readonly min: WindowSize;
}

export interface Placement {
  readonly bounds: WindowRect;
  readonly maximized: boolean;
  readonly fullScreen: boolean;
}

/** Less of the window than this on any display, and it opens at the default instead. */
export const MIN_VISIBLE_FRACTION = 0.5;

/** Settings' `window` value, as read from disk; anything that isn't a WindowState is none. */
export const decodeWindowState = Schema.decodeUnknownOption(WindowState);

const overlap = (a: WindowRect, b: WindowRect) => {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);

  return width > 0 && height > 0 ? width * height : 0;
};

const clampAxis = (start: number, length: number, areaStart: number, areaLength: number) =>
  Math.min(Math.max(start, areaStart), areaStart + areaLength - length);

const fitSize = (wanted: number, min: number, available: number) =>
  Math.min(Math.max(wanted, min), available);

/** Shrinks the window to fit the work area, then slides it fully inside. */
export const clampToArea = (bounds: WindowRect, area: WindowRect, min: WindowSize): WindowRect => {
  const width = fitSize(bounds.width, min.width, area.width);
  const height = fitSize(bounds.height, min.height, area.height);

  return {
    x: clampAxis(bounds.x, width, area.x, area.width),
    y: clampAxis(bounds.y, height, area.y, area.height),
    width,
    height,
  };
};

export const centredDefault = (primary: DisplayArea, defaults: WindowSize, min: WindowSize) => {
  const area = primary.workArea;
  const width = fitSize(defaults.width, min.width, area.width);
  const height = fitSize(defaults.height, min.height, area.height);

  return {
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
    width,
    height,
  };
};

/** The display showing most of the window, if it shows enough of it. */
const visibleOn = (bounds: WindowRect, displays: readonly DisplayArea[]) => {
  let best: { readonly display: DisplayArea; readonly area: number } | null = null;

  for (const display of displays) {
    const area = overlap(bounds, display.workArea);

    if (best === null || area > best.area) best = { display, area };
  }

  if (best === null) return null;

  return best.area >= bounds.width * bounds.height * MIN_VISIBLE_FRACTION ? best.display : null;
};

export const placeWindow = ({
  saved,
  displays,
  primary,
  defaults,
  min,
}: PlacementInput): Placement => {
  const state = Option.getOrNull(saved);
  const fallback = centredDefault(primary, defaults, min);

  if (state === null) return { bounds: fallback, maximized: false, fullScreen: false };

  const known = displays.some((display) => display.id === state.displayId);
  const target = known ? visibleOn(state.bounds, displays) : null;
  const bounds = target === null ? fallback : clampToArea(state.bounds, target.workArea, min);

  return { bounds, maximized: state.maximized, fullScreen: state.fullScreen };
};
