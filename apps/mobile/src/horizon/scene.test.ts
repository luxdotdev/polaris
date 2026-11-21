import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import {
  FOOT_HEIGHT,
  FOOT_WIDTH,
  footFrame,
  footLayout,
  HILLS,
  HILLS_TOP_ROW,
  HORIZON_HEIGHT,
  previewTop,
} from "./scene.ts";

const SCENES = join(import.meta.dir, "../../../../design/assets/scenes");

const FILES = { midnight: "scene-midnight-foot.png", moonlit: "scene-night-foot.png" } as const;

/** The PNG's compressed image data: its IDAT chunks, joined and inflated. */
const imageData = (file: Buffer): Buffer => {
  const chunks: Buffer[] = [];

  for (let at = 8; at < file.length;) {
    const length = file.readUInt32BE(at);

    if (file.toString("ascii", at + 4, at + 8) === "IDAT")
      chunks.push(file.subarray(at + 8, at + 8 + length));
    at += length + 12;
  }

  return inflateSync(Buffer.concat(chunks));
};

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];

  if (pa <= pb && pa <= pc) return a;

  return pb <= pc ? b : c;
};

/** One RGB row undone from its PNG filter, given the row above. */
const unfilter = (filter: number, raw: Uint8Array, above: Uint8Array): Uint8Array => {
  const row = new Uint8Array(raw.length);

  for (let i = 0; i < raw.length; i += 1) {
    const a = row[i - 3] ?? 0;
    const b = above[i] ?? 0;
    const predictor = [0, a, b, (a + b) >> 1, paeth(a, b, above[i - 3] ?? 0)][filter] ?? 0;

    row[i] = ((raw[i] ?? 0) + predictor) & 0xff;
  }

  return row;
};

/** An 8-bit RGB, non-interlaced PNG (what design/scripts/gen_textures.py writes) as rows of hex. */
const readPng = (path: string) => {
  const file = readFileSync(path);
  const width = file.readUInt32BE(16);
  const data = imageData(file);
  const stride = width * 3;
  const rows: string[][] = [];
  let above: Uint8Array = new Uint8Array(stride);

  expect([file[24], file[25], file[28]]).toEqual([8, 2, 0]);

  for (let at = 0; at < data.length; at += stride + 1) {
    const row = unfilter(data[at] ?? 0, data.subarray(at + 1, at + 1 + stride), above);

    rows.push(
      Array.from({ length: width }, (_, x) =>
        `#${Buffer.from(row.subarray(x * 3, x * 3 + 3)).toString("hex")}`.toUpperCase()
      )
    );
    above = row;
  }

  return { width, rows };
};

describe.each(Object.entries(FILES))("%s's foot scene", (theme, file) => {
  const { width, rows } = readPng(join(SCENES, file));
  const hills = HILLS[theme === "midnight" ? "midnight" : "moonlit"];
  const isHill = (colour: string) => colour === hills.far || colour === hills.near;

  test("is the size the horizon lays out", () => {
    expect([width, rows.length]).toEqual([FOOT_WIDTH, FOOT_HEIGHT]);
  });

  test("its highest hill tops out on HILLS_TOP_ROW, so the horizon's ridge is where it draws", () => {
    const tops = Array.from({ length: width }, (_, x) =>
      rows.findIndex((row) => isHill(row[x] ?? ""))
    );

    expect(Math.min(...tops)).toBe(HILLS_TOP_ROW);
  });

  test("its hills and the sky over them are the colours the widgets draw", () => {
    const count = (colour: string) => rows.flat().filter((c) => c === colour).length;

    // Each is one of the scene's main colours, not a stray pixel.
    expect(Math.min(count(hills.sky), count(hills.far), count(hills.near))).toBeGreaterThan(5000);
    // The foot is the nearest hill, the whole width.
    expect(new Set(rows.at(-1))).toEqual(new Set([hills.near]));
  });
});

describe("footLayout", () => {
  test.each([
    [393, 3],
    [430, 3],
    [320, 2],
    [375, 2],
  ])("at %ipt and %ix every image pixel falls on one device pixel, centred", (width, ratio) => {
    const foot = footLayout(width, ratio);
    const px = (points: number) => Math.round(points * ratio * 1e6) / 1e6;

    expect(foot.scale).toBe(1);
    expect([px(foot.width), px(foot.height)]).toEqual([FOOT_WIDTH, FOOT_HEIGHT]);
    expect(Number.isInteger(px(foot.left))).toBe(true);
    expect(Number.isInteger(px(foot.top))).toBe(true);
    // Its foot on the box's, and as much cut off either side within a pixel.
    expect(foot.top + foot.height).toBeCloseTo(HORIZON_HEIGHT);
    expect(Math.abs(px(-foot.left) - px(foot.width + foot.left - width))).toBeLessThanOrEqual(1);
  });

  test("on a screen wider than the image, its pixels grow by whole device pixels to cover it", () => {
    const foot = footLayout(1000, 3);

    expect(foot.scale).toBe(3);
    expect(foot.left).toBeLessThanOrEqual(0);
    expect(foot.left + foot.width).toBeGreaterThanOrEqual(1000);
  });

  test.each([2, 3])(
    "at %ix the hills stand under the fade, and the fade inside the box",
    (ratio) => {
      const foot = footLayout(393, ratio);
      const hillsTop = foot.top + (HILLS_TOP_ROW * foot.height) / FOOT_HEIGHT;

      expect(foot.ridgeTop).toBeCloseTo(hillsTop);
      expect(foot.fadeTop).toBeGreaterThanOrEqual(0);
      expect(foot.fadeBottom).toBeLessThanOrEqual(foot.ridgeTop);
    }
  );

  test("on a 3x iPhone the scene starts under MX-C's resting last row, 140pt up", () => {
    expect(HORIZON_HEIGHT - footLayout(393, 3).fadeTop).toBeLessThanOrEqual(142);
  });
});

describe("previewTop", () => {
  test("stands the highest hill where asked, on whole device pixels", () => {
    const frame = footFrame(166, 3);
    const top = previewTop(frame, 3, 104, 34);

    expect(Number.isInteger(top * 3)).toBe(true);
    expect(top + HILLS_TOP_ROW / 3).toBeCloseTo(34, 0);
  });

  test("never raises the image so far that its foot leaves the preview's", () => {
    const frame = footFrame(166, 3);

    expect(previewTop(frame, 3, 400, 34) + frame.height).toBe(400);
  });
});
