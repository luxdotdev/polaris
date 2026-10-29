/**
 * The pull request's status pill, its branch chips and its stack chip with the stack's
 * popover (DESIGN.md, Review → Stacks; Chrome redesign → Review). A state takes its hue
 * lightly (12% fill, 30% hairline, hued glyph and text), never solid; draft stays neutral.
 */
import {
  cn,
  COPIED,
  COPY_FAILED,
  InstrumentPopoverContent,
  Popover,
  PopoverAnchor,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useCopy,
} from "@polaris/ui";
import { type ReactNode, useRef, useState } from "react";
import type {
  ChecksView,
  PullStatus,
  RepoRef,
  StackMemberView,
  StackView,
} from "../../../../shared/github.ts";
import { openPull } from "../../../routes/review.ts";
import { useShellActions } from "../../../shell/hooks.ts";
import {
  checksText,
  layerText,
  shortBranch,
  STATUS_HUES,
  STATUS_LABELS,
  stackStatus,
  stackTitle,
  topDown,
} from "../model/stack.ts";
import { StackHero } from "./StackHero.tsx";
import { ClosedGlyph, DraftGlyph, MergedGlyph, PullGlyph, StackGlyph } from "./glyphs.tsx";

const STATUS_GLYPHS: Readonly<Record<PullStatus, (props: { size?: number }) => ReactNode>> = {
  open: PullGlyph,
  draft: DraftGlyph,
  merged: MergedGlyph,
  closed: ClosedGlyph,
};

export const StatusGlyph = ({
  status,
  size = 14,
}: {
  readonly status: PullStatus;
  readonly size?: number;
}) => {
  const Glyph = STATUS_GLYPHS[status];

  return (
    <span
      className="inline-flex shrink-0"
      style={{ color: STATUS_HUES[status] ?? "var(--color-text-subtle)" }}
    >
      <Glyph size={size} />
    </span>
  );
};

