/**
 * The conversation, virtualized: only rows near the viewport are in the DOM,
 * positioned by the virtualizer directly (no React render per scroll frame).
 * It stays pinned to the end while the user is there, so streaming output
 * follows, and restores its measurements and offset when a session reopens.
 */
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import { useEffect, useRef } from "react";
import type { Row } from "../model/conversation.ts";
import { ConversationRow, type RowContext } from "./rows.tsx";

interface Saved {
  readonly measurements: ReadonlyArray<VirtualItem>;
  readonly offset: number;
  readonly atEnd: boolean;
}

const saved = new Map<string, Saved>();

const ESTIMATE = 64;

export interface ConversationProps {
  /** Where to keep this list's scroll between visits (the session's key). */
  readonly scrollKey: string;
  readonly rows: ReadonlyArray<Row>;
  readonly ctx: RowContext;
}

export const Conversation = ({ scrollKey, rows, ctx }: ConversationProps) => {
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
