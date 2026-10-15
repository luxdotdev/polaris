/** Hand-built image headers for the raster tests: just enough of each format to be measured. */

export interface Rect {
  readonly x?: number;
  readonly y?: number;
  readonly width: number;
  readonly height: number;
}

export const ascii = (text: string) => Array.from(text, (char) => char.charCodeAt(0));

export const bytes = (...parts: ReadonlyArray<ReadonlyArray<number>>) =>
  new Uint8Array(parts.flat());

export const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

export const be16 = (n: number) => [(n >>> 8) & 255, n & 255];

export const le16 = (n: number) => [n & 255, (n >>> 8) & 255];

export const le24 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];

export const le32 = (n: number) => [...le24(n), (n >>> 24) & 255];

const pngChunk = (type: string, ...payload: ReadonlyArray<ReadonlyArray<number>>) => {
  const body = payload.flat();

  return [...be32(body.length), ...ascii(type), ...body, 0, 0, 0, 0];
};

export const fcTL = (frame: Rect) =>
  pngChunk(
    "fcTL",
    be32(0),
    be32(frame.width),
    be32(frame.height),
    be32(frame.x ?? 0),
    be32(frame.y ?? 0),
    [0, 1, 0, 10, 0, 0]
  );

export const acTL = (frames: number) => pngChunk("acTL", be32(frames), be32(0));

export interface PngHeader {
  readonly depth?: 8 | 16;
  readonly interlaced?: boolean;
}

/** A PNG with IHDR's bit depth and interlace method set; extra chunks sit before IDAT. */
export const pngWith = (
  header: PngHeader,
  width: number,
  height: number,
  ...chunks: ReadonlyArray<ReadonlyArray<number>>
) =>
  bytes(
    [137, 80, 78, 71, 13, 10, 26, 10],
    pngChunk("IHDR", be32(width), be32(height), [
      header.depth ?? 8,
      6,
      0,
      0,
      header.interlaced ? 1 : 0,
    ]),
    ...chunks,
    pngChunk("IDAT", [0]),
    pngChunk("IEND")
  );

/** An 8-bit RGBA PNG whose extra chunks (`acTL`, `fcTL`) sit between IHDR and IDAT. */
export const png = (
  width: number,
  height: number,
  ...chunks: ReadonlyArray<ReadonlyArray<number>>
) => pngWith({}, width, height, ...chunks);

const gifFrame = (frame: Rect) => [
  0x2c,
  ...le16(frame.x ?? 0),
  ...le16(frame.y ?? 0),
  ...le16(frame.width),
  ...le16(frame.height),
  0,
  2,
  1,
  0x44,
  0,
];

/** A GIF with a graphic control extension before each frame. */
export const gif = (
  width: number,
  height: number,
  frames: ReadonlyArray<Rect> = [{ width, height }]
) =>
  bytes(
    ascii("GIF89a"),
    le16(width),
    le16(height),
    [0, 0, 0],
    ...frames.map((frame) => [0x21, 0xf9, 4, 0, 10, 0, 0, 0, ...gifFrame(frame)]),
    [0x3b]
  );

export const segment = (marker: number, payload: ReadonlyArray<number>) => [
  0xff,
  marker,
  ...be16(payload.length + 2),
  ...payload,
];

/** A frame header; `sampling` holds each component's packed H and V factors. */
export const sof = (
  width: number,
  height: number,
  marker = 0xc0,
  sampling: ReadonlyArray<number> = [0x11]
) =>
  segment(marker, [
    8,
    ...be16(height),
    ...be16(width),
    sampling.length,
    ...sampling.flatMap((factors, i) => [i + 1, factors, 0]),
  ]);

/** A scan header over the first `count` components. */
export const sos = (count: number) =>
  segment(0xda, [count, ...Array.from({ length: count }, (_, i) => [i + 1, 0]).flat(), 0, 63, 0]);

