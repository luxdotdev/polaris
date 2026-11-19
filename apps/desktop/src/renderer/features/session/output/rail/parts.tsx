/** The rail's shared pieces: the fixed icon slot every row starts with, and a section. */
import { cn } from "@polaris/ui";
import type { ReactNode } from "react";

/** A row's inset and gap: 14px and 10px at Calm, tighter with density. */
export const ROW = "flex min-w-0 items-center gap-row-x px-[calc(var(--spacing-row-x)+4px)]";

/** The 16px slot an icon, glyph or git letter sits in, so every row's text starts on one lane. */
export const Slot = ({
  children,
  className,
}: {
  readonly children?: ReactNode;
  readonly className?: string;
}) => (
  <span
    className={cn("text-text-subtle flex w-4 shrink-0 justify-center", className)}
    data-slot="rail-icon"
  >
    {children}
  </span>
);

/** A block under a hairline; dimmed when what it describes is out of reach or idle. */
export const Section = ({
  label,
  dimmed = false,
  className,
  children,
}: {
  readonly label: string;
  readonly dimmed?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}) => (
  <div
    role="group"
    aria-label={label}
    className={cn(
      "border-hairline flex shrink-0 flex-col border-t py-2.5",
      dimmed && "opacity-(--opacity-dimmed)",
      className
    )}
  >
    {children}
  </div>
);

/** A file with a plus and a minus: the session's changes (Paper R1). */
export const ChangesIcon = () => (
  <svg width={14} height={14} viewBox="0 0 16 16" fill="none" aria-hidden>
    <path
      d="M8 3v5M5.5 5.5h5M5.5 12h5"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
    />
    <rect x={2} y={1.5} width={12} height={13} rx={2} stroke="currentColor" strokeWidth={1.2} />
  </svg>
);

/** Two branches merging back: a pull request (Paper R1). */
export const PullRequestIcon = () => (
  <svg width={14} height={14} viewBox="0 0 16 16" fill="none" aria-hidden>
    <circle cx={4} cy={3.5} r={1.5} stroke="currentColor" strokeWidth={1.2} />
    <circle cx={4} cy={12.5} r={1.5} stroke="currentColor" strokeWidth={1.2} />
    <circle cx={12} cy={12.5} r={1.5} stroke="currentColor" strokeWidth={1.2} />
    <path
      d="M4 5v6M12 11V6.5c0-1.4-1-2.5-2.5-2.5H7.5M9 2.5L7.5 4 9 5.5"
      stroke="currentColor"
      strokeWidth={1.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
