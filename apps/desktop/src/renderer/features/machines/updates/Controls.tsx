/**
 * "Keep daemons up to date": the app-wide switch in the hosts table's sunken
 * foot, and each Host's override, in its row's menu and its opened settings.
 */
import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@polaris/ui";
import { useId } from "react";
import type { DaemonUpdateView } from "./contract.ts";
import { defaultChoiceLabel, type OverrideChoice, overrideChoice, overrideValue } from "./model.ts";

const CHOICES = (daemon: DaemonUpdateView) =>
  [
    { value: "default", label: defaultChoiceLabel(daemon) },
    { value: "on", label: "Always keep up to date" },
    { value: "off", label: "Only when I ask" },
  ] as const;

const isChoice = (value: string): value is OverrideChoice =>
  value === "default" || value === "on" || value === "off";

export interface OverrideProps {
  readonly daemon: DaemonUpdateView;
  readonly onChange: (enabled: boolean | null) => void;
}

/** The row menu's section: a radio group under its label. */
export const OverrideMenuItems = ({ daemon, onChange }: OverrideProps) => (
  <>
    <DropdownMenuSeparator />
    <DropdownMenuLabel>Daemon updates</DropdownMenuLabel>
    <DropdownMenuRadioGroup
      value={overrideChoice(daemon)}
      onValueChange={(value) => {
        if (isChoice(value)) onChange(overrideValue(value));
      }}
    >
      {CHOICES(daemon).map((choice) => (
        <DropdownMenuRadioItem key={choice.value} value={choice.value}>
          {choice.label}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  </>
);

/** The same choice as a select, in the opened row's settings. */
export const OverrideSelect = ({ daemon, onChange }: OverrideProps) => (
  <Select
    value={overrideChoice(daemon)}
    onValueChange={(value) => {
      if (isChoice(value)) onChange(overrideValue(value));
    }}
  >
    <SelectTrigger aria-label="Daemon updates" className="text-label h-7 w-[260px]">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      {CHOICES(daemon).map((choice) => (
        <SelectItem key={choice.value} value={choice.value}>
          {choice.label}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

export interface KeepUpToDateProps {
  readonly checked: boolean;
  readonly onChange: (enabled: boolean) => void;
}

/** The table's foot (DESIGN.md, Settings: a sunken strip holds secondary defaults). */
export const KeepUpToDate = ({ checked, onChange }: KeepUpToDateProps) => {
  const id = useId();

  return (
    <div
      data-testid="keep-daemons-up-to-date"
      className="border-hairline bg-surface-sunken px-panel flex items-center gap-4 border-t py-[calc(var(--spacing-gap)+2px)]"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <label htmlFor={id} className="text-label text-text-default">
          Keep daemons up to date
        </label>
        <span className="text-caption text-text-subtle">
          Upgrades a host's daemon when it connects, with working agent sessions kept. Never
          installs on a host you haven't approved.
        </span>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
};
