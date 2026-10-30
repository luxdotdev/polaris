/**
 * Settings → Sessions, "Visuals" (ENG-598; DESIGN.md, Visualizations, V8): how readily agents
 * draw a visualization. One setting for every host: the Desktop App writes it to each.
 */
import type { VisualsLevel } from "@polaris/protocol";
import { cn, InstrumentCard } from "@polaris/ui";
import { setSessionPrefs, useSettings } from "../store.ts";
import { CARD_CAPTION } from "./UsageTokens.tsx";

const LEVELS: ReadonlyArray<{
  readonly level: VisualsLevel;
  readonly name: string;
  readonly caption: string;
}> = [
  {
    level: "rich",
    name: "Rich",
    caption:
      "Whenever a picture explains better than text: charts, trade-offs with sliders, plans as steps",
  },
  {
    level: "simple",
    name: "Simple",
    caption: "Only when you ask for one, or when the answer is a chart or a table",
  },
  {
    level: "off",
    name: "Off",
    caption: "Agents answer in text; they aren't offered the tool at all",
  },
];

const Level = ({
  level,
  name,
  caption,
  checked,
}: (typeof LEVELS)[number] & { readonly checked: boolean }) => (
  <label className="px-panel flex cursor-default items-start gap-3 py-[calc(var(--spacing-gap)+4px)]">
    <input
      type="radio"
      name="visuals"
      value={level}
      checked={checked}
      onChange={() => setSessionPrefs({ visuals: level })}
      className="peer sr-only"
    />
    <span
      aria-hidden
      className={cn(
        "peer-focus-visible:ring-starlight mt-px size-4 shrink-0 rounded-full peer-focus-visible:ring-2",
        checked ? "border-text-strong border-[4.5px]" : "border-text-faint border-[1.5px]"
      )}
    />
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="text-label text-text-default flex items-baseline gap-2">
        {name}
        {level === "rich" ? <span className={CARD_CAPTION}>Default</span> : null}
      </span>
      <span className="text-caption text-text-subtle">{caption}</span>
    </span>
  </label>
);

export const Visuals = () => {
  const current = useSettings((s) => s.sessions.visuals);

  return (
    <InstrumentCard
      aria-label="Visuals"
      className="w-full"
      header={{
        title: "Visuals",
        control: <span className={CARD_CAPTION}>How often agents draw a visualization</span>,
      }}
      wells={[
        <div
          key="levels"
          role="radiogroup"
          aria-label="Visuals"
          className="divide-hairline flex flex-col divide-y"
        >
          {LEVELS.map((l) => (
            <Level key={l.level} {...l} checked={l.level === current} />
          ))}
        </div>,
      ]}
      footer={{ status: "New turns follow it · earlier visualizations stay in the conversation" }}
    />
  );
};
