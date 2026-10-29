/**
 * Appearance's theme cards (DESIGN.md, Chrome redesign: Settings; Paper X-J): Moonlit and
 * Midnight as a choice of dark, each a miniature of the chrome under its own sky, and a smaller
 * Light card. The miniature is the real horizon and tokens in a themed subtree, scaled down.
 */
import { CheckIcon, cn, Horizon, hueVar, Kicker } from "@polaris/ui";
import type { DarkTheme, ThemeSource } from "../../../../shared/api.ts";
import { setAppearance } from "../store.ts";

type Sky = DarkTheme | "light";

const Bar = ({ className }: { readonly className: string }) => (
  <span className={cn("block h-1 rounded-full", className)} />
);

const ROWS = [
  { hue: "claude", width: "w-[58%]", selected: true },
  { hue: "codex", width: "w-[48%]", selected: false },
  { hue: "opencode", width: "w-[40%]", selected: false },
] as const;

/** The sidebar: a heading and three session rows marked in their Harness hue. */
const MiniSidebar = () => (
  <div className="flex w-[30%] shrink-0 flex-col gap-2.5 pt-2">
    <Bar className="bg-text-strong/70 w-[34%]" />
    <Bar className="bg-text-subtle/40 -mt-1 w-[52%]" />
    {ROWS.map((row) => (
      <span
        key={row.hue}
        className={cn(
          "flex items-center gap-2 rounded-[10px] px-2 py-1.5",
          row.selected && "bg-panel"
        )}
      >
        <span className="size-2.5 shrink-0 rounded-full" style={{ background: hueVar(row.hue) }} />
        <span className="flex flex-1 flex-col gap-1">
          <Bar className={cn("bg-text-default/70", row.width)} />
          <Bar className="bg-text-subtle/35 w-[70%]" />
        </span>
      </span>
    ))}
  </div>
);

/** The conversation panel: a header, the user's message, the agent's lines and the composer. */
const MiniPanel = () => (
  <div className="bg-panel shadow-panel mb-4 flex flex-1 flex-col gap-4 rounded-[18px] p-5">
    <span className="flex items-center gap-2">
      <span className="size-3 rounded-[3px]" style={{ background: hueVar("claude") }} />
      <span className="flex flex-col gap-1">
        <Bar className="bg-text-strong/70 w-20" />
        <Bar className="bg-text-subtle/35 w-12" />
      </span>
    </span>
    <span className="bg-well ml-auto block w-[44%] rounded-[10px] p-2.5">
      <Bar className="bg-text-default/60 w-full" />
    </span>
    <span className="flex flex-col gap-1.5">
      <Bar className="bg-text-default/55 w-[86%]" />
      <Bar className="bg-text-default/55 w-[72%]" />
      <Bar className="bg-text-default/55 w-[80%]" />
    </span>
    <span className="border-hairline bg-well mt-auto flex items-end justify-between rounded-[12px] border p-3">
      <span className="flex w-[50%] flex-col gap-2">
        <Bar className="bg-text-subtle/45 w-full" />
        <Bar className="bg-text-subtle/30 w-[60%]" />
      </span>
      <span className="bg-starlight size-3 rounded-full" />
    </span>
  </div>
);

const DOTS = ["#FF5F57", "#FEBC2E", "#28C840"] as const;

const MiniTitleBar = () => (
  <div className="flex h-9 shrink-0 items-center gap-1.5 px-4">
    {DOTS.map((dot) => (
      <span key={dot} className="size-2.5 rounded-full" style={{ background: dot }} />
    ))}
    <span className="bg-panel mx-auto flex h-4 w-32 items-center justify-center gap-2 rounded-full">
      <Bar className="bg-text-default/70 w-9" />
      <Bar className="bg-text-subtle/40 w-7" />
    </span>
    <span className="bg-starlight h-4 w-20 rounded-full" />
  </div>
);

