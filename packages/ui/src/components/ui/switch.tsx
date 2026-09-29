// Portions adapted from shadcn-ui/ui@5563a46 (shadcn@4.21.0, MIT)
import { Switch as SwitchPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "../../lib/cn";

/** Off is a sunken track; on is the monochrome primary fill, never an accent colour. */
export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "inline-flex h-[18px] w-[30px] shrink-0 cursor-default items-center rounded-full border border-hairline bg-fill-selected p-px",
        "data-[state=checked]:bg-text-strong disabled:opacity-(--opacity-dimmed)",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "block size-3.5 rounded-full bg-text-subtle transition-transform duration-120 ease-out",
          "data-[state=checked]:translate-x-3 data-[state=checked]:bg-bg"
        )}
      />
    </SwitchPrimitive.Root>
  );
}
