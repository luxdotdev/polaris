/**
 * The rail's rows (DESIGN.md, Rows, not a canvas): fixed lanes of rail (60px), id, title,
 * actor and state, plus at most two caption lines that carry state, never prose.
 */
import { Button, ChevronDownIcon, ChevronRightIcon, cn } from "@polaris/ui";
import type { ReactNode } from "react";
import {
  type ClaimGlance,
  clock,
  type Line,
  type Liveness,
  pluralize,
  type RailRow,
  shortSha,
  type Tally,
  tallyBar,
  type TaskRow,
  type Tone,
} from "../model/index.ts";
import { InputDot, TaskGlyph } from "./glyphs.tsx";
import { Checks, StripBar } from "./strip.tsx";

export const TONE: Readonly<Record<Tone, string>> = {
  neutral: "text-text-default",
  accepted: "text-accepted-text",
  "needs-you": "text-needs-you-text",
  failed: "text-failed-text",
  faint: "text-text-faint",
};

const ID_TONE: Readonly<Record<Tone, string>> = { ...TONE, neutral: "text-text-subtle" };

/** The rail column: the trunk, and for a nested row the elbow to its glyph. */
const Rail = ({
  nested,
  accepted,
  children,
}: {
  readonly nested: boolean;
  readonly accepted?: boolean;
  readonly children: ReactNode;
}) => (
  <span className="relative w-[60px] shrink-0 self-stretch" aria-hidden={false}>
    <span className="bg-text-strong/14 absolute top-0 bottom-0 left-[8px] w-px" />
    {nested ? (
      <span
        className={cn(
          "absolute top-0 left-[8px] h-[14px] w-[10px] rounded-bl-[6px] border-b border-l",
          accepted ? "border-accepted/40" : "border-text-strong/14"
        )}
      />
    ) : null}
    <span
      className={cn(
        "bg-bg absolute top-[6px] grid size-4 place-items-center rounded-full",
        nested ? "left-[18px]" : "left-[1px]"
      )}
    >
      {children}
    </span>
  </span>
);

const Caption = ({ children, className }: { children: ReactNode; className?: string }) => (
  <p
    className={cn(
      "text-caption text-text-subtle flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap",
      className
    )}
  >
    {children}
  </p>
);

const LivenessLine = ({ line }: { readonly line: Liveness }) => (
  <Caption>
    {line.activity === null ? null : (
      <span className={cn("truncate", line.mono && "text-code-inline font-mono")}>
        {line.activity}
        {line.duration === null ? null : <span className="font-sans"> · {line.duration}</span>}
      </span>
    )}
    {line.progress === null ? null : <span className="truncate">{line.progress}</span>}
    {line.context === null ? null : (
      <span className="text-text-faint tabular shrink-0">context {line.context}%</span>
    )}
    {line.queued === 0 ? null : (
      <span className="text-text-faint shrink-0">{line.queued} queued</span>
    )}
    {line.quiet === null ? null : <span className="text-text-faint shrink-0">{line.quiet}</span>}
    {line.away === null ? null : <span className="text-text-faint">{line.away}</span>}
  </Caption>
);

const ClaimLine = ({ glance }: { readonly glance: ClaimGlance }) => (
  <Caption>
    <span className="text-code-inline font-mono">{shortSha(glance.head)}</span>
    <Checks checks={glance.checks} />
    {glance.notDone === 0 ? null : <span>{glance.notDone} not done</span>}
    {glance.questions === 0 ? null : (
      <span className="text-needs-you-text">{pluralize(glance.questions, "question")}</span>
    )}
    {glance.asserted ? <span className="text-text-faint">no receipts</span> : null}
  </Caption>
);

const LineView = ({ line }: { readonly line: Line }) => {
  switch (line.kind) {
    case "liveness":
      return <LivenessLine line={line} />;
    case "claim":
      return <ClaimLine glance={line.glance} />;
    case "accepted":
      return (
        <Caption>
          <span className="text-code-inline font-mono">{shortSha(line.head)}</span>
          <Checks checks={line.receipts} reportedHollow />
        </Caption>
      );
    case "note":
      return (
        <Caption>
          <span className={cn("truncate", line.tone === "needs-you" && "text-needs-you-text")}>
            {line.text}
          </span>
          {line.detail === null ? null : <span className="text-text-faint">{line.detail}</span>}
        </Caption>
      );
  }
};

export interface RowHandlers {
  readonly onToggleGroup: (group: string) => void;
  readonly onFocus: (row: TaskRow) => void;
  readonly onReview: (row: TaskRow, mode: "accept" | "send-back") => void;
  readonly onProposal: (proposalId: string, accept: boolean) => void;
  readonly onHandover: (revision: number) => void;
  /** The row's ⋯ menu, rendered by the tab. */
  readonly menu: (row: TaskRow) => ReactNode;
}

