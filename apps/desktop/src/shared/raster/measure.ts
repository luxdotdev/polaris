import { malformed } from "./bytes.ts";

export interface RasterSize {
  readonly width: number;
  readonly height: number;
}

/**
 * What Chromium will decode: the canvas, how many frames, and the bytes decoding takes, which
 * are every frame's, tile's and layer's output plus the decoder's own working buffers.
 */
export interface RasterMeasure extends RasterSize {
  readonly mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/avif";
  readonly frames: number;
  readonly decodedBytes: number;
  /** Pixels in the largest one image decoded: the canvas, or a gain map decoded beside it. */
  readonly largestPixels: number;
}

/** Chromium decodes to 4 bytes a pixel, or to 8 (half float) from samples deeper than 8 bits. */
export const outputBytes = (deep: boolean): number => (deep ? 8 : 4);

/**
 * One animation frame's buffer: Blink allocates every frame at the canvas size, and a frame's
 * dependency chain stays cached for the whole decode (see docs/adr/0058-preview-images-are-measured-before-decoding.md).
 */
export const canvasFrameBytes = (canvas: RasterSize): number => outputBytes(false) * area(canvas);

export const size = (width: number, height: number): RasterSize =>
  width > 0 && height > 0 ? { width, height } : malformed();

export const area = (rect: RasterSize): number => rect.width * rect.height;

/** A frame at (`x`, `y`) must lie inside the canvas: decoders grow the canvas, or clip, otherwise. */
export const inside = (canvas: RasterSize, x: number, y: number, frame: RasterSize): RasterSize =>
  x + frame.width <= canvas.width && y + frame.height <= canvas.height ? frame : malformed();

export const sameSize = (a: RasterSize, b: RasterSize): RasterSize =>
  a.width === b.width && a.height === b.height ? a : malformed();
