import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";

export interface KbdProps extends HTMLAttributes<HTMLElement> {
  /** "cap" is the outlined 18px keycap; "plain" is a bare hint such as "⌃1" or "esc". */
  readonly variant?: "cap" | "plain";
}

/** A key hint. Keycaps sit in text-subtle; plain hints in text-faint. */
export function Kbd({ variant = "cap", className, ...props }: KbdProps) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "inline-flex shrink-0 items-center justify-center font-sans text-micro tabular",
        variant === "cap"
          ? "h-[18px] min-w-[18px] rounded-[4px] border border-text-subtle/25 px-1 font-medium text-text-subtle"
          : "text-text-faint",
        className
      )}
      {...props}
    />
  );
}
