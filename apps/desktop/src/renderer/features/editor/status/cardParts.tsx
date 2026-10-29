/**
 * Parts the status bar's cards share (Paper L1/L3): the language pill's popover and the tab
 * completion card use the same fact rows, sections and action rows, so they read as one family.
 */
import { cn } from "@polaris/ui";
import type { ReactNode } from "react";
import type { Fact } from "./model.ts";

/** A label, its value, and a note; `shortValue` keeps the value whole and truncates the note. */
export const FactRow = ({
  fact,
  shortValue = false,
}: {
  readonly fact: Fact;
  readonly shortValue?: boolean;
}) => (
  <div className="text-caption flex items-center gap-2" data-fact={fact.label}>
    <span className="text-text-subtle w-[84px] shrink-0">{fact.label}</span>
    <span
      className={cn(
        "text-text-default",
        shortValue ? "shrink-0" : "min-w-0 truncate",
        fact.mono && "font-mono"
      )}
    >
      {fact.value}
    </span>
    {fact.note === undefined ? null : (
      <span
        className={cn("text-text-subtle", shortValue ? "min-w-0 truncate" : "shrink-0")}
        title={shortValue ? fact.note : undefined}
      >
        {fact.note}
      </span>
    )}
  </div>
);

export const Section = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn("border-hairline flex flex-col border-t px-4 py-3", className)}>
    {children}
  </div>
);

export interface ActionRow<Id extends string> {
  readonly id: Id;
  readonly label: string;
  readonly hint?: string | undefined;
}

/** The card's last block: one row per action, the first focused when the card takes focus. */
export const ActionRows = <Id extends string>({
  actions,
  running,
  onRun,
  autoFocus = true,
}: {
  readonly actions: readonly ActionRow<Id>[];
  readonly running: { readonly id: Id } | null;
  readonly onRun: (action: ActionRow<Id>) => void;
  readonly autoFocus?: boolean;
}) => (
  <div className="border-hairline flex flex-col border-t p-1.5" role="menu">
    {actions.map((action, index) => (
      <button
        key={action.id}
        type="button"
        role="menuitem"
        data-action={action.id}
        aria-busy={running?.id === action.id}
        aria-disabled={running !== null}
        autoFocus={autoFocus && index === 0}
        onClick={() => onRun(action)}
        className={cn(
          "rounded-control text-body text-text-default hover:bg-fill-selected hover:text-text-strong focus-visible:bg-fill-selected focus-visible:text-text-strong flex h-[30px] shrink-0 items-center justify-between gap-3 px-2.5 text-left outline-none",
          running !== null && running.id !== action.id && "opacity-55"
        )}
      >
        <span className="truncate">{action.label}</span>
        {action.hint === undefined ? null : (
          <span className="text-caption text-text-subtle shrink-0 font-mono">{action.hint}</span>
        )}
      </button>
    ))}
  </div>
);
