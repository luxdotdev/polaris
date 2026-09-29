import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "../../lib/cn";
import type { TintHue } from "../../lib/hue";
import { Tile } from "./tile";

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  readonly hue: TintHue;
  /** A pixel icon for the tile. */
  readonly icon: ReactNode;
  /** One heading-sm sentence. */
  readonly title: ReactNode;
  /** One caption line of fact. */
  readonly fact?: ReactNode;
  /** At most one secondary action. */
  readonly action?: ReactNode;
}

/**
 * The pane tier of DESIGN.md's empty states: a 48px washed tile, one sentence, one fact and
 * at most one action. No scene and no signal colour ("Nothing needs you" is never yellow).
 */
export function EmptyState({
  hue,
  icon,
  title,
  fact,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn("flex flex-col items-center gap-3 px-6 py-10 text-center", className)}
      {...props}
    >
      <Tile hue={hue} size={48}>
        {icon}
      </Tile>
      <div className="flex flex-col gap-1">
        <p className="text-heading-sm text-text-strong">{title}</p>
        {fact === undefined ? null : <p className="text-caption text-text-subtle">{fact}</p>}
      </div>
      {action}
    </div>
  );
}