/** The pill's light tint of a state's hue. */
const pillStyle = (hue: string) => ({
  color: hue,
  backgroundColor: `color-mix(in oklab, ${hue} 12%, transparent)`,
  boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${hue} 30%, transparent)`,
});

/** Open, Merged or Closed in their hue's light tint; Draft a neutral dashed pill. */
export const StatusPill = ({ status }: { readonly status: PullStatus }) => {
  const hue = STATUS_HUES[status];

  return (
    <span
      data-testid="pull-status"
      data-status={status}
      className={cn(
        "rounded-control text-caption inline-flex h-[22px] shrink-0 items-center gap-1.5 px-2 font-medium",
        hue === null && "border-hairline text-text-subtle border border-dashed"
      )}
      style={hue === null ? undefined : pillStyle(hue)}
    >
      <StatusGlyph status={status} size={13} />
      {STATUS_LABELS[status]}
    </span>
  );
};

/** A branch name cut after 20 characters; hover shows it whole, a click copies it. */
export const BranchChip = ({ name }: { readonly name: string }) => {
  const { state, copy } = useCopy();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid="branch-chip"
          data-branch={name}
          data-copy-state={state}
          onClick={() => copy(name)}
          aria-label={`${name}: copy`}
          className="bg-row-selected text-text-default text-micro hover:bg-fill-selected shrink-0 cursor-default rounded-[4px] px-1.5 py-px font-mono transition-transform duration-120 ease-out active:scale-[0.97]"
        >
          {shortBranch(name)}
        </button>
      </TooltipTrigger>
      <TooltipContent className={cn("font-mono", state === "failed" && "text-failed-text")}>
        {{ idle: name, copied: COPIED, failed: COPY_FAILED }[state]}
      </TooltipContent>
    </Tooltip>
  );
};

const ChecksLine = ({ checks }: { readonly checks: ChecksView | null }) => {
  const text = checksText(checks);

  if (text === null || checks === null) return null;

  return (
    <span
      className={cn(
        "shrink-0",
        checks.state === "failure" ? "text-failed-text" : "text-text-subtle"
      )}
    >
      {text}
    </span>
  );
};

const Member = ({
  member,
  current,
  onOpen,
}: {
  readonly member: StackMemberView;
  readonly current: boolean;
  readonly onOpen: (member: StackMemberView) => void;
}) => (
  <button
    type="button"
    data-testid="stack-member"
    data-number={member.number}
    aria-current={current ? "page" : undefined}
    onClick={() => onOpen(member)}
    className={cn(
      "rounded-row px-row-x flex w-full cursor-default items-start gap-2.5 py-1.5 text-left",
      current ? "bg-fill-selected" : "hover:bg-fill-hover"
    )}
  >
    <span className="mt-0.5">
      <StatusGlyph status={member.status} />
    </span>
    <span className="flex min-w-0 flex-1 flex-col gap-px">
      <span
        className={cn(
          "text-label truncate font-medium",
          current && "text-text-strong",
          !current && (member.status === "merged" ? "text-text-subtle" : "text-text-default")
        )}
      >
        {member.title}
      </span>
      <span className="text-caption text-text-subtle flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate">
          #{member.number} ·{" "}
          <span className="font-mono">{shortBranch(member.headRefName, 32)}</span>
        </span>
        <span className="flex-1" />
        <ChecksLine checks={member.checks} />
        <span className="tabular shrink-0 font-mono">
          <span className="text-diff-added-text">+{member.additions}</span>{" "}
          <span className="text-diff-removed-text">−{member.deletions}</span>
        </span>
      </span>
    </span>
  </button>
);

/** Waits this long before opening on hover, and before closing once the pointer leaves. */
const HOVER_OPEN_MS = 150;

const HOVER_CLOSE_MS = 200;

export interface StackChipProps {
  readonly stack: StackView;
  /** The pull requests' repository, for opening a layer. */
  readonly repo: RepoRef;
  /** `compact`: the pull list's chip, without the glyph's padding. */
  readonly compact?: boolean;
}

/** "2/4": hover, click or ↵ opens the stack; choosing a layer opens its Review. */
export const StackChip = ({ stack, repo, compact = false }: StackChipProps) => {
  const actions = useShellActions();
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Opened by the pointer: focus stays where it was; a click or ↵ moves it into the list.
  const byHover = useRef(false);

  const later = (next: boolean, ms: number) => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(next), ms);
  };

  const hover = {
    onPointerEnter: () => {
      if (!open) byHover.current = true;
      later(true, HOVER_OPEN_MS);
    },
    onPointerLeave: () => later(false, HOVER_CLOSE_MS),
  };

  const current = stack.members[stack.position - 1];

  const choose = (member: StackMemberView) => {
    setOpen(false);

    if (member.number === current?.number) return;
    openPull(actions, { repo, number: member.number, pullId: member.id === "" ? null : member.id });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <button
          type="button"
          data-testid="stack-chip"
          aria-label={`Layer ${stack.position} of ${stack.size} in a stack`}
          aria-expanded={open}
          onClick={(event) => {
            event.stopPropagation();
            byHover.current = false;
            setOpen(!open);
          }}
          {...hover}
          className={cn(
            "border-hairline text-text-default tabular inline-flex shrink-0 cursor-default items-center gap-1 rounded-full border font-medium",
            compact
              ? "text-micro h-[18px] px-1.5"
              : "text-caption hover:bg-fill-hover h-[22px] px-2"
          )}
        >
          <span className="text-text-subtle">
            <StackGlyph size={compact ? 11 : 13} />
          </span>
          {layerText(stack)}
        </button>
      </PopoverAnchor>
      <InstrumentPopoverContent
        align="start"
        data-testid="stack-popover"
        className="w-[440px]"
        onClick={(event) => event.stopPropagation()}
        onOpenAutoFocus={(event) => {
          if (byHover.current) event.preventDefault();
        }}
        {...hover}
        header={{
          title: stackTitle(stack),
          state: `${stack.size} pull requests · layer ${stack.position}`,
        }}
        hero={<StackHero stack={stack} />}
        heroMaxHeight={200}
        wells={[
          <div key="layers" className="flex flex-col gap-0.5 p-1">
            {topDown(stack).map((member) => (
              <Member
                key={member.number}
                member={member}
                current={member.number === current?.number}
                onOpen={choose}
              />
            ))}
            <div className="px-row-x flex items-center gap-2.5 py-1.5" data-testid="stack-trunk">
              <span
                aria-hidden
                className="border-text-subtle mx-[3px] size-2 rounded-full border"
              />
              <span className="bg-row-selected text-text-default text-micro rounded-[4px] px-1.5 py-px font-mono">
                {stack.trunk}
              </span>
            </div>
          </div>,
        ]}
        footer={{ status: stackStatus(stack) }}
      />
    </Popover>
  );
};
