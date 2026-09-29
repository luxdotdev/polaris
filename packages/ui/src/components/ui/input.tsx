// Portions adapted from shadcn-ui/ui@5563a46 (shadcn@4.21.0, MIT)
import type { ComponentProps } from "react";

import { cn } from "../../lib/cn";

/** A 28px field on bg with a hairline; the placeholder is text-faint. */
export const INPUT_BASE =
  "w-full min-w-0 rounded-control border border-hairline bg-bg text-body text-text-default placeholder:text-text-faint disabled:opacity-(--opacity-dimmed) aria-invalid:border-failed/60";

export function Input({ className, type = "text", ...props }: ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(INPUT_BASE, "h-7 px-2.5", className)}
      {...props}
    />
  );
}
