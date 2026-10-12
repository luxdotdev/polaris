/**
 * The conversation's scrollbar, drawn over its right edge in place of the native one: hidden
 * at rest, shown while the list scrolls, while the pointer is on the edge, and while dragged.
 * The thumb moves by `transform`, written straight to the DOM (no React render per frame).
 */
import { cn } from "@polaris/ui";
import { type PointerEvent, type RefObject, useEffect, useRef, useState } from "react";

/** How long the bar stays after the last scroll. */
const LINGER_MS = 900;

const MIN_THUMB = 24;

interface Geometry {
  readonly size: number;
  readonly top: number;
  readonly travel: number;
}

const geometry = (list: HTMLElement): Geometry | null => {
  const { clientHeight: view, scrollHeight: content, scrollTop } = list;

  if (content <= view + 1) return null;
  const size = Math.max(MIN_THUMB, (view * view) / content);
  const travel = view - size;

  return { size, travel, top: (scrollTop / (content - view)) * travel };
};

/** Shows on scroll, hides `LINGER_MS` after the last one; `geometry` sizes the thumb. */
const useScrolling = (
  list: RefObject<HTMLElement | null>,
  thumb: RefObject<HTMLElement | null>
) => {
  const [scrolling, setScrolling] = useState(false);
  const [scrollable, setScrollable] = useState(false);

  useEffect(() => {
    const el = list.current;

    if (el === null) return;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const place = () => {
      const g = geometry(el);

      setScrollable(g !== null);

      if (g !== null && thumb.current !== null) {
        thumb.current.style.height = `${g.size}px`;
        thumb.current.style.transform = `translateY(${g.top}px)`;
      }
    };

    const onScroll = () => {
      place();
      setScrolling(true);

      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => setScrolling(false), LINGER_MS);
    };

    // Rows measured or a page landing change the content's height without a scroll.
    const resize = new ResizeObserver(place);

    resize.observe(el);

    if (el.firstElementChild !== null) resize.observe(el.firstElementChild);
    el.addEventListener("scroll", onScroll, { passive: true });
    place();

    return () => {
      if (timer !== null) clearTimeout(timer);
      resize.disconnect();
      el.removeEventListener("scroll", onScroll);
    };
  }, [list, thumb]);

  return { scrolling, scrollable };
};

export const OverlayScrollbar = ({ list }: { readonly list: RefObject<HTMLElement | null> }) => {
  const thumb = useRef<HTMLDivElement>(null);
  const { scrolling, scrollable } = useScrolling(list, thumb);
  const [hover, setHover] = useState(false);
  const drag = useRef<{ readonly y: number; readonly scrollTop: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const el = list.current;

    if (el === null) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { y: event.clientY, scrollTop: el.scrollTop };
    setDragging(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const el = list.current;
    const g = el === null ? null : geometry(el);

    if (el === null || g === null || drag.current === null || g.travel <= 0) return;
    const ratio = (el.scrollHeight - el.clientHeight) / g.travel;

    el.scrollTop = drag.current.scrollTop + (event.clientY - drag.current.y) * ratio;
  };

  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };

  const shown = scrollable && (scrolling || hover || dragging);

  return (
    <div
      aria-hidden="true"
      data-testid="conversation-scrollbar"
      data-shown={shown}
      hidden={!scrollable}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      // The edge sits over the list, not in it: pass the wheel on.
      onWheel={(event) => list.current?.scrollBy({ top: event.deltaY, left: 0 })}
      className="absolute top-0 right-0 bottom-0 z-[6] w-2"
    >
      <div
        ref={thumb}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={cn(
          "absolute top-0 right-px w-1.5 rounded-full transition-opacity duration-150 ease-out",
          dragging || hover ? "bg-text-faint/70" : "bg-text-faint/40",
          shown ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      />
    </div>
  );
};
