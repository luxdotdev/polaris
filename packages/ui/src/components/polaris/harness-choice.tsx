import type { HarnessKind, HarnessStatus } from "@polaris/protocol";
import { RadioGroup } from "radix-ui";
import type { ReactNode } from "react";

import { CheckIcon } from "../../icons/chrome";
import { cn } from "../../lib/cn";
import type { CssVars } from "../../lib/css";
import { harnessHue, hueVar, resolveTint, washVar, type TintHue } from "../../lib/hue";
import { Dither } from "./dither";

/** A catalogue Harness to offer: its name, hue and setup come from the catalogue. */
export interface HarnessChoiceHarness {
  readonly kind: HarnessKind;
  /** The Model it will run on ("Opus 5"). */
  readonly caption: ReactNode;
  /** From the Host's availability; anything but "ready" can't be chosen. */
  readonly status?: HarnessStatus;
  /** Why it isn't ready, for "outdated", "needs-sign-in" or "unknown". */
  readonly detail?: ReactNode;
}

/** A choice that isn't a Harness, such as "Fork a turn". */
export interface HarnessChoiceOther {
  readonly value: string;
  readonly hue: TintHue;
  /** A 22–24px pixel glyph for the tile. */
  readonly icon: ReactNode;
  readonly title: ReactNode;
  readonly caption: ReactNode;
}

export interface HarnessChoiceProps {
  /** Catalogue Harnesses, in catalogue order; the choice's value is the kind. */
  readonly harnesses: readonly HarnessChoiceHarness[];
  readonly others?: readonly HarnessChoiceOther[];
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly "aria-label": string;
  readonly className?: string;
}

/**
 * The new-session Harness choice (DESIGN.md, New session; Paper VG-0): one balanced row of
 * equal 56px cards, each with a 48px washed tile. Arrow keys move the choice.
 */
export function HarnessChoice({
  harnesses,
  others = [],
  value,
  onValueChange,
  className,
  ...props
}: HarnessChoiceProps) {
  return (
    <RadioGroup.Root
      value={value}
      onValueChange={onValueChange}
      orientation="horizontal"
      aria-label={props["aria-label"]}
      data-slot="harness-choice"
      className={cn("flex gap-2.5", className)}
    >
      {harnesses.map((harness) =>
        harness.status === "not-installed" ? (
          <NotInstalledCard key={harness.kind} kind={harness.kind} />
        ) : (
          <HarnessCard key={harness.kind} harness={harness} selected={harness.kind === value} />
        )
      )}
      {others.map((other) => (
        <ChoiceCard
          key={other.value}
          value={other.value}
          hue={other.hue}
          icon={other.icon}
          title={other.title}
          caption={other.caption}
          selected={other.value === value}
        />
      ))}
    </RadioGroup.Root>
  );
}

interface HarnessCardProps {
  readonly harness: HarnessChoiceHarness;
  readonly selected: boolean;
}

function HarnessCard({ harness, selected }: HarnessCardProps) {
  const identity = harnessHue(harness.kind);
  const ready = harness.status === undefined || harness.status === "ready";

  return (
    <ChoiceCard
      value={harness.kind}
      hue={harness.kind}
      icon={<Dither hue={harness.kind} size={24} />}
      title={identity.name}
      caption={ready ? harness.caption : (harness.detail ?? harness.caption)}
      selected={selected}
      disabled={!ready}
    />
  );
}

interface ChoiceCardProps {
  readonly value: string;
  readonly hue: TintHue;
  readonly icon: ReactNode;
  readonly title: ReactNode;
  readonly caption: ReactNode;
  readonly selected: boolean;
  readonly disabled?: boolean;
}

function ChoiceCard({
  value,
  hue,
  icon,
  title,
  caption,
  selected,
  disabled = false,
}: ChoiceCardProps) {
  return (
    <RadioGroup.Item
      value={value}
      disabled={disabled}
      data-slot="harness-choice-card"
      className={cn(
        "flex h-14 min-w-0 flex-1 cursor-default items-stretch overflow-clip rounded-card border bg-surface-raised text-left select-none disabled:opacity-(--opacity-dimmed)",
        selected ? "border-text-subtle/40" : "border-hairline hover:border-text-subtle/25"
      )}
    >
      <ChoiceTile hue={hue}>{icon}</ChoiceTile>
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 pr-2 pl-3">
        <span
          className={cn(
            "truncate text-heading-sm leading-[18px]",
            selected ? "text-text-strong" : "text-text-default"
          )}
        >
          {title}
        </span>
        <span className="text-caption text-text-subtle truncate">{caption}</span>
      </span>
      <span className="flex items-center pr-3">
        <RadioGroup.Indicator>
          <CheckIcon className="text-text-strong" />
        </RadioGroup.Indicator>
      </span>
    </RadioGroup.Item>
  );
}

interface NotInstalledCardProps {
  readonly kind: HarnessKind;
}

/**
 * A catalogue Harness this Host doesn't have. Polaris never installs one: the card shows the
 * catalogue's setup line and a link to its docs, and nothing else (ADR 0001).
 */
function NotInstalledCard({ kind }: NotInstalledCardProps) {
  const identity = harnessHue(kind);

  return (
    <div
      data-slot="harness-choice-card"
      data-status="not-installed"
      aria-disabled="true"
      className="rounded-card border-text-subtle/30 bg-surface-raised flex min-h-14 min-w-0 flex-1 overflow-clip border border-dashed"
    >
      <ChoiceTile hue={kind} muted>
        <Dither hue={kind} size={24} dim />
      </ChoiceTile>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 py-2 pr-3 pl-3">
        <span className="flex items-baseline gap-2">
          <span className="text-heading-sm text-text-subtle min-w-0 flex-1 truncate leading-[18px]">
            {identity.name}
          </span>
          {identity.setup === null ? null : (
            <a
              href={identity.setup.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="text-caption text-text-default shrink-0 font-medium underline-offset-2 hover:underline"
            >
              Setup guide
            </a>
          )}
        </span>
        <span className="text-caption text-text-subtle line-clamp-2">
          {identity.setup?.install ?? "Not installed on this host."}
        </span>
      </div>
    </div>
  );
}

export interface ChoiceTileProps {
  readonly hue: TintHue;
  readonly muted?: boolean;
  readonly className?: string;
  readonly children?: ReactNode;
}

/**
 * The leading tile of a choice card (Paper VG-0): 48px wide, flush with the card's leading
 * edge and full height, so the card's radius and overflow clip its corners; a hue hairline right.
 */
export function ChoiceTile({ hue, muted = false, className, children }: ChoiceTileProps) {
  const resolved = resolveTint(hue);

  const vars: CssVars =
    resolved === "neutral"
      ? {}
      : { "--choice-hue": hueVar(resolved), backgroundImage: washVar(resolved) };

  return (
    <span
      aria-hidden="true"
      className={cn(
        "pixelated flex w-12 shrink-0 items-center justify-center self-stretch border-r bg-cover bg-center bg-origin-border",
        resolved === "neutral"
          ? "border-hairline bg-fill-selected"
          : "border-[color-mix(in_oklab,var(--choice-hue)_22%,transparent)]",
        muted && "opacity-60",
        className
      )}
      style={vars}
    >
      {children}
    </span>
  );
}
