import { Slot } from "radix-ui";
import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  /** Render as the single child element (a section, an aside) instead of a div. */
  readonly asChild?: boolean;
}

/**
 * A working surface on the ground (DESIGN.md, Chrome redesign: panels on a ground): the panel
 * fill and an 18px radius; light adds its hairline and 1px soft shadow. It clips its content, so
 * a scrolling child keeps the rounded corners. Lay panels out with 8px gaps.
 */
export function Panel({ asChild = false, className, ...props }: PanelProps) {
  const Comp = asChild ? Slot.Root : "div";

  return (
    <Comp
      data-slot="panel"
      className={cn(
        "relative flex min-h-0 flex-col overflow-clip rounded-[18px] bg-panel shadow-panel",
        className
      )}
      {...props}
    />
  );
}
