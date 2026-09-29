import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";

/** A sunken well for a command, stderr line or install detail (Needs You, onboarding). */
export function CodeWell({ className, ...props }: HTMLAttributes<HTMLPreElement>) {
  return (
    <pre
      data-slot="code-well"
      className={cn(
        "overflow-x-auto rounded-control border border-hairline bg-surface-sunken px-2.5 py-2 font-mono text-code-inline leading-[18px] whitespace-pre-wrap text-text-default",
        className
      )}
      {...props}
    />
  );
}
