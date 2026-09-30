// Portions adapted from shadcn-ui/ui@5563a46 (shadcn@4.21.0, MIT)
import { Switch as SwitchPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "../../lib/cn";

/** 26×16 with a 12px thumb (Paper 6R2-1); on is text-default, never an accent colour. */
export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "inline-flex h-4 w-[26px] shrink-0 cursor-default items-center rounded-full border border-hairline bg-fill-selected p-px",
        "data-[state=checked]:bg-text-default disabled:opacity-(--opacity-dimmed)",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "block size-3 rounded-full bg-text-subtle transition-transform duration-120 ease-out",
          "data-[state=checked]:translate-x-2.5 data-[state=checked]:bg-bg"
        )}
      />
    </SwitchPrimitive.Root>
  );
}
