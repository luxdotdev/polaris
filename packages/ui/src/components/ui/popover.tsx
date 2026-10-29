// Portions adapted from shadcn-ui/ui@5563a46 (shadcn@4.21.0, MIT)
import { Popover as PopoverPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "../../lib/cn";
import { FLOAT_EDGE, FLOAT_MOTION, FLOAT_SURFACE } from "../../lib/float";

export const Popover = PopoverPrimitive.Root;

export const PopoverTrigger = PopoverPrimitive.Trigger;

export const PopoverAnchor = PopoverPrimitive.Anchor;

/**
 * Sized to the room its trigger leaves (rule/popover-fits-window): it flips or shifts to the
 * roomier side, never taller than that room, and scrolls rather than run off the window.
 */
export function PopoverContent({
  className,
  align = "center",
  sideOffset = 6,
  collisionPadding = FLOAT_EDGE,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          "z-50 max-h-(--radix-popover-content-available-height) w-72 overflow-y-auto p-3.5",
          FLOAT_SURFACE,
          FLOAT_MOTION,
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export function PopoverTitle({ className, ...props }: ComponentProps<"h2">) {
  return <h2 className={cn("text-label text-text-strong", className)} {...props} />;
}

export function PopoverDescription({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-caption text-text-subtle", className)} {...props} />;
}
