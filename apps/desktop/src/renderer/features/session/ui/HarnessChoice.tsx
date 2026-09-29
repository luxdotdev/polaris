/**
 * The new-session page's Harness choice (DESIGN.md, New session): one row of
 * three equal 56px cards, Claude Code, Codex and Fork a turn, each with a 48px
 * washed tile. The selected card lifts to text-strong with a check.
 */
import { CheckIcon, cn, Dither, type Harness, HARNESS_NAMES, Tile } from "@polaris/ui";
import type { ReactNode } from "react";
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
      "rounded-card bg-surface-raised flex h-14 min-w-0 flex-1 basis-0 cursor-default items-stretch overflow-clip border text-left",
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

const HarnessTile = ({ harness }: { readonly harness: Harness }) => (
  <Tile hue={harness} size={48} className="h-full w-12 rounded-none border-0 border-r">
    <Dither hue={harness} size={20} />
  </Tile>
);

export interface HarnessChoiceProps {
  readonly value: Choice;
  readonly onChange: (choice: Choice) => void;
  /** The Model each Harness would start on, as its card's caption. */
  readonly captions: Readonly<Record<Harness, string>>;
  readonly canFork: boolean;
}

export const HarnessChoiceRow = ({ value, onChange, captions, canFork }: HarnessChoiceProps) => (
  <div role="radiogroup" aria-label="Harness" className="flex w-full gap-2.5">
    {(["claude", "codex"] as const).map((harness) => (
      <Card
        key={harness}
        testId={`harness-${harness}`}
        selected={value === harness}
        tile={<HarnessTile harness={harness} />}
        title={HARNESS_NAMES[harness]}
        caption={captions[harness]}
        onSelect={() => onChange(harness)}
      />
    ))}
    {canFork ? (
      <Card
        testId="harness-fork"
        selected={value === "fork"}
        tile={
          <Tile hue="starlight" size={48} className="h-full w-12 rounded-none border-0 border-r">
            <ForkGlyph />
          </Tile>
        }
        title="Fork a turn"
        caption="From a checkpoint"
        onSelect={() => onChange("fork")}
      />
    ) : null}
  </div>
);
