/**
 * Settings → Appearance (DESIGN.md, Settings; Paper S3): theme cards with the
 * real scenes, density with a live session-row preview, text size, code font,
 * colourblind-safe diffs and Reduce motion. Every change applies at once.
 */
import {
  CheckIcon,
  cn,
  Dither,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Tile,
} from "@polaris/ui";
import type {
  CodeFont,
  Density,
  MotionSource,
  TextSize,
  ThemeSource,
} from "../../../../shared/api.ts";
import { sectionInfo } from "../model/sections.ts";
import { setAppearance, useSettings } from "../store.ts";
import { Column, Group, Heading, PageHeader, SettingRow, StepSlider } from "./parts.tsx";

interface ThemeCard {
  readonly value: ThemeSource;
  readonly name: string;
  readonly hint: string;
}

const THEMES: ReadonlyArray<ThemeCard> = [
  { value: "dark", name: "Night", hint: "Dark" },
  { value: "light", name: "Dawn", hint: "Light" },
  { value: "system", name: "Match macOS", hint: "Auto" },
];

/** A scene as its theme draws it: `--scene` resolves inside a `data-theme` subtree. */
const Scene = ({
  theme,
  position,
}: {
  readonly theme: "dark" | "light";
  readonly position: string;
}) => (
  <span
    data-theme={theme}
    className="pixelated block h-28 flex-1 bg-cover"
    style={{ backgroundImage: "var(--scene)", backgroundPosition: position }}
  />
);

const ThemePreview = ({ value }: { readonly value: ThemeSource }) => {
  if (value === "system") {
    return (
      <span className="flex">
        <Scene theme="dark" position="0% 80%" />
        <Scene theme="light" position="100% 80%" />
      </span>
    );
  }

  return <Scene theme={value} position="50% 80%" />;
};

const ThemeCards = ({ value }: { readonly value: ThemeSource }) => (
  <div role="radiogroup" aria-label="Theme" className="flex gap-3">
    {THEMES.map((card) => {
      const selected = card.value === value;

      return (
        <button
          key={card.value}
          type="button"
          role="radio"
          aria-checked={selected}
          onClick={() => setAppearance({ theme: card.value })}
          className={cn(
            "rounded-card flex flex-1 cursor-default flex-col overflow-clip border bg-[light-dark(var(--color-surface-raised),transparent)] text-left",
            selected
              ? "border-text-strong shadow-[0_0_0_3px_light-dark(#0000000a,#ffffff0f)]"
              : "border-text-strong/10 hover:border-text-strong/20"
          )}
        >
          <ThemePreview value={card.value} />
          <span className="py-row-x gap-gap flex items-center px-3">
            <span
              className={cn(
                "text-body flex-1 font-medium",
                selected ? "text-text-strong" : "text-text-default"
              )}
            >
              {card.name}
            </span>
            {selected ? (
              <CheckIcon size={14} className="text-text-strong" />
            ) : (
              <span className="text-caption text-text-subtle">{card.hint}</span>
            )}
          </span>
        </button>
      );
    })}
  </div>
);

const DENSITIES: ReadonlyArray<Density> = ["calm", "balanced", "compact"];

const DENSITY_NAMES: Readonly<Record<Density, string>> = {
  calm: "Calm",
  balanced: "Balanced",
  compact: "Compact",
};

/** Two session rows drawn with the density tokens, so they follow the slider live. */
const DensityPreview = () => (
  <div aria-hidden className="bg-surface-sunken rounded-row flex flex-1 flex-col gap-0.5 p-1.5">
    <div className="h-session-row px-row-x rounded-row border-hairline bg-row-selected gap-row-x flex items-center border">
      <Tile
        hue="claude"
        size={28}
        style={{ width: "var(--spacing-harness-tile)", height: "var(--spacing-harness-tile)" }}
      >
        <Dither hue="claude" size={12} />
      </Tile>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-body text-text-strong truncate font-medium">Polaris planning</span>
        <span className="text-caption text-text-subtle truncate">Writing layout variants…</span>
      </span>
      <span className="text-caption text-text-subtle">5h</span>
    </div>
    <div className="h-session-row px-row-x gap-row-x flex items-center">
      <Tile
        hue="neutral"
        dormant
        size={28}
        style={{ width: "var(--spacing-harness-tile)", height: "var(--spacing-harness-tile)" }}
      >
        <span className="border-text-subtle size-1.5 rounded-full border" />
      </Tile>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-body text-text-default truncate font-medium">
          Glossary first pass
        </span>
        <span className="text-caption text-text-subtle truncate">Dormant · resumes on reply</span>
      </span>
      <span className="text-caption text-text-subtle">1d</span>
    </div>
  </div>
);