const TaskTitle = ({ row }: { readonly row: TaskRow }) => (
  <span className="text-body text-text-default flex min-w-0 flex-1 items-center gap-1.5">
    {row.inputs === null ? null : (
      <span className="flex shrink-0 items-center gap-[3px]" aria-hidden>
        {row.inputs.map((glyph, n) => (
          <InputDot key={n} glyph={glyph} harness={null} />
        ))}
        <span className="text-text-faint pl-0.5">→</span>
      </span>
    )}
    <span className="truncate">{row.task.title}</span>
  </span>
);

const TaskView = ({ row, on }: { readonly row: TaskRow; readonly on: RowHandlers }) => (
  <div className="min-h-tree-row flex w-full items-stretch pr-3 pl-3" data-task={row.task.id}>
    <Rail nested={row.nested} accepted={row.look.bucket === "done"}>
      <TaskGlyph glyph={row.look.glyph} harness={row.harness} />
    </Rail>
    <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-[5px]">
      <div className="flex min-w-0 items-center gap-3">
        <span className={cn("text-code-inline w-10 shrink-0 font-mono", ID_TONE[row.look.idTone])}>
          {row.task.id}
        </span>
        <TaskTitle row={row} />
        <span className="text-body text-text-subtle hidden w-[9.5rem] shrink-0 truncate text-right @[42rem]:block">
          {row.actor}
        </span>
        <span className="flex w-[7.5rem] shrink-0 items-center justify-end gap-1.5 text-right">
          <span className={cn("text-body truncate", TONE[row.look.wordTone])}>{row.look.word}</span>
          {row.look.evidence === null ? null : (
            <span className="text-body text-text-subtle">{row.look.evidence}</span>
          )}
        </span>
        <span className="w-6 shrink-0">{row.attempt === null ? null : on.menu(row)}</span>
      </div>
      {row.line === null && !row.promoted ? null : (
        <div className="flex min-w-0 items-center gap-3 pl-[3.25rem]">
          <div className="min-w-0 flex-1">
            {row.line === null ? null : <LineView line={row.line} />}
          </div>
          {row.promoted ? (
            <span className="flex shrink-0 gap-1.5 pr-9">
              <Button size="xs" onClick={() => on.onReview(row, "accept")}>
                Accept…
              </Button>
              <Button size="xs" variant="ghost" onClick={() => on.onReview(row, "send-back")}>
                Send back…
              </Button>
            </span>
          ) : null}
        </div>
      )}
      {row.overlap === null ? null : (
        <div className="pl-[3.25rem]">
          <Caption>
            <span aria-hidden className="text-text-faint">
              ⧉
            </span>
            <span>Area overlaps {row.overlap.with}</span>
            <span className="text-code-inline text-text-faint truncate font-mono">
              {row.overlap.glob}
            </span>
          </Caption>
        </div>
      )}
    </div>
  </div>
);

const TallyText = ({ tally }: { readonly tally: Tally }) => {
  const parts: Array<ReactNode> = [];

  if (tally["needs-you"] > 0)
    parts.push(
      <span key="ny" className="text-needs-you-text">
        {tally["needs-you"]} needs you
      </span>
    );

  if (tally.review > 0) parts.push(<span key="r">{tally.review} in review</span>);

  if (tally.working > 0) parts.push(<span key="w">{tally.working} working</span>);

  if (tally.waiting > 0 && tally.working + tally.review + tally["needs-you"] === 0)
    parts.push(<span key="wt">{tally.waiting} waiting</span>);

  return (
    <span className="text-body text-text-subtle flex min-w-0 shrink items-center gap-1.5 overflow-hidden whitespace-nowrap">
      {parts.flatMap((p, n) => (n === 0 ? [p] : [<span key={`s${n}`}>·</span>, p]))}
      {tally.done > 0 ? <span className="text-accepted-text pl-1">{tally.done} done</span> : null}
    </span>
  );
};

const GroupView = ({
  row,
  on,
  large,
}: {
  readonly row: Extract<RailRow, { kind: "group" }>;
  readonly on: RowHandlers;
  readonly large: boolean;
}) => (
  <div className="h-tree-row flex w-full items-stretch pr-3 pl-3">
    <Rail nested={false}>
      <TaskGlyph glyph={row.glyph} harness={null} />
    </Rail>
    <button
      type="button"
      aria-expanded={row.open}
      onClick={() => on.onToggleGroup(row.group)}
      className="flex min-w-0 flex-1 cursor-default items-center gap-3 pl-[3.25rem] text-left"
    >
      <span className="text-label text-text-strong flex min-w-24 flex-1 items-center gap-1.5">
        {row.open ? (
          <ChevronDownIcon size={10} className="text-text-subtle shrink-0" />
        ) : (
          <ChevronRightIcon size={10} className="text-text-subtle shrink-0" />
        )}
        <span className="truncate">{row.label}</span>
        {large ? (
          <span className="text-body text-text-faint tabular shrink-0">
            {row.total}
            {row.tally.proposed > 0 ? ` · ${row.tally.proposed} proposed` : ""}
          </span>
        ) : null}
      </span>
      {large ? (
        <span className="hidden @[44rem]:block">
          <StripBar parts={tallyBar(row.tally, row.total)} width={120} />
        </span>
      ) : null}
      <TallyText tally={row.tally} />
      <span className="w-6 shrink-0" />
    </button>
  </div>
);

