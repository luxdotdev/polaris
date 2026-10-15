import { type Bytes, Malformed, malformed } from "./bytes.ts";
import { type RasterMeasure, type RasterSize, area, outputBytes, size } from "./measure.ts";

/** Start-of-frame markers carry the size; DHT (C4), JPG (C8) and DAC (CC) share the range. */
const isSof = (marker: number) =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

/** Progressive frames, Huffman and arithmetic, sequential and hierarchical. */
const PROGRESSIVE = new Set([0xc2, 0xc6, 0xca, 0xce]);

/** Markers with no length: TEM and the restart markers. */
const standalone = (marker: number) => marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);

interface Component {
  readonly h: number;
  readonly v: number;
}

interface Frame {
  readonly size: RasterSize;
  readonly components: ReadonlyArray<Component>;
  readonly progressive: boolean;
}

/** The SOF at `at`: 1 to 4 components (Blink decodes no other colour space), each sampled 1 to 4×. */
const frameAt = (data: Bytes, at: number): Frame => {
  const count = data.u8(at + 9);

  if (count < 1 || count > 4 || data.u16(at + 2) !== 8 + 3 * count) return malformed();

  const components = Array.from({ length: count }, (_, i) => {
    const sampling = data.u8(at + 11 + 3 * i);
    const component = { h: sampling >>> 4, v: sampling & 0x0f };

    return component.h >= 1 && component.h <= 4 && component.v >= 1 && component.v <= 4
      ? component
      : malformed();
  });

  return {
    size: size(data.u16(at + 7), data.u16(at + 5)),
    components,
    progressive: PROGRESSIVE.has(data.u8(at + 1)),
  };
};

const roundUp = (n: number, multiple: number) => Math.ceil(n / multiple) * multiple;

/**
 * RGBA output plus libjpeg-turbo's buffers, per component in blocks padded to whole MCUs: a frame
 * read in several scans keeps every coefficient (64 of 2 bytes a block); one scan keeps MCU rows.
 */
const cost = (frame: Frame, buffered: boolean): number => {
  const hMax = Math.max(...frame.components.map((component) => component.h));
  const vMax = Math.max(...frame.components.map((component) => component.v));

  return frame.components.reduce(
    (sum, { h, v }) => {
      const across = roundUp(Math.ceil((frame.size.width * h) / (hMax * 8)), h);
      const down = roundUp(Math.ceil((frame.size.height * v) / (vMax * 8)), v);

      return sum + (buffered ? across * down * 128 : across * 8 * v * 8 * 3);
    },
    outputBytes(false) * area(frame.size)
  );
};

/** The marker at `at` and where the next one starts; SOF, SOS and EOI are the caller's. */
const step = (data: Bytes, at: number): readonly [marker: number, next: number] => {
  if (data.u8(at) !== 0xff) return malformed();
  const marker = data.u8(at + 1);

  if (marker === 0xff) return [marker, at + 1];

  if (standalone(marker)) return [marker, at + 2];

  if (marker === 0xda) return [marker, at];

  if (marker === 0xd8 || marker === 0xd9) return malformed();
  const length = data.u16(at + 2);

  return length < 2 ? malformed() : [marker, at + 2 + length];
};

/** A walk past this many bytes per byte of file is refused rather than finished. */
const WALK_PER_BYTE = 8;

interface Walk {
  left: number;
}

const measured = (read: () => number): number => {
  try {
    return read();
  } catch (error) {
    if (error instanceof Malformed) return 0;
    throw error;
  }
};

/**
 * One libjpeg `next_marker` from `at`: stray bytes and fill skipped. A frame's cost (0 if
 * libjpeg would fail first), or undefined and where the walk goes on.
 */
const nextMarker = (data: Bytes, at: number): readonly [cost: number | undefined, next: number] => {
  const bytes = data.data;
  let marker = bytes.indexOf(0xff, at);

  if (marker < 0) return [0, bytes.length];

  while (bytes[marker] === 0xff) marker++;
  const type = bytes[marker];

  if (type === undefined || type === 0xd8 || type === 0xd9 || type === 0xda) return [0, marker];

  if (type === 0x00 || standalone(type)) return [undefined, marker + 1];

  if (isSof(type)) return [measured(() => cost(frameAt(data, marker - 1), true)), marker];

  return data.has(marker + 1, 2)
    ? [undefined, marker + 1 + Math.max(2, data.u16(marker + 1))]
    : [0, marker];
};

/** What a JPEG starting at `from`'s SOI would cost libjpeg, which skips junk between markers. */
const embeddedAt = (data: Bytes, from: number, walk: Walk): number => {
  for (let at = from + 2; ;) {
    const [found, next] = nextMarker(data, at);

    walk.left -= next - at + 1;

    if (walk.left < 0) return malformed();

    if (found !== undefined) return found;
    at = next;
  }
};

/**
 * Blink decodes a gain map (MPF or GContainer) as a second JPEG, located by offsets that can
 * point anywhere; every SOI after the first is costed as one, and the dearest counts.
 */
const gainMap = (data: Bytes): number => {
  const bytes = data.data;
  const walk = { left: WALK_PER_BYTE * bytes.length };
  let dearest = 0;

  for (let at = bytes.indexOf(0xff, 1); at >= 0; at = bytes.indexOf(0xff, at + 1))
    if (bytes[at + 1] === 0xd8) dearest = Math.max(dearest, embeddedAt(data, at, walk));

  return dearest;
};

/**
 * Segments from SOI to the first SOS, skipped by their lengths (so an EXIF thumbnail's own
 * SOF stays inside its APP1). Exactly one SOF: a second one is refused, not ignored.
 */
export const jpeg = (data: Bytes): RasterMeasure => {
  let frame: Frame | null = null;
  let at = 2;

  for (;;) {
    const [marker, next] = step(data, at);

    if (marker === 0xda) break;

    if (isSof(marker)) {
      if (frame !== null) return malformed();
      frame = frameAt(data, at);
    }

    at = next;
  }

  if (frame === null) return malformed();
  // libjpeg buffers the whole image when the first scan leaves a component out.
  const buffered = frame.progressive || data.u8(at + 4) < frame.components.length;

  return {
    mimeType: "image/jpeg",
    ...frame.size,
    frames: 1,
    decodedBytes: cost(frame, buffered) + gainMap(data),
  };
};
