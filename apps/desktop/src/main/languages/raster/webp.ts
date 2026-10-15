import { type Bytes, malformed } from "./bytes.ts";
import { type RasterMeasure, type RasterSize, area, inside, sameSize, size } from "./measure.ts";

interface Chunk {
  readonly type: string;
  readonly start: number;
  readonly end: number;
}

/** RIFF chunks in `[start, end)`, padded to even sizes; one that overruns is `Malformed`. */
const chunks = (data: Bytes, start: number, end: number): ReadonlyArray<Chunk> => {
  const found: Chunk[] = [];
  let at = start;

  while (at < end) {
    const length = data.u32le(at + 4);
    const chunk = { type: data.text(at, 4), start: at + 8, end: at + 8 + length };

    if (chunk.end > end) return malformed();
    found.push(chunk);
    at = chunk.end + (length & 1);
  }

  return found;
};

/** A VP8 key frame's or a VP8L stream's size; anything else is `Malformed`. */
const bitstream = (data: Bytes, chunk: Chunk): RasterSize => {
  if (chunk.end - chunk.start < (chunk.type === "VP8L" ? 5 : 10)) return malformed();

  if (chunk.type === "VP8L" && data.u8(chunk.start) === 0x2f) {
    const bits = data.u32le(chunk.start + 1);

    return size((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }

  if (
    chunk.type === "VP8 " &&
    (data.u8(chunk.start) & 1) === 0 &&
    data.is(chunk.start + 3, "\x9d\x01\x2a")
  )
    return size(data.u16le(chunk.start + 6) & 0x3fff, data.u16le(chunk.start + 8) & 0x3fff);

  return malformed();
};

const isImage = (chunk: Chunk) => chunk.type === "VP8 " || chunk.type === "VP8L";

/** The one image chunk among `found`, after an optional ALPH. */
const image = (data: Bytes, found: ReadonlyArray<Chunk>): RasterSize => {
  const images = found.filter(isImage);

  return images.length === 1 && images[0] !== undefined ? bitstream(data, images[0]) : malformed();
};

/** An ANMF frame: its declared rectangle must match its bitstream and fit the canvas. */
const animationFrame = (data: Bytes, canvas: RasterSize, chunk: Chunk): RasterSize => {
  const frame = size(data.u24le(chunk.start + 6) + 1, data.u24le(chunk.start + 9) + 1);

  sameSize(frame, image(data, chunks(data, chunk.start + 16, chunk.end)));

  return inside(canvas, 2 * data.u24le(chunk.start), 2 * data.u24le(chunk.start + 3), frame);
};

/** VP8X: a still's one image must be the canvas; an animation's every frame must fit it. */
const extended = (data: Bytes, header: Chunk, rest: ReadonlyArray<Chunk>): RasterMeasure => {
  const canvas = size(data.u24le(header.start + 4) + 1, data.u24le(header.start + 7) + 1);
  const frames = rest.filter((chunk) => chunk.type === "ANMF");

  if ((data.u8(header.start) & 0x02) === 0) {
    if (frames.length > 0) return malformed();
    sameSize(canvas, image(data, rest));

    return { mimeType: "image/webp", ...canvas, frames: 1, decodedPixels: area(canvas) };
  }

  if (frames.length === 0 || rest.some(isImage)) return malformed();

  const decodedPixels = frames.reduce(
    (sum, chunk) => sum + area(animationFrame(data, canvas, chunk)),
    0
  );

  return { mimeType: "image/webp", ...canvas, frames: frames.length, decodedPixels };
};

export const webp = (data: Bytes): RasterMeasure => {
  const [first, ...rest] = chunks(data, 12, 8 + data.u32le(4));

  if (first?.type === "VP8X" && first.end - first.start >= 10) return extended(data, first, rest);

  if (first === undefined || !isImage(first)) return malformed();
  const frame = bitstream(data, first);

  return { mimeType: "image/webp", ...frame, frames: 1, decodedPixels: area(frame) };
};
