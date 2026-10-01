/**
 * Sizing and caching for sent images' previews (pure): the box a thumbnail
 * takes before its bytes arrive, which attachments are previewed at all, and
 * a small LRU that releases what it drops.
 */

/** Thumbnails are made at this longest edge (2× the largest box). */
export const THUMB_EDGE = 480;

/** Images larger than this aren't fetched for a preview; they show as a file chip. */
export const MAX_PREVIEW_BYTES = 32 * 1024 * 1024;

/** Formats Chromium decodes. */
const PREVIEWABLE = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
]);

export interface PreviewSource {
  readonly mimeType: string;
  readonly size: number;
}

export const isPreviewable = (a: PreviewSource) =>
  PREVIEWABLE.has(a.mimeType) && a.size <= MAX_PREVIEW_BYTES;

export interface Box {
  readonly width: number;
  readonly height: number;
}

/** One image fits 240×180; several fit 112×112 each, so a row of them stays compact. */
const SINGLE: Box = { width: 240, height: 180 };

const MANY: Box = { width: 112, height: 112 };

/**
 * The box a thumbnail reserves, from the image's stored size (no layout shift
 * when it loads); a square when the size is unknown (attachments staged before
 * sizes were recorded), shown cropped.
 */
export const previewBox = (
  size: { readonly width: number | null; readonly height: number | null },
  count: number
): Box => {
  const bound = count > 1 ? MANY : SINGLE;
  const { width, height } = size;

  if (width === null || height === null || width <= 0 || height <= 0)
    return { width: bound.height, height: bound.height };

  const scale = Math.min(bound.width / width, bound.height / height, 1);

  // Very thin images keep a minimum so they stay clickable.
  return {
    width: Math.max(24, Math.round(width * scale)),
    height: Math.max(24, Math.round(height * scale)),
  };
};

/** A bounded map that calls `release` on what it evicts (object URLs). */
export class Lru<V> {
  private readonly entries = new Map<string, V>();

  constructor(
    private readonly capacity: number,
    private readonly release: (value: V) => void
  ) {}

  get(key: string): V | undefined {
    const value = this.entries.get(key);

    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);

    return value;
  }

  set(key: string, value: V) {
    const old = this.entries.get(key);

    if (old !== undefined && old !== value) this.release(old);
    this.entries.delete(key);
    this.entries.set(key, value);

    for (const [k, v] of this.entries) {
      if (this.entries.size <= this.capacity) break;
      this.entries.delete(k);
      this.release(v);
    }
  }

  get size() {
    return this.entries.size;
  }
}