/** A Subagent under its Attempt (DESIGN.md, Subagents are nodes): smaller glyph, "subagent". */
const SubagentView = ({
  row,
  on,
}: {
  readonly row: Extract<RailRow, { kind: "subagent" }>;
  readonly on: RowHandlers;
}) => (
  <button
    type="button"
    onClick={() => on.onFocus(row.parent)}
    className="h-tree-row flex w-full cursor-default items-stretch pr-3 pl-3 text-left"
    data-subagent={row.subagent.id}
  >
    <span className="relative w-[60px] shrink-0 self-stretch">
      <span className="bg-text-strong/14 absolute top-0 bottom-0 left-[8px] w-px" />
      <span className="border-text-strong/14 absolute top-0 left-[26px] h-[14px] w-[10px] rounded-bl-[6px] border-b border-l" />
      <span className="bg-bg absolute top-[8px] left-[36px] grid size-3 place-items-center rounded-full">
        <TaskGlyph glyph="working" harness={row.parent.harness} size={12} />
      </span>
    </span>
    <span className="flex min-w-0 flex-1 items-center gap-3">
      <span className="w-10 shrink-0" />
      <span className="text-body text-text-subtle min-w-0 flex-1 truncate">
        {row.subagent.title}
      </span>
      <span className="text-body text-text-faint hidden w-[9.5rem] shrink-0 truncate text-right @[42rem]:block">
        {row.subagent.agent === null ? "subagent" : `subagent · ${row.subagent.agent}`}
      </span>
      <span className="text-body text-text-default w-[7.5rem] shrink-0 text-right">
        working · {row.age}
      </span>
      <span className="w-6 shrink-0" />
    </span>
  </button>
);

export const RowView = ({
  row,
  on,
  large,
}: {
  readonly row: RailRow;
  readonly on: RowHandlers;
  readonly large: boolean;
}) => {
  switch (row.kind) {
    case "task":
      return <TaskView row={row} on={on} />;
    case "group":
      return <GroupView row={row} on={on} large={large} />;
    case "handover":
      return (
        <div className="h-tree-row flex w-full items-stretch pr-3 pl-3">
          <Rail nested={false}>
            <span className="bg-text-faint size-[5px] rounded-full" />
          </Rail>
          <span className="text-body text-text-subtle flex flex-1 items-center">
            Handed to a new lead at {clock(row.handover.at)}
          </span>
          <Button size="xs" variant="ghost" onClick={() => on.onHandover(row.handover.revision)}>
            Summary ›
          </Button>
          <span className="w-6 shrink-0" />
        </div>
      );
    case "proposal":
      return (
        <div className="h-tree-row flex w-full items-stretch pr-3 pl-3">
          <Rail nested={row.nested}>
            <TaskGlyph glyph="future" harness={null} />
          </Rail>
          <span className="flex min-w-0 flex-1 items-center gap-3 pl-[3.25rem]">
            <span className="text-body text-text-default truncate">{row.proposal.task.title}</span>
            {row.by === null ? null : (
              <span className="text-body text-text-subtle shrink-0">proposed by {row.by}</span>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <Button size="xs" onClick={() => on.onProposal(row.proposal.proposalId, true)}>
              Accept
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => on.onProposal(row.proposal.proposalId, false)}
            >
              Decline
            </Button>
          </span>
          <span className="w-6 shrink-0" />
        </div>
      );
    case "waiting":
      return (
        <div className="h-tree-row flex w-full items-stretch pr-3 pl-3">
          <Rail nested>
            <TaskGlyph glyph="waiting" harness={null} />
          </Rail>
          <button
            type="button"
            onClick={() => on.onToggleGroup(row.group)}
            className="text-body text-text-subtle flex flex-1 cursor-default items-center gap-1.5 text-left"
          >
            <ChevronRightIcon size={10} />
            {row.count} waiting · {row.ids}
          </button>
        </div>
      );
    case "subagent":
      return <SubagentView row={row} on={on} />;
    case "note":
      return (
        <p className="text-caption text-text-subtle h-tree-row flex items-center pr-3 pl-[calc(0.75rem+60px)]">
          {row.text}
        </p>
      );
  }
};