/** The chrome at 664×368 under one sky, scaled to the card; the themed subtree paints `bg`, so the ground sits inside. */
const Miniature = ({ sky }: { readonly sky: Sky }) => (
  <div
    data-theme={sky === "light" ? "light" : "dark"}
    data-theme-dark={sky === "light" ? undefined : sky}
    className="h-[368px] w-[664px]"
  >
    <div className="bg-ground relative isolate flex size-full flex-col">
      <MiniTitleBar />
      <div className="flex min-h-0 flex-1 gap-3 px-4">
        <MiniSidebar />
        <MiniPanel />
      </div>
      <Horizon />
    </div>
  </div>
);

/** The miniature scaled into a box; it never takes pointer events or focus. */
const Preview = ({
  sky,
  scale,
  className,
}: {
  readonly sky: Sky;
  readonly scale: "half" | "quarter";
  readonly className: string;
}) => (
  <span aria-hidden className={cn("pointer-events-none block overflow-hidden", className)}>
    <span className={cn("block origin-top-left", scale === "half" ? "scale-50" : "scale-25")}>
      <Miniature sky={sky} />
    </span>
  </span>
);

interface DarkCard {
  readonly value: DarkTheme;
  readonly name: string;
  readonly caption: string;
}

/** DESIGN.md, Chrome redesign: Themes. Moonlit is the default. */
const DARK_CARDS: ReadonlyArray<DarkCard> = [
  {
    value: "moonlit",
    name: "Moonlit",
    caption: "Today's dark, softer charcoal. A moon in the sky.",
  },
  { value: "midnight", name: "Midnight", caption: "Pure black for OLED. A new-moon sky." },
];

const CARD = "rounded-card flex cursor-default overflow-clip border bg-panel text-left";

const cardBorder = (selected: boolean) =>
  selected
    ? "border-text-strong/60 shadow-[0_0_0_3px_light-dark(#0000000a,#ffffff0f)]"
    : "border-hairline hover:border-text-strong/20";

/** A radio's mark: a check in a filled circle, or an empty ring. */
const RadioMark = ({ selected }: { readonly selected: boolean }) =>
  selected ? (
    <span className="bg-text-strong text-panel grid size-5 shrink-0 place-items-center rounded-full">
      <CheckIcon size={12} />
    </span>
  ) : (
    <span className="border-text-subtle/60 size-5 shrink-0 rounded-full border" />
  );

/** Moonlit and Midnight: choosing one switches the dark theme at once. */
export const DarkThemeCards = ({ value }: { readonly value: DarkTheme }) => (
  <div role="radiogroup" aria-label="Dark theme" className="grid grid-cols-2 gap-3">
    {DARK_CARDS.map((card) => {
      const selected = card.value === value;

      return (
        <button
          key={card.value}
          type="button"
          role="radio"
          aria-checked={selected}
          aria-label={card.name}
          onClick={() => setAppearance({ darkTheme: card.value })}
          className={cn(CARD, "flex-col", cardBorder(selected))}
        >
          <Preview sky={card.value} scale="half" className="border-hairline h-[184px] border-b" />
          <span className="flex items-center gap-3 px-4 py-3">
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex items-baseline gap-2">
                <span className="text-label text-text-strong">{card.name}</span>
                {card.value === "moonlit" ? <Kicker>Default</Kicker> : null}
              </span>
              <span className="text-caption text-text-subtle">{card.caption}</span>
            </span>
            <RadioMark selected={selected} />
          </span>
        </button>
      );
    })}
  </div>
);

const LIGHT_STATUS: Readonly<Record<ThemeSource, string>> = {
  system: "System · by day",
  light: "Always",
  dark: "Not in use",
};

/** The smaller Light card: when light shows, and choosing it sets Appearance to Light. */
export const LightCard = ({ theme }: { readonly theme: ThemeSource }) => (
  <button
    type="button"
    aria-pressed={theme === "light"}
    onClick={() => setAppearance({ theme: "light" })}
    className={cn(CARD, "items-center gap-4 p-2 pr-4", cardBorder(theme === "light"))}
  >
    <Preview sky="light" scale="quarter" className="h-[92px] w-[166px] shrink-0 rounded-[10px]" />
    <span className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-label text-text-strong">Light</span>
      <span className="text-caption text-text-subtle">
        What System uses by day, or always with Appearance set to Light. Dawn hills along the foot.
      </span>
    </span>
    <Kicker className="shrink-0">{LIGHT_STATUS[theme]}</Kicker>
  </button>
);
