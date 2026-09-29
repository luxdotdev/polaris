// Portions adapted from shadcn-ui/ui@5563a46 (shadcn@4.21.0, MIT)
import type { ComponentProps } from "react";

import { cn } from "../../lib/cn";
import { INPUT_BASE } from "./input";

export interface TextareaProps extends ComponentProps<"textarea"> {
  /** Borderless, for use inside a composer or card that draws its own edge. */
  readonly bare?: boolean;
}

/** Grows with its content (field-sizing) up to max-height. */
export function Textarea({ className, bare = false, ...props }: TextareaProps) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "field-sizing-content resize-none",
        bare
          ? "w-full min-w-0 bg-transparent text-body text-text-default outline-none placeholder:text-text-faint"
          : [INPUT_BASE, "min-h-16 px-2.5 py-1.5"],
        className
      )}
      {...props}
    />
  );
}
