import { describe, expect, test } from "bun:test";
import { rasterView } from "../media.ts";
import { ascii, av1, avif, be32, box, grid, ispe, still } from "./fixtures.testing.ts";
import { measureRaster } from "./index.ts";

const MAX = 10 * 1024 * 1024;

const huge = ispe(60000, 60000);

describe("AVIF", () => {
  test("reads a still's size, and a grid's from its output and tiles", () => {
    expect(measureRaster(avif([still(640, 480)]))).toMatchObject({
      mimeType: "image/avif",
      width: 640,
      height: 480,
    });

    const tiled = avif([
      { type: "grid", ispe: { width: 128, height: 64 }, data: grid(128, 64) },
      still(64, 64),
      still(64, 64),
    ]);

    expect(measureRaster(tiled)).toMatchObject({
      width: 128,
      height: 64,
      decodedPixels: 2 * 128 * 64,
    });
  });

  test.each([
    [
      "a malformed box hides a later ispe",
      avif([still(64, 64)], { properties: [...be32(4), ...ascii("free"), ...huge] }),
    ],
    [
      "a size-0 box swallows a later ispe",
      avif([still(64, 64)], { properties: [...be32(0), ...ascii("free"), ...huge] }),
    ],
    [
      "a box runs past the end of the file",
      avif([still(64, 64)], { after: [...be32(1000), ...ascii("free")] }),
    ],
    [
      "a second meta declares a huge item",
      avif([still(64, 64)], { after: box("meta", [0, 0, 0, 0], box("iprp", box("ipco", huge))) }),
    ],
    [
      "an ispe too short to hold its height",
      avif([still(64, 64)], { properties: box("ispe", [0, 0, 0, 0], be32(60000)) }),
    ],
    ["a grid item has no ispe", avif([{ type: "grid", data: grid(60000, 60000) }, still(64, 64)])],
    [
      "a grid's output is larger than its ispe",
      avif([
        { type: "grid", ispe: { width: 64, height: 64 }, data: grid(60000, 60000) },
        still(64, 64),
      ]),
    ],
    [
      "it is a sequence, sized by tracks",
      avif([still(64, 64)], { after: box("moov", box("mvhd", [0, 0, 0, 0])) }),
    ],
  ] as const)("refuses when %s", (_, data) => {
    expect(measureRaster(data)).toBeNull();
    expect(() => rasterView(data, MAX)).toThrow("invalid-input");
  });

  test("an AV1 bitstream larger than its ispe is measured by the bitstream", () => {
    const data = avif([still(64, 64, av1(8000, 8000))]);

    expect(measureRaster(data)).toMatchObject({ width: 8000, height: 8000 });
    expect(() => rasterView(data, MAX)).toThrow("too-large");
  });

  test("a full sequence header may override its frame size, so its field widths bound it", () => {
    expect(measureRaster(avif([still(640, 480, av1(640, 480, false))]))).toMatchObject({
      width: 1024,
      height: 512,
    });
    expect(() => rasterView(avif([still(6000, 4000, av1(6000, 4000, false))]), MAX)).toThrow(
      "too-large"
    );
  });
});
