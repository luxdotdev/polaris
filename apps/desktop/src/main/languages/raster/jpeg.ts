import { type Bytes, malformed } from "./bytes.ts";
import { type RasterMeasure, type RasterSize, area, size } from "./measure.ts";

/** Start-of-frame markers carry the size; DHT (C4), JPG (C8) and DAC (CC) share the range. */
const isSof = (marker: number) =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

/** Markers with no length: TEM and the restart markers. */
const standalone = (marker: number) => marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);

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

/**
 * Segments from SOI to the first SOS, skipped by their lengths (so an EXIF thumbnail's own
 * SOF stays inside its APP1). Exactly one SOF: a second one is refused, not ignored.
 */
export const jpeg = (data: Bytes): RasterMeasure => {
  let frame: RasterSize | null = null;

  for (let at = 2; ;) {
    const [marker, next] = step(data, at);

    if (marker === 0xda) break;

    if (isSof(marker)) {
      if (frame !== null || data.u16(at + 2) < 8) return malformed();
      frame = size(data.u16(at + 7), data.u16(at + 5));
    }

    at = next;
  }

  return frame === null
    ? malformed()
    : { mimeType: "image/jpeg", ...frame, frames: 1, decodedPixels: area(frame) };
};
