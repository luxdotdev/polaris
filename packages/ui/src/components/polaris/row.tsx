import { Slot } from "radix-ui";
import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "../../lib/cn";

export interface RowProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** A 16px icon, or a tile on a session row. */
  readonly leading?: ReactNode;
  readonly title: ReactNode;
  /** The second line of a session row: what it is doing now. Compact drops it. */
  readonly description?: ReactNode;
  /** Caption metadata on the right: an age, a host, a count. */
  readonly meta?: ReactNode;
  /** Trailing controls after the meta, such as a key hint. */
  readonly trailing?: ReactNode;
  readonly selected?: boolean;
  /** "session" is the two-line sidebar unit; "tree" uses the tree-row height. */
  readonly variant?: "list" | "session" | "tree";
  /** needs-you tints the second line and lifts the title (rule/needs-you-is-loudest). */
  readonly tone?: "default" | "needs-you" | "quiet";
  /**
   * Render as the single child element (a button or link) instead of a div; the row's
   * content goes inside it, before the child's own children.
   */
  readonly asChild?: boolean;
}

const HEIGHTS = {
  list: "h-row",
  session: "h-session-row",
  tree: "h-tree-row",
} as const;

function titleTone(selected: boolean, tone: RowProps["tone"]): string {
  if (selected || tone === "needs-you") return "text-text-strong";

  return tone === "quiet" ? "text-text-subtle" : "text-text-default";
}

/**
 * The main unit of the app (DESIGN.md, Rows and lists): an icon or tile, a label title and
 * caption metadata. Hover is fill-hover; a selected session row is a raised card.
 */
export function Row({
  leading,
  title,
  description,
  meta,
  trailing,
  selected = false,
  variant = "list",
  tone = "default",
  asChild = false,
  className,
  children,
  ...props
}: RowProps) {
  const Comp = asChild ? Slot.Root : "div";
  const session = variant === "session";

  return (
    <Comp
      data-slot="row"
      data-variant={variant}
      data-selected={selected ? "" : undefined}
      aria-selected={props.role === "option" ? selected : undefined}
      className={cn(
        "group/row flex w-full shrink-0 cursor-default items-center gap-gap rounded-row border border-transparent px-row-x text-left select-none",
        HEIGHTS[variant],
        "hover:bg-fill-hover",
        selected && !session && "bg-fill-selected hover:bg-fill-selected",
        selected && session && "border-hairline bg-row-selected hover:bg-row-selected",
        className
      )}
      {...props}
    >
      {leading === undefined ? null : (
        <span className="flex min-w-4 shrink-0 items-center justify-center">{leading}</span>
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className={cn("truncate text-label", titleTone(selected, tone))}>{title}</span>
        {description === undefined ? null : (
          <span
            className={cn(
              "truncate text-caption in-data-[density=compact]:hidden",
              tone === "needs-you" ? "text-needs-you" : "text-text-subtle"
            )}
          >
            {description}
          </span>
        )}
      </span>
      {meta === undefined ? null : (
        <span
          className={cn(
            "shrink-0 text-caption tabular",
            selected ? "text-text-subtle" : "text-text-faint"
          )}
        >
          {meta}
        </span>
      )}
      {trailing}
      <Slot.Slottable>{children}</Slot.Slottable>
    </Comp>
  );
}
