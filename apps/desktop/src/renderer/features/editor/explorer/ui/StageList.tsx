/**
 * Staged and Changes (Paper 15): one row per file and side of the index, the
 * hover action to move it across, and Discard behind a popover whose Cancel is focused.
 */
import {
  Button,
  cn,
  IconButton,
  PlusIcon,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  SectionHeader,
} from "@polaris/ui";
import type { SVGProps } from "react";
import { type StageRow } from "../model/stage.ts";
import { AgentSlot, GitSlot, nameTone } from "./slots.tsx";

const MinusIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" width={16} height={16} fill="none" aria-hidden {...props}>
    <path d="M3.5 8h9" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
  </svg>
);

const DiscardIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" width={16} height={16} fill="none" aria-hidden {...props}>
    <path
      d="M5.5 3.5 3 6l2.5 2.5M3 6h6.25a3.25 3.25 0 0 1 0 6.5H7"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export type StageSide = "staged" | "unstaged";

export interface StageSectionProps {
  readonly side: StageSide;
  readonly rows: ReadonlyArray<StageRow>;
  readonly active: string | null;
  /** Committing: rows show but don't move. */
  readonly locked: boolean;
  /** The row whose Discard popover is open, by `rowKey`. */
  readonly confirming: string | null;
  readonly onOpen: (path: string, pin: boolean) => void;
  readonly onMove: (rows: ReadonlyArray<StageRow>) => void;
  readonly onAskDiscard: (row: StageRow | null) => void;
  readonly onDiscard: (row: StageRow) => void;
}

export const rowKey = (side: StageSide, row: StageRow) => `${side}:${row.path}`;

const ConfirmDiscard = ({
  row,
  onCancel,
  onDiscard,
}: {
  readonly row: StageRow;
  readonly onCancel: () => void;
  readonly onDiscard: () => void;
}) => (
  <PopoverContent align="start" side="bottom" className="w-60" data-testid="confirm-discard">
    <PopoverTitle>
      {row.untracked ? `Move ${row.name} to the Trash?` : `Discard changes to ${row.name}?`}
    </PopoverTitle>
    <PopoverDescription className="mt-1">
      {row.untracked
        ? "It isn't tracked, so git can't bring it back. The Trash can."
        : "It goes back to its staged or last committed version. This can't be undone."}
    </PopoverDescription>
    <div className="mt-3 flex justify-end gap-2">
      <Button size="sm" variant="ghost" autoFocus onClick={onCancel}>
        Cancel
      </Button>
      <Button size="sm" variant="danger" onClick={onDiscard} data-testid="discard-confirm">
        {row.untracked ? "Move to Trash" : "Discard"}
      </Button>
    </div>
  </PopoverContent>
);

interface RowProps extends Omit<StageSectionProps, "rows" | "onMove" | "confirming"> {
  readonly row: StageRow;
  readonly confirming: boolean;
  readonly onMove: () => void;
}

const Actions = ({ side, row, locked, onMove, onAskDiscard }: RowProps) => (
  <span
    className={cn(
      "flex shrink-0 items-center opacity-0 group-focus-within:opacity-100 group-hover:opacity-100",
      locked && "hidden"
    )}
  >
    {side === "unstaged" ? (
      <IconButton
        size="sm"
        label={row.untracked ? "Move to Trash" : "Discard changes"}
        icon={<DiscardIcon />}
        className="size-5"
        data-testid="row-discard"
        onClick={() => onAskDiscard(row)}
      />
    ) : null}
    <IconButton
      size="sm"
      label={side === "staged" ? "Unstage" : "Stage"}
      icon={side === "staged" ? <MinusIcon /> : <PlusIcon size={16} />}
      className="size-5"
      data-testid={side === "staged" ? "row-unstage" : "row-stage"}
      onClick={onMove}
    />
  </span>
);

const Row = (props: RowProps) => {
  const { row, active, locked, confirming, onOpen, onAskDiscard, onDiscard } = props;
  const selected = row.path === active;
  const deleted = row.git === "deleted";

  return (
    <li className="group relative" data-testid={`${props.side}-row`} data-path={row.path}>
      <Popover open={confirming} onOpenChange={(open) => onAskDiscard(open ? row : null)}>
        <PopoverAnchor asChild>
          <div
            className={cn(
              "h-tree-row flex w-full items-center gap-1 rounded-[8px] pr-2 pl-2.5",
              selected || confirming ? "bg-fill-selected" : "hover:bg-fill-hover",
              locked && "opacity-(--opacity-dimmed)"
            )}
          >
            <button
              type="button"
              disabled={deleted}
              title={row.folder === "" ? row.name : `${row.folder}/${row.name}`}
              onClick={(event) => onOpen(row.path, event.detail >= 2)}
              className="focus-visible:ring-starlight flex min-w-0 flex-1 cursor-default items-baseline gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset"
            >
              <span
                className={cn(
                  "max-w-full shrink-0 truncate text-label font-regular",
                  nameTone(row.git, selected, false),
                  deleted && "line-through"
                )}
              >
                {row.name}
              </span>
              <span className="text-caption text-text-subtle min-w-0 flex-1 truncate">
                {row.folder}
              </span>
            </button>
            <Actions {...props} />
            <AgentSlot agent={row.agent} hand={false} />
            <GitSlot git={row.git} dirty={false} />
          </div>
        </PopoverAnchor>
        {confirming ? (
          <ConfirmDiscard
            row={row}
            onCancel={() => onAskDiscard(null)}
            onDiscard={() => onDiscard(row)}
          />
        ) : null}
      </Popover>
    </li>
  );
};

export const StageSection = (props: StageSectionProps) => {
  const { side, rows, locked, confirming, onMove } = props;

  if (rows.length === 0) return null;

  return (
    <section aria-label={side === "staged" ? "Staged" : "Changes"} data-testid={`section-${side}`}>
      <SectionHeader
        action={
          locked ? null : (
            <button
              type="button"
              data-testid={side === "staged" ? "unstage-all" : "stage-all"}
              onClick={() => onMove(rows)}
              className="text-caption text-text-subtle hover:text-text-default cursor-default"
            >
              {side === "staged" ? "Unstage all" : "Stage all"}
            </button>
          )
        }
      >
        {side === "staged" ? "Staged" : "Changes"}{" "}
        <span className="text-text-faint tabular-nums">{rows.length}</span>
      </SectionHeader>
      <ul>
        {rows.map((row) => (
          <Row
            key={row.path}
            {...props}
            row={row}
            confirming={confirming === rowKey(side, row)}
            onMove={() => onMove([row])}
          />
        ))}
      </ul>
    </section>
  );
};
