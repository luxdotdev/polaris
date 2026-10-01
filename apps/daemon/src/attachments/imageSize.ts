/**
 * An image's pixel size from its header, for PNG, GIF, JPEG and WebP: enough
 * for a Client to reserve a thumbnail's box before the bytes arrive. Null for
 * anything else or a header it can't read.
 */
export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

const ascii = (bytes: Uint8Array, at: number, text: string) => {
  for (let n = 0; n < text.length; n += 1) if (bytes[at + n] !== text.charCodeAt(n)) return false;

  return true;
};

const valid = (width: number, height: number): ImageSize | null =>
  width > 0 && height > 0 ? { width, height } : null;

const png = (b: Uint8Array, view: DataView) =>
  b.length >= 24 && b[0] === 0x89 && ascii(b, 1, "PNG") && ascii(b, 12, "IHDR")
    ? valid(view.getUint32(16), view.getUint32(20))
    : null;

const gif = (b: Uint8Array, view: DataView) =>
  b.length >= 10 && ascii(b, 0, "GIF8")
    ? valid(view.getUint16(6, true), view.getUint16(8, true))
    : null;

/** Start-of-frame markers carry the size; DHT (C4), JPG (C8) and DAC (CC) don't. */
const isFrame = (marker: number) =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

const jpeg = (b: Uint8Array, view: DataView) => {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let at = 2;

  while (at + 9 < b.length) {
    if (b[at] !== 0xff) return null;
    const marker = b[at + 1] ?? 0;

    if (isFrame(marker)) return valid(view.getUint16(at + 7), view.getUint16(at + 5));
    at += 2 + view.getUint16(at + 2);
  }

  return null;
};

const u24 = (b: Uint8Array, at: number) =>
  (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8) | ((b[at + 2] ?? 0) << 16);

const webp = (b: Uint8Array, view: DataView) => {
  if (b.length < 30 || !ascii(b, 0, "RIFF") || !ascii(b, 8, "WEBP")) return null;

  if (ascii(b, 12, "VP8X")) return valid(1 + u24(b, 24), 1 + u24(b, 27));

  if (ascii(b, 12, "VP8L")) {
    const bits = view.getUint32(21, true);

    return valid(1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff));
  }

  if (ascii(b, 12, "VP8 "))
    return valid(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);

  return null;
};

export const imageSize = (bytes: Uint8Array): ImageSize | null => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  try {
    return png(bytes, view) ?? gif(bytes, view) ?? webp(bytes, view) ?? jpeg(bytes, view);
  } catch {
    // A truncated header reads past the end.
    return null;
  }
};
