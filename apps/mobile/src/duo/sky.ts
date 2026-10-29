/**
 * The monitor's sky (Paper MX-AF): its gradient, faint stars and the pixel ridge the celestials
 * stand on, drawn in a 669pt frame and stretched across the sky. Pure; `Monitor` draws it.
 */
import type { ThemeName } from "../theme/index.ts";

/** Paper's frame: the half-folded Duo's top half. */
export const SKY_FRAME = { width: 669, height: 475 } as const;

/** The ridge as [width, top] steps from the left edge, in the frame's points. */
const STEPS: ReadonlyArray<readonly [number, number]> = [
  [40, 410],
  [48, 404],
  [40, 396],
  [52, 400],
  [30, 390],
  [18, 378],
  [44, 386],
  [60, 392],
  [46, 386],
  [28, 376],
  [52, 382],
  [48, 388],
  [40, 380],
  [52, 386],
  [30, 382],
  [41, 394],
];

const scaled = (width: number) => width / SKY_FRAME.width;

/** The ridge's top at `x` in a sky `width` wide, as a distance up from the sky's foot. */
export const ridgeRise = (x: number, width: number): number => {
  const at = x / scaled(width);
  let left = 0;

  for (const [run, top] of STEPS) {
    if (at < left + run) return SKY_FRAME.height - top;
    left += run;
  }

  return SKY_FRAME.height - (STEPS.at(-1)?.[1] ?? SKY_FRAME.height);
};

/** The ridge's outline as an SVG path in a sky `width` by `height`; `closed` fills it down. */
export const ridgePath = (width: number, height: number, closed: boolean): string => {
  const k = scaled(width);
  const foot = height - SKY_FRAME.height;
  const [first] = STEPS;
  let d = `M0 ${(first?.[1] ?? 0) + foot}`;
  let x = 0;

  for (const [run, top] of STEPS) {
    d += `V${top + foot}H${(x + run) * k}`;
    x += run;
  }

  return closed ? `${d}V${height}H0Z` : d;
};

/** Paper's faint stars as [x, y, radius, opacity] in the frame. */
export const SKY_STARS: ReadonlyArray<readonly [number, number, number, number]> = [
  [40, 60, 1, 0.5],
  [120, 140, 1, 0.4],
  [210, 40, 1, 0.6],
  [470, 80, 1, 0.5],
  [560, 150, 1, 0.4],
  [620, 50, 1, 0.6],
  [90, 230, 1, 0.3],
  [600, 250, 1, 0.3],
  [330, 230, 1, 0.3],
  [520, 200, 1, 0.4],
  [160, 300, 1, 0.3],
  [420, 290, 1, 0.3],
];

export interface SkyPalette {
  /** The gradient's stops, top to the ridge. */
  readonly stops: ReadonlyArray<readonly [number, string]>;
  readonly ridge: string;
  readonly ridgeEdge: string;
  /** The stars' opacity, over each star's own. */
  readonly stars: number;
}

/** MX-AF's sky in each theme; Moonlit's is lifted toward its ground. */
export const SKY_PALETTES: Readonly<Record<ThemeName, SkyPalette>> = {
  midnight: {
    stops: [
      [0, "#000000"],
      [0.6, "#05070d"],
      [1, "#0b1222"],
    ],
    ridge: "#06080c",
    ridgeEdge: "#ffffff1f",
    stars: 1,
  },
  moonlit: {
    stops: [
      [0, "#151618"],
      [0.75, "#1c2030"],
      [1, "#232838"],
    ],
    ridge: "#1b1c20",
    ridgeEdge: "#ffffff1a",
    stars: 0.55,
  },
};
