/**
 * Windows' notification-area star and taskbar badge as raw bitmaps, free of Electron so they
 * are testable anywhere (Paper W2). Pixels are BGRA, the order `nativeImage.createFromBitmap`
 * reads; the digits are a 3x5 pixel face, in keeping with the pixel star.
 */
import { starCells } from "@polaris/ui/star";

export interface Bitmap {
  /** Width and height in pixels. */
  readonly size: number;
  readonly pixels: Buffer;
}

/** DESIGN.md `needs-you` on a dark taskbar, `needs-you-light` (white digits) on a light one. */
export const badgeColors = (dark: boolean) =>
  dark ? { fill: "#F2C84B", ink: "#1A1B1D" } : { fill: "#B98A00", ink: "#FFFFFF" };

/** The star's colour against the taskbar: white on dark, near-black on light. */
export const starInk = (dark: boolean) => (dark ? "#FFFFFF" : "#1A1A1A");

const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));

const blank = (size: number): Bitmap => ({ size, pixels: Buffer.alloc(size * size * 4) });

const paint = (bitmap: Bitmap, x: number, y: number, hex: string, alpha = 1) => {
  if (x < 0 || y < 0 || x >= bitmap.size || y >= bitmap.size) return;
  const [r = 0, g = 0, b = 0] = rgb(hex);
  const at = (y * bitmap.size + x) * 4;

  bitmap.pixels[at] = b;
  bitmap.pixels[at + 1] = g;
  bitmap.pixels[at + 2] = r;
  bitmap.pixels[at + 3] = Math.round(alpha * 255);
};

const clear = (bitmap: Bitmap, x: number, y: number) => {
  if (x < 0 || y < 0 || x >= bitmap.size || y >= bitmap.size) return;
  bitmap.pixels.fill(0, (y * bitmap.size + x) * 4, (y * bitmap.size + x) * 4 + 4);
};

/** How much of the pixel at (x, y) a disc covers, sampled 4x4, for a soft edge. */
const coverage = (x: number, y: number, cx: number, cy: number, r: number) => {
  let inside = 0;

  for (let sy = 0; sy < 4; sy++) {
    for (let sx = 0; sx < 4; sx++) {
      const dx = x + (sx + 0.5) / 4 - cx;
      const dy = y + (sy + 0.5) / 4 - cy;

      if (dx * dx + dy * dy <= r * r) inside++;
    }
  }

  return inside / 16;
};

const disc = (bitmap: Bitmap, cx: number, cy: number, r: number, hex: string) => {
  for (let y = Math.floor(cy - r); y < Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x < Math.ceil(cx + r); x++) {
      const covered = coverage(x, y, cx, cy, r);

      if (covered > 0) paint(bitmap, x, y, hex, covered);
    }
  }
};

/**
 * The 16px star at `scale`, in `ink`; with `dot`, a needs-you dot at its lower right, cut
 * out of the star by a one-pixel gap so it reads at taskbar size.
 */
export const trayStar = (scale: number, ink: string, dot: string | null): Bitmap => {
  const bitmap = blank(16 * scale);

  for (const [x, y] of starCells()) {
    for (let dy = 0; dy < scale; dy++) {
      for (let dx = 0; dx < scale; dx++) paint(bitmap, x * scale + dx, y * scale + dy, ink);
    }
  }

  if (dot === null) return bitmap;

  const r = 3 * scale;
  const c = 16 * scale - r;

  for (let y = c - r - scale; y < 16 * scale; y++) {
    for (let x = c - r - scale; x < 16 * scale; x++) {
      if (coverage(x, y, c, c, r + scale) > 0) clear(bitmap, x, y);
    }
  }

  disc(bitmap, c, c, r, dot);

  return bitmap;
};

const GLYPHS = new Map(
  Object.entries({
    "0": ["111", "101", "101", "101", "111"],
    "1": ["010", "110", "010", "010", "111"],
    "2": ["111", "001", "111", "100", "111"],
    "3": ["111", "001", "111", "001", "111"],
    "4": ["101", "101", "111", "001", "001"],
    "5": ["111", "100", "111", "001", "111"],
    "6": ["111", "100", "111", "101", "111"],
    "7": ["111", "001", "001", "001", "001"],
    "8": ["111", "101", "111", "101", "111"],
    "9": ["111", "101", "111", "001", "111"],
    "+": ["000", "010", "111", "010", "000"],
  })
);

/** The badge's text: the count to 9, then "9+"; none at zero. */
export const badgeText = (count: number): string | null =>
  count <= 0 ? null : count > 9 ? "9+" : String(count);

/** The taskbar overlay: a 16px needs-you disc at `scale` with the count in pixel digits. */
export const taskbarBadge = (scale: number, text: string, dark: boolean): Bitmap => {
  const { fill, ink } = badgeColors(dark);
  const size = 16 * scale;
  const bitmap = blank(size);
  const width = text.length * 4 - 1;
  const left = Math.floor((16 - width) / 2) * scale;
  const top = Math.floor((16 - 5) / 2) * scale;

  disc(bitmap, size / 2, size / 2, size / 2, fill);

  Array.from(text, (char, i) => {
    (GLYPHS.get(char) ?? []).forEach((row, y) => {
      Array.from(row, (on, x) => {
        if (on !== "1") return;

        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            paint(bitmap, left + (i * 4 + x) * scale + dx, top + y * scale + dy, ink);
          }
        }
      });
    });
  });

  return bitmap;
};
