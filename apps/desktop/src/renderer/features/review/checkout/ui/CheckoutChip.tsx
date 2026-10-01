/**
 * The Review Checkout chip beside the primary action (Paper R5 8B5-0): one line of state and
 * at most one action after a divider; a click on the state opens the menu (R4 804-0).
 */
import { cn, Popover, PopoverAnchor, PopoverTrigger } from "@polaris/ui";
import { Match } from "effect";
import { type ReactNode, useState } from "react";
import type { OpenPull } from "../../../../../shared/api.ts";
import { useShellActions } from "../../../../shell/hooks.ts";
import type { ReviewSlotProps } from "../../surface.ts";
import { checkOutOn, runFix, updateCheckout } from "../actions.ts";
import { chipAction, type ChipView, elapsed, removedText } from "../model/chip.ts";
import { type CheckoutModel, useCheckout } from "../useCheckout.ts";
import { CheckoutMenu } from "./CheckoutMenu.tsx";
import { HostDot, ProgressGlyph, WarningGlyph } from "./glyphs.tsx";

interface Face {
  readonly glyph: ReactNode;
  readonly label: string;
  readonly fact: string | null;
  readonly frame: "plain" | "attention" | "dim" | "dashed";
}

const face = (view: ChipView): Face =>
  Match.value(view).pipe(
    Match.withReturnType<Face>(),
    Match.discriminatorsExhaustive("kind")({
      "checking-out": ({ host }) => ({
        glyph: <ProgressGlyph />,
        label: `Checking out on ${host}`,
        fact: "fetching",
        frame: "plain",
      }),
      updating: ({ host, to }) => ({
        glyph: <ProgressGlyph />,
        label: `Updating ${host}`,
        fact: `to ${to}`,
        frame: "plain",
      }),
      ready: ({ host, at }) => ({
        glyph: <HostDot kind="on" />,
        label: `Checked out on ${host}`,
        fact: `at ${at}`,
        frame: "plain",
      }),
      "new-commits": ({ host }) => ({
        glyph: <HostDot kind="on" />,
        label: host,
        fact: "new commits",
        frame: "attention",
      }),
      blocked: ({ block }) => ({
        glyph: <WarningGlyph />,
        label: block.title,
        fact: null,
        frame: "plain",
      }),
      removing: ({ host }) => ({
        glyph: <ProgressGlyph />,
        label: `Removing from ${host}`,
        fact: null,
        frame: "plain",
      }),
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
      }),
      removed: ({ host, reason }) => ({
        glyph: null,
        label: removedText(reason, host),
        fact: null,
        frame: "dashed",
      }),
    })
  );

const FRAMES: Readonly<Record<Face["frame"], string>> = {
  plain: "bg-surface-sunken border-hairline",
  attention: "bg-fill-selected border-text-faint/40",
  dim: "bg-surface-sunken border-hairline opacity-(--opacity-dimmed)",
  dashed: "border-hairline border-dashed",
};

const runAction = (
  model: CheckoutModel,
  pull: OpenPull,
  nav: ReturnType<typeof useShellActions>
) => {
  const { view, held, nextPlace, detail } = model;

  if (view.kind === "new-commits" && held !== null) void updateCheckout(held);
  else if (view.kind === "blocked" && held !== null) runFix(view.block.fix, held, pull, nav);
  else if (view.kind === "offline" && nextPlace !== null && detail !== null) {
    void checkOutOn(nextPlace, pull, detail);
  }
};

export const CheckoutChip = ({ subject }: ReviewSlotProps) =>
  subject.kind === "pull" ? <PullCheckoutChip pull={subject.pull} /> : null;

const PullCheckoutChip = ({ pull }: { readonly pull: OpenPull }) => {
  const model = useCheckout(pull);
  const nav = useShellActions();
  const [open, setOpen] = useState(false);
  const { view } = model;
  const { glyph, label, fact, frame } = face(view);
  const action = chipAction(view);
  // A fix that throws work away asks in the menu first.
  const confirms = view.kind === "blocked" && view.block.confirm !== null;

  const evidence =
    view.kind === "blocked" && view.block.fix.kind === "retry" ? view.block.evidence[0] : undefined;

  return (
    <div className="flex max-w-[420px] min-w-0 flex-col items-end gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div
            data-testid="checkout-chip"
            data-state={view.kind}
            className={cn(
              "text-caption gap-gap px-row-x flex h-[30px] min-w-0 items-center rounded-control border",
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
                  "truncate font-medium",
                  view.kind === "offline" || view.kind === "removed"
                    ? "text-text-subtle"
                    : "text-text-default",
                  view.kind === "removed" && "font-normal"
                )}
              >
                {label}
              </span>
              {fact !== null && <span className="text-text-subtle shrink-0">{fact}</span>}
            </PopoverTrigger>
            {action !== null && (
              <>
                <span aria-hidden="true" className="bg-hairline h-3.5 w-px shrink-0" />
                <button
                  type="button"
                  data-testid="checkout-chip-action"
                  className="text-text-default hover:text-text-strong focus-visible:ring-ring shrink-0 rounded-[4px] font-medium outline-hidden focus-visible:ring-2"
                  onClick={() => (confirms ? setOpen(true) : runAction(model, pull, nav))}
                >
                  {action.label}
                </button>
              </>
            )}
          </div>
        </PopoverAnchor>
        <CheckoutMenu model={model} pull={pull} onDone={() => setOpen(false)} />
      </Popover>
      {evidence !== undefined && (
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
