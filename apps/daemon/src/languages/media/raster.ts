import { LanguageError } from "@polaris/protocol";

const prefix = (data: Uint8Array, signature: readonly number[], offset = 0) =>
  data.length >= offset + signature.length &&
  signature.every((byte, i) => data[offset + i] === byte);

const ascii = (data: Uint8Array, text: string, offset = 0) =>
  prefix(
    data,
    Array.from(text, (char) => char.charCodeAt(0)),
    offset
  );

/** Magic only: filename extensions never authorize active SVG, HTML, or arbitrary bytes. */
export function rasterMime(
  data: Uint8Array
): "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/avif" {
  if (prefix(data, [137, 80, 78, 71, 13, 10, 26, 10])) return "image/png";

  if (prefix(data, [255, 216, 255])) return "image/jpeg";

  if (ascii(data, "GIF87a") || ascii(data, "GIF89a")) return "image/gif";

  if (data.length >= 12 && ascii(data, "RIFF") && ascii(data, "WEBP", 8)) return "image/webp";

  if (isAvif(data)) return "image/avif";

  throw new LanguageError({
    reason: "invalid-input",
    message: "Media is not a supported raster image",
    retryable: false,
  });
}

function isAvif(data: Uint8Array) {
  if (data.length < 24 || !ascii(data, "ftyp", 4)) return false;

  const size = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0);

  if (size < 24 || size > data.length || size > 4096 || size % 4 !== 0) return false;

  if (ascii(data, "avif", 8) || ascii(data, "avis", 8)) return true;

  for (let at = 16; at < size; at += 4)
    if (ascii(data, "avif", at) || ascii(data, "avis", at)) return true;

  return false;
}
