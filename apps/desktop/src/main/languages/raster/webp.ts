import { type Bytes, malformed } from "./bytes.ts";
import {
  type RasterMeasure,
  type RasterSize,
  area,
  inside,
  outputBytes,
  sameSize,
  size,
} from "./measure.ts";

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

interface Image {
  readonly size: RasterSize;
  /** libwebp's buffers beside the output: a lossless stream's ARGB, an alpha plane (maybe lossless). */
  readonly working: number;
}

/** The one image chunk among `found`, after an optional ALPH. */
const image = (data: Bytes, found: ReadonlyArray<Chunk>): Image => {
  const images = found.filter(isImage);
  const only = images.length === 1 ? images[0] : undefined;

  if (only === undefined) return malformed();
  const decoded = bitstream(data, only);

  const perPixel =
    (only.type === "VP8L" ? 4 : 0) + (found.some((chunk) => chunk.type === "ALPH") ? 5 : 0);

  return { size: decoded, working: perPixel * area(decoded) };
};

/** An ANMF frame: its declared rectangle must match its bitstream and fit the canvas. */
const animationFrame = (data: Bytes, canvas: RasterSize, chunk: Chunk): Image => {
  const frame = size(data.u24le(chunk.start + 6) + 1, data.u24le(chunk.start + 9) + 1);
  const decoded = image(data, chunks(data, chunk.start + 16, chunk.end));

  sameSize(frame, decoded.size);
  inside(canvas, 2 * data.u24le(chunk.start), 2 * data.u24le(chunk.start + 3), frame);

  return decoded;
};

/** Every frame's output, and the largest frame's working buffers (freed between frames). */
const decodedBytes = (images: ReadonlyArray<Image>): number =>
  images.reduce((sum, { size: frame }) => sum + outputBytes(false) * area(frame), 0) +
  Math.max(0, ...images.map((decoded) => decoded.working));

/** VP8X: a still's one image must be the canvas; an animation's every frame must fit it. */
const extended = (data: Bytes, header: Chunk, rest: ReadonlyArray<Chunk>): RasterMeasure => {
  const canvas = size(data.u24le(header.start + 4) + 1, data.u24le(header.start + 7) + 1);
  const frames = rest.filter((chunk) => chunk.type === "ANMF");

  if ((data.u8(header.start) & 0x02) === 0) {
    if (frames.length > 0) return malformed();
    const still = image(data, rest);

    sameSize(canvas, still.size);

    return {
      mimeType: "image/webp",
      ...canvas,
      frames: 1,
      decodedBytes: decodedBytes([still]),
      largestPixels: area(canvas),
    };
  }

  if (frames.length === 0 || rest.some(isImage)) return malformed();
  const decoded = frames.map((chunk) => animationFrame(data, canvas, chunk));

  return {
    mimeType: "image/webp",
    ...canvas,
    frames: frames.length,
    decodedBytes: decodedBytes(decoded),
    largestPixels: area(canvas),
  };
};

export const webp = (data: Bytes): RasterMeasure => {
  const [first, ...rest] = chunks(data, 12, 8 + data.u32le(4));

  if (first?.type === "VP8X" && first.end - first.start >= 10) return extended(data, first, rest);

  if (first === undefined || !isImage(first)) return malformed();
  const still = image(data, [first]);

  return {
    mimeType: "image/webp",
    ...still.size,
    frames: 1,
    decodedBytes: decodedBytes([still]),
    largestPixels: area(still.size),
  };
};
