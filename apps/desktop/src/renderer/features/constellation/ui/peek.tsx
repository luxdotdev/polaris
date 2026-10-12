/**
 * The Space preview of a Constellation (K4, Paper 13): Space on a hovered or focused Lead row
 * opens a card beside it with the strip, the counts and the Tasks still in play.
 */
import { cn, Kbd, Popover, PopoverAnchor, PopoverContent } from "@polaris/ui";
import {
  type ComponentProps,
  type ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { age } from "../../../shell/copy.ts";
import { useNow } from "../../../shell/useNow.ts";
import { peekCounts, peekRows } from "../../sessions/model/peek.ts";
import { useFacts, useLeadConstellation } from "../hooks.ts";
import { buildRail, LANE_MAX, laneWidth, segments, tallyOf, type TaskRow } from "../model/index.ts";
import { TaskGlyph } from "./glyphs.tsx";
import { IdLane, laneStyle } from "./lane.tsx";
import { ID_TONE, TONE } from "./rows.tsx";
import { ProgressStrip } from "./strip.tsx";

const editable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/**
 * The preview's open state and its triggers: Space toggles it while the row is hovered (a
 * key listener only while the pointer is on it) or focused (the row's own key handler).
 */
export const useSpacePeek = () => {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const row = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!hovered) return undefined;

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== " " || event.repeat || editable(event.target)) return;

      // A focused row handles its own Space.
      if (event.target instanceof Node && row.current?.contains(event.target)) return;
      event.preventDefault();
      setOpen((o) => !o);
    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [hovered]);

  return {
    open,
    setOpen,
    toggle: () => setOpen((o) => !o),
    rowProps: {
      onMouseEnter: (event: React.MouseEvent<HTMLElement>) => {
        row.current = event.currentTarget;
        setHovered(true);
      },
      onMouseLeave: () => setHovered(false),
    },
  };
};

const PeekRow = ({ row }: { readonly row: TaskRow }) => (
  <div className="gap-gap px-row-x flex h-[30px] items-center" data-testid="peek-task">
    <TaskGlyph glyph={row.look.glyph} harness={row.harness} size={16} />
    <IdLane id={row.task.id} max={LANE_MAX.sidebar} className={ID_TONE[row.look.idTone]} />
    <span className="text-body text-text-default min-w-0 flex-1 truncate">{row.task.title}</span>
    <span className={cn("text-caption shrink-0", TONE[row.look.wordTone])}>{row.look.word}</span>
  </div>
);

const PeekBody = ({
  hostKey,
  leadSessionId,
}: {
  readonly hostKey: string;
  readonly leadSessionId: string;
}) => {
  const record = useLeadConstellation(hostKey, leadSessionId);
  const facts = useFacts(record);
  const now = useNow();
  const rail = useMemo(() => (record === null ? null : buildRail(record, facts)), [record, facts]);

  if (record === null || rail === null) return null;
  const c = record.constellation;
  const { shown, more } = peekRows(rail.tasks);

  return (
    <div className="flex flex-col" data-testid="constellation-peek">
      <div className="flex flex-col gap-2 px-4 pt-3.5 pb-3">
        <div className="flex items-center gap-2">
          <span className="text-heading-sm text-text-strong min-w-0 flex-1 truncate">{c.name}</span>
          <span className="text-caption text-text-subtle shrink-0">
            {c.state} · {age(c.createdAt, now)}
          </span>
        </div>
        <ProgressStrip segments={segments(rail.tasks)} />
        <p className="text-caption text-text-subtle">
          {peekCounts(tallyOf(rail.tasks)).map((count, n) => (
            <span key={count.bucket}>
              {n === 0 ? null : " · "}
              <span className={count.bucket === "needs-you" ? "text-needs-you-text" : undefined}>
                {count.text}
              </span>
            </span>
          ))}
        </p>
      </div>
      {shown.length === 0 ? null : (
        <div
          className="border-hairline flex flex-col border-t px-2 py-1.5"
          style={laneStyle(
            laneWidth(
              shown.map((r) => r.task.id),
              LANE_MAX.sidebar
            )
          )}
        >
          {shown.map((row) => (
            <PeekRow key={row.key} row={row} />
          ))}
          {more === 0 ? null : (
            <p className="text-caption text-text-subtle px-row-x py-1">{more} more</p>
          )}
        </div>
      )}
      <div className="border-hairline bg-surface-sunken flex items-center gap-3 border-t px-4 py-2">
        <span className="text-caption text-text-subtle flex items-center gap-1.5">
          <Kbd>Space</Kbd> close
        </span>
        <span className="text-caption text-text-subtle flex items-center gap-1.5">
          <Kbd>↵</Kbd> open the lead
        </span>
      </div>
    </div>
  );
};

/** Triggers around the preview (a menu, a hover card) pass their props through to the row. */
export interface ConstellationPeekProps extends Omit<
  ComponentProps<typeof PopoverAnchor>,
  "asChild" | "children"
> {
  readonly hostKey: string;
  readonly leadSessionId: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The Lead row it opens beside. */
  readonly children: ReactElement;
}

export const ConstellationPeek = ({
  hostKey,
  leadSessionId,
  open,
  onOpenChange,
  children,
  ...slot
}: ConstellationPeekProps) => (
  <Popover open={open} onOpenChange={onOpenChange}>
    <PopoverAnchor asChild {...slot}>
      {children}
    </PopoverAnchor>
    {open ? (
      <PopoverContent
        side="right"
        align="start"
        sideOffset={10}
        className="w-[344px] overflow-hidden p-0"
        // The row keeps focus, so Space and ↵ still reach it.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <PeekBody hostKey={hostKey} leadSessionId={leadSessionId} />
      </PopoverContent>
    ) : null}
  </Popover>
);
