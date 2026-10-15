import { describe, expect, test } from "bun:test";
import { rasterView } from "../../main/languages/media.ts";
import {
  type Av1Color,
  acTL,
  anmf,
  animation,
  av1,
  avif,
  bytes,
  fcTL,
  gif,
  jpeg,
  png,
  pngWith,
  segment,
  sof,
  sos,
  vp8,
  vp8l,
  vp8x,
  webp,
} from "./fixtures.testing.ts";

const MAX = 10 * 1024 * 1024;

const CMYK = [0x11, 0x11, 0x11, 0x11];

/** A CMYK photo at the canvas cap, which libjpeg buffers whole when read in several scans. */
const photo = (marker: number, sampling = CMYK, scan = sampling.length) =>
  jpeg(sof(6000, 4000, marker, sampling), sos(scan));

/** The same photo again as a gain map after the primary image, where MPF points to it. */
const withGainMap = (primary: Uint8Array) => bytes([...primary], [...photo(0xc0)]);

const passes = (data: Uint8Array) => expect(rasterView(data, MAX).bytes).toBe(data.length);

const refused = (data: Uint8Array) => expect(() => rasterView(data, MAX)).toThrow("too-large");

describe("JPEG decode cost", () => {
  test("a frame with more components than Blink decodes is refused", () => {
    expect(() => rasterView(jpeg(sof(64, 64, 0xc0, [0x11, 0x11, 0x11, 0x11, 0x11])), MAX)).toThrow(
      "invalid-input"
    );
  });

  test("a progressive frame costs its coefficient buffer, a baseline one doesn't", () => {
    passes(withGainMap(photo(0xc0)));
    refused(withGainMap(photo(0xc2)));
  });

  test.each([
    ["SOF6", 0xc6],
    ["SOF10", 0xca],
    ["SOF14", 0xce],
  ] as const)("%s is buffered like SOF2", (_, marker) => {
    refused(withGainMap(photo(marker)));
  });

  test("a sequential frame whose first scan leaves components out is buffered", () => {
    refused(withGainMap(photo(0xc0, CMYK, 1)));
  });

  test("subsampled components cost their own, smaller, coefficient buffers", () => {
    passes(withGainMap(photo(0xc2, [0x22, 0x11, 0x11, 0x11])));
    refused(withGainMap(photo(0xc2, [0x22, 0x22, 0x22, 0x22])));
  });

  test("a gain map is costed with the primary image", () => {
    passes(photo(0xc2));
    refused(withGainMap(photo(0xc2)));
  });

  test("a gain map inside a segment, where MPF can also point, is costed", () => {
    refused(jpeg(segment(0xe2, [...photo(0xc0)]), sof(6000, 4000, 0xc2, CMYK), sos(4)));
  });

  test("an embedded JPEG libjpeg would stop reading before its frame costs nothing", () => {
    const unreadable = bytes([0xff, 0xd8], [...sos(4)], [...sof(6000, 4000, 0xc0, CMYK)]);

    passes(bytes([...photo(0xc2)], [...unreadable]));
    refused(bytes([...photo(0xc2)], [...photo(0xc0)]));
  });

  test("a gain map larger than the canvas cap is refused, though its bytes fit the budget", () => {
    const small = jpeg(sof(64, 64), sos(1));

    passes(bytes([...small], [...jpeg(sof(6000, 4000), sos(1))]));
    refused(bytes([...small], [...jpeg(sof(7000, 4000), sos(1))]));
  });

  test("the view carries the decode cost, not the pixel count, for the renderer's budget", () => {
    const view = rasterView(photo(0xc2), MAX);

    expect(view.decodedBytes).toBeGreaterThan(4 * 6000 * 4000 * 2);
  });

  test("a chain of embedded SOIs that would make the walk quadratic is refused, quickly", () => {
    const chain = Array.from({ length: 150_000 }, () => [0xff, 0xe1, 0, 4, 0xff, 0xd8]).flat();

    expect(() => rasterView(jpeg(chain, sof(64, 64)), MAX)).toThrow("invalid-input");
  });
});

describe("PNG decode cost", () => {
  const animation16 = (depth: 8 | 16, interlaced: boolean) =>
    pngWith(
      { depth, interlaced },
      4000,
      4000,
      acTL(7),
      ...Array.from({ length: 7 }, () => fcTL({ width: 4000, height: 4000 }))
    );

  test("16-bit samples decode to half float, twice the bytes", () => {
    passes(animation16(8, false));
    refused(animation16(16, false));
  });

  test("an interlaced image also keeps a buffer for its passes", () => {
    refused(animation16(8, true));
  });
});

describe("WebP decode cost", () => {
  const frames = (image: typeof vp8) =>
    webp(
      vp8x(4000, 4000, true),
      animation(),
      ...Array.from({ length: 8 }, () => anmf({ width: 4000, height: 4000 }, image(4000, 4000)))
    );

  test("a lossless frame also costs its ARGB working image", () => {
    passes(frames(vp8));
    refused(frames(vp8l));
  });
});

describe("AVIF decode cost", () => {
  const items = (count: number, color: Av1Color, gainMap = false) =>
    avif([
      ...Array.from({ length: count }, () => ({
        type: "av01" as const,
        ispe: { width: 6000, height: 4000 },
        data: av1(6000, 4000, true, color),
      })),
      ...(gainMap ? [{ type: "tmap" as const, data: [0] }] : []),
    ]);

  test.each([
    ["10-bit", { depth: 10 }],
    ["4:4:4", { layout: "444" }],
    ["12-bit 4:4:4", { depth: 12, layout: "444" }],
  ] as const)("a %s picture costs more than an 8-bit 4:2:0 one", (_, color) => {
    passes(items(7, { depth: 8, layout: "420" }));
    refused(items(7, color));
  });

  test("a gain map (tmap) is decoded to its own output beside the primary image", () => {
    passes(items(2, { depth: 10, layout: "444" }));
    refused(items(2, { depth: 10, layout: "444" }, true));
  });
});

describe("an animation frame costs the whole canvas, as Blink allocates it", () => {
  const tiny = (count: number) => Array.from({ length: count }, () => ({ width: 1, height: 1 }));

  test("a GIF whose one frame is a pixel on a large screen costs the screen", () => {
    expect(rasterView(gif(4898, 4898, tiny(1)), MAX).decodedBytes).toBe(4 * 4898 * 4898);
  });

  test.each([
    ["GIF", gif(4000, 4000, tiny(9))],
    ["APNG", png(4000, 4000, acTL(9), ...tiny(9).map((frame) => fcTL(frame)))],
    ["WebP", webp(vp8x(4000, 4000, true), animation(), ...tiny(9).map((frame) => anmf(frame)))],
  ] as const)("an animated %s of tiny frames over the budget is refused", (_, data) => {
    refused(data);
  });
});

describe("JPEG precision", () => {
  /** A frame header with its sample precision set to `bits`. */
  const precision = (bits: number) => {
    const header = sof(64, 64);

    header[4] = bits;

    return header;
  };

  test.each([
    ["SOF3", 0xc3],
    ["SOF7", 0xc7],
    ["SOF11", 0xcb],
    ["SOF15", 0xcf],
  ] as const)("a lossless %s frame is refused", (_, marker) => {
    expect(() => rasterView(jpeg(sof(64, 64, marker)), MAX)).toThrow("invalid-input");
  });

  test.each([12, 16])("a %i-bit frame is refused", (bits) => {
    expect(() => rasterView(jpeg(precision(bits)), MAX)).toThrow("invalid-input");
  });

  test("an 8-bit frame passes", () => {
    passes(jpeg(precision(8)));
  });
});
