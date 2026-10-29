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

/** The pixel moon, 72×72 (the shared horizon art's): its dotted halo, then body tones. */
export const MOON_HALO =
  "M28 4h1v1h-1zM36 4h1v1h-1zM44 4h1v1h-1zM16 8h1v1h-1zM20 8h1v1h-1zM24 8h1v1h-1zM28 8h1v1h-1zM32 8h1v1h-1zM36 8h1v1h-1zM40 8h1v1h-1zM44 8h1v1h-1zM48 8h1v1h-1zM26 10h1v1h-1zM30 10h1v1h-1zM34 10h1v1h-1zM38 10h1v1h-1zM42 10h1v1h-1zM20 12h1v1h-1zM24 12h1v1h-1zM28 12h1v1h-1zM32 12h1v1h-1zM36 12h1v1h-1zM40 12h1v1h-1zM44 12h1v1h-1zM48 12h1v1h-1zM52 12h1v1h-1zM22 14h1v1h-1zM26 14h1v1h-1zM30 14h1v1h-1zM34 14h1v1h-1zM38 14h1v1h-1zM42 14h1v1h-1zM46 14h1v1h-1zM8 16h1v1h-1zM12 16h1v1h-1zM16 16h1v1h-1zM20 16h1v1h-1zM24 16h1v1h-1zM26 16h1v1h-1zM44 16h1v1h-1zM46 16h1v1h-1zM48 16h1v1h-1zM50 16h1v1h-1zM52 16h1v1h-1zM56 16h1v1h-1zM60 16h1v1h-1zM18 18h1v1h-1zM22 18h1v1h-1zM50 18h1v1h-1zM54 18h1v1h-1zM58 18h1v1h-1zM12 20h1v1h-1zM16 20h1v1h-1zM20 20h1v1h-1zM52 20h1v1h-1zM56 20h1v1h-1zM60 20h1v1h-1zM14 22h1v1h-1zM18 22h1v1h-1zM54 22h1v1h-1zM8 24h1v1h-1zM12 24h1v1h-1zM16 24h1v1h-1zM54 24h1v1h-1zM56 24h1v1h-1zM60 24h1v1h-1zM64 24h1v1h-1zM10 26h1v1h-1zM14 26h1v1h-1zM58 26h1v1h-1zM4 28h1v1h-1zM8 28h1v1h-1zM12 28h1v1h-1zM14 28h1v1h-1zM56 28h1v1h-1zM60 28h1v1h-1zM64 28h1v1h-1zM14 30h1v1h-1zM58 30h1v1h-1zM62 30h1v1h-1zM8 32h1v1h-1zM12 32h1v1h-1zM14 32h1v1h-1zM58 32h1v1h-1zM60 32h1v1h-1zM64 32h1v1h-1zM10 34h1v1h-1zM14 34h1v1h-1zM58 34h1v1h-1zM62 34h1v1h-1zM4 36h1v1h-1zM8 36h1v1h-1zM12 36h1v1h-1zM14 36h1v1h-1zM60 36h1v1h-1zM64 36h1v1h-1zM68 36h1v1h-1zM10 38h1v1h-1zM14 38h1v1h-1zM58 38h1v1h-1zM62 38h1v1h-1zM8 40h1v1h-1zM12 40h1v1h-1zM14 40h1v1h-1zM58 40h1v1h-1zM60 40h1v1h-1zM64 40h1v1h-1zM10 42h1v1h-1zM14 42h1v1h-1zM58 42h1v1h-1zM4 44h1v1h-1zM8 44h1v1h-1zM12 44h1v1h-1zM14 44h1v1h-1zM16 44h1v1h-1zM56 44h1v1h-1zM60 44h1v1h-1zM64 44h1v1h-1zM14 46h1v1h-1zM54 46h1v1h-1zM58 46h1v1h-1zM8 48h1v1h-1zM12 48h1v1h-1zM16 48h1v1h-1zM18 48h1v1h-1zM56 48h1v1h-1zM60 48h1v1h-1zM64 48h1v1h-1zM14 50h1v1h-1zM18 50h1v1h-1zM54 50h1v1h-1zM58 50h1v1h-1zM12 52h1v1h-1zM16 52h1v1h-1zM20 52h1v1h-1zM22 52h1v1h-1zM52 52h1v1h-1zM56 52h1v1h-1zM60 52h1v1h-1zM18 54h1v1h-1zM22 54h1v1h-1zM46 54h1v1h-1zM50 54h1v1h-1zM54 54h1v1h-1zM12 56h1v1h-1zM16 56h1v1h-1zM20 56h1v1h-1zM24 56h1v1h-1zM26 56h1v1h-1zM28 56h1v1h-1zM30 56h1v1h-1zM42 56h1v1h-1zM44 56h1v1h-1zM48 56h1v1h-1zM52 56h1v1h-1zM56 56h1v1h-1zM18 58h1v1h-1zM22 58h1v1h-1zM26 58h1v1h-1zM30 58h1v1h-1zM34 58h1v1h-1zM38 58h1v1h-1zM42 58h1v1h-1zM46 58h1v1h-1zM50 58h1v1h-1zM20 60h1v1h-1zM24 60h1v1h-1zM28 60h1v1h-1zM32 60h1v1h-1zM36 60h1v1h-1zM40 60h1v1h-1zM44 60h1v1h-1zM48 60h1v1h-1zM52 60h1v1h-1zM30 62h1v1h-1zM38 62h1v1h-1zM24 64h1v1h-1zM28 64h1v1h-1zM32 64h1v1h-1zM36 64h1v1h-1zM40 64h1v1h-1zM44 64h1v1h-1zM48 64h1v1h-1zM36 68h1v1h-1z";

