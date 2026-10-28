/** The Working dither's frames baked into SVG masks: a horizontal sprite strip and a still. */
import { DITHER_CELL, DITHER_FRAMES, type DitherSize, ditherFrameAt, type LitCell } from "./cells";

function rects(cells: readonly LitCell[], offsetX: number): string {
  return cells
    .map(
      (cell) =>
        `<rect x="${cell.x + offsetX}" y="${cell.y}" width="${DITHER_CELL}" height="${DITHER_CELL}" fill-opacity="${cell.alpha.toFixed(2)}"/>`
    )
    .join("");
}

function svg(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">${body}</svg>`;
}

function dataUrl(markup: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(markup)}")`;
}

const cache = new Map<string, string>();

function cached(key: string, build: () => string): string {
  const hit = cache.get(key);

  if (hit !== undefined) return hit;

  const value = build();

  cache.set(key, value);

  return value;
}

/** A CSS mask of every frame side by side; stepped by translating it (DESIGN.md, Dither). */
export function ditherStripMask(size: DitherSize, intensity?: number): string {
  return cached(`strip:${size.width}x${size.height}:${intensity ?? ""}`, () => {
    let body = "";

    for (let frame = 0; frame < DITHER_FRAMES; frame++) {
      body += rects(ditherFrameAt(size, frame, intensity), frame * size.width);
    }

    return dataUrl(svg(size.width * DITHER_FRAMES, size.height, body));
  });
}

/** One still frame: the Starting pattern and the Reduce Motion stand-in. */
export function ditherStillMask(size: DitherSize, intensity?: number): string {
  return cached(`still:${size.width}x${size.height}:${intensity ?? ""}`, () =>
    dataUrl(svg(size.width, size.height, rects(ditherFrameAt(size, 0, intensity), 0)))
  );
}
