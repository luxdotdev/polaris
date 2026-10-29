/**
 * Each dark's sky for its theme card (Paper MX-G), 166×104: stars, two ridges and Moonlit's moon.
 * The art is the theme's own, so it keeps its colours whichever theme is active.
 */
import type { ThemeName } from "../theme";

export interface Sky {
  readonly ground: string;
  readonly stars: ReadonlyArray<readonly [x: number, y: number, size: number, fill: string]>;
  readonly ridges: readonly [back: string, front: string];
  readonly moon: boolean;
}

const BACK = "M0 74h18v-4h14v-6h12v4h16v-8h20v6h14v-4h22v6h16v-6h14v4h20v32H0z";

const FRONT = "M0 84h24v-4h20v4h18v-6h22v4h16v-2h18v4h20v-4h12v6h16v4h10v20H0z";

export const RIDGE_PATHS = [BACK, FRONT] as const;

export const SKIES: Record<ThemeName, Sky> = {
  midnight: {
    ground: "#000000",
    stars: [
      [58, 30, 1, "#FFFFFFB3"],
      [96, 10, 2, "#FFFFFFE6"],
      [130, 24, 1, "#FFFFFF99"],
      [150, 44, 2, "#FFFFFFCC"],
      [40, 46, 1, "#FFFFFF80"],
      [110, 40, 1, "#FFFFFF99"],
      [76, 52, 1, "#FFFFFF66"],
      [14, 58, 1, "#FFFFFF80"],
    ],
    ridges: ["#151A3A", "#0B1026"],
    moon: false,
  },
  moonlit: {
    ground: "#151618",
    stars: [
      [22, 14, 2, "#FFFFFFB3"],
      [96, 10, 2, "#FFFFFFA1"],
      [40, 46, 1, "#FFFFFF59"],
    ],
    ridges: ["#262B45", "#1E2236"],
    moon: true,
  },
};

/** The pixel moon, 72×72, from the shared horizon art. */
export { MOON, MOON_HALO } from "@polaris/ui/horizon";