export const MOON: ReadonlyArray<readonly [fill: string, path: string]> = [
  [
    "#D9DEE8",
    "M34 16h4v1h-4zM30 17h12v1h-12zM27 18h18v1h-18zM25 19h22v1h-22zM25 20h23v1h-23zM26 21h23v1h-23zM26 22h24v1h-24zM27 23h24v1h-24zM27 24h25v1h-25zM28 25h18v1h-18zM48 25h5v1h-5zM28 26h4v1h-4zM38 26h7v1h-7zM49 26h4v1h-4zM28 27h3v1h-3zM39 27h6v1h-6zM49 27h5v1h-5zM29 28h2v1h-2zM39 28h7v1h-7zM48 28h6v1h-6zM29 29h2v1h-2zM39 29h15v1h-15zM29 30h2v1h-2zM41 30h14v1h-14zM29 31h2v1h-2zM42 31h13v1h-13zM29 32h2v1h-2zM42 32h13v1h-13zM29 33h1v1h-1zM42 33h13v1h-13zM29 34h1v1h-1zM42 34h14v1h-14zM29 35h2v1h-2zM35 35h2v1h-2zM41 35h15v1h-15zM29 36h3v1h-3zM34 36h22v1h-22zM29 37h11v1h-11zM44 37h12v1h-12zM29 38h10v1h-10zM45 38h10v1h-10zM29 39h9v1h-9zM46 39h9v1h-9zM29 40h9v1h-9zM46 40h9v1h-9zM29 41h7v1h-7zM46 41h9v1h-9zM29 42h6v1h-6zM46 42h8v1h-8zM29 43h6v1h-6zM47 43h7v1h-7zM28 44h7v1h-7zM47 44h7v1h-7zM28 45h7v1h-7zM41 45h2v1h-2zM47 45h6v1h-6zM28 46h8v1h-8zM40 46h3v1h-3zM47 46h6v1h-6zM27 47h25v1h-25zM27 48h24v1h-24zM26 49h24v1h-24zM26 50h23v1h-23zM25 51h23v1h-23zM25 52h22v1h-22zM27 53h18v1h-18zM30 54h12v1h-12zM34 55h4v1h-4z",
  ],
  [
    "#C3C9D6",
    "M24 20h1v1h-1zM23 21h3v1h-3zM23 22h3v1h-3zM23 23h4v1h-4zM24 24h3v1h-3zM24 25h4v1h-4zM25 26h3v1h-3zM25 27h3v1h-3zM25 28h4v1h-4zM26 29h3v1h-3zM26 30h3v1h-3zM26 31h3v1h-3zM26 32h3v1h-3zM26 33h3v1h-3zM26 34h3v1h-3zM26 35h3v1h-3zM26 36h3v1h-3zM26 37h3v1h-3zM26 38h3v1h-3zM26 39h3v1h-3zM26 40h3v1h-3zM26 41h3v1h-3zM26 42h3v1h-3zM25 43h4v1h-4zM25 44h3v1h-3zM25 45h3v1h-3zM24 46h4v1h-4zM24 47h3v1h-3zM23 48h4v1h-4zM23 49h3v1h-3zM23 50h3v1h-3zM24 51h1v1h-1z",
  ],
  [
    "#23273A",
    "M22 22h1v1h-1zM21 23h2v1h-2zM20 24h4v1h-4zM19 25h5v1h-5zM19 26h6v1h-6zM18 27h7v1h-7zM18 28h7v1h-7zM18 29h8v1h-8zM17 30h9v1h-9zM17 31h9v1h-9zM17 32h9v1h-9zM17 33h9v1h-9zM16 34h10v1h-10zM16 35h10v1h-10zM16 36h10v1h-10zM16 37h10v1h-10zM17 38h9v1h-9zM17 39h9v1h-9zM17 40h9v1h-9zM17 41h9v1h-9zM18 42h8v1h-8zM18 43h7v1h-7zM18 44h7v1h-7zM19 45h6v1h-6zM19 46h5v1h-5zM20 47h4v1h-4zM21 48h2v1h-2zM22 49h1v1h-1z",
  ],
  [
    "#AEB5C4",
    "M46 25h2v1h-2zM32 26h6v1h-6zM45 26h4v1h-4zM31 27h8v1h-8zM45 27h4v1h-4zM31 28h8v1h-8zM46 28h2v1h-2zM31 29h8v1h-8zM31 30h10v1h-10zM31 31h11v1h-11zM31 32h11v1h-11zM30 33h12v1h-12zM30 34h12v1h-12zM31 35h4v1h-4zM37 35h4v1h-4zM32 36h2v1h-2zM40 37h4v1h-4zM39 38h6v1h-6zM38 39h8v1h-8zM38 40h8v1h-8zM36 41h10v1h-10zM35 42h11v1h-11zM35 43h12v1h-12zM35 44h12v1h-12zM35 45h6v1h-6zM43 45h4v1h-4zM36 46h4v1h-4zM43 46h4v1h-4z",
  ],
];
