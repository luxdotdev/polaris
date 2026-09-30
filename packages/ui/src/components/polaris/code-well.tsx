import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";

export interface CodeWellProps extends HTMLAttributes<HTMLPreElement> {
  /** "sm" is the inbox card's compact well (11/16). */
  readonly size?: "default" | "sm";
}

/** A sunken well for a command, stderr line or install detail (Needs You, onboarding). */
export function CodeWell({ size = "default", className, ...props }: CodeWellProps) {
  return (
    <pre
      data-slot="code-well"
      className={cn(
        "overflow-x-auto border border-hairline bg-surface-sunken font-mono whitespace-pre-wrap text-text-default",
        size === "default"
          ? "rounded-control px-2.5 py-2 text-code-inline leading-[18px]"
          : "rounded-control px-2 py-1.5 text-micro leading-4",
        className
      )}
      {...props}
    />
  );
}
