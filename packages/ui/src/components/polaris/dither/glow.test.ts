import { describe, expect, test } from "bun:test";

import {
  BLOOM_MS,
  bloomAt,
  cornerValue,
  type FieldFrame,
  HUE_ALPHA,
  hueAlpha,
  onLattice,
  packPixel,
  paintFrame,
  RESTING,
  sparseAlpha,
  STILL,
  Trail,
} from "./glow";

const hovered = (x: number, y: number): FieldFrame => ({
  ...STILL,
  pointer: { x, y },
  presence: 1,
});

describe("the Working strip's dither field", () => {
  test("at rest, fine dots crowd the top-left and are gone by 150px right or 46px down", () => {
    expect(hueAlpha(1, 1, STILL)).toBeGreaterThan(0.15);
    expect(hueAlpha(1, 1, STILL)).toBeLessThanOrEqual(HUE_ALPHA * RESTING.gain);
    expect(cornerValue(150, 2, 1)).toBe(0);
    expect(cornerValue(2, 46, 1)).toBe(0);
  });

  test("the fringe thins by dropping dots, not only by fading them", () => {
    let lit = 0;

    for (let i = 50; i < 58; i++) for (let j = 0; j < 4; j++) if (hueAlpha(i, j, STILL) > 0) lit++;

    expect(lit).toBeGreaterThan(0);
    expect(lit).toBeLessThan(32);
  });

  test("a bloom floods the corner, reaches further, then settles to rest", () => {
    expect(bloomAt(0).gain).toBe(0);
    expect(bloomAt(400).gain).toBeCloseTo(1);
    expect(bloomAt(400).spread).toBeCloseTo(1.3);
    expect(bloomAt(BLOOM_MS)).toEqual(RESTING);
  });

  test("sparse dots sit on a staggered 8×4px lattice", () => {
    expect([onLattice(0, 0), onLattice(8, 0), onLattice(4, 4), onLattice(12, 4)]).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect([onLattice(4, 0), onLattice(0, 4), onLattice(2, 2), onLattice(0, 2)]).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  test("sparse dots show within 22px of the pointer, brightest at its centre", () => {
    const frame = hovered(200, 16);

    expect(sparseAlpha(200, 16, frame)).toBeGreaterThan(0.9);
    expect(sparseAlpha(216, 16, frame)).toBeLessThan(sparseAlpha(200, 16, frame));
    expect(sparseAlpha(232, 16, frame)).toBe(0);
    expect(sparseAlpha(200, 16, { ...frame, presence: 0 })).toBe(0);
  });

  test("the trail lingers behind the pointer and dies away once it rests", () => {
    const trail = new Trail(150, 17);

    expect(trail.update(16, 100, 16, 1)).toBe(true);
    expect(trail.values[8 * 150 + 50]).toBeCloseTo(0.7);
    trail.update(16, 200, 16, 1);
    expect(trail.values[8 * 150 + 50] ?? 0).toBeGreaterThan(0.6);

    let moving = true;
    let frames = 0;

    while (moving && frames < 400) {
      moving = trail.update(16, 200, 16, 1);
      frames++;
    }

    expect(frames).toBeLessThan(400);
    expect(trail.values[8 * 150 + 50]).toBe(0);
  });

  test("a wash tints the gaps between dots, fainter than the dots", () => {
    const width = 8;
    const pixels = new Uint32Array(width * 8);

    const colors = {
      hue: [0, 200, 100],
      sparse: [240, 240, 240],
      hueAlpha: 0.4,
      washAlpha: 0.1,
    } as const;

    paintFrame({ pixels, width, height: 8 }, colors, STILL);

    expect((pixels[1] ?? 0) >>> 24).toBeGreaterThan(0);
    expect((pixels[1] ?? 0) >>> 24).toBeLessThan((pixels[0] ?? 0) >>> 24);
  });

  test("with no wash a frame paints only dot positions, sparse over hue", () => {
    const width = 40;
    const pixels = new Uint32Array(width * 20);

    const colors = {
      hue: [0, 200, 100],
      sparse: [240, 240, 240],
      hueAlpha: HUE_ALPHA,
      washAlpha: 0,
    } as const;

    paintFrame({ pixels, width, height: 20 }, colors, hovered(8, 8));

    expect(pixels[1]).toBe(0);
    expect(pixels[width]).toBe(0);
    expect(pixels[8 * width + 8]).toBe(packPixel(colors.sparse, sparseAlpha(8, 8, hovered(8, 8))));
    expect((pixels[2] ?? 0) & 0xffffff).toBe(0x64c800);
  });
});
