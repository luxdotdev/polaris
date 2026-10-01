import { describe, expect, test } from "bun:test";
import { imageSize } from "./imageSize.ts";
import { bytes, PNG_1200x800, tag, u16le, u24le, zeros } from "./imageSize.testing.ts";

const riff = (kind: string) => [...tag("RIFF"), 0, 0, 0, 0, ...tag("WEBP"), ...tag(kind)];

describe("imageSize", () => {
  test("PNG", () => {
    expect(imageSize(PNG_1200x800)).toEqual({ width: 1200, height: 800 });
  });

  test("GIF", () => {
    expect(imageSize(bytes(tag("GIF89a"), u16le(64), u16le(32)))).toEqual({
      width: 64,
      height: 32,
    });
  });

  test("JPEG skips segments before its frame", () => {
    const app0 = [0xff, 0xe0, 0, 6, 1, 2, 3, 4];
    const sof0 = [0xff, 0xc0, 0, 17, 8, 3, 0x20, 2, 0x80, 3];

    expect(imageSize(bytes([0xff, 0xd8], app0, sof0, zeros(10)))).toEqual({
      width: 640,
      height: 800,
    });
  });

  test("WebP, extended and lossless", () => {
    const vp8x = bytes(riff("VP8X"), [10, 0, 0, 0], zeros(4), u24le(1919), u24le(1079));

    expect(imageSize(vp8x)).toEqual({ width: 1920, height: 1080 });

    const bits = 99 | (49 << 14);
    const vp8l = bytes(riff("VP8L"), [5, 0, 0, 0, 0x2f], u24le(bits), [bits >>> 24], zeros(8));

    expect(imageSize(vp8l)).toEqual({ width: 100, height: 50 });
  });

  test("anything else, or a truncated header, is null", () => {
    expect(imageSize(bytes(tag("%PDF-1.7")))).toBeNull();
    expect(imageSize(PNG_1200x800.slice(0, 20))).toBeNull();
    expect(imageSize(bytes([0xff, 0xd8, 0xff, 0xe0, 0, 200]))).toBeNull();
  });
});
