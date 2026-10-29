/**
 * Settings → Appearance (DESIGN.md, Chrome redesign: Settings; Paper X-J): System / Light / Dark,
 * Moonlit and Midnight as preview cards and a smaller Light card, then plain rows: text size,
 * density, code font, colourblind-safe diffs and Reduce motion. Every change applies at once.
 */
import { clientCopy } from "../../../../shared/clientCopy.ts";
import { isWindows } from "../../../../shared/platform.ts";
import {
  ChevronDownIcon,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SegmentedControl,
  type SegmentedOption,
  Switch,
} from "@polaris/ui";
import type {
  CodeFont,
  CodeFontSize,
  Density,
  MotionSource,
  TextSize,
  ThemeSource,
} from "../../../../shared/api.ts";
import { sectionInfo } from "../model/sections.ts";
import { setAppearance, useSettings } from "../store.ts";
import { Column, Heading, PageHeader, PlainRows, SettingRow, StepSlider } from "./parts.tsx";
import { DarkThemeCards, LightCard } from "./ThemeCards.tsx";

const THEMES: ReadonlyArray<SegmentedOption<ThemeSource>> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const DENSITIES: ReadonlyArray<SegmentedOption<Density>> = [
  { value: "calm", label: "Calm" },
  { value: "balanced", label: "Balanced" },
  { value: "compact", label: "Compact" },
];

const TEXT_SIZES: ReadonlyArray<TextSize> = ["small", "default", "large", "larger"];

/** The type table's scale at each step (theme.css): 12, 13, 14 and 15 over 13. */
const TEXT_PERCENT: Readonly<Record<TextSize, string>> = {
  small: "92%",
  default: "100%",
  large: "108%",
  larger: "115%",
};

const CODE_FONTS: ReadonlyArray<{
  readonly value: CodeFont;
  readonly name: string;
  readonly family: string;
}> = isWindows()
  ? [
      { value: "sf-mono", name: "Cascadia Mono", family: '"Cascadia Mono", Consolas, monospace' },
      { value: "menlo", name: "Consolas", family: "Consolas, monospace" },
    ]
  : [
      { value: "sf-mono", name: "SF Mono", family: '"SF Mono", ui-monospace, monospace' },
      { value: "menlo", name: "Menlo", family: "Menlo, ui-monospace, monospace" },
    ];

const CODE_SIZES: ReadonlyArray<CodeFontSize> = [12, 13, 14, 15];

/** Font and size in one control, "SF Mono · 13" (Paper S3): the Editor's font and size are settings. */
const CodeFontMenu = ({ font, size }: { readonly font: CodeFont; readonly size: CodeFontSize }) => (
  <DropdownMenu>
    <DropdownMenuTrigger
      id="code-font"
      className="h-tree-row px-row-x rounded-control text-caption text-text-strong hover:bg-fill-hover border-text-strong/10 flex cursor-default items-center gap-1.5 border"
    >
      {CODE_FONTS.find((f) => f.value === font)?.name ?? font} · {size}
      <ChevronDownIcon size={10} className="text-text-subtle" />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuLabel>Font</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={font}
        onValueChange={(v) => {
          const next = CODE_FONTS.find((f) => f.value === v);

          if (next !== undefined) setAppearance({ codeFont: next.value });
        }}
      >
        {CODE_FONTS.map((f) => (
          <DropdownMenuRadioItem key={f.value} value={f.value} style={{ fontFamily: f.family }}>
            {f.name}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>Size</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={String(size)}
        onValueChange={(v) => {
          const next = CODE_SIZES.find((s) => String(s) === v);

          if (next !== undefined) setAppearance({ codeFontSize: next });
        }}
      >
        {CODE_SIZES.map((s) => (
          <DropdownMenuRadioItem key={s} value={String(s)}>
            {s}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
);

const MOTION: ReadonlyArray<{ readonly value: MotionSource; readonly name: string }> = [
  { value: "system", name: `Match ${clientCopy().os}` },
  { value: "reduce", name: "On" },
  { value: "full", name: "Off" },
];

export const AppearancePage = () => {
  const appearance = useSettings((s) => s.appearance);
  const info = sectionInfo("appearance");
  const os = clientCopy().os;

  return (
    <Column>
      <PageHeader title={info.title} blurb={info.blurb} />
      <PlainRows label="Appearance">
        <SettingRow
          title="Appearance"
          caption={`System follows ${os}: light by day, your dark theme at night`}
        >
          <SegmentedControl
            pill
            aria-label="Appearance"
            options={THEMES}
            value={appearance.theme}
            onValueChange={(theme) => setAppearance({ theme })}
          />
        </SettingRow>
      </PlainRows>
      <div className="flex flex-col gap-3">
        <Heading
          aside={
            <span className="text-caption text-text-subtle">
              Used when Appearance is Dark, and by System at night
            </span>
          }
        >
          Dark theme
        </Heading>
        <DarkThemeCards value={appearance.darkTheme} />
        <LightCard theme={appearance.theme} />
      </div>
      <PlainRows label="Text, density and motion" ruled>
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
        <SettingRow title="Density" caption="Spacing and row height only; text size is separate">
          <SegmentedControl
            pill
            aria-label="Density"
            options={DENSITIES}
            value={appearance.density}
            onValueChange={(density) => setAppearance({ density })}
          />
        </SettingRow>
        <SettingRow title="Code font" caption="Editor, diffs and turn output" htmlFor="code-font">
          <CodeFontMenu font={appearance.codeFont} size={appearance.codeFontSize} />
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
          caption={
            appearance.motion === "system"
              ? "Follows the system · stills the working dither and drops transitions"
              : "Stills the working dither and drops transitions"
          }
          htmlFor="reduce-motion"
        >
          <Select
            value={appearance.motion}
            onValueChange={(v) => {
              const motion = MOTION.find((m) => m.value === v);

              if (motion !== undefined) setAppearance({ motion: motion.value });
            }}
          >
            <SelectTrigger id="reduce-motion" className="h-tree-row rounded-full bg-transparent">
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
      </PlainRows>
    </Column>
  );
};
