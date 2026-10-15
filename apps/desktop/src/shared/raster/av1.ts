import { Bits, malformed } from "./bytes.ts";
import { type RasterSize, area, size } from "./measure.ts";

const SEQUENCE_HEADER = 1;

const FRAME_HEADER = 3;

const FRAME = 6;

const larger = (a: RasterSize | null, b: RasterSize): RasterSize =>
  a === null || area(b) > area(a) ? b : a;

const timingInfo = (bits: Bits): boolean => {
  if (bits.bit() === 0) return false;
  bits.read(64);

  if (bits.bit() === 1) bits.uvlc();

  return true;
};

/** Skips the operating points; their fields' presence hangs on the flags before them. */
const operatingPoints = (bits: Bits, decoderModel: boolean): void => {
  const bufferDelayBits = decoderModel ? bits.read(5) + 1 : 0;

  if (decoderModel) bits.read(42);
  const displayDelayPresent = bits.bit() === 1;
  const count = bits.read(5) + 1;

  for (let i = 0; i < count; i++) {
    bits.read(12);

    if (bits.read(5) > 7) bits.bit();

    if (decoderModel && bits.bit() === 1) bits.read(2 * bufferDelayBits + 1);

    if (displayDelayPresent && bits.bit() === 1) bits.read(4);
  }
};

/** The sequence header's tools, skipped to reach `color_config` (AV1 spec 5.5.1). */
const tools = (bits: Bits, reduced: boolean): void => {
  if (!reduced && bits.bit() === 1) bits.read(7);
  bits.read(3);

  if (!reduced) {
    bits.read(4);
    const orderHint = bits.bit() === 1;

    if (orderHint) bits.read(2);
    const screenContent = bits.bit() === 1 || bits.bit() === 1;

    if (screenContent && bits.bit() === 0) bits.bit();

    if (orderHint) bits.read(3);
  }

  bits.read(3);
};

export interface Picture {
  readonly deep: boolean;
  readonly bytes: number;
}

const bitDepth = (bits: Bits, profile: number): number => {
  const high = bits.bit() === 1;

  if (profile === 2 && high) return bits.bit() === 1 ? 12 : 10;

  return high ? 10 : 8;
};

/** Chroma planes as a share of luma: profile 0 is 4:2:0, 1 is 4:4:4, 2 is 4:2:2 or (12-bit) read. */
const chroma = (bits: Bits, profile: number, depth: number): number => {
  bits.bit();

  if (profile === 0) return 2 / 4;

  if (profile === 1) return 2;

  if (depth !== 12 || bits.bit() === 0) return depth === 12 ? 2 : 1;

  return bits.bit() === 1 ? 2 / 4 : 1;
};

/** Bytes a pixel of dav1d's picture: 1 or 2 a sample, over the luma and subsampled chroma planes. */
const colorConfig = (bits: Bits, profile: number): Picture => {
  const depth = bitDepth(bits, profile);
  const sample = depth > 8 ? 2 : 1;
  const mono = profile !== 1 && bits.bit() === 1;
  const described = bits.bit() === 1;

  const [primaries, transfer, matrix] = described
    ? [bits.read(8), bits.read(8), bits.read(8)]
    : [2, 2, 2];

  if (mono) return { deep: depth > 8, bytes: sample };

  const share =
    primaries === 1 && transfer === 13 && matrix === 0 ? 2 : chroma(bits, profile, depth);

  return { deep: depth > 8, bytes: sample * (1 + share) };
};

interface Sequence {
  readonly size: RasterSize;
  readonly picture: Picture;
}

/**
 * The largest frame a sequence header allows, and its pictures' sample layout. With the reduced
 * still-picture header every frame is the maximum; otherwise a frame may override its size.
 */
const sequence = (payload: Uint8Array): Sequence => {
  const bits = new Bits(payload);
  const profile = bits.read(3);

  if (profile > 2) return malformed();
  bits.bit();
  const reduced = bits.bit() === 1;

  if (reduced) bits.read(5);
  else operatingPoints(bits, timingInfo(bits) && bits.bit() === 1);

  const widthBits = bits.read(4) + 1;
  const heightBits = bits.read(4) + 1;
  const width = bits.read(widthBits) + 1;
  const height = bits.read(heightBits) + 1;

  tools(bits, reduced);

  return {
    size: reduced ? size(width, height) : size(2 ** widthBits, 2 ** heightBits),
    picture: colorConfig(bits, profile),
  };
};

const leb128 = (data: Uint8Array, from: number): readonly [value: number, next: number] => {
  let value = 0;

  for (let i = 0; i < 8; i++) {
    const byte = data[from + i] ?? malformed();

    value += (byte & 0x7f) * 2 ** (7 * i);

    if ((byte & 0x80) === 0) return [value, from + i + 1];
  }

  return malformed();
};

export interface Av1Bound extends Sequence {
  readonly frames: number;
}

const deeper = (a: Picture | null, b: Picture): Picture => ({
  deep: b.deep || (a?.deep ?? false),
  bytes: Math.max(b.bytes, a?.bytes ?? 0),
});

/** An AV1 image item's OBUs: the largest frame and picture any sequence header allows, and how many frames. */
export const av1Bound = (data: Uint8Array): Av1Bound => {
  let bound: RasterSize | null = null;
  let picture: Picture | null = null;
  let frames = 0;
  let at = 0;

  while (at < data.length) {
    const header = data[at] ?? malformed();

    if (header & 0x80) return malformed();
    const type = (header >>> 3) & 0x0f;
    const payload = at + 1 + ((header >>> 2) & 1);

    const [length, start] =
      header & 0x02 ? leb128(data, payload) : [data.length - payload, payload];

    if (length < 0 || start + length > data.length) return malformed();

    if (type === SEQUENCE_HEADER) {
      const header = sequence(data.subarray(start, start + length));

      bound = larger(bound, header.size);
      picture = deeper(picture, header.picture);
    }

    if (type === FRAME_HEADER || type === FRAME) frames++;
    at = start + length;
  }

  return bound === null || picture === null
    ? malformed()
    : { size: bound, picture, frames: Math.max(1, frames) };
};
