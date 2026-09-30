import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "../../lib/cn";

export interface SectionHeaderProps extends HTMLAttributes<HTMLDivElement> {
  /** Trailing content, such as an add button or a count. */
  readonly action?: ReactNode;
  /** The inline empty state: one caption line under the header ("None in polaris"). */
  readonly empty?: ReactNode;
}

/** A sidebar section header: caption, sentence case, no divider (DESIGN.md, Rows and lists). */
export function SectionHeader({
  action,
  empty,
  className,
  children,
  ...props
}: SectionHeaderProps) {
  return (
    <div data-slot="section-header" className={cn("flex flex-col", className)} {...props}>
      <div className="flex min-h-[30px] items-end gap-2 px-2 pt-2 pb-1.5">
        <h3 className="text-caption text-text-subtle flex-1 truncate">{children}</h3>
        {action}
      </div>
      {empty === undefined ? null : (
        <p className="text-caption text-text-subtle px-2 pb-1.5">{empty}</p>
      )}
    </div>
  );
}
