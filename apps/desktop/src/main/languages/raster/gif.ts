import { type Bytes, malformed } from "./bytes.ts";
import { type RasterMeasure, area, inside, outputBytes, size } from "./measure.ts";

const colorTable = (flags: number) => (flags & 0x80 ? 3 * 2 ** ((flags & 7) + 1) : 0);

/** Skips a run of data sub-blocks, ending at the zero-length terminator. */
const subBlocks = (data: Bytes, from: number): number => {
  let at = from;

  for (let length = data.u8(at); length !== 0; length = data.u8(at)) at += 1 + length;

  return at + 1;
};

/**
 * Every image descriptor to the trailer: each frame must fit the logical screen, since a
 * decoder may grow the canvas to a first frame that doesn't.
 */
export const gif = (data: Bytes): RasterMeasure => {
  const screen = size(data.u16le(6), data.u16le(8));
  let at = 13 + colorTable(data.u8(10));
  let frames = 0;
  let decodedBytes = 0;

  for (let block = data.u8(at); block !== 0x3b; block = data.u8(at)) {
    if (block === 0x21) {
      at = subBlocks(data, at + 2);
      continue;
    }

    if (block !== 0x2c) return malformed();
    const frame = size(data.u16le(at + 5), data.u16le(at + 7));

    inside(screen, data.u16le(at + 1), data.u16le(at + 3), frame);
    frames++;
    decodedBytes += outputBytes(false) * area(frame);
    at = subBlocks(data, at + 11 + colorTable(data.u8(at + 9)));
  }

  return frames > 0 ? { mimeType: "image/gif", ...screen, frames, decodedBytes } : malformed();
};
