/**
 * The queue on Review's left (Paper R1 1TC-0): what's waiting to be reviewed, the open
 * subject selected, and "Review a PR by URL" at its foot. The header goes back to the list.
 */
import { cn, Kbd, SEVERITY_LABELS, SeverityGlyph, Tile } from "@polaris/ui";
import { useEffect, useState } from "react";
import { reviewDigits } from "../../../routes/review.ts";
import type { RiskMark } from "../model/findings.ts";
import type { OpenPull } from "../../../../shared/api.ts";
import { ByUrl } from "../../pulls/ui/ByUrl.tsx";
import { PullGlyph } from "../../pulls/ui/glyphs.tsx";
import type { QueueGroup, QueueRow } from "../model/queue.ts";

export interface QueueProps {
  readonly groups: ReadonlyArray<QueueGroup>;
  readonly caption: string;
  readonly selected: string | null;
  readonly onOpen: (row: QueueRow) => void;
  readonly onOpenPull: (pull: OpenPull) => void;
  readonly onList: () => void;
  /** The row's Risk Summary, when one ran this launch: its highest Severity and count. */
  readonly markOf: (row: QueueRow) => RiskMark | null;
}

/** "▲ 1": the highest Severity's glyph and how many findings have it (DESIGN.md, Review → Queue). */
const Mark = ({ mark }: { readonly mark: RiskMark | null }) =>
  mark === null ? null : (
    <span
      data-testid="review-queue-risk"
      className="text-micro tabular flex shrink-0 items-center gap-1 font-medium"
      style={{ color: `var(--color-severity-${mark.severity}-text)` }}
    >
      <SeverityGlyph severity={mark.severity} tone="text" />
      <span className="sr-only">{SEVERITY_LABELS[mark.severity]}</span>
      {mark.count}
    </span>
  );

/** Whether Control is held: the first nine rows show their ⌃N. */
const useCtrlHeld = () => {
  const [held, setHeld] = useState(false);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.key === "Control") setHeld(!event.metaKey && !event.altKey && !event.shiftKey);
    };

    const up = (event: KeyboardEvent) => {
      if (event.key === "Control" || !event.ctrlKey) setHeld(false);
    };

    const blur = () => setHeld(false);

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);

    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  return held;
};

/** ⌃1…⌃9 open the first nine rows in the order they show. */
const useDigits = (rows: ReadonlyArray<QueueRow>, onOpen: (row: QueueRow) => void) => {
  useEffect(() => {
    const pick = (index: number) => {
      const row = rows[index];

      if (row === undefined) return false;
      onOpen(row);

      return true;
    };

    reviewDigits.pick = pick;

    return () => {
      if (reviewDigits.pick === pick) reviewDigits.pick = null;
    };
  }, [rows, onOpen]);
};

const TallRow = ({ row, selected }: { readonly row: QueueRow; readonly selected: boolean }) => (
  <>
    {row.kind === "pull" ? (
      <span
        className={cn(
          "flex size-tree-row shrink-0 items-center justify-center rounded-[8px]",
          selected ? "bg-fill-selected text-text-default" : "bg-surface-raised text-text-subtle"
        )}
      >
        <PullGlyph />
      </span>
    ) : (
      <Tile hue={row.harness} size={28} />
    )}
    <span className="flex min-w-0 flex-1 flex-col gap-px text-left">
      <span
        className={cn(
          "text-body line-clamp-1 font-medium",
          selected ? "text-text-strong" : "text-text-default"
        )}
      >
        {row.title}
      </span>
      <span className={cn("text-caption truncate", "text-text-subtle")}>{row.meta}</span>
    </span>
  </>
);

const ShortRow = ({ row }: { readonly row: QueueRow }) => (
  <>
    <span className="text-text-subtle text-micro w-tree-row shrink-0 text-center font-mono">
      {row.kind === "pull" ? row.number : ""}
    </span>
    <span className="text-body text-text-subtle line-clamp-1 flex-1 text-left">{row.title}</span>
  </>
);

export const Queue = ({
  groups,
  caption,
  selected,
  onOpen,
  onOpenPull,
  onList,
  markOf,
}: QueueProps) => {
  const held = useCtrlHeld();
  const order = groups.flatMap((group) => group.rows);

  useDigits(order, onOpen);

  return (
    <nav
      aria-label="Review queue"
      data-testid="review-queue"
      className="bg-surface-sunken border-hairline flex w-[264px] shrink-0 flex-col border-r"
    >
      <button
        type="button"
        onClick={onList}
        aria-label="Pull requests"
        title="All pull requests"
        className="px-panel pt-panel flex cursor-default flex-col gap-0.5 pb-1.5 text-left"
      >
        <span className="text-heading text-text-strong font-medium">Review</span>
        <span className="text-caption text-text-subtle">{caption}</span>
      </button>
      <div className="pb-gap min-h-0 flex-1 overflow-y-auto">
        {groups.map((group) => (
          <section key={group.id} className="px-gap pt-gap flex flex-col gap-0.5">
            <h2 className="text-caption text-text-subtle px-gap pt-gap flex items-center pb-1.5 font-normal">
              <span className="flex-1">{group.label}</span>
              <span className="tabular">{group.rows.length}</span>
            </h2>
            {group.rows.map((row) => {
              const isSelected = row.id === selected;
              const digit = order.indexOf(row);

              return (
                <button
                  type="button"
                  key={row.id}
                  data-testid="review-queue-row"
                  data-row={row.id}
                  aria-current={isSelected ? "page" : undefined}
                  onClick={() => onOpen(row)}
                  className={cn(
                    "rounded-row flex shrink-0 cursor-default items-center gap-row-x border px-gap",
                    group.compact ? "h-row" : "min-h-session-row py-1",
                    isSelected
                      ? "bg-row-selected border-hairline"
                      : "hover:bg-fill-hover border-transparent"
                  )}
                >
                  {group.compact ? (
                    <ShortRow row={row} />
                  ) : (
                    <TallRow row={row} selected={isSelected} />
                  )}
                  {held && digit < 9 ? (
                    <Kbd data-testid="review-queue-digit">⌃{digit + 1}</Kbd>
                  ) : (
                    <Mark mark={markOf(row)} />
                  )}
                </button>
              );
            })}
          </section>
        ))}
      </div>
      <div className="border-hairline px-panel flex h-10 shrink-0 items-center border-t">
        <ByUrl onOpen={onOpenPull} />
      </div>
    </nav>
  );
};
