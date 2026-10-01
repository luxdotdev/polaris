/**
 * One pull request in the list (Paper R3): the neutral PR tile, title over `#n · repo ·
 * author`, then fixed lanes for workspace, changes, risk and updated, so columns line up.
 */
import { cn } from "@polaris/ui";
import type { RowModel } from "../model/list.ts";
import { PullGlyph } from "./glyphs.tsx";

/** Lane widths from Paper R3; the header uses the same ones. */
export const LANES = {
  workspace: "w-[200px]",
  changes: "w-[104px]",
  risk: "w-[72px]",
  updated: "w-[56px]",
} as const;

const count = (n: number) => n.toLocaleString("en-US");

export interface PullRowProps {
  readonly row: RowModel;
  readonly onOpen: (row: RowModel) => void;
}

const Workspace = ({ lane }: { readonly lane: RowModel["workspace"] }) => {
  if (lane === null) {
    return (
      <div className={cn(LANES.workspace, "text-caption text-text-faint shrink-0")}>
        Not in a workspace
      </div>
    );
  }

  return (
    <div
      className={cn(
        LANES.workspace,
        "flex min-w-0 shrink-0 flex-col gap-0.5",
        lane.away && "opacity-55"
      )}
    >
      <span className="text-body text-text-default truncate">{lane.name}</span>
      <span className="text-caption text-text-subtle flex min-w-0 items-center gap-1.5">
        {lane.away ? (
          <span aria-hidden className="border-text-subtle size-1.5 shrink-0 rounded-full border" />
        ) : null}
        <span className="truncate">{lane.where}</span>
      </span>
    </div>
  );
};

export const PullRow = ({ row, onOpen }: PullRowProps) => (
  <button
    type="button"
    data-testid="pull-row"
    data-pull-row
    data-pull={row.id}
    onClick={() => onOpen(row)}
    className="group/pull rounded-row hover:bg-fill-hover focus-visible:bg-fill-hover flex h-[52px] w-full shrink-0 cursor-default items-center gap-3 px-3 text-left outline-none"
  >
    <span className="bg-surface-raised text-text-subtle group-hover/pull:bg-fill-selected group-hover/pull:text-text-strong group-focus-visible/pull:bg-fill-selected flex size-(--spacing-tree-row) shrink-0 items-center justify-center rounded-[8px]">
      <PullGlyph />
    </span>
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="text-label text-text-default group-hover/pull:text-text-strong line-clamp-1 font-medium">
        {row.title}
      </span>
      <span className="text-caption text-text-subtle truncate">{row.meta}</span>
    </span>
    <Workspace lane={row.workspace} />
    <span className={cn(LANES.changes, "text-caption tabular flex shrink-0 gap-2 font-mono")}>
      <span className="text-diff-added-text">+{count(row.additions)}</span>
      <span className="text-diff-removed-text">−{count(row.deletions)}</span>
    </span>
    {/* A risk summary only runs when a review opens; the list never implies a change is safe. */}
    <span className={cn(LANES.risk, "text-caption text-text-faint shrink-0")}>Not run</span>
    <span className={cn(LANES.updated, "text-caption text-text-faint shrink-0 text-right")}>
      {row.updated}
    </span>
  </button>
);
