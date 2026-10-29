/**
 * The sidebar row's wave bar (Paper X-H, compact): one segment per dependency wave, split by
 * its Tasks' states in a fixed order, so the same graph reads the same way every time.
 */
import type { HarnessKind } from "@polaris/protocol";
import type { Segment, StripTone } from "./strip.ts";

export interface WavePart {
  readonly tone: StripTone;
  readonly harness: HarnessKind | null;
  readonly count: number;
  /** Whole px. */
  readonly width: number;
}

export interface WaveSegment {
  readonly wave: number;
  readonly width: number;
  readonly parts: ReadonlyArray<WavePart>;
}

/** A wave's segment at most, the whole bar at most, and the gaps (Paper X-H: 24, 3, 1). */
export const WAVE_BAR = { segment: 24, budget: 108, gap: 3, partGap: 1, minPart: 2 } as const;

const ORDER: ReadonlyArray<StripTone> = [
  "accepted",
  "review",
  "failed",
  "working",
  "needs-you",
  "blocked",
  "waiting",
];

/** Splits `width` between counts, whole px, each at least `min`, largest remainders first. */
const share = (counts: ReadonlyArray<number>, width: number, min: number) => {
  const total = counts.reduce((a, b) => a + b, 0);
  const spare = Math.max(0, width - min * counts.length);
  const exact = counts.map((c) => (spare * c) / total);
  const out = exact.map((e) => min + Math.floor(e));
  let left = width - out.reduce((a, b) => a + b, 0);

  const byRemainder = exact
    .map((e, n) => [e - Math.floor(e), n] as const)
    .toSorted((a, b) => b[0] - a[0] || a[1] - b[1]);

  for (const [, n] of byRemainder) {
    if (left <= 0) break;
    out[n] = (out[n] ?? 0) + 1;
    left -= 1;
  }

  return out;
};

const partsOf = (segments: ReadonlyArray<Segment>) => {
  const parts: Array<{ tone: StripTone; harness: HarnessKind | null; count: number }> = [];

  for (const tone of ORDER) {
    const inTone = segments.filter((s) => s.tone === tone);
    const harnesses = [...new Set(inTone.map((s) => (tone === "working" ? s.harness : null)))];

    for (const harness of harnesses) {
      const count = inTone.filter((s) => tone !== "working" || s.harness === harness).length;

      parts.push({ tone, harness, count });
    }
  }

  return parts;
};

/** Each wave's segment: as wide as the budget allows, at least wide enough for its parts. */
export const waveBar = (
  segments: ReadonlyArray<Segment>,
  waveOf: ReadonlyMap<string, number>
): ReadonlyArray<WaveSegment> => {
  const byWave = new Map<number, Array<Segment>>();

  for (const s of segments) {
    const wave = waveOf.get(s.key) ?? 1;

    byWave.set(wave, [...(byWave.get(wave) ?? []), s]);
  }

  const waves = [...byWave.keys()].sort((a, b) => a - b);

  if (waves.length === 0) return [];
  const room = Math.floor((WAVE_BAR.budget - WAVE_BAR.gap * (waves.length - 1)) / waves.length);
  const each = Math.min(WAVE_BAR.segment, room);

  return waves.map((wave) => {
    const parts = partsOf(byWave.get(wave) ?? []);
    const least = parts.length * (WAVE_BAR.minPart + WAVE_BAR.partGap) - WAVE_BAR.partGap;
    const width = Math.max(each, least);

    const widths = share(
      parts.map((p) => p.count),
      width - WAVE_BAR.partGap * (parts.length - 1),
      WAVE_BAR.minPart
    );

    return { wave, width, parts: parts.map((p, n) => ({ ...p, width: widths[n] ?? 0 })) };
  });
};
