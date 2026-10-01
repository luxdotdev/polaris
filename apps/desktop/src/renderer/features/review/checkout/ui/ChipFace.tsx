/**
 * The chip itself (Paper R5 8B5-0), drawn from a `ChipView`: the state, and at most one action
 * after a divider. Inside a `Popover`: the state opens the menu, and so does an action that
 * must ask first (a discard) or pick a Host (clone).
 */
import { cn, PopoverAnchor, PopoverTrigger } from "@polaris/ui";
import { Match } from "effect";
import type { ReactNode } from "react";
import {
  type ChipAction,
  type ChipView,
  elapsed,
  newCommitsText,
  removedText,
} from "../model/chip.ts";
import { runningFact } from "../model/run.ts";
import { HostDot, ProgressGlyph, WarningGlyph } from "./glyphs.tsx";

interface Face {
  readonly glyph: ReactNode;
  readonly label: string;
  readonly fact: string | null;
  /** The fact is a command, in mono. */
  readonly mono?: boolean;
  readonly frame: "plain" | "attention" | "dim" | "dashed";
  readonly quiet?: boolean;
}

const progress = (label: string, fact: string | null = null): Face => ({
  glyph: <ProgressGlyph />,
  label,
  fact,
  frame: "plain",
});

const face = (view: ChipView): Face =>
  Match.value(view).pipe(
    Match.withReturnType<Face>(),
    Match.discriminatorsExhaustive("kind")({
      "checking-out": ({ host }) => progress(`Checking out on ${host}`, "fetching"),
      updating: ({ host, to }) => progress(`Updating ${host}`, `to ${to}`),
      ready: ({ host, at }) => ({
        glyph: <HostDot kind="on" />,
        label: `Checked out on ${host}`,
        fact: `at ${at}`,
        frame: "plain",
      }),
      running: ({ host, command, seconds }) => ({
        glyph: <HostDot kind="on" />,
        label: host,
        fact: runningFact(command, seconds),
        mono: true,
        frame: "plain",
      }),
      "new-commits": ({ host, count, rewritten }) => ({
        glyph: <HostDot kind="on" />,
        label: host,
        fact: newCommitsText(count, rewritten),
        frame: "attention",
      }),
      blocked: ({ block }) => ({
        glyph: <WarningGlyph />,
        label: block.title,
        fact: null,
        frame: "plain",
      }),
      removing: ({ host }) => progress(`Removing from ${host}`),
      reconnecting: ({ host, at, seconds }) => ({
        glyph: <HostDot kind="reconnecting" />,
        label: host,
        fact: `at ${at} · reconnecting for ${elapsed(seconds)}`,
        frame: "dim",
      }),
      offline: ({ host }) => ({
        glyph: <HostDot kind="away" />,
        label: `${host} offline`,
        fact: null,
        frame: "plain",
        quiet: true,
      }),
      waiting: ({ host }) => ({
        glyph: <HostDot kind="away" />,
        label: host === "" ? "Waiting for a host" : `Waiting for ${host}`,
        fact: null,
        frame: "plain",
      }),
      none: () => ({
        glyph: null,
        label: "No workspace has this repo",
        fact: null,
        frame: "plain",
        quiet: true,
      }),
      cloning: ({ host }) => progress(`Cloning on ${host}`, "git clone"),
      "clone-failed": ({ host }) => ({
        glyph: <WarningGlyph />,
        label: `Couldn’t clone on ${host}`,
        fact: null,
        frame: "plain",
      }),
      removed: ({ host, reason }) => ({
        glyph: null,
        label: removedText(reason, host),
        fact: null,
        frame: "dashed",
        quiet: true,
      }),
    })
  );

const FRAMES: Readonly<Record<Face["frame"], string>> = {
  plain: "bg-surface-sunken border-hairline",
  attention: "bg-fill-selected border-text-faint/40",
  dim: "bg-surface-sunken border-hairline opacity-(--opacity-dimmed)",
  dashed: "border-hairline border-dashed",
};

const ACTION =
  "text-text-default hover:text-text-strong focus-visible:ring-ring shrink-0 rounded-[4px] font-medium outline-hidden focus-visible:ring-2";

/** The evidence a failed state shows under the chip (the git error), if any. */
export const evidenceOf = (view: ChipView): string | null => {
  if (view.kind === "clone-failed") return view.message;

  if (view.kind === "blocked" && view.block.fix.kind === "retry")
    return view.block.evidence[0] ?? null;

  return null;
};

export interface ChipFaceProps {
  readonly view: ChipView;
  readonly action: ChipAction | null;
  /** The action opens the menu instead of acting (a discard asks first; clone picks a Host). */
  readonly actionOpensMenu: boolean;
  readonly onAction: () => void;
}

export const ChipFace = ({ view, action, actionOpensMenu, onAction }: ChipFaceProps) => {
  const { glyph, label, fact, mono = false, frame, quiet = false } = face(view);
  const evidence = evidenceOf(view);

  return (
    <div className="flex max-w-[420px] min-w-0 flex-col items-end gap-1.5">
      <PopoverAnchor asChild>
        <div
          data-testid="checkout-chip"
          data-state={view.kind}
          className={cn(
            "text-caption gap-gap px-row-x flex h-row min-w-0 items-center rounded-control border",
            FRAMES[frame]
          )}
        >
          <PopoverTrigger
            data-testid="checkout-chip-trigger"
            className="gap-gap text-text-subtle focus-visible:ring-ring flex min-w-0 items-center rounded-[4px] outline-hidden focus-visible:ring-2"
          >
            {glyph}
            <span
              className={cn(
                "truncate",
                quiet ? "text-text-subtle" : "text-text-default font-medium",
                view.kind === "offline" && "font-medium"
              )}
            >
              {label}
            </span>
            {fact !== null && (
              <span
                className={cn(
                  "text-text-subtle shrink-0",
                  mono && "font-mono text-[11px] leading-4"
                )}
              >
                {fact}
              </span>
            )}
          </PopoverTrigger>
          {action !== null && (
            <>
              <span aria-hidden="true" className="bg-hairline h-3.5 w-px shrink-0" />
              {actionOpensMenu ? (
                <PopoverTrigger
                  data-testid="checkout-chip-action"
                  className={ACTION}
                  onClick={onAction}
                >
                  {action.label}
                </PopoverTrigger>
              ) : (
                <button
                  type="button"
                  data-testid="checkout-chip-action"
                  className={ACTION}
                  onClick={onAction}
                >
                  {action.label}
                </button>
              )}
            </>
          )}
        </div>
      </PopoverAnchor>
      {evidence !== null && (
        <p
          data-testid="checkout-chip-evidence"
          title={evidence}
          className="text-text-subtle max-w-full truncate pl-0.5 font-mono text-[11px] leading-4"
        >
          {evidence}
        </p>
      )}
    </div>
  );
};
