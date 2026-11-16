/**
 * A file card's own sideways scrollbar in the Changes list (fileScroll.ts holds the offsets):
 * the thumb drags, a click on the track pages, and focused, ← → Home End scroll it.
 */
import {
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { DiffFile } from "../model/diff.ts";
import { fileColumns } from "../diffRows.ts";
import { createFileScroll, type FileScroll, sidewaysDelta } from "../fileScroll.ts";

/** An arrow key's step: about three cells of code. */
const KEY_STEP = 24;

/** A wheel in lines (deltaMode 1) moves about a line's height a step. */
const LINE_DELTA = 20;

/** Where ← → Home End take a file's offset, or null for any other key. */
const keyTarget = (key: string, offset: number, max: number): number | null => {
  switch (key) {
    case "ArrowLeft":
      return offset - KEY_STEP;
    case "ArrowRight":
      return offset + KEY_STEP;
    case "Home":
      return 0;
    case "End":
      return max;
    default:
      return null;
  }
};

/** The id of a file's card header, which its scrollbar controls. */
export const fileCardId = (path: string) => `changes-file-${encodeURIComponent(path)}`;

interface FileScrollbarProps {
  readonly path: string;
  readonly scroll: FileScroll;
}

export const FileScrollbar = ({ path, scroll }: FileScrollbarProps) => {
  const track = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (track.current === null || thumb.current === null) return;

    return scroll.bar(path, { track: track.current, thumb: thumb.current });
  }, [path, scroll]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const bar = track.current;
    const grip = thumb.current;

    if (bar === null || grip === null || event.button !== 0) return;
    event.preventDefault();

    if (event.target !== grip) {
      const side = event.clientX < grip.getBoundingClientRect().left ? -1 : 1;

      scroll.scrollBy(path, side * bar.clientWidth);

      return;
    }

    const start = { x: event.clientX, offset: scroll.offset(path) };
    const travel = Math.max(1, bar.clientWidth - grip.offsetWidth);
    const ratio = scroll.max(path) / travel;

    bar.setPointerCapture(event.pointerId);
    grip.dataset.dragging = "";

    const move = (e: globalThis.PointerEvent) =>
      scroll.scrollTo(path, start.offset + (e.clientX - start.x) * ratio);

    const end = () => {
      delete grip.dataset.dragging;
      bar.removeEventListener("pointermove", move);
      bar.removeEventListener("pointerup", end);
      bar.removeEventListener("pointercancel", end);
    };

    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", end);
    bar.addEventListener("pointercancel", end);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const to = keyTarget(event.key, scroll.offset(path), scroll.max(path));

    if (to === null) return;
    event.preventDefault();
    scroll.scrollTo(path, to);
  };

  return (
    <div
      ref={track}
      role="scrollbar"
      aria-orientation="horizontal"
      aria-controls={fileCardId(path)}
      aria-label={`Scroll ${path} sideways`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={0}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className="focus-visible:outline-starlight relative h-1.5 flex-1 touch-none rounded-full focus-visible:outline-2 focus-visible:outline-offset-1"
      data-testid="file-scrollbar"
    >
      <div
        ref={thumb}
        className="bg-text-faint/40 hover:bg-text-faint/70 data-dragging:bg-text-faint/70 absolute inset-y-0 left-0 rounded-full"
      />
    </div>
  );
};

/** A wheel that moves mostly sideways over a file's rows scrolls that file, not the list. */
const useSidewaysWheel = (lane: RefObject<HTMLElement | null>, scroll: FileScroll, on: boolean) =>
  useEffect(() => {
    const element = lane.current;

    if (element === null || !on) return;

    const onWheel = (event: WheelEvent) => {
      const delta = sidewaysDelta(event);

      const row =
        event.target instanceof Element ? event.target.closest("[data-scroll-file]") : null;

      const path = row instanceof HTMLElement ? row.dataset.scrollFile : undefined;

      if (delta === null || path === undefined || scroll.max(path) === 0) return;
      event.preventDefault();
      scroll.scrollBy(path, event.deltaMode === 1 ? delta * LINE_DELTA : delta);
    };

    element.addEventListener("wheel", onWheel, { passive: false });

    return () => element.removeEventListener("wheel", onWheel);
  }, [lane, scroll, on]);

/**
 * The list's per-file sideways scroll: measured from the lane's width and a probe of 100
 * code cells, and the paths whose widest line overflows (re-read only on a resize).
 */
export const useFileScroll = (
  lane: RefObject<HTMLElement | null>,
  probe: RefObject<HTMLElement | null>,
  files: ReadonlyArray<DiffFile>,
  wrap: boolean
) => {
  const [scroll] = useState(createFileScroll);

  const columns = useMemo(
    () => new Map(wrap ? [] : files.map((file) => [file.path, fileColumns(file)] as const)),
    [files, wrap]
  );

  useEffect(() => {
    const element = lane.current;
    const cells = probe.current;

    if (element === null || cells === null) return;

    const measure = () =>
      scroll.measure(columns, {
        lane: element.clientWidth,
        cell: cells.getBoundingClientRect().width / 100,
      });

    const observer = new ResizeObserver(measure);

    observer.observe(element);
    observer.observe(cells);
    measure();

    return () => observer.disconnect();
  }, [lane, probe, scroll, columns]);

  useSidewaysWheel(lane, scroll, !wrap);

  const overflowing = useSyncExternalStore(scroll.subscribe, scroll.overflowing);

  return { scroll, overflowing };
};
