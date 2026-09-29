// Portions adapted from shadcn-ui/ui@5563a46 (shadcn@4.21.0, MIT)
import { Popover as PopoverPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "../../lib/cn";
import { FLOAT_MOTION, FLOAT_SURFACE } from "../../lib/float";

export const Popover = PopoverPrimitive.Root;

export const PopoverTrigger = PopoverPrimitive.Trigger;

export const PopoverAnchor = PopoverPrimitive.Anchor;

export function PopoverContent({
  className,
  align = "center",
  sideOffset = 6,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn("z-50 w-72 p-3.5", FLOAT_SURFACE, FLOAT_MOTION, className)}
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