/** A JPEG: SOI, the given segments (default a JFIF APP0 and one SOF), then SOS (one if none). */
export const jpeg = (...segments: ReadonlyArray<ReadonlyArray<number>>) =>
  bytes(
    [0xff, 0xd8],
    segment(0xe0, [...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...segments,
    segments.some((part) => part[1] === 0xda) ? [] : sos(1),
    [0, 0xff, 0xd9]
  );

/** An EXIF APP1 carrying a whole thumbnail JPEG, SOF and all. */
export const exifThumbnail = (width: number, height: number) =>
  segment(0xe1, [...ascii("Exif"), 0, 0, ...jpeg(sof(width, height))]);

const riffChunk = (type: string, ...payload: ReadonlyArray<ReadonlyArray<number>>) => {
  const body = payload.flat();

  return [...ascii(type), ...le32(body.length), ...body, ...(body.length % 2 ? [0] : [])];
};

export const vp8 = (width: number, height: number) =>
  riffChunk("VP8 ", [0x10, 0, 0, 0x9d, 0x01, 0x2a], le16(width), le16(height), [0, 0]);

export const vp8l = (width: number, height: number) => {
  const bits = (width - 1) | ((height - 1) << 14);

  return riffChunk("VP8L", [0x2f], le32(bits >>> 0), [0, 0, 0, 0, 0]);
};

export const vp8x = (width: number, height: number, animated = false) =>
  riffChunk("VP8X", [animated ? 0x02 : 0, 0, 0, 0], le24(width - 1), le24(height - 1));

export const anmf = (frame: Rect, image = vp8l(frame.width, frame.height)) =>
  riffChunk(
    "ANMF",
    le24((frame.x ?? 0) / 2),
    le24((frame.y ?? 0) / 2),
    le24(frame.width - 1),
    le24(frame.height - 1),
    [100, 0, 0, 0],
    image
  );

export const animation = () => riffChunk("ANIM", [0, 0, 0, 0, 0, 0]);

export const webp = (...chunks: ReadonlyArray<ReadonlyArray<number>>) => {
  const body = [...ascii("WEBP"), ...chunks.flat()];

  return bytes(ascii("RIFF"), le32(body.length), body);
};

export const box = (type: string, ...body: ReadonlyArray<ReadonlyArray<number>>) => {
  const inner = body.flat();

  return [...be32(8 + inner.length), ...ascii(type), ...inner];
};

const fullBox = (type: string, version: number, ...body: ReadonlyArray<ReadonlyArray<number>>) =>
  box(type, [version, 0, 0, 0], ...body);

export const ispe = (width: number, height: number) =>
  fullBox("ispe", 0, be32(width), be32(height));

const leb128 = (n: number) => (n < 128 ? [n] : [(n & 0x7f) | 0x80, n >>> 7]);

const bitString = (fields: ReadonlyArray<readonly [value: number, width: number]>) => {
  const bits = fields.flatMap(([value, width]) =>
    Array.from({ length: width }, (_, i) => (value >>> (width - 1 - i)) & 1)
  );

  const padded = [...bits, ...Array.from({ length: (8 - (bits.length % 8)) % 8 }, () => 0)];

  return Array.from({ length: padded.length / 8 }, (_, i) =>
    padded.slice(i * 8, i * 8 + 8).reduce((byte, bit) => byte * 2 + bit, 0)
  );
};

const bitsFor = (n: number) => Math.max(1, Math.ceil(Math.log2(n)));

export interface Av1Color {
  readonly depth?: 8 | 10 | 12;
  readonly layout?: "420" | "444" | "mono";
}

/** `color_config` for the profile that carries `color`: 4:4:4 is profile 1, 12-bit profile 2. */
const colorConfig = (
  profile: number,
  color: Av1Color
): ReadonlyArray<readonly [number, number]> => [
  [color.depth === undefined || color.depth === 8 ? 0 : 1, 1],
  ...(profile === 2 ? ([[color.depth === 12 ? 1 : 0, 1]] as const) : []),
  ...(profile === 1 ? [] : ([[color.layout === "mono" ? 1 : 0, 1]] as const)),
  [0, 1],
  [0, 1],
  ...(profile === 2 && color.depth === 12 ? ([[color.layout === "444" ? 0 : 1, 1]] as const) : []),
];

/**
 * An AV1 sequence header OBU and one frame OBU; `reduced` picks the still-picture header, and
 * `color` the bit depth and chroma layout.
 */
export const av1 = (width: number, height: number, reduced = true, color: Av1Color = {}) => {
  const profile = color.depth === 12 ? 2 : color.layout === "444" ? 1 : 0;
  const w = bitsFor(width);
  const h = bitsFor(height);

  const size: ReadonlyArray<readonly [number, number]> = [
    [w - 1, 4],
    [h - 1, 4],
    [width - 1, w],
    [height - 1, h],
  ];

  const head: ReadonlyArray<readonly [number, number]> = reduced
    ? [
        [profile, 3],
        [1, 1],
        [1, 1],
        [0, 5],
      ]
    : [
        [profile, 3],
        [0, 1],
        [0, 1],
        [0, 1],
        [0, 1],
        [0, 5],
        [0, 12],
        [0, 5],
      ];

  const tools: ReadonlyArray<readonly [number, number]> = reduced
    ? [
        [0, 3],
        [0, 3],
      ]
    : [
        [0, 1],
        [0, 3],
        [0, 4],
        [0, 1],
        [0, 1],
        [0, 1],
        [0, 3],
      ];

  const sequence = bitString([...head, ...size, ...tools, ...colorConfig(profile, color)]);

  return [0x0a, ...leb128(sequence.length), ...sequence, 0x32, 1, 0];
};

export interface AvifItem {
  readonly type: "av01" | "grid" | "tmap";
  readonly ispe?: Rect;
  readonly data: ReadonlyArray<number>;
}

export const grid = (width: number, height: number) => [
  0,
  0,
  0,
  0,
  ...be16(width),
  ...be16(height),
];

export interface AvifExtras {
  /** Raw bytes after the items' properties in `ipco`. */
  readonly properties?: ReadonlyArray<number>;
  /** Raw top-level boxes after `meta`. */
  readonly after?: ReadonlyArray<number>;
  /** Compatible brands in `ftyp`, each 4 bytes of its length. */
  readonly brands?: ReadonlyArray<string>;
}

/** An AVIF whose items' bytes all live in `idat`, so offsets don't depend on the file layout. */
export const avif = (items: ReadonlyArray<AvifItem>, extras: AvifExtras = {}) => {
  const offsets = items.map((_, i) =>
    items.slice(0, i).reduce((sum, item) => sum + item.data.length, 0)
  );

  const withExtents = items.flatMap((item, i) => (item.ispe ? [{ item, i }] : []));

  const iloc = fullBox(
    "iloc",
    1,
    [0x44, 0x00],
    be16(items.length),
    ...items.map((item, i) => [
      ...be16(i + 1),
      0,
      1,
      0,
      0,
      0,
      1,
      ...be32(offsets[i] ?? 0),
      ...be32(item.data.length),
    ])
  );

  const iinf = fullBox(
    "iinf",
    0,
    be16(items.length),
    ...items.map((item, i) => box("infe", [2, 0, 0, 0], be16(i + 1), [0, 0], ascii(item.type), [0]))
  );

  const iprp = box(
    "iprp",
    box(
      "ipco",
      ...withExtents.map(({ item }) => ispe(item.ispe?.width ?? 0, item.ispe?.height ?? 0)),
      extras.properties ?? []
    ),
    fullBox(
      "ipma",
      0,
      be32(withExtents.length),
      ...withExtents.map(({ i }, property) => [...be16(i + 1), 1, 0x80 | (property + 1)])
    )
  );

  return bytes(
    box("ftyp", ascii("avif"), [0, 0, 0, 0], ...(extras.brands ?? ["mif1"]).map(ascii)),
    fullBox(
      "meta",
      0,
      box(
        "hdlr",
        Array.from({ length: 24 }, () => 0)
      ),
      iloc,
      iinf,
      iprp,
      box("idat", ...items.map((item) => item.data))
    ),
    extras.after ?? []
  );
};

export const still = (width: number, height: number, bitstream = av1(width, height)): AvifItem => ({
  type: "av01",
  ispe: { width, height },
  data: bitstream,
});
