import { avif } from "./avif.ts";
import { Bytes, Malformed } from "./bytes.ts";
import { gif } from "./gif.ts";
import { jpeg } from "./jpeg.ts";
import type { RasterMeasure } from "./measure.ts";
import { png } from "./png.ts";
import { webp } from "./webp.ts";

export type { RasterMeasure, RasterSize } from "./measure.ts";

/**
 * Chromium picks a decoder by sniffing the bytes, whatever the extension or MIME type says,
 * so the format is sniffed here the same way. Signatures from Blink's `ImageDecoder::Create`.
 */
const sniff = (data: Bytes): ((data: Bytes) => RasterMeasure) | null => {
  if (data.is(0, "\x89PNG\r\n\x1a\n")) return png;

  if (data.is(0, "\xff\xd8\xff")) return jpeg;

  if (data.is(0, "GIF87a") || data.is(0, "GIF89a")) return gif;

  if (data.is(0, "RIFF") && data.is(8, "WEBP")) return webp;

  return data.is(4, "ftypavif") ? avif : null;
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
