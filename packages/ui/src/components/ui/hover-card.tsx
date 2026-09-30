// Portions adapted from shadcn-ui/ui@5563a46 (shadcn@4.21.0, MIT)
import { HoverCard as HoverCardPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "../../lib/cn";
import { FLOAT_MOTION, FLOAT_SURFACE } from "../../lib/float";

export function HoverCard({
  openDelay = 300,
  closeDelay = 150,
  ...props
}: ComponentProps<typeof HoverCardPrimitive.Root>) {
  return <HoverCardPrimitive.Root openDelay={openDelay} closeDelay={closeDelay} {...props} />;
}

export const HoverCardTrigger = HoverCardPrimitive.Trigger;

/**
 * A floating card (340px by default, as the Needs You hover card). Layout is the caller's.
 * It sits below modals (z-50): a jump menu or dialog always covers a hover card.
 */
export function HoverCardContent({
  className,
  align = "start",
  sideOffset = 8,
  ...props
}: ComponentProps<typeof HoverCardPrimitive.Content>) {
  return (
    <HoverCardPrimitive.Portal>
      <HoverCardPrimitive.Content
        data-slot="hover-card-content"
        align={align}
        sideOffset={sideOffset}
        className={cn("z-40 w-[340px] overflow-clip", FLOAT_SURFACE, FLOAT_MOTION, className)}
        {...props}
      />
    </HoverCardPrimitive.Portal>
  );
}
