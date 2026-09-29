import { ToggleGroup } from "radix-ui";
import type { ReactNode } from "react";

import { cn } from "../../lib/cn";

export interface SegmentedOption<Value extends string> {
  readonly value: Value;
  readonly label: ReactNode;
  /** A count or badge after the label. */
  readonly badge?: ReactNode;
  readonly disabled?: boolean;
}

export interface SegmentedControlProps<Value extends string> {
  readonly options: readonly SegmentedOption<Value>[];
  readonly value: Value;
  readonly onValueChange: (value: Value) => void;
  /** "mode" is the title-bar switch (26px segments); "fill" stretches equal segments (24px). */
  readonly variant?: "mode" | "fill";
  readonly "aria-label": string;
  readonly className?: string;
}

/**
 * One choice among a few (Orchestrate / Review / Edit; Sessions / Needs you). Selection is
 * a fill-selected segment, never an accent colour. Arrow keys move between segments.
 */
export function SegmentedControl<Value extends string>({
  options,
  value,
  onValueChange,
  variant = "mode",
  className,
  ...props
}: SegmentedControlProps<Value>) {
  const choose = (next: string) => {
    const option = options.find((candidate) => candidate.value === next);

    if (option !== undefined) onValueChange(option.value);
  };

  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={choose}
      aria-label={props["aria-label"]}
      data-slot="segmented-control"
      className={cn(
        "flex items-center gap-0.5 rounded-[8px] border border-hairline bg-bg p-0.5",
        variant === "fill" && "w-full",
        className
      )}
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          className={cn(
            "group/segment flex cursor-default items-center justify-center gap-2 rounded-control font-medium text-text-subtle select-none",
            "hover:text-text-default data-[state=on]:bg-fill-selected data-[state=on]:text-text-strong",
            "disabled:opacity-(--opacity-dimmed)",
            variant === "mode"
              ? "h-[26px] px-2.5 text-label"
              : "h-6 flex-1 gap-1.5 text-caption font-medium"
          )}
        >
          {option.label}
          {option.badge}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
