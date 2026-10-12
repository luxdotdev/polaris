/**
 * The conversation, virtualized: only rows near the viewport are in the DOM,
 * positioned by the virtualizer directly (no React render per scroll frame).
 * It stays pinned to the end while the user is there, so streaming output
 * follows, and restores its measurements and offset when a session reopens.
 * `reveal` scrolls a row into the middle (⌘F, the Turn rail).
 */
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import { useEffect, useRef } from "react";
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
}

export interface ConversationProps {
  /** Where to keep this list's scroll between visits (the session's key). */
  readonly scrollKey: string;
  readonly rows: ReadonlyArray<Row>;
  readonly ctx: RowContext;
  readonly reveal?: Reveal | null;
}

export const Conversation = ({ scrollKey, rows, ctx, reveal = null }: ConversationProps) => {
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
    initialMeasurementsCache: restore === undefined ? [] : [...restore.measurements],
    initialOffset: () =>
      restore === undefined || restore.atEnd ? Number.MAX_SAFE_INTEGER : restore.offset,
  });

  useEffect(preloadMarkdown, []);

  const revealed = useRef<number | null>(null);

  // The row may appear only after its Turn opens, so this waits for it in `rows`.
  useEffect(() => {
    if (reveal === null || revealed.current === reveal.nonce) return;
    const index = rows.findIndex((r) => r.key === reveal.key);

    if (index === -1) return;
    revealed.current = reveal.nonce;
    virtualizer.scrollToIndex(index, { align: "center" });
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
              className="pb-panel absolute top-0 left-0 w-full px-5"
            >
              <ConversationRow row={row} ctx={ctx} />
            </div>
          );
        })}
      </div>
    </div>
  );
};
