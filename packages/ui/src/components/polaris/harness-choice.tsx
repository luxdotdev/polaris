import { RadioGroup } from "radix-ui";
import type { ReactNode } from "react";

import { CheckIcon } from "../../icons/chrome";
import { cn } from "../../lib/cn";
import type { CssVars } from "../../lib/css";
import { hueVar, washVar, type TintHue } from "../../lib/hue";

export interface HarnessOption<Value extends string> {
  readonly value: Value;
  /** The wash on the card's leading tile: a Harness hue, or Starlight for "Fork a turn". */
  readonly hue: TintHue;
  /** A 22–24px pixel glyph for the tile. */
  readonly icon: ReactNode;
  /** "Claude Code". */
  readonly title: ReactNode;
  /** The Model or a one-line fact ("Opus 5", "From a checkpoint"). */
  readonly caption: ReactNode;
  readonly disabled?: boolean;
}

export interface HarnessChoiceProps<Value extends string> {
  readonly options: readonly HarnessOption<Value>[];
  readonly value: Value;
  readonly onValueChange: (value: Value) => void;
  readonly "aria-label": string;
  readonly className?: string;
}

/**
 * The new-session Harness choice (DESIGN.md, New session; Paper VG-0): one balanced row of
 * equal 56px cards, each with a 48px washed tile. Arrow keys move the choice.
 */
export function HarnessChoice<Value extends string>({
  options,
  value,
  onValueChange,
  className,
  ...props
}: HarnessChoiceProps<Value>) {
  const choose = (next: string) => {
    const option = options.find((candidate) => candidate.value === next);

    if (option !== undefined) onValueChange(option.value);
  };

  return (
    <RadioGroup.Root
      value={value}
      onValueChange={choose}
      orientation="horizontal"
      aria-label={props["aria-label"]}
      data-slot="harness-choice"
      className={cn("flex gap-2.5", className)}
    >
      {options.map((option) => (
        <HarnessChoiceCard key={option.value} option={option} selected={option.value === value} />
      ))}
    </RadioGroup.Root>
  );
}

interface HarnessChoiceCardProps<Value extends string> {
  readonly option: HarnessOption<Value>;
  readonly selected: boolean;
}

function HarnessChoiceCard<Value extends string>({
  option,
  selected,
}: HarnessChoiceCardProps<Value>) {
  const vars: CssVars = { "--choice-hue": hueVar(option.hue) };

  return (
    <RadioGroup.Item
      value={option.value}
      disabled={option.disabled}
      data-slot="harness-choice-card"
      className={cn(
        "flex h-14 min-w-0 flex-1 cursor-default overflow-clip rounded-card border bg-surface-raised text-left select-none disabled:opacity-(--opacity-dimmed)",
        selected ? "border-text-subtle/40" : "border-hairline hover:border-text-subtle/25"
      )}
      style={vars}
    >
      <span
        aria-hidden="true"
        className="pixelated flex w-12 shrink-0 items-center justify-center border-r border-[color-mix(in_oklab,var(--choice-hue)_20%,transparent)] bg-cover bg-center bg-origin-border"
        style={{ backgroundImage: washVar(option.hue) }}
      >
        {option.icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 pr-2 pl-3">
        <span
          className={cn(
            "truncate text-heading-sm leading-[18px]",
            selected ? "text-text-strong" : "text-text-default"
          )}
        >
          {option.title}
        </span>
        <span className="text-caption text-text-subtle truncate">{option.caption}</span>
      </span>
      <span className="flex items-center pr-3">
        <RadioGroup.Indicator>
          <CheckIcon className="text-text-strong" />
        </RadioGroup.Indicator>
      </span>
    </RadioGroup.Item>
  );
}
