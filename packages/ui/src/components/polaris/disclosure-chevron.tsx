import { ChevronRightIcon } from "../../icons/nucleo/ui";
import { cn } from "../../lib/cn";

export interface DisclosureChevronProps {
  readonly open: boolean;
  readonly size?: number;
  readonly className?: string;
}

/** One chevron for every disclosure: points right when closed, turns down over 120ms when open. */
export function DisclosureChevron({ open, size = 10, className }: DisclosureChevronProps) {
  return (
    <ChevronRightIcon
      size={size}
      aria-hidden
      data-open={open ? "" : undefined}
      className={cn(
        "shrink-0 transition-transform duration-120 ease-out",
        open && "rotate-90",
        className
      )}
    />
  );
}
