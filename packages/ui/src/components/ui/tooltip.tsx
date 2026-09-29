// Portions adapted from shadcn-ui/ui@5563a46 (shadcn@4.21.0, MIT)
import { Tooltip as TooltipPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "../../lib/cn";
import { FLOAT_MOTION } from "../../lib/float";
import { Kbd } from "../polaris/kbd";

export function TooltipProvider({
  delayDuration = 400,
  skipDelayDuration = 200,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      delayDuration={delayDuration}
      skipDelayDuration={skipDelayDuration}
      {...props}
    />
  );
}

export const Tooltip = TooltipPrimitive.Root;

export const TooltipTrigger = TooltipPrimitive.Trigger;

export interface TooltipContentProps extends ComponentProps<typeof TooltipPrimitive.Content> {
  /** A shortcut shown after the label, such as "⌘2". */
  readonly shortcut?: string | undefined;
}

/** A one-line label on surface-raised, with an optional shortcut. No arrow. */
export function TooltipContent({
  className,
  sideOffset = 6,
  shortcut,
  children,
  ...props
}: TooltipContentProps) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 flex h-6 items-center gap-2 rounded-control border border-hairline bg-surface-raised px-2 text-caption text-text-default shadow-float",
          FLOAT_MOTION,
          className
        )}
        {...props}
      >
        {children}
        {shortcut === undefined ? null : <Kbd variant="plain">{shortcut}</Kbd>}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}
