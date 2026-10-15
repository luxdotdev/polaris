/**
 * A preview image's pixel size, read from its header before Chromium decodes it: a small
 * file can declare a huge canvas. Null when the header can't be read, so callers fail closed.
 */

export interface RasterSize {
  readonly width: number;
  readonly height: number;
}

const ascii = (data: Uint8Array, at: number, text: string) =>
  at + text.length <= data.length &&
  Array.from(text, (char, i) => data[at + i] === char.charCodeAt(0)).every(Boolean);

const view = (data: Uint8Array) => new DataView(data.buffer, data.byteOffset, data.byteLength);

const sized = (width: number, height: number): RasterSize | null =>
  width > 0 && height > 0 ? { width, height } : null;

const png = (data: Uint8Array): RasterSize | null =>
  data.length >= 24 && ascii(data, 12, "IHDR")
    ? sized(view(data).getUint32(16), view(data).getUint32(20))
    : null;

const gif = (data: Uint8Array): RasterSize | null =>
  data.length >= 10 ? sized(view(data).getUint16(6, true), view(data).getUint16(8, true)) : null;

/** Start-of-frame markers carry the size; DHT (C4), JPG (C8) and DAC (CC) share the range. */
const isSof = (marker: number) =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

const jpeg = (data: Uint8Array): RasterSize | null => {
  const dv = view(data);
  let at = 2;

  while (at + 4 <= data.length) {
    if (data[at] !== 0xff) return null;
    const marker = data[at + 1] ?? 0;

    if (marker === 0xff) {
      at += 1;
      continue;
    }

    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      at += 2;
      continue;
    }

    if (isSof(marker))
      return at + 9 <= data.length ? sized(dv.getUint16(at + 7), dv.getUint16(at + 5)) : null;

    if (marker === 0xd9 || marker === 0xda) return null;
    at += 2 + dv.getUint16(at + 2);
  }

  return null;
};

const uint24 = (data: Uint8Array, at: number) =>
  (data[at] ?? 0) | ((data[at + 1] ?? 0) << 8) | ((data[at + 2] ?? 0) << 16);

const webp = (data: Uint8Array): RasterSize | null => {
  if (data.length < 30) return null;
  const dv = view(data);

  if (ascii(data, 12, "VP8X")) return sized(uint24(data, 24) + 1, uint24(data, 27) + 1);

  if (ascii(data, 12, "VP8L") && data[20] === 0x2f) {
    const bits = dv.getUint32(21, true);

    return sized((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }

  if (ascii(data, 12, "VP8 ") && data[23] === 0x9d && data[24] === 0x01 && data[25] === 0x2a)
    return sized(dv.getUint16(26, true) & 0x3fff, dv.getUint16(28, true) & 0x3fff);

  return null;
};

interface Box {
  readonly type: string;
  readonly start: number;
  readonly end: number;
}

/** ISO-BMFF boxes in `[start, end)`; a malformed size ends the walk. */
function* boxes(data: Uint8Array, start: number, end: number): Generator<Box> {
  const dv = view(data);
  let at = start;

  while (at + 8 <= end) {
    const small = dv.getUint32(at);
    const header = small === 1 ? 16 : 8;

    const size =
      small === 1 && at + 16 <= end
        ? Number(dv.getBigUint64(at + 8))
        : small === 0
          ? end - at
          : small;

    if (size < header || at + size > end) return;
    const type = String.fromCharCode(...data.subarray(at + 4, at + 8));

    yield { type, start: at + header, end: at + size };
    at += size;
  }
}

const child = (data: Uint8Array, parent: Box | undefined, type: string, skip = 0) =>
  parent === undefined
    ? undefined
    : [...boxes(data, parent.start + skip, parent.end)].find((box) => box.type === type);

/** The largest `ispe` (image spatial extents) any item declares, grid and alpha included. */
const avif = (data: Uint8Array): RasterSize | null => {
  const top = { type: "", start: 0, end: data.length };
  const meta = child(data, top, "meta");
  // `meta` is a full box: four bytes of version and flags before its children.
  const props = child(data, child(data, meta, "iprp", 4), "ipco");
  let best: RasterSize | null = null;

  for (const box of props === undefined ? [] : boxes(data, props.start, props.end)) {
    if (box.type !== "ispe" || box.start + 12 > box.end) continue;
    const size = sized(view(data).getUint32(box.start + 4), view(data).getUint32(box.start + 8));

    if (size === null) return null;

    if (best === null || size.width * size.height > best.width * best.height) best = size;
  }

  return best;
};

/** The declared size for a raster `mimeType` (as `rasterView` sniffed it). */
export const rasterSize = (mimeType: string, data: Uint8Array): RasterSize | null => {
  switch (mimeType) {
    case "image/png":
      return png(data);
    case "image/gif":
      return gif(data);
    case "image/jpeg":
      return jpeg(data);
    case "image/webp":
      return webp(data);
    case "image/avif":
      return avif(data);
    default:
      return null;
  }
};
