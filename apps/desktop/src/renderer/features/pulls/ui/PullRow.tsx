/**
 * One row in the list (Paper R3): a pull request (the neutral PR tile, title over `#n ·
 * repo · author`) or an Agent Session ready to review (its Harness tile, "Claude Code ·
 * turns 22–24"), then fixed lanes for workspace, changes, risk and updated. Heights and
 * insets follow density (rule/density-through-tokens).
 */
import { cn, SeverityGlyph, Tile } from "@polaris/ui";
import type { RowModel, WorkspaceLane } from "../model/list.ts";
import type { RiskLane } from "../model/risk.ts";
import { PullGlyph } from "./glyphs.tsx";

/** Lane widths from Paper R3; the header uses the same ones. */
export const LANES = {
  workspace: "w-[200px]",
  changes: "w-[104px]",
  risk: "w-[72px]",
  updated: "w-[56px]",
} as const;

/** Paper's 12px insets and gap at Calm, 10 at Balanced, 8 at Compact. */
export const ROW_X = "px-[calc(var(--spacing-row-x)+2px)] gap-[calc(var(--spacing-row-x)+2px)]";

const count = (n: number) => n.toLocaleString("en-US");

export interface PullRowProps {
  readonly row: RowModel;
  readonly onOpen: (row: RowModel) => void;
}

const Workspace = ({ lane }: { readonly lane: WorkspaceLane | null }) => {
  if (lane === null) {
    return (
      <div className={cn(LANES.workspace, "text-caption text-text-subtle shrink-0")}>
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
      <span className="text-caption text-text-subtle flex h-4 min-w-0 items-center gap-1.5">
        {lane.away ? (
          <span aria-hidden className="border-text-subtle size-1.5 shrink-0 rounded-full border" />
        ) : null}
        <span className="truncate">{lane.where}</span>
      </span>
    </div>
  );
};

const SEVERITY_TEXT = {
  critical: "text-severity-critical-text",
  high: "text-severity-high-text",
  medium: "text-severity-medium-text",
  low: "text-severity-low-text",
} as const;

const QUIET_WORDS = {
  "not-run": "Not run",
  running: "Running…",
  none: "None open",
  "rules-only": "Rules only",
} as const;

/** The highest open Severity and how many; "Not run" never implies the change is safe. */
const Risk = ({ risk }: { readonly risk: RiskLane }) => {
  const base = cn(LANES.risk, "text-caption shrink-0");

  if (risk.kind !== "found") {
    return (
      <span className={cn(base, "text-text-subtle")} data-risk={risk.kind}>
        {QUIET_WORDS[risk.kind]}
      </span>
    );
  }

  return (
    <span
      className={cn(
        base,
        "tabular flex items-center gap-1.5 font-medium",
        SEVERITY_TEXT[risk.severity]
      )}
      data-risk={risk.severity}
      aria-label={`${risk.count} ${risk.severity}`}
    >
      <SeverityGlyph severity={risk.severity} tone="text" />
      {risk.count}
    </span>
  );
};

/** The neutral PR tile; in light a hairline keeps it off the near-white page. */
const PullTile = () => (
  <span className="bg-surface-raised text-text-subtle in-data-[theme=light]:border-hairline group-hover/pull:bg-fill-selected group-hover/pull:text-text-strong group-focus-visible/pull:bg-fill-selected flex size-(--spacing-tree-row) shrink-0 items-center justify-center rounded-[8px] border border-transparent">
    <PullGlyph />
  </span>
);

export const PullRow = ({ row, onOpen }: PullRowProps) => (
  <button
    type="button"
    data-testid={row.kind === "pull" ? "pull-row" : "session-ready-row"}
    data-pull-row
    data-pull={row.id}
    onClick={() => onOpen(row)}
    className={cn(
      "group/pull rounded-row hover:bg-fill-hover focus-visible:bg-fill-hover flex min-h-[calc(var(--spacing-session-row)+4px)] w-full shrink-0 cursor-default items-center py-1 text-left outline-none",
      ROW_X
    )}
  >
    {row.kind === "pull" ? (
      <PullTile />
    ) : (
      <Tile
        hue={row.harness}
        size={28}
        style={{ width: "var(--spacing-tree-row)", height: "var(--spacing-tree-row)" }}
      />
    )}
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="text-label text-text-default group-hover/pull:text-text-strong line-clamp-1 font-medium">
        {row.title}
      </span>
      <span className="text-caption text-text-subtle truncate">{row.meta}</span>
    </span>
    <Workspace lane={row.workspace} />
    {row.kind === "pull" ? (
      <span className={cn(LANES.changes, "text-caption tabular flex shrink-0 gap-2 font-mono")}>
        <span className="text-diff-added-text">+{count(row.additions)}</span>
        <span className="text-diff-removed-text">−{count(row.deletions)}</span>
      </span>
    ) : (
      <span className={cn(LANES.changes, "shrink-0")} />
    )}
    <Risk risk={row.risk} />
    <span
      className={cn(LANES.updated, "text-caption text-text-subtle tabular shrink-0 text-right")}
    >
      {row.updated}
    </span>
  </button>
);
