import type { HTMLAttributes, ReactNode } from "react";

import { PlusIcon } from "../../icons/chrome";
import { cn } from "../../lib/cn";
import { Badge } from "./badge";
import { Kbd } from "./kbd";

export interface Machine {
  readonly id: string;
  /** The Host's name ("Linux VM"). */
  readonly name: string;
  /** "3 workspaces", "Work · 6 workspaces", "Slow link", "Needs attention". */
  readonly detail?: ReactNode;
  /** A 12px glyph: the Host's loudest session state, or the key for Needs Attention. */
  readonly glyph?: ReactNode;
  /** Sessions on this Host that need you. */
  readonly needsYou?: number;
  /** "⌃1". */
  readonly shortcut?: string;
  /** A Reconnecting Host shows its last known state, dimmed. */
  readonly dimmed?: boolean;
}

export interface MachineBarProps extends Omit<HTMLAttributes<HTMLElement>, "onSelect"> {
  readonly machines: readonly Machine[];
  readonly selected?: string;
  readonly onSelect?: (id: string) => void;
  /** Shows "Add machine" (or the given label) at the end. */
  readonly onAdd?: () => void;
  readonly addLabel?: string;
}

/**
 * The bar for 11+ Workspaces (Paper MX-0): one tab per Host with its workspace count and
 * needs-you count; the selected Host is a raised tab. Workspaces move into the sidebar.
 */
export function MachineBar({
  machines,
  selected,
  onSelect,
  onAdd,
  addLabel = "Add machine",
  className,
  ...props
}: MachineBarProps) {
  return (
    <nav
      data-slot="machine-bar"
      className={cn(
        "flex h-12 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-hairline bg-surface-sunken px-3",
        className
      )}
      {...props}
    >
      {machines.map((machine) => {
        const isSelected = machine.id === selected;

        return (
          <button
            key={machine.id}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onSelect?.(machine.id)}
            className={cn(
              "flex h-[34px] shrink-0 cursor-default items-center gap-2 rounded-[8px] border px-2.5 whitespace-nowrap select-none",
              isSelected
                ? "border-hairline bg-surface-raised"
                : "border-transparent hover:bg-fill-hover",
              machine.dimmed === true && "opacity-(--opacity-dimmed)"
            )}
          >
            {machine.glyph === undefined ? null : (
              <span className="flex w-3 shrink-0 items-center justify-center">{machine.glyph}</span>
            )}
            <span
              className={cn("text-label", isSelected ? "text-text-strong" : "text-text-default")}
            >
              {machine.name}
            </span>
            {machine.detail === undefined ? null : (
              <span className="text-caption text-text-subtle">{machine.detail}</span>
            )}
            {(machine.needsYou ?? 0) > 0 ? (
              <Badge tone="needs-you" size="count" aria-label={`${machine.needsYou} need you`}>
                {machine.needsYou}
              </Badge>
            ) : null}
            {machine.shortcut === undefined ? null : <Kbd variant="plain">{machine.shortcut}</Kbd>}
          </button>
        );
      })}
      {onAdd === undefined ? null : (
        <button
          type="button"
          onClick={onAdd}
          className="text-label font-regular text-text-subtle hover:bg-fill-hover hover:text-text-default flex h-[34px] shrink-0 cursor-default items-center gap-1.5 rounded-[8px] px-2.5 whitespace-nowrap select-none"
        >
          <PlusIcon size={14} />
          {addLabel}
        </button>
      )}
    </nav>
  );
}
