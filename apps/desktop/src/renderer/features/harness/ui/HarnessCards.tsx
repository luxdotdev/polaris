/**
 * The new-session page's Harness choice (DESIGN.md, New session): one row of
 * equal 56px cards, one per Harness the Host has (catalogue + availability)
 * and Fork a turn. A Harness that isn't ready shows why, never an install.
 */
import { CheckIcon, cn, Dither, type Harness, Tile } from "@polaris/ui";
import type { ReactNode } from "react";
import { useHarnessModels } from "../hooks.ts";
import { type HarnessOption, STATUS_CAPTIONS } from "../model/harnesses.ts";
import { defaultChoice, type ModelChoice, modelLabel } from "../model/models.ts";
import type { HarnessChoice as Choice } from "../model/newSession.ts";

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
    STATUS_CAPTIONS[option.status] ??
    modelLabel(models, choice?.model ?? null, choice?.effort ?? null);

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

/** Under the row when the chosen Harness can't start: its setup line and its docs. */
export const SetupNote = ({ option }: { readonly option: HarnessOption }) => (
  <div
    className="rounded-card border-hairline bg-surface-raised flex flex-col gap-1 border px-4 py-3"
    data-testid="harness-setup"
  >
    <p className="text-body text-text-default">
      {option.setupLine ?? `${option.name} can't start yet.`}
    </p>
    {option.detail === null ? null : (
      <p className="text-caption text-text-subtle">{option.detail}</p>
    )}
    <a
      href={option.docsUrl}
      target="_blank"
      rel="noreferrer"
      className="text-label text-text-strong decoration-text-faint self-start underline underline-offset-4"
    >
      {option.name} setup guide
    </a>
  </div>
);

/** One balanced row of up to three cards (DESIGN.md); more wrap two to a row so names fit. */
const columns = (cards: number) => (cards <= 3 ? Math.max(cards, 1) : 2);

export interface HarnessChoiceProps {
  readonly hostKey: string;
  readonly options: ReadonlyArray<HarnessOption>;
  /** The Model the user picked per Harness; absent means its default. */
  readonly picked: Readonly<Partial<Record<Harness, ModelChoice | null>>>;
  readonly value: Choice | null;
  readonly onChange: (choice: Choice) => void;
  readonly canFork: boolean;
}

export const HarnessChoiceRow = ({
  hostKey,
  options,
  picked,
  value,
  onChange,
  canFork,
}: HarnessChoiceProps) => (
  <div
    role="radiogroup"
    aria-label="Harness"
    className="grid w-full gap-2.5"
    style={{
      gridTemplateColumns: `repeat(${columns(options.length + (canFork ? 1 : 0))}, minmax(0, 1fr))`,
    }}
  >
    {options.map((option) => (
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
          <Tile hue="starlight" size={48} className="h-full w-12 rounded-none border-0 border-r">
            <ForkGlyph />
          </Tile>
        }
        title="Fork a turn"
        caption="From a checkpoint"
        onSelect={() => onChange({ kind: "fork" })}
      />
    ) : null}
  </div>
);
