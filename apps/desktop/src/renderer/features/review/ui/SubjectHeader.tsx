/**
 * The subject header (Paper R1 1V2-0, R2 243-0): a pull request's title, number and one
 * caption line (author, base ← head as mono chips, repository), or an Agent Session's tile,
 * title, caption and Turn picker; then the checkout chip and the primary action (slots).
 */
import type { TurnId } from "@polaris/protocol";
import { cn, harnessHue, Tile } from "@polaris/ui";
import type { ReactNode } from "react";
import { type PullDetailView, pullStatus, repoOfRow } from "../../../../shared/github.ts";
import { BranchChip, StackChip, StatusPill } from "../../pulls/ui/StackParts.tsx";
import type { TurnInfo, TurnPick } from "../data/source.ts";

/** A pull request's header tops its two lines (R1); an Agent Session's centres on its tile (R2). */
const Shell = ({
  children,
  centred = false,
}: {
  readonly children: ReactNode;
  readonly centred?: boolean;
}) => (
  <header
    data-testid="review-header"
    className={cn(
      "border-hairline flex shrink-0 border-b px-5",
      centred ? "items-center gap-3.5 py-3.5" : "gap-panel pt-panel items-start pb-3.5"
    )}
  >
    {children}
  </header>
);

interface TurnOption {
  readonly value: string;
  readonly label: string;
}

/** The Turn picker (Paper R2 249-0): a sunken well, the chosen Turn a raised segment. */
const TurnPicker = ({
  options,
  value,
  onChange,
}: {
  readonly options: ReadonlyArray<TurnOption>;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) => (
  <div
    role="radiogroup"
    aria-label="Turns"
    data-testid="turn-picker"
    className="border-hairline bg-surface-sunken flex shrink-0 gap-0.5 rounded-[8px] border p-0.5"
  >
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        role="radio"
        aria-checked={option.value === value}
        onClick={() => onChange(option.value)}
        className={cn(
          "text-caption px-row-x flex h-[26px] cursor-default items-center rounded-control font-medium",
          option.value === value
            ? "bg-surface-raised text-text-strong shadow-[0_1px_2px_rgb(0_0_0/6%)]"
            : "text-text-subtle hover:text-text-default"
        )}
      >
        {option.label}
      </button>
    ))}
  </div>
);

export interface PullHeaderProps {
  readonly name: string;
  readonly number: number;
  readonly detail: PullDetailView | null;
  readonly actions: ReactNode;
}

export const PullHeader = ({ name, number, detail, actions }: PullHeaderProps) => {
  return (
    <Shell>
      <div className="gap-gap flex min-w-0 flex-1 flex-col">
        <div className="gap-row-x flex min-w-0 items-baseline">
          <h1
            data-testid="pull-review-title"
            className="text-title text-text-strong truncate font-medium tracking-[-0.01em]"
          >
            {detail?.title ?? name}
          </h1>
          <span className="text-title text-text-subtle shrink-0 font-normal">#{number}</span>
        </div>
        <div className="text-caption text-text-subtle gap-gap flex min-w-0 items-center overflow-hidden whitespace-nowrap [contain:inline-size]">
          {detail === null ? (
            <span>{name}</span>
          ) : (
            <>
              <StatusPill status={pullStatus(detail.state, detail.isDraft)} />
              {detail.stack === null || detail.stack === undefined ? null : (
                <StackChip stack={detail.stack} repo={repoOfRow(detail)} />
              )}
              {/* Remote images are outside the CSP: the author's initial stands in for the avatar. */}
              <span
                aria-hidden="true"
                className="bg-fill-selected text-text-subtle text-micro flex size-[18px] shrink-0 items-center justify-center rounded-full font-medium"
              >
                {(detail.author?.login ?? "?").slice(0, 1).toUpperCase()}
              </span>
              <span>
                {detail.author?.login ?? "ghost"} wants to merge {detail.commits}{" "}
                {detail.commits === 1 ? "commit" : "commits"} into
              </span>
              {/* base ← head on one line: long branch names are cut, whole on hover. */}
              <BranchChip name={detail.baseRefName} />
              <span aria-label="from">←</span>
              <BranchChip name={detail.headRefName} />
              <span className="text-text-subtle truncate">· {detail.repo}</span>
            </>
          )}
        </div>
      </div>
      <div className="gap-gap flex shrink-0 items-center">{actions}</div>
    </Shell>
  );
};

export interface SessionHeaderProps {
  readonly title: string;
  readonly harness: string;
  readonly caption: string;
  readonly pending: ReadonlyArray<TurnInfo>;
  readonly pick: TurnPick;
  readonly onPick: (pick: TurnPick) => void;
  readonly actions: ReactNode;
}

/** The Turn picker shows at most this many single Turns before "All". */
const PICKER_TURNS = 4;

export const SessionHeader = ({
  title,
  harness,
  caption,
  pending,
  pick,
  onPick,
  actions,
}: SessionHeaderProps) => {
  const turns = pending.slice(-PICKER_TURNS);

  const options: ReadonlyArray<TurnOption> = [
    ...turns.map((t) => ({ value: t.id, label: `${t.index + 1}` })),
    { value: "all", label: `All ${pending.length} turns` },
  ];

  return (
    <Shell centred>
      <Tile hue={harness} size={36} aria-label={harnessHue(harness).name} />
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <h1
          data-testid="session-review-title"
          className="text-title text-text-strong truncate font-medium tracking-[-0.01em]"
        >
          {title}
        </h1>
        <p className="text-caption text-text-subtle truncate">{caption}</p>
      </div>
      {pending.length > 1 && (
        <TurnPicker
          value={pick.kind === "all" ? "all" : pick.turnId}
          options={options}
          onChange={(value) =>
            onPick(
              value === "all"
                ? { kind: "all" }
                : // SAFETY: every other option's value is one of `pending`'s Turn ids.
                  { kind: "turn", turnId: value as TurnId }
            )
          }
        />
      )}
      <div className="gap-gap flex shrink-0 items-center">{actions}</div>
    </Shell>
  );
};
