/**
 * The new-session page's Harness choice (DESIGN.md, New session): equal 56px
 * cards, one per Harness the Host has ready or needing sign-in, and Fork a
 * turn. The rest are under "Other harnesses", never offered as an install.
 */
import type { HarnessKind } from "@polaris/protocol";
import { CheckIcon, cn, Dither, type Harness, Tile } from "@polaris/ui";
import type { ReactNode } from "react";
import { useHarnessModels } from "../live.ts";
import { defaultChoice, type ModelChoice, modelLabel } from "../model/models.ts";
import { type HarnessOption, listedOptions, STATUS_LABELS } from "../model/options.ts";
import { OtherHarnessesLink } from "./Availability.tsx";

/** A catalogue Harness, or "Fork a turn". */
export type HarnessChoice =
  | { readonly kind: "harness"; readonly harness: HarnessKind }
  | { readonly kind: "fork" };

/** Paper's fork glyph (artboard 4), on the 24px pixel grid. */
const ForkGlyph = () => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    aria-hidden="true"
    className="text-starlight pixelated"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="square"
  >
    <path d="M7 7V10M17 7V10M12 12V17M6.5 2H7.5M6.5 7H7.5M9.5 4V5M4.5 4V5M16.5 2H17.5M16.5 7H17.5M19.5 4V5M14.5 4V5M11.5 17H12.5M11.5 22H12.5M14.5 19V20M9.5 19V20M9 12H15" />
  </svg>
);

interface CardProps {
  readonly selected: boolean;
  readonly tile: ReactNode;
  readonly title: string;
  readonly caption: string;
  readonly onSelect: () => void;
  readonly testId: string;
}

const Card = ({ selected, tile, title, caption, onSelect, testId }: CardProps) => (
  <button
    type="button"
    role="radio"
    aria-checked={selected}
    onClick={onSelect}
    data-testid={testId}
    className={cn(
      "rounded-card bg-surface-raised flex h-14 min-w-0 cursor-default items-stretch overflow-clip border text-left",
      selected
        ? "border-text-strong/15 shadow-float"
        : "border-hairline hover:border-text-strong/10"
    )}
  >
    {tile}
    <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 pr-2 pl-3">
      <span
        className={cn(
          "text-heading-sm truncate leading-[18px]",
          selected ? "text-text-strong" : "text-text-default"
        )}
      >
        {title}
      </span>
      <span
        className={cn("text-caption truncate", selected ? "text-text-subtle" : "text-text-faint")}
      >
        {caption}
      </span>
    </span>
    {selected ? (
      <span className="flex items-center pr-3">
        <CheckIcon size={16} className="text-text-strong" />
      </span>
    ) : null}
  </button>
);

const HarnessTile = ({
  harness,
  muted,
}: {
  readonly harness: Harness;
  readonly muted: boolean;
}) => (
  <Tile
    hue={harness}
    size={48}
    muted={muted}
    className="h-full w-12 rounded-none border-0 border-r"
  >
    <Dither hue={harness} size={20} />
  </Tile>
);

const HarnessCard = ({
  hostKey,
  option,
  picked,
  selected,
  onSelect,
}: {
  readonly hostKey: string;
  readonly option: HarnessOption;
  readonly picked: ModelChoice | null;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) => {
  const { models } = useHarnessModels(hostKey, option.kind, option.startable);
  const choice = picked ?? defaultChoice(option.kind, models);

  const caption =
    option.status === "ready" || option.status === "unknown"
      ? modelLabel(models, choice?.model ?? null, choice?.effort ?? null)
      : STATUS_LABELS[option.status];

  return (
    <Card
      testId={`harness-${option.kind}`}
      selected={selected}
      tile={<HarnessTile harness={option.kind} muted={!option.startable} />}
      title={option.name}
      caption={caption}
      onSelect={onSelect}
    />
  );
};

/** One balanced row of up to three cards (DESIGN.md); more wrap two to a row so names fit. */
const columns = (cards: number) => (cards <= 3 ? Math.max(cards, 1) : 2);

export interface HarnessChoiceProps {
  readonly hostKey: string;
  readonly options: ReadonlyArray<HarnessOption>;
  /** The Model the user picked per Harness; absent means its default. */
  readonly picked: Readonly<Partial<Record<Harness, ModelChoice | null>>>;
  readonly value: HarnessChoice | null;
  readonly onChange: (choice: HarnessChoice) => void;
  readonly canFork: boolean;
}

export const HarnessChoiceRow = ({
  hostKey,
  options,
  picked,
  value,
  onChange,
  canFork,
}: HarnessChoiceProps) => {
  const listed = listedOptions(options);
  const cards = listed.length + (canFork ? 1 : 0);

  return (
    <div className="flex w-full flex-col gap-2">
      <div
        role="radiogroup"
        aria-label="Harness"
        className="grid w-full gap-2.5"
        style={{ gridTemplateColumns: `repeat(${columns(cards)}, minmax(0, 1fr))` }}
      >
        {listed.map((option) => (
          <HarnessCard
            key={option.kind}
            hostKey={hostKey}
            option={option}
            picked={picked[option.kind] ?? null}
            selected={value?.kind === "harness" && value.harness === option.kind}
            onSelect={() => onChange({ kind: "harness", harness: option.kind })}
          />
        ))}
        {canFork ? (
          <Card
            testId="harness-fork"
            selected={value?.kind === "fork"}
            tile={
              <Tile
                hue="starlight"
                size={48}
                className="h-full w-12 rounded-none border-0 border-r"
              >
                <ForkGlyph />
              </Tile>
            }
            title="Fork a turn"
            caption="From a checkpoint"
            onSelect={() => onChange({ kind: "fork" })}
          />
        ) : null}
      </div>
      {listed.length === 0 ? (
        <p className="text-caption text-text-default">No harness is ready on this host yet.</p>
      ) : null}
      <OtherHarnessesLink hostKey={hostKey} options={options} />
    </div>
  );
};
