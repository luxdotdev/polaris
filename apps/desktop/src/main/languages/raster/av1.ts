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

/**
 * The largest frame a sequence header allows. With the reduced still-picture header every
 * frame is the maximum; otherwise a frame may override its size up to the field width.
 */
const sequenceBound = (payload: Uint8Array): RasterSize => {
  const bits = new Bits(payload);

  bits.read(4);
  const reduced = bits.bit() === 1;

  if (reduced) bits.read(5);
  else operatingPoints(bits, timingInfo(bits) && bits.bit() === 1);

  const widthBits = bits.read(4) + 1;
  const heightBits = bits.read(4) + 1;
  const width = bits.read(widthBits) + 1;
  const height = bits.read(heightBits) + 1;

  return reduced ? size(width, height) : size(2 ** widthBits, 2 ** heightBits);
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

/** An AV1 image item's OBUs: the largest frame any sequence header allows, and how many frames. */
export const av1Bound = (
  data: Uint8Array
): { readonly size: RasterSize; readonly frames: number } => {
  let bound: RasterSize | null = null;
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

    if (type === SEQUENCE_HEADER)
      bound = larger(bound, sequenceBound(data.subarray(start, start + length)));

    if (type === FRAME_HEADER || type === FRAME) frames++;
    at = start + length;
  }

  return bound === null ? malformed() : { size: bound, frames: Math.max(1, frames) };
};
