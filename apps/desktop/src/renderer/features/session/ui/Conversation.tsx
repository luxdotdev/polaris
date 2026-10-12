/**
 * The conversation, virtualized: only rows near the viewport are in the DOM,
 * positioned by the virtualizer directly (no React render per scroll frame).
 * It stays pinned to the end while the user is there, so streaming output
 * follows, and restores its measurements and offset when a session reopens.
 * `reveal` scrolls a row into the middle (⌘F, the Turn rail).
 */
import { cn } from "@polaris/ui";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import { useEffect, useLayoutEffect, useRef } from "react";
import type { Row } from "../model/conversation.ts";
import { preloadMarkdown } from "./markdown/index.tsx";
import { ConversationRow, type RowContext } from "./rows.tsx";

interface Saved {
  readonly measurements: ReadonlyArray<VirtualItem>;
  readonly offset: number;
  readonly atEnd: boolean;
}

const saved = new Map<string, Saved>();

const ESTIMATE = 64;

/** A row to bring into view; a new `nonce` asks again for the same row. */
export interface Reveal {
  readonly key: string;
  readonly nonce: number;
  /** Where the row lands: the middle (a find match) or the top (a Turn from the rail). */
  readonly align?: "center" | "start";
}

export interface ConversationProps {
  /** Where to keep this list's scroll between visits (the session's key). */
  readonly scrollKey: string;
  readonly rows: ReadonlyArray<Row>;
  readonly ctx: RowContext;
  readonly reveal?: Reveal | null;
  /** Rows rendered now (the virtualizer's range), on every scroll: keep the work cheap. */
  readonly onRange?: (start: number, end: number) => void;
  /** Room on the right for the Turn rail. */
  readonly gutter?: boolean;
  /** The first Turn listed: when older Turns land above it, the list keeps its place. */
  readonly firstTurnId?: string | null;
}

/** The row at the top of the viewport, and how far its start sits from it. */
interface Anchor {
  readonly key: string | number | bigint;
  readonly offset: number;
}

export const Conversation = ({
  scrollKey,
  rows,
  ctx,
  reveal = null,
  onRange,
  gutter = false,
  firstTurnId = null,
}: ConversationProps) => {
  const anchor = useRef<Anchor | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const restore = saved.get(scrollKey);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATE,
    getItemKey: (index) => rows[index]?.key ?? index,
    overscan: 6,
    anchorTo: "end",
    followOnAppend: true,
    scrollEndThreshold: 48,
    paddingStart: 20,
    paddingEnd: 20,
    directDomUpdates: true,
    onChange: (instance) => {
      if (instance.range !== null) onRange?.(instance.range.startIndex, instance.range.endIndex);
    },
    initialMeasurementsCache: restore === undefined ? [] : [...restore.measurements],
    initialOffset: () =>
      restore === undefined || restore.atEnd ? Number.MAX_SAFE_INTEGER : restore.offset,
  });

  useEffect(preloadMarkdown, []);

  // The anchor follows scrolling only: rows changing (a page landing) must not move it.
  useEffect(() => {
    const list = scrollRef.current;

    if (list === null) return;

    const record = () => {
      const top = list.scrollTop;

      // The "older" row leaves once the last page lands, so it never holds the place.
      const first = virtualizer
        .getVirtualItems()
        .find((item) => item.end > top && item.key !== "older");

      anchor.current = first === undefined ? null : { key: first.key, offset: first.start - top };
    };

    list.addEventListener("scroll", record, { passive: true });

    return () => list.removeEventListener("scroll", record);
  }, [virtualizer]);

  const shownFirst = useRef(firstTurnId);

  // Older Turns landed above: scroll by what they added, so the row on top stays on top.
  useLayoutEffect(() => {
    if (shownFirst.current === firstTurnId) return;
    shownFirst.current = firstTurnId;
    const held = anchor.current;
    const index = held === null ? -1 : rows.findIndex((r) => r.key === held.key);
    const start = index === -1 ? undefined : virtualizer.getOffsetForIndex(index, "start")?.[0];

    if (held !== null && start !== undefined) virtualizer.scrollToOffset(start - held.offset);
  }, [firstTurnId, rows, virtualizer]);

  const revealed = useRef<number | null>(null);

  // The row may appear only after its Turn opens, so this waits for it in `rows`.
  useEffect(() => {
    if (reveal === null || revealed.current === reveal.nonce) return;
    const index = rows.findIndex((r) => r.key === reveal.key);

    if (index === -1) return;
    revealed.current = reveal.nonce;
    virtualizer.scrollToIndex(index, { align: reveal.align ?? "center" });
  }, [reveal, rows, virtualizer]);

  // Streaming grows the last row: `anchorTo: "end"` follows it as the row is re-measured.
  // No per-commit isAtEnd/scrollToEnd: each one forces a layout of the whole list.
  useEffect(
    () => () => {
      saved.set(scrollKey, {
        measurements: virtualizer.takeSnapshot(),
        offset: virtualizer.scrollOffset ?? 0,
        atEnd: virtualizer.isAtEnd(48),
      });
    },
    [scrollKey, virtualizer]
  );

  return (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain select-text [overflow-anchor:none]"
      data-testid="conversation"
    >
      <div ref={virtualizer.containerRef} className="relative w-full">
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index];

          return row === undefined ? null : (
            <div
              key={item.key}
              ref={virtualizer.measureElement}
              data-index={item.index}
              data-row-key={row.key}
              className={cn(
                "pb-panel absolute top-0 left-0 w-full pl-5",
                gutter ? "pr-10" : "pr-5"
              )}
            >
              <ConversationRow row={row} ctx={ctx} />
            </div>
          );
        })}
      </div>
    </div>
  );
};
