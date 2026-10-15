import { describe, expect, test } from "bun:test";
import { rasterView } from "./media.ts";
import { rasterSize } from "./rasterSize.ts";

const ascii = (text: string) => Array.from(text, (char) => char.charCodeAt(0));

const zeros = (length: number) => Array.from({ length }, () => 0);

const bytes = (...parts: ReadonlyArray<ReadonlyArray<number>>) => new Uint8Array(parts.flat());

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

const be16 = (n: number) => [(n >>> 8) & 255, n & 255];

const le16 = (n: number) => [n & 255, (n >>> 8) & 255];

const le24 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];

const png = (width: number, height: number) =>
  bytes(
    [137, 80, 78, 71, 13, 10, 26, 10],
    be32(13),
    ascii("IHDR"),
    be32(width),
    be32(height),
    [8, 6, 0, 0, 0]
  );

const gif = (width: number, height: number) =>
  bytes(ascii("GIF89a"), le16(width), le16(height), [0, 0, 0]);

const jpeg = (width: number, height: number) =>
  bytes(
    [0xff, 0xd8],
    [0xff, 0xe0],
    be16(16),
    ascii("JFIF"),
    [0, 1, 1, 0, 0, 1, 0, 1, 0, 0],
    [0xff, 0xc2],
    be16(17),
    [8],
    be16(height),
    be16(width),
    [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]
  );

const riff = (chunk: string, payload: ReadonlyArray<number>) =>
  bytes(ascii("RIFF"), [0, 0, 0, 0], ascii("WEBP"), ascii(chunk), [0, 0, 0, 0], payload, zeros(16));

const box = (type: string, ...body: ReadonlyArray<ReadonlyArray<number>>) => {
  const inner = body.flat();

  return [...be32(8 + inner.length), ...ascii(type), ...inner];
};

const avif = (...extents: ReadonlyArray<readonly [number, number]>) =>
  new Uint8Array([
    ...box("ftyp", ascii("avif"), [0, 0, 0, 0], ascii("mif1")),
    ...box(
      "meta",
      [0, 0, 0, 0],
      box("hdlr", zeros(24)),
      box(
        "iprp",
        box("ipco", ...extents.map(([w, h]) => box("ispe", [0, 0, 0, 0], be32(w), be32(h))))
      )
    ),
  ]);

describe("rasterSize", () => {
  test.each([
    ["image/png", png(640, 480)],
    ["image/gif", gif(640, 480)],
    ["image/jpeg", jpeg(640, 480)],
    ["image/webp", riff("VP8X", [0, 0, 0, 0, ...le24(639), ...le24(479)])],
    [
      "image/webp",
      riff("VP8L", [
        0x2f,
        639 & 0xff,
        ((639 >> 8) & 0x3f) | ((479 & 0x3) << 6),
        (479 >> 2) & 0xff,
        (479 >> 10) & 0xf,
      ]),
    ],
    ["image/webp", riff("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(640), ...le16(480)])],
    ["image/avif", avif([640, 480])],
  ] as const)("reads %s dimensions from the header", (mimeType, data) => {
    expect(rasterSize(mimeType, data)).toEqual({ width: 640, height: 480 });
  });

  test("an AVIF counts its largest item, so a small primary can't hide a huge grid", () => {
    expect(rasterSize("image/avif", avif([64, 64], [60000, 60000]))).toEqual({
      width: 60000,
      height: 60000,
    });
  });

  test("a header that can't be read gives no size", () => {
    expect(rasterSize("image/png", bytes([137, 80, 78, 71, 13, 10, 26, 10, 0]))).toBeNull();
    expect(rasterSize("image/jpeg", bytes([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeNull();
    expect(rasterSize("image/avif", avif())).toBeNull();
    expect(rasterSize("image/png", png(0, 480))).toBeNull();
  });
});

describe("rasterView", () => {
  test("a small file declaring a huge canvas is refused before it reaches the renderer", () => {
    expect(() => rasterView(png(30000, 30000), 1024)).toThrow("too-large");
    expect(() => rasterView(gif(65535, 65535), 1024)).toThrow("too-large");
    expect(() => rasterView(jpeg(20000, 20000), 1024)).toThrow("too-large");
  });

  test("an unreadable header is refused, not decoded", () => {
    expect(() => rasterView(bytes([137, 80, 78, 71, 13, 10, 26, 10, 0]), 1024)).toThrow(
      "invalid-input"
    );
  });

  test("a photo-sized image passes with its pixel count", () => {
    expect(rasterView(jpeg(6000, 4000), 1024)).toMatchObject({
      mimeType: "image/jpeg",
      pixels: 24_000_000,
    });
  });
});
