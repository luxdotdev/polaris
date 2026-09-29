import { Slot } from "radix-ui";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "../../lib/cn";
import { Badge } from "./badge";
import { Kbd } from "./kbd";

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** A 12px state glyph (workspace chips) or a 14px brand mark (source chips). */
  readonly leading?: ReactNode;
  /** How many sessions here need you; drawn as a needs-you count. */
  readonly needsYou?: number;
  /** The switch shortcut, such as "⌃1". */
  readonly shortcut?: string;
  readonly selected?: boolean;
  /** "workspace" is the machine-bar chip; "source" and "add" are the session's Sources. */
  readonly variant?: "workspace" | "source" | "add";
  readonly asChild?: boolean;
}

function labelTone(selected: boolean, needsYou: number): string {
  if (selected) return "text-text-strong";

  return needsYou > 0 ? "text-text-default" : "text-text-subtle";
}

/** A compact, clickable token: workspace chips in the machine bar, source chips in a session. */
export function Chip({
  leading,
  needsYou = 0,
  shortcut,
  selected = false,
  variant = "workspace",
  asChild = false,
  className,
  children,
  type = "button",
  ...props
}: ChipProps) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="chip"
      data-variant={variant}
      data-selected={selected ? "" : undefined}
      aria-pressed={variant === "workspace" ? selected : undefined}
      type={asChild ? undefined : type}
      className={cn(
        "inline-flex shrink-0 cursor-default items-center rounded-control whitespace-nowrap select-none",
        variant === "workspace" && [
          "h-7 gap-2 px-2 text-label hover:bg-fill-hover",
          labelTone(selected, needsYou),
          selected && "bg-fill-selected hover:bg-fill-selected",
        ],
        variant === "source" &&
          "h-[26px] gap-1.5 bg-row-selected pr-2 pl-1.5 text-caption font-medium text-text-default",
        variant === "add" &&
          "h-[26px] gap-1.5 border border-dashed border-text-faint/40 px-2 text-caption text-text-faint hover:text-text-subtle",
        className
      )}
      {...props}
    >
      {leading === undefined ? null : (
        <span className="flex w-3 shrink-0 items-center justify-center">{leading}</span>
      )}
      {children}
      {needsYou > 0 ? (
        <Badge tone="needs-you" size="count" aria-label={`${needsYou} need you`}>
          {needsYou}
        </Badge>
      ) : null}
      {shortcut === undefined ? null : <Kbd variant="plain">{shortcut}</Kbd>}
    </Comp>
  );
}
