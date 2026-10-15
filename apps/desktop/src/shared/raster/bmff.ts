import { type Bytes, malformed } from "./bytes.ts";

export interface Box {
  readonly type: string;
  /** Where the payload starts, after the size, type and any 64-bit size. */
  readonly start: number;
  readonly end: number;
}

/**
 * ISO-BMFF boxes tiling `[start, end)` exactly. A size of 0 (to the end), a box that overruns
 * or a truncated header is `Malformed`, so nothing a decoder reads can hide past it.
 */
export const boxes = (data: Bytes, start: number, end: number): ReadonlyArray<Box> => {
  const found: Box[] = [];
  let at = start;

  while (at < end) {
    const small = data.u32(at);
    const header = small === 1 ? 16 : 8;
    const length = small === 1 ? data.u64(at + 8) : small;

    if (length < header || at + length > end) return malformed();
    found.push({ type: data.text(at + 4, 4), start: at + header, end: at + length });
    at += length;
  }

  return found;
};

/** The box of `type` among `list`, if there is one; two are `Malformed`. */
export const optional = (list: ReadonlyArray<Box>, type: string): Box | undefined => {
  const matches = list.filter((box) => box.type === type);

  return matches.length > 1 ? malformed() : matches[0];
};

/** Exactly one box of `type` among `list`. */
export const single = (list: ReadonlyArray<Box>, type: string): Box =>
  optional(list, type) ?? malformed();

/** A full box's children, after its version and flags. */
export const fullChildren = (data: Bytes, box: Box, skip = 0): ReadonlyArray<Box> =>
  boxes(data, box.start + 4 + skip, box.end);

export interface Location {
  readonly method: number;
  readonly dataReference: number;
  readonly extents: ReadonlyArray<{ readonly offset: number; readonly length: number }>;
}

/** `iloc`: where each item's bytes live, as file (method 0) or `idat` (method 1) extents. */
export const locations = (data: Bytes, iloc: Box): ReadonlyMap<number, Location> => {
  const version = data.u8(iloc.start);

  if (version > 2) return malformed();
  const offsetSize = data.u8(iloc.start + 4) >>> 4;
  const lengthSize = data.u8(iloc.start + 4) & 0x0f;
  const baseSize = data.u8(iloc.start + 5) >>> 4;
  const indexSize = version > 0 ? data.u8(iloc.start + 5) & 0x0f : 0;
  const wide = version === 2 ? 4 : 2;
  const count = data.uint(iloc.start + 6, wide);
  const found = new Map<number, Location>();
  let at = iloc.start + 6 + wide;

  // A zero-width length would let a few bytes declare endless extents.
  if (lengthSize !== 4 && lengthSize !== 8) return malformed();

  for (let item = 0; item < count; item++) {
    const id = data.uint(at, wide);
    const method = version > 0 ? data.u16(at + wide) & 0x0f : 0;

    at += wide + (version > 0 ? 2 : 0);
    const dataReference = data.u16(at);
    const base = data.uint(at + 2, baseSize);
    const extentCount = data.u16(at + 2 + baseSize);
    const extents = [];

    at += 4 + baseSize;

    for (let extent = 0; extent < extentCount; extent++) {
      at += indexSize;
      extents.push({
        offset: base + data.uint(at, offsetSize),
        length: data.uint(at + offsetSize, lengthSize),
      });
      at += offsetSize + lengthSize;
    }

    if (at > iloc.end || found.has(id)) return malformed();
    found.set(id, { method, dataReference, extents });
  }

  return found;
};
