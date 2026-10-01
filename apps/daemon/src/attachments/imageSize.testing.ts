/** Image headers for tests: byte builders and a PNG of 1200×800. */

/** An ASCII tag's bytes. */
export const tag = (text: string): Array<number> =>
  Array.from({ length: text.length }, (_, n) => text.charCodeAt(n));

export const zeros = (count: number): Array<number> => Array.from({ length: count }, () => 0);

export const bytes = (...parts: ReadonlyArray<ReadonlyArray<number>>) =>
  new Uint8Array(parts.flat());

export const u32be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

export const u16le = (n: number) => [n & 255, (n >>> 8) & 255];

export const u24le = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];

export const PNG_1200x800 = bytes(
  [0x89],
  tag("PNG"),
  [0x0d, 0x0a, 0x1a, 0x0a],
  u32be(13),
  tag("IHDR"),
  u32be(1200),
  u32be(800),
  [8, 6, 0, 0, 0]
);
