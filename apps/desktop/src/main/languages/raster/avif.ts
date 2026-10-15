import { type Picture, av1Bound } from "./av1.ts";
import {
  type Box,
  type Location,
  boxes,
  fullChildren,
  locations,
  optional,
  single,
} from "./bmff.ts";
import { type Bytes, malformed } from "./bytes.ts";
import {
  type RasterMeasure,
  type RasterSize,
  area,
  outputBytes,
  sameSize,
  size,
} from "./measure.ts";

/** `iinf`: each item's id and four-character type (`infe` version 2 or 3). */
const itemTypes = (data: Bytes, iinf: Box): ReadonlyMap<number, string> => {
  const wide = data.u8(iinf.start) === 0 ? 2 : 4;
  const types = new Map<number, string>();

  for (const infe of fullChildren(data, iinf, wide)) {
    const version = data.u8(infe.start);

    if (infe.type !== "infe" || version < 2 || version > 3) return malformed();
    const idSize = version === 2 ? 2 : 4;
    const id = data.uint(infe.start + 4, idSize);

    if (types.has(id)) return malformed();
    types.set(id, data.text(infe.start + 6 + idSize, 4));
  }

  return types;
};

/** `ipma`: each item's property indices into `ipco`, one-based. */
const associations = (data: Bytes, ipma: Box): ReadonlyMap<number, ReadonlyArray<number>> => {
  const idSize = data.u8(ipma.start) > 0 ? 4 : 2;
  const indexSize = (data.u8(ipma.start + 3) & 1) === 1 ? 2 : 1;
  const essential = indexSize === 2 ? 0x8000 : 0x80;
  const found = new Map<number, ReadonlyArray<number>>();
  let at = ipma.start + 8;

  for (let entry = data.u32(ipma.start + 4); entry > 0; entry--) {
    const id = data.uint(at, idSize);
    const count = data.u8(at + idSize);
    const indices: number[] = [];

    at += idSize + 1;

    for (let i = 0; i < count; i++) {
      indices.push(data.uint(at, indexSize) & ~essential);
      at += indexSize;
    }

    if (at > ipma.end || found.has(id)) return malformed();
    found.set(id, indices);
  }

  return found;
};

/** An `ispe` (image spatial extents) box, which must hold its full width and height. */
const extents = (data: Bytes, ispe: Box): RasterSize =>
  ispe.end - ispe.start >= 12
    ? size(data.u32(ispe.start + 4), data.u32(ispe.start + 8))
    : malformed();

/** An item's bytes, joined from its extents; `budget` stops overlapping extents re-reading the file. */
const itemBytes = (data: Bytes, idat: Box | undefined, at: Location, budget: { left: number }) => {
  if (at.dataReference !== 0 || at.method > 1 || (at.method === 1 && idat === undefined))
    return malformed();
  const base = at.method === 1 && idat !== undefined ? idat.start : 0;
  const limit = at.method === 1 && idat !== undefined ? idat.end : data.length;

  const parts = at.extents.map(({ offset, length }) => {
    budget.left -= length;

    if (length === 0 || budget.left < 0 || base + offset + length > limit) return malformed();

    return data.slice(base + offset, base + offset + length);
  });

  const joined = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;

  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }

  return joined;
};

/** An `ImageGrid` item's output size. */
const gridSize = (content: Uint8Array): RasterSize => {
  const data = new Uint8Array(content);
  const wide = ((data[1] ?? 0) & 1) === 1;
  const view = new DataView(data.buffer);

  if (data[0] !== 0 || data.length < (wide ? 12 : 8)) return malformed();

  return wide
    ? size(view.getUint32(4), view.getUint32(8))
    : size(view.getUint16(4), view.getUint16(6));
};

const larger = (a: RasterSize, b: RasterSize): RasterSize => (area(b) > area(a) ? b : a);

interface Meta {
  readonly properties: ReadonlyArray<Box>;
  readonly associations: ReadonlyMap<number, ReadonlyArray<number>>;
  readonly types: ReadonlyMap<number, string>;
  readonly locations: ReadonlyMap<number, Location>;
  readonly idat: Box | undefined;
}

const meta = (data: Bytes, top: ReadonlyArray<Box>): Meta => {
  const children = fullChildren(data, single(top, "meta"));
  const iprpBox = single(children, "iprp");
  const iprp = boxes(data, iprpBox.start, iprpBox.end);
  const ipco = single(iprp, "ipco");

  return {
    properties: boxes(data, ipco.start, ipco.end),
    associations: associations(data, single(iprp, "ipma")),
    types: itemTypes(data, single(children, "iinf")),
    locations: locations(data, single(children, "iloc")),
    idat: optional(children, "idat"),
  };
};

/** The one `ispe` associated with an image item; none, or two, is `Malformed`. */
const itemExtents = (data: Bytes, info: Meta, id: number): RasterSize => {
  const own = (info.associations.get(id) ?? [])
    .filter((index) => index > 0)
    .map((index) => info.properties[index - 1] ?? malformed())
    .filter((box) => box.type === "ispe");

  return own.length === 1 && own[0] !== undefined ? extents(data, own[0]) : malformed();
};

/**
 * Every image item (`av01` tiles, alpha and `grid`s): its `ispe`, a grid's output size (which
 * must equal it) and an AV1 item's sequence header bound. Sequences (`moov`) are refused.
 * Each item's frames cost a decoded picture, a grid one as deep as its deepest tile; the RGBA
 * output is the canvas, twice when a `tmap` gain map is decoded beside the primary image.
 */
export const avif = (data: Bytes): RasterMeasure => {
  const top = boxes(data, 0, data.length);

  if (optional(top, "moov") !== undefined) return malformed();
  const info = meta(data, top);
  const budget = { left: data.length };
  let canvas: RasterSize = { width: 0, height: 0 };
  const items: Array<{ size: RasterSize; frames: number; picture?: Picture }> = [];

  for (const box of info.properties)
    if (box.type === "ispe") canvas = larger(canvas, extents(data, box));

  for (const [id, type] of info.types) {
    if (type !== "av01" && type !== "grid") continue;
    const declared = itemExtents(data, info, id);
    const content = itemBytes(data, info.idat, info.locations.get(id) ?? malformed(), budget);

    const decoded =
      type === "grid"
        ? { size: sameSize(declared, gridSize(content)), frames: 1 }
        : av1Bound(content);

    canvas = larger(larger(canvas, declared), decoded.size);
    items.push(decoded);
  }

  const pictures = items.flatMap((item) => (item.picture === undefined ? [] : [item.picture]));

  if (pictures.length === 0) return malformed();
  const deep = pictures.some((picture) => picture.deep);
  const deepest = Math.max(...pictures.map((picture) => picture.bytes));
  const outputs = [...info.types.values()].includes("tmap") ? 2 : 1;

  const decodedBytes = items.reduce(
    (sum, item) => sum + area(item.size) * item.frames * (item.picture?.bytes ?? deepest),
    outputs * outputBytes(deep) * area(canvas)
  );

  return { mimeType: "image/avif", ...canvas, frames: 1, decodedBytes };
};
