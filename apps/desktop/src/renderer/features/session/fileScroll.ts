/**
 * Sideways scrolling for each file card in the Changes list, outside React: every file keeps
 * its own offset (by path, across row remounts), and a scroll writes `transform` straight to
 * that file's mounted code spans and scrollbar thumb, at most once a frame.
 */

/** The card's 16px margins and 1px borders, and the 64px gutter: what doesn't scroll. */
export const CODE_INSET = 98;

/** Room after a file's widest line, so its last character never sits on the card's edge. */
const END_ROOM = 12;

/** The thumb never shrinks below this, so it stays a target. */
const MIN_THUMB = 24;

export interface Bar {
  readonly track: HTMLElement;
  readonly thumb: HTMLElement;
}

export interface Geometry {
  /** The list's visible width, without its scrollbar. */
  readonly lane: number;
  /** One monospace cell of the code font. */
  readonly cell: number;
}

/** How far a file scrolls: 0 when its widest line fits. */
export const maxOffset = (columns: number, { lane, cell }: Geometry) =>
  Math.max(0, Math.ceil(columns * cell + END_ROOM - (lane - CODE_INSET)));

/** The thumb's width and left edge on a track, for an offset out of `max`. */
export const thumbPlace = (track: number, visible: number, max: number, offset: number) => {
  const width = Math.min(track, Math.max(MIN_THUMB, (track * visible) / (visible + max)));

  return { width, left: max === 0 ? 0 : (offset / max) * (track - width) };
};

export interface FileScroll {
  /** A line row's code span; returns its cleanup. */
  readonly code: (path: string, span: HTMLElement) => () => void;
  /** A file's scrollbar; returns its cleanup. */
  readonly bar: (path: string, bar: Bar) => () => void;
  readonly offset: (path: string) => number;
  readonly max: (path: string) => number;
  readonly scrollBy: (path: string, delta: number) => void;
  readonly scrollTo: (path: string, offset: number) => void;
  /** Each file's widest line in cells, and the lane's size: re-clamps every offset. */
  readonly measure: (columns: ReadonlyMap<string, number>, geometry: Geometry) => void;
  /** The paths that scroll, re-read when `measure` changes them. */
  readonly overflowing: () => ReadonlySet<string>;
  readonly subscribe: (listener: () => void) => () => void;
}

const addTo = <V>(map: Map<string, Set<V>>, path: string, value: V) => {
  const set = map.get(path) ?? new Set<V>();

  set.add(value);
  map.set(path, set);

  return () => {
    set.delete(value);

    if (set.size === 0) map.delete(path);
  };
};

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && [...a].every((path) => b.has(path));

export const createFileScroll = (): FileScroll => {
  const offsets = new Map<string, number>();
  const codes = new Map<string, Set<HTMLElement>>();
  const bars = new Map<string, Set<Bar>>();
  const listeners = new Set<() => void>();
  const dirty = new Set<string>();
  let columns: ReadonlyMap<string, number> = new Map();
  let geometry: Geometry = { lane: 0, cell: 0 };
  let overflowing: ReadonlySet<string> = new Set();
  let frame: number | null = null;

  const max = (path: string) => maxOffset(columns.get(path) ?? 0, geometry);
  const offset = (path: string) => Math.min(offsets.get(path) ?? 0, max(path));

  const placeCode = (path: string, span: HTMLElement) => {
    const x = offset(path);

    span.style.transform = x === 0 ? "" : `translateX(${-x}px)`;
  };

  const placeBar = (path: string, { track, thumb }: Bar) => {
    const limit = max(path);
    const x = offset(path);
    const { width, left } = thumbPlace(track.clientWidth, geometry.lane - CODE_INSET, limit, x);

    thumb.style.width = `${width}px`;
    thumb.style.transform = `translateX(${left}px)`;
    track.setAttribute("aria-valuenow", String(limit === 0 ? 0 : Math.round((x / limit) * 100)));
  };

  const place = (path: string) => {
    for (const span of codes.get(path) ?? []) placeCode(path, span);

    for (const bar of bars.get(path) ?? []) placeBar(path, bar);
  };

  const flush = () => {
    frame = null;

    for (const path of dirty) place(path);
    dirty.clear();
  };

  const scrollTo = (path: string, to: number) => {
    const next = Math.max(0, Math.min(max(path), Math.round(to)));

    if (next === offset(path)) return;
    offsets.set(path, next);
    dirty.add(path);
    frame ??= requestAnimationFrame(flush);
  };

  return {
    code: (path, span) => {
      placeCode(path, span);

      return addTo(codes, path, span);
    },
    bar: (path, bar) => {
      placeBar(path, bar);

      return addTo(bars, path, bar);
    },
    offset,
    max,
    scrollBy: (path, delta) => scrollTo(path, offset(path) + delta),
    scrollTo,
    measure: (nextColumns, nextGeometry) => {
      columns = nextColumns;
      geometry = nextGeometry;

      for (const path of new Set([...codes.keys(), ...bars.keys()])) place(path);

      const next = new Set([...columns.keys()].filter((path) => max(path) > 0));

      if (sameSet(next, overflowing)) return;
      overflowing = next;

      for (const listener of listeners) listener();
    },
    overflowing: () => overflowing,
    subscribe: (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
  };
};

/** A wheel's sideways travel, or null when it mostly scrolls the list. */
export const sidewaysDelta = (event: {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly shiftKey: boolean;
}): number | null => {
  if (event.shiftKey && event.deltaX === 0) return event.deltaY === 0 ? null : event.deltaY;

  return Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : null;
};
