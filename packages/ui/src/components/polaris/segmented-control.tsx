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

const SEGMENT_SIZE = {
  mode: "h-[26px] px-2.5 text-label",
  fill: "h-6 flex-1 gap-1.5 text-caption font-medium",
  well: "px-2.5 py-[3px] text-caption font-regular data-[state=on]:font-medium",
} as const;

const PILL_SIZE = {
  mode: "h-[30px] gap-2 rounded-full px-3.5",
  fill: "h-7 rounded-full",
  well: "",
} as const;

export interface SegmentedControlProps<Value extends string> {
  readonly options: readonly SegmentedOption<Value>[];
  readonly value: Value;
  readonly onValueChange: (value: Value) => void;
  /**
   * "mode" is the title-bar switch (26px segments); "fill" stretches equal segments (24px);
   * "well" is the small sunken range control (Settings → Usage: 7 / 30 / 90 days).
   */
  readonly variant?: "mode" | "fill" | "well";
  /**
   * Pill tabs on the ground (DESIGN.md, Chrome redesign: Controls): a round track in the panel
   * fill with round segments, 30px in "mode", 28px in "fill". Not for "well".
   */
  readonly pill?: boolean;
  readonly "aria-label": string;
  readonly className?: string;
}

/**
 * One choice among a few (Orchestrate / Review / Edit; Sessions / Needs you), always a pill:
 * a well track inside a surface, the panel fill on the ground (`pill`). Selection is a
 * fill-selected segment, never an accent colour. Arrow keys move between segments.
 */
export function SegmentedControl<Value extends string>({
  options,
  value,
  onValueChange,
  variant = "mode",
  pill = false,
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
        "flex items-center gap-0.5 rounded-full border border-hairline bg-well p-0.5",
        variant === "fill" && "w-full",
        variant === "well" && "gap-0",
        pill && "rounded-full border-0 bg-panel p-[3px]",
        className
      )}
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          className={cn(
            "group/segment flex cursor-default items-center justify-center gap-2 rounded-full font-medium text-text-subtle select-none",
            "hover:text-text-default data-[state=on]:bg-fill-selected data-[state=on]:text-text-strong",
            "disabled:opacity-(--opacity-dimmed)",
            SEGMENT_SIZE[variant],
            pill && PILL_SIZE[variant]
          )}
        >
          {option.label}
          {option.badge}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
