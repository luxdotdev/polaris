import { type Bytes, malformed } from "./bytes.ts";
import { type RasterMeasure, area, inside, outputBytes, size } from "./measure.ts";

/**
 * PNG and APNG: IHDR first, then every chunk to IEND. Each `fcTL` frame must fit the canvas,
 * and costs a whole canvas; the frame count is the larger of `acTL`'s and the `fcTL`s seen.
 * 16-bit samples decode to half float; an interlaced image also keeps a buffer for its passes.
 */
export const png = (data: Bytes): RasterMeasure => {
  if (data.u32(8) !== 13 || !data.is(12, "IHDR")) return malformed();
  const canvas = size(data.u32(16), data.u32(20));
  let at = 8;
  let declared = 0;
  let controls = 0;
  const pixel = outputBytes(data.u8(24) === 16);
  let decodedBytes = (data.u8(28) === 0 ? pixel : 2 * pixel) * area(canvas);

  while (!data.is(at + 4, "IEND")) {
    const length = data.u32(at);
    const type = data.text(at + 4, 4);
    const body = at + 8;

    data.slice(body, body + length + 4);

    if (type === "acTL")
      declared = Math.max(
        declared,
        length >= 8 && data.u32(body) > 0 ? data.u32(body) : malformed()
      );

    if (type === "fcTL") {
      if (length < 26) return malformed();
      const frame = size(data.u32(body + 4), data.u32(body + 8));

      inside(canvas, data.u32(body + 12), data.u32(body + 16), frame);
      controls++;
      decodedBytes += pixel * area(canvas);
    }

    at = body + length + 4;
  }

  return {
    mimeType: "image/png",
    ...canvas,
    frames: Math.max(1, declared, controls),
    decodedBytes,
    largestPixels: area(canvas),
  };
};
