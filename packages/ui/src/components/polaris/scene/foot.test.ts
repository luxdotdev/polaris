import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const read = (path: string) => readFileSync(new URL(path, import.meta.url));

const design = read("../../../../../../DESIGN.md").toString("utf8");

/** The text set over the foot (gen_textures.py, FOOT_TEXT): body text and Session State words. */
const FOOT_TEXT = [
  "text-strong",
  "text-default",
  "text-subtle",
  "starlight-text",
  "needs-you-text",
  "failed-text",
  "shell-text",
  "accepted-text",
] as const;

const token = (name: string) => {
  const hex = new RegExp(`^\\s+${name}: "(#[0-9A-Fa-f]{6})"`, "m").exec(design)?.[1];

  if (hex === undefined) throw new Error(`DESIGN.md has no ${name}`);

  return hex;
};

const channel = (value: number) => {
  const c = value / 255;

  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const luminance = (r: number, g: number, b: number) =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

const hexLuminance = (hex: string) =>
  luminance(
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16)
  );

const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c;
  const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];

  if (pa <= pb && pa <= pc) return a;

  return pb <= pc ? b : c;
};

const unfilter = (filter: number, raw: number, left: number, up: number, corner: number) => {
  if (filter === 1) return raw + left;

  if (filter === 2) return raw + up;

  if (filter === 3) return raw + Math.floor((left + up) / 2);

  if (filter === 4) return raw + paeth(left, up, corner);

  return raw;
};

/** The image data of a PNG: its IDAT chunks, inflated. */
const imageData = (png: Buffer) => {
  const chunks: Buffer[] = [];

  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at);

    if (png.toString("latin1", at + 4, at + 8) === "IDAT") {
      chunks.push(png.subarray(at + 8, at + 8 + length));
    }

    at += length + 12;
  }

  return inflateSync(Buffer.concat(chunks));
};

/** One scanline unfiltered into `rows`, given the line above it. */
const unfilterRow = (data: Buffer, rows: Uint8Array, y: number, stride: number) => {
  const filter = data[y * (stride + 1)] ?? 0;

  for (let x = 0; x < stride; x++) {
    const raw = data[y * (stride + 1) + 1 + x] ?? 0;
    const left = x >= 3 ? (rows[y * stride + x - 3] ?? 0) : 0;
    const up = y > 0 ? (rows[(y - 1) * stride + x] ?? 0) : 0;
    const corner = x >= 3 && y > 0 ? (rows[(y - 1) * stride + x - 3] ?? 0) : 0;

    rows[y * stride + x] = unfilter(filter, raw, left, up, corner) & 0xff;
  }
};

/** The distinct colours of an 8-bit RGB, non-interlaced PNG (what gen_textures.py writes). */
const colours = (png: Buffer): ReadonlySet<number> => {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);

  if (png[24] !== 8 || png[25] !== 2 || png[28] !== 0) throw new Error("not 8-bit RGB");
  const data = imageData(png);
  const stride = width * 3;
  const rows = new Uint8Array(stride * height);

  for (let y = 0; y < height; y++) unfilterRow(data, rows, y, stride);
  const found = new Set<number>();

  for (let i = 0; i < rows.length; i += 3) {
    found.add(((rows[i] ?? 0) << 16) | ((rows[i + 1] ?? 0) << 8) | (rows[i + 2] ?? 0));
  }

  return found;
};

describe.each([
  ["night", "dark"],
  ["midnight", "dark"],
  ["dawn", "light"],
] as const)("the %s foot", (scene, theme) => {
  test(`keeps 4.5:1 for ${theme} text on every pixel (rule/scene-text-contrast)`, () => {
    const text = FOOT_TEXT.map((name) => hexLuminance(token(`${name}-${theme}`)));

    const failing = [
      ...colours(read(`../../../../../../design/assets/scenes/scene-${scene}-foot.png`)),
    ].flatMap((rgb) => {
      const ground = luminance(rgb >> 16, (rgb >> 8) & 0xff, rgb & 0xff);

      const fails = text.some(
        (t) => (Math.max(ground, t) + 0.05) / (Math.min(ground, t) + 0.05) < 4.5
      );

      return fails ? [`#${rgb.toString(16).padStart(6, "0")}`] : [];
    });

    expect(failing).toEqual([]);
  });
});
