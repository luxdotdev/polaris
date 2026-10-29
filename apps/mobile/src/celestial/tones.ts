/**
 * A celestial's four tones in a hue, as @polaris/ui's celestial.css mixes them: CSS
 * `color-mix(in oklab, hue N%, white|black)`, computed here because React Native has no color-mix.
 */
import { type HarnessKind, harnessEntry } from "@polaris/protocol";
import type { Tone } from "@polaris/ui/celestial";
import type { MobileColours } from "../theme";

export type CelestialPalette = Readonly<Record<Tone, string>>;

/** celestial.css's mixes: the hue's share, and what makes up the rest. */
export const TONE_MIX: Readonly<
  Record<Tone, { readonly hue: number; readonly with: "white" | "black" }>
> = {
  light: { hue: 0.62, with: "white" },
  hue: { hue: 1, with: "white" },
  shade: { hue: 0.62, with: "black" },
  glint: { hue: 0.22, with: "white" },
};

type Vec = readonly [number, number, number];

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

const fromLinear = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

const parseHex = (hex: string): Vec => {
  const n = Number.parseInt(hex.slice(1, 7), 16);

  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

const toOklab = ([r, g, b]: Vec): Vec => {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};

const fromOklab = ([L, a, b]: Vec): Vec => {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
};

const toHex = (rgb: Vec): string =>
  `#${rgb
    .map((c) =>
      Math.round(Math.min(1, Math.max(0, c)) * 255)
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`;

/** CSS `color-mix(in oklab, a share%, b)` for sRGB hex colours. */
export const mixOklab = (a: string, share: number, b: string): string => {
  const [x, y] = [toOklab(parseHex(a)), toOklab(parseHex(b))];

  const at = (i: 0 | 1 | 2) => x[i] * share + y[i] * (1 - share);

  return toHex(fromOklab([at(0), at(1), at(2)]));
};

const palettes = new Map<string, CelestialPalette>();

/** The four tones of a hue (`#rrggbb`), cached per hue. */
export const celestialPalette = (hue: string): CelestialPalette => {
  const hit = palettes.get(hue);

  if (hit !== undefined) return hit;

  const mix = (tone: Tone) => {
    const { hue: share, with: other } = TONE_MIX[tone];

    return share === 1 ? hue : mixOklab(hue, share, other === "white" ? "#ffffff" : "#000000");
  };

  const palette = {
    light: mix("light"),
    hue: mix("hue"),
    shade: mix("shade"),
    glint: mix("glint"),
  };

  palettes.set(hue, palette);

  return palette;
};

/** "Claude Code" → "harnessClaudeCode": @polaris/ui's token name for a catalogue Harness's hue. */
const tokenOf = (name: string) =>
  `harness${name
    .split(/[^a-zA-Z0-9]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("")}`;

/** A Harness's hue in a theme, as `hueVar` picks it; an unknown or unhued Harness is neutral. */
export const harnessColour = (colours: MobileColours, harness: HarnessKind): string => {
  const entry = harnessEntry(harness);

  const hue =
    entry === undefined || entry.hued === false
      ? undefined
      : new Map<string, string>(Object.entries(colours)).get(tokenOf(entry.name));

  return hue ?? colours.textSubtle;
};
