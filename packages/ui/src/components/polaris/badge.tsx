import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";

/**
 * DESIGN.md, Badges: counts and short status words in a soft tint with a darker text of
 * the same hue. Never decoration. Severity has its own badge (SeverityBadge).
 */
export const badgeVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-control font-medium tabular",
  {
    variants: {
      tone: {
        neutral: "bg-fill-selected text-text-subtle",
        "needs-you": "bg-needs-you/16 text-needs-you",
        failed: "bg-failed/16 text-failed",
      },
      size: {
        default: "h-5 px-1.5 text-caption",
        /** The count inside a chip or segment (Paper: 16-18px, 11px). */
        count: "h-4 min-w-4 rounded-[4px] px-1 text-micro",
      },
    },
    defaultVariants: { tone: "neutral", size: "default" },
  }
);

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export function Badge({ tone, size, className, ...props }: BadgeProps) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ tone, size }), className)} {...props} />
  );
}
