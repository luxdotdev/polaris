/**
 * The subject header at the top of the diff's panel (Paper X-G, R2 243-0): a pull request's
 * toolbar (state pill and stack chip, then its actions: reviewers, the checkout chip, Merge,
 * Submit review), its title and number, and one caption line (author, base ← head as mono
 * chips, repository); or an Agent Session's tile, title, caption, Turn picker and actions.
 */
import type { TurnId } from "@polaris/protocol";
import { cn, harnessHue, Tile } from "@polaris/ui";
import type { ReactNode } from "react";
import { type PullDetailView, pullStatus, repoOfRow } from "../../../../shared/github.ts";
import { BranchChip, StackChip, StatusPill } from "../../pulls/ui/StackParts.tsx";
import { pickerOptions, type ReviewTurn, type TurnPick } from "../data/source.ts";
import { PullMenu } from "./pullMenu.tsx";

/** A pull request's header stacks toolbar, title and caption (X-G); an Agent Session's centres on its tile (R2). */
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
      "flex shrink-0 pr-4 pl-5",
      centred ? "items-center gap-3.5 py-3.5" : "flex-col gap-1.5 py-3"
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
  /** Its page on GitHub, for the title's right-click menu. */
  readonly url: string;
  readonly actions: ReactNode;
}

export const PullHeader = ({ name, number, detail, url, actions }: PullHeaderProps) => {
  return (
    <Shell>
      <div className="gap-gap flex min-w-0 items-center pb-1" data-testid="pull-review-toolbar">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {detail !== null && (
            <>
              <StatusPill status={pullStatus(detail.state, detail.isDraft)} />
              {detail.stack === null || detail.stack === undefined ? null : (
                <StackChip stack={detail.stack} repo={repoOfRow(detail)} />
              )}
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
      </div>
      <PullMenu url={url}>
        <div className="gap-gap flex min-w-0 flex-col" data-testid="pull-review-subject">
          <div className="gap-row-x flex min-w-0 items-baseline">
            <h1
              data-testid="pull-review-title"
              className="text-title text-text-strong truncate font-semibold tracking-[-0.01em]"
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
                {/* Remote images are outside the CSP: the author's initial stands in for the avatar. */}
                <span
                  aria-hidden="true"
                  className="bg-fill-selected text-text-subtle text-micro flex size-[18px] shrink-0 items-center justify-center rounded-full font-medium"
                >
                  {(detail.author?.login ?? "?").slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 truncate">
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
      </PullMenu>
    </Shell>
  );
};

export interface SessionHeaderProps {
  readonly title: string;
  readonly harness: string;
  readonly caption: string;
  readonly pending: ReadonlyArray<ReviewTurn>;
  readonly pick: TurnPick;
  readonly onPick: (pick: TurnPick) => void;
  readonly actions: ReactNode;
}

export const SessionHeader = ({
  title,
  harness,
  caption,
  pending,
  pick,
  onPick,
  actions,
}: SessionHeaderProps) => {
  const options: ReadonlyArray<TurnOption> = pickerOptions(pending);

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
