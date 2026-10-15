import { describe, expect, test } from "bun:test";
import { rasterView } from "../media.ts";
import {
  acTL,
  anmf,
  animation,
  bytes,
  exifThumbnail,
  fcTL,
  gif,
  jpeg,
  png,
  sof,
  vp8,
  vp8l,
  vp8x,
  webp,
} from "./fixtures.testing.ts";
import { measureRaster } from "./index.ts";

const MAX = 10 * 1024 * 1024;

const frames = (count: number, width: number, height: number) =>
  Array.from({ length: count }, () => ({ width, height }));

describe("measureRaster", () => {
  test.each([
    ["image/png", png(640, 480)],
    ["image/gif", gif(640, 480)],
    ["image/jpeg", jpeg(sof(640, 480, 0xc2))],
    ["image/webp", webp(vp8x(640, 480), vp8l(640, 480))],
    ["image/webp", webp(vp8l(640, 480))],
    ["image/webp", webp(vp8(640, 480))],
  ] as const)("reads a still %s's size from its header", (mimeType, data) => {
    expect(measureRaster(data)).toEqual({
      mimeType,
      width: 640,
      height: 480,
      frames: 1,
      decodedPixels: 640 * 480,
    });
  });

  test.each([
    [
      "GIF",
      gif(100, 100, [
        { width: 100, height: 100 },
        { x: 50, y: 50, width: 50, height: 50 },
      ]),
    ],
    [
      "APNG",
      png(
        100,
        100,
        acTL(2),
        fcTL({ width: 100, height: 100 }),
        fcTL({ x: 50, y: 50, width: 50, height: 50 })
      ),
    ],
    [
      "animated WebP",
      webp(
        vp8x(100, 100, true),
        animation(),
        anmf({ width: 100, height: 100 }),
        anmf({ x: 50, y: 50, width: 50, height: 50 })
      ),
    ],
  ] as const)("an animated %s counts every frame it decodes", (_, data) => {
    expect(measureRaster(data)).toMatchObject({ width: 100, height: 100, frames: 2 });
    expect(measureRaster(data)?.decodedPixels).toBeGreaterThanOrEqual(100 * 100 + 50 * 50);
  });

  test("an EXIF thumbnail's own SOF doesn't stand in for the image's", () => {
    expect(measureRaster(jpeg(exifThumbnail(64, 64), sof(5000, 4000)))).toMatchObject({
      width: 5000,
      height: 4000,
    });
  });
});

describe("rasterView refuses what Chromium would decode larger than the header says", () => {
  test.each([
    [
      "a GIF frame larger than its logical screen",
      gif(16, 16, [
        { width: 16, height: 16 },
        { width: 60000, height: 60000 },
      ]),
    ],
    [
      "a GIF frame placed off its logical screen",
      gif(16, 16, [{ x: 60000, y: 0, width: 16, height: 16 }]),
    ],
    ["an APNG frame larger than IHDR", png(16, 16, acTL(1), fcTL({ width: 60000, height: 60000 }))],
    ["a JPEG with a second, larger SOF", jpeg(sof(64, 64), sof(60000, 60000))],
    [
      "a WebP still whose bitstream is larger than its VP8X canvas",
      webp(vp8x(16, 16), vp8l(8000, 8000)),
    ],
    [
      "an animated WebP frame outside its canvas",
      webp(vp8x(16, 16, true), animation(), anmf({ width: 8000, height: 8000 })),
    ],
    [
      "an animated WebP frame whose bitstream is larger than its ANMF header",
      webp(vp8x(16, 16, true), animation(), anmf({ width: 16, height: 16 }, vp8l(8000, 8000))),
    ],
  ] as const)("%s", (_, data) => {
    expect(() => rasterView(data, MAX)).toThrow("invalid-input");
  });

  test.each([
    ["GIF", gif(16, 16, frames(257, 16, 16))],
    ["APNG", png(16, 16, acTL(100_000), fcTL({ width: 16, height: 16 }))],
    [
      "animated WebP",
      webp(vp8x(16, 16, true), animation(), ...frames(257, 16, 16).map((frame) => anmf(frame))),
    ],
  ] as const)("an animated %s over the frame cap is refused", (_, data) => {
    expect(() => rasterView(data, MAX)).toThrow("too-large");
  });

  test("small frames can't add up past the decode budget", () => {
    expect(() => rasterView(gif(4000, 4000, frames(9, 4000, 4000)), MAX)).toThrow("too-large");
  });

  test("a small file declaring a huge canvas is refused", () => {
    expect(() => rasterView(png(30000, 30000), 1024)).toThrow("too-large");
    expect(() => rasterView(gif(65535, 65535), 1024)).toThrow("too-large");
    expect(() => rasterView(jpeg(sof(20000, 20000)), 1024)).toThrow("too-large");
  });

  test("no request or policy can raise the byte cap past 10 MiB", () => {
    const padded = bytes(
      [...png(16, 16)],
      Array.from({ length: MAX }, () => 0)
    );

    expect(() => rasterView(padded, 2 * MAX)).toThrow("too-large");
  });

  test("an unreadable header is refused, not decoded", () => {
    expect(() => rasterView(bytes([137, 80, 78, 71, 13, 10, 26, 10, 0]), 1024)).toThrow(
      "invalid-input"
    );
    expect(() => rasterView(gif(16, 16).subarray(0, 30), 1024)).toThrow("invalid-input");
  });

  test("a photo-sized image passes with its pixel count; an animation holds two frames", () => {
    expect(rasterView(jpeg(sof(6000, 4000)), 1024)).toMatchObject({
      mimeType: "image/jpeg",
      pixels: 24_000_000,
    });
    expect(rasterView(gif(100, 100, frames(3, 100, 100)), MAX).pixels).toBe(20_000);
  });
});