const DensityGroup = ({ value }: { readonly value: Density }) => (
  <div className="flex flex-col gap-2.5">
    <Heading
      aside={
        <span className="text-caption text-text-subtle">
          Spacing and row height only; text size is separate
        </span>
      }
    >
      Density
    </Heading>
    <Group label="Density">
      <div className="p-panel gap-section flex items-center">
        <div className="flex w-[260px] shrink-0 flex-col gap-2.5">
          <StepSlider
            label="Density"
            values={DENSITIES}
            value={value}
            valueText={DENSITY_NAMES[value]}
            onChange={(density) => setAppearance({ density })}
          />
          <div className="flex justify-between">
            {DENSITIES.map((d) => (
              <button
                key={d}
                type="button"
                tabIndex={-1}
                onClick={() => setAppearance({ density: d })}
                className={cn(
                  "text-caption cursor-default",
                  d === value ? "text-text-strong font-medium" : "text-text-subtle"
                )}
              >
                {DENSITY_NAMES[d]}
              </button>
            ))}
          </div>
        </div>
        <DensityPreview />
      </div>
    </Group>
  </div>
);

const TEXT_SIZES: ReadonlyArray<TextSize> = ["small", "default", "large", "larger"];

/** The type table's scale at each step (theme.css): 12, 13, 14 and 15 over 13. */
const TEXT_PERCENT: Readonly<Record<TextSize, string>> = {
  small: "92%",
  default: "100%",
  large: "108%",
  larger: "115%",
};

const CODE_FONTS: ReadonlyArray<{ readonly value: CodeFont; readonly name: string }> = [
  { value: "sf-mono", name: "SF Mono" },
  { value: "menlo", name: "Menlo" },
];

const MOTION: ReadonlyArray<{ readonly value: MotionSource; readonly name: string }> = [
  { value: "system", name: "Match macOS" },
  { value: "reduce", name: "On" },
  { value: "full", name: "Off" },
];

export const AppearancePage = () => {
  const appearance = useSettings((s) => s.appearance);
  const info = sectionInfo("appearance");

  return (
    <Column>
      <PageHeader title={info.title} blurb={info.blurb} />
      <div className="flex flex-col gap-2.5">
        <Heading>Theme</Heading>
        <ThemeCards value={appearance.theme} />
      </div>
      <DensityGroup value={appearance.density} />
      <Group label="Text and motion">
        <SettingRow title="Text size" caption="Scales every label and message">
          <span className="text-micro text-text-subtle" aria-hidden>
            A
          </span>
          <StepSlider
            className="w-[140px]"
            label="Text size"
            values={TEXT_SIZES}
            value={appearance.textSize}
            valueText={TEXT_PERCENT[appearance.textSize]}
            onChange={(textSize) => setAppearance({ textSize })}
          />
          <span className="text-heading text-text-subtle" aria-hidden>
            A
          </span>
          <span className="text-caption text-text-default tabular w-10 text-right">
            {TEXT_PERCENT[appearance.textSize]}
          </span>
        </SettingRow>
        <SettingRow title="Code font" caption="Editor, diffs and turn output" htmlFor="code-font">
          <Select
            value={appearance.codeFont}
            onValueChange={(v) => {
              const font = CODE_FONTS.find((f) => f.value === v);

              if (font !== undefined) setAppearance({ codeFont: font.value });
            }}
          >
            <SelectTrigger id="code-font" className="h-tree-row">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CODE_FONTS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow
          title="Colourblind-safe diffs"
          caption="Blue and orange instead of green and red"
          htmlFor="cvd-diffs"
        >
          <span data-diff-palette="cvd" className="text-caption tabular flex gap-0.5" aria-hidden>
            <span className="bg-diff-added-bg text-diff-added-text rounded-[4px] px-[5px]">
              +12
            </span>
            <span className="bg-diff-removed-bg text-diff-removed-text rounded-[4px] px-[5px]">
              −4
            </span>
          </span>
          <Switch
            id="cvd-diffs"
            checked={appearance.diffPalette === "cvd"}
            onCheckedChange={(on) => setAppearance({ diffPalette: on ? "cvd" : "default" })}
          />
        </SettingRow>
        <SettingRow
          title="Reduce motion"
          caption="Stills the working dither and drops transitions"
          htmlFor="reduce-motion"
        >
          <Select
            value={appearance.motion}
            onValueChange={(v) => {
              const motion = MOTION.find((m) => m.value === v);

              if (motion !== undefined) setAppearance({ motion: motion.value });
            }}
          >
            <SelectTrigger id="reduce-motion" className="h-tree-row">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MOTION.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
      </Group>
    </Column>
  );
};
