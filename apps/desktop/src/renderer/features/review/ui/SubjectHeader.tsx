/**
 * The subject header (Paper R1 1V2-0, R2 243-0): a pull request's title, number and one
 * caption line (author, base ← head as mono chips, repository), or an Agent Session's tile,
 * title, caption and Turn picker; then the checkout chip and the primary action (slots).
 */
import type { TurnId } from "@polaris/protocol";
import { harnessHue, SegmentedControl, type SegmentedOption, Tile } from "@polaris/ui";
import type { ReactNode } from "react";
import type { PullDetailView } from "../../../../shared/github.ts";
import type { TurnInfo, TurnPick } from "../data/source.ts";

const Chip = ({ children }: { readonly children: ReactNode }) => (
  <span className="bg-row-selected text-text-default text-micro rounded-[4px] px-1.5 py-px font-mono">
    {children}
  </span>
);

const Shell = ({ children }: { readonly children: ReactNode }) => (
  <header
    data-testid="review-header"
    className="border-hairline gap-panel pt-panel flex shrink-0 items-start border-b px-5 pb-3.5"
  >
    {children}
  </header>
);

export interface PullHeaderProps {
  readonly name: string;
  readonly number: number;
  readonly detail: PullDetailView | null;
  readonly actions: ReactNode;
}

export const PullHeader = ({ name, number, detail, actions }: PullHeaderProps) => {
  const fileCount = detail === null ? null : detail.files.length;

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
          <span className="text-title text-text-faint shrink-0">#{number}</span>
        </div>
        <div className="text-caption text-text-subtle gap-gap flex min-w-0 flex-wrap items-center">
          {detail === null ? (
            <span>{name}</span>
          ) : (
            <>
              {detail.author !== null && (
                <img
                  src={detail.author.avatarUrl}
                  alt=""
                  className="size-[18px] shrink-0 rounded-full"
                />
              )}
              <span>{detail.author?.login ?? "ghost"} wants to merge into</span>
              <Chip>{detail.baseRefName}</Chip>
              <span>from</span>
              <Chip>{detail.headRefName}</Chip>
              <span className="text-text-faint truncate">
                · {detail.repo}
                {fileCount === null ? "" : ` · ${fileCount} ${fileCount === 1 ? "file" : "files"}`}
              </span>
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

  const options: ReadonlyArray<SegmentedOption<string>> = [
    ...turns.map((t) => ({ value: t.id, label: `${t.index + 1}` })),
    { value: "all", label: `All ${pending.length} turns` },
  ];

  return (
    <Shell>
      <Tile hue={harness} size={32} aria-label={harnessHue(harness).name} />
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
        <SegmentedControl
          aria-label="Turns"
          variant="mode"
          value={pick.kind === "all" ? "all" : pick.turnId}
          options={options}
          onValueChange={(value) =>
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
