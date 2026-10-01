/**
 * The list above the composer while a `/` or `$` word is typed: Skills, then
 * Slash Commands, filtered as you type. Keyboard-first: the editor keeps focus
 * and owns ↑ ↓ ↵ ⇥ esc; a click picks too (DESIGN.md, Skills and Slash Commands).
 */
import { CommandIcon, cn, SkillIcon } from "@polaris/ui";
import { useEffect, useRef } from "react";
import type { CommandOption, Menu } from "../model/commands.ts";
import { describe, sourceLabel } from "../model/labels.ts";

export interface CommandMenuProps {
  /** Null while the list is still being read from the Host. */
  readonly menu: Menu | null;
  readonly loading: boolean;
  readonly active: number;
  readonly onPick: (index: number) => void;
  readonly onHover: (index: number) => void;
}

const GROUP_LABELS = { skill: "Skills", command: "Commands" } as const;

const Row = ({
  option,
  selected,
  onPick,
  onHover,
}: {
  readonly option: CommandOption;
  readonly selected: boolean;
  readonly onPick: () => void;
  readonly onHover: () => void;
}) => {
  const Icon = option.kind === "skill" ? SkillIcon : CommandIcon;
  const source = sourceLabel(option);

  return (
    <div
      role="option"
      aria-selected={selected}
      data-selected={selected ? "" : undefined}
      // The editor keeps focus: a mouse press must not move it.
      onMouseDown={(event) => {
        event.preventDefault();
        onPick();
      }}
      onMouseMove={onHover}
      className={cn(
        "rounded-row px-row-x flex cursor-default items-start gap-2.5 py-1.5 select-none",
        selected && "bg-fill-selected"
      )}
    >
      <Icon
        size={16}
        className={cn("mt-px shrink-0", selected ? "text-text-strong" : "text-text-subtle")}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-baseline gap-2">
          <span
            className={cn(
              "text-label truncate font-medium",
              selected ? "text-text-strong" : "text-text-default"
            )}
          >
            {option.sigil}
            {option.name}
          </span>
          {option.argumentHint === null ? null : (
            <span className="text-caption text-text-faint truncate">{option.argumentHint}</span>
          )}
          {source === null ? null : (
            <span className="text-micro text-text-subtle ml-auto shrink-0">{source}</span>
          )}
        </span>
        <span className="text-caption text-text-subtle truncate">{describe(option)}</span>
      </span>
    </div>
  );
};

export const CommandMenu = ({ menu, loading, active, onPick, onHover }: CommandMenuProps) => {
  const list = useRef<HTMLDivElement>(null);

  // Keeps the highlighted row in view as ↑ ↓ move it.
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (menu === null && !loading) return null;

  const options = menu?.options ?? [];
  const grouped = new Set(options.map((o) => o.kind)).size > 1;

  return (
    <div
      ref={list}
      role="listbox"
      aria-label="Skills and commands"
      data-testid="command-menu"
      className="rounded-card border-hairline bg-surface-raised shadow-float animate-in fade-in-0 mb-2 max-h-[min(320px,40vh)] max-w-[560px] overflow-y-auto border p-1.5 duration-160 ease-out"
    >
      {menu === null ? (
        <p className="text-caption text-text-subtle px-row-x py-1.5">
          Reading skills and commands…
        </p>
      ) : null}
      {options.map((option, i) => (
        <div key={`${option.sigil}${option.name}`}>
          {grouped && (i === 0 || options[i - 1]?.kind !== option.kind) ? (
            <div role="presentation" className="px-row-x text-caption text-text-subtle pt-2 pb-1">
              {GROUP_LABELS[option.kind]}
            </div>
          ) : null}
          <Row
            option={option}
            selected={i === active}
            onPick={() => onPick(i)}
            onHover={() => onHover(i)}
          />
        </div>
      ))}
      {menu !== null && menu.more > 0 ? (
        <p
          role="presentation"
          className="border-hairline text-caption text-text-subtle px-row-x mt-1 border-t pt-1.5 pb-0.5"
        >
          {menu.more} more · keep typing to narrow
        </p>
      ) : null}
    </div>
  );
};
