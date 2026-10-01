/**
 * Where scene pixels land in the element: the scene is `background-size: cover` anchored at the
 * bottom centre, so one scene pixel is `scale` CSS px and the image is offset by (x, y).
 */
import type { Rect } from "./map";

export interface Cover {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

export const cover = (width: number, height: number, sceneW: number, sceneH: number): Cover => {
  const scale = Math.max(width / sceneW, height / sceneH);

  return { scale, x: (width - sceneW * scale) / 2, y: height - sceneH * scale };
};

/** A CSS-px box in the element as the scene pixels it covers. */
export const toScene = (
  box: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  },
  at: Cover
): Rect => {
  const x = Math.floor((box.left - at.x) / at.scale);
  const y = Math.floor((box.top - at.y) / at.scale);

  return {
    x,
    y,
    w: Math.ceil((box.left + box.width - at.x) / at.scale) - x,
    h: Math.ceil((box.top + box.height - at.y) / at.scale) - y,
  };
};
