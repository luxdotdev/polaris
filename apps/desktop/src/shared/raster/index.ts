import {
  PREVIEW_IMAGE_MAX_BYTES,
  PREVIEW_IMAGE_MAX_DECODED_BYTES,
  PREVIEW_IMAGE_MAX_FRAMES,
  PREVIEW_IMAGE_MAX_PIXELS,
} from "../languages.ts";
import { avif } from "./avif.ts";
import { Bytes, Malformed } from "./bytes.ts";
import { gif } from "./gif.ts";
import { jpeg } from "./jpeg.ts";
import type { RasterMeasure } from "./measure.ts";
import { png } from "./png.ts";
import { webp } from "./webp.ts";

export type { RasterMeasure, RasterSize } from "./measure.ts";

type Parse = (data: Bytes) => RasterMeasure;

/**
 * Chromium picks a decoder by sniffing the bytes, whatever the extension or MIME type says, so
 * this is Blink's `SniffMimeTypeInternal` in its order; formats not measured here are refused.
 */
const sniff = (data: Bytes): Parse | null => {
  const blink: ReadonlyArray<readonly [matches: boolean, parse: Parse | null]> = [
    [data.is(0, "\xff\xd8\xff"), jpeg],
    [data.is(0, "\x89PNG\r\n\x1a\n"), png],
    [data.is(0, "GIF87a") || data.is(0, "GIF89a"), gif],
    [data.is(0, "RIFF") && data.is(8, "WEBPVP"), webp],
    // ICO and CUR: an AVIF whose ftyp box is 256 or 512 bytes long begins with these too.
    [data.is(0, "\x00\x00\x01\x00") || data.is(0, "\x00\x00\x02\x00"), null],
    [data.is(0, "BM") || data.is(0, "BA"), null],
    [data.is(4, "ftypavif"), avif],
  ];

  return blink.find(([matches]) => matches)?.[1] ?? null;
};

/**
 * A preview image's format, canvas, frames and decode cost in bytes, read from its bytes before
 * Chromium decodes them. Null when anything can't be read exactly, so callers fail closed.
 */
export const measureRaster = (bytes: Uint8Array): RasterMeasure | null => {
  const data = new Bytes(bytes);
  const parse = sniff(data);

  try {
    return parse === null ? null : parse(data);
  } catch (error) {
    if (error instanceof Malformed) return null;
    throw error;
  }
};

export type RasterAdmission =
  | { readonly kind: "admitted"; readonly measure: RasterMeasure }
  | { readonly kind: "too-large" }
  | { readonly kind: "invalid" };

/**
 * Whether Chromium may decode `bytes` (from a Host, a Workspace or the web): its encoded size,
 * canvas, frames and decode cost within the preview caps. Every renderer decode goes through this.
 */
export const admitRaster = (
  bytes: Uint8Array,
  maxBytes = PREVIEW_IMAGE_MAX_BYTES
): RasterAdmission => {
  if (bytes.length > Math.min(maxBytes, PREVIEW_IMAGE_MAX_BYTES) || bytes.length === 0)
    return { kind: "too-large" };
  const measure = measureRaster(bytes);

  if (measure === null) return { kind: "invalid" };

  return measure.largestPixels > PREVIEW_IMAGE_MAX_PIXELS ||
    measure.frames > PREVIEW_IMAGE_MAX_FRAMES ||
    measure.decodedBytes > PREVIEW_IMAGE_MAX_DECODED_BYTES
    ? { kind: "too-large" }
    : { kind: "admitted", measure };
};
