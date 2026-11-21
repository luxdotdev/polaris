/**
 * The horizon's geometry and colours: the theme's foot scene (design/assets/scenes, the Desktop
 * App's window foot) at the screen's foot, one image pixel to a device pixel, centred and cropped.
 */
import type { ThemeName } from "../theme/appearance.ts";

/** The horizon's box: the foot scene's hills, the sky over them and the fade into the ground. */
export const HORIZON_HEIGHT = 200;

/** Each foot scene is a 360×225 pixel scene drawn at 4×. */
export const FOOT_WIDTH = 1440;

export const FOOT_HEIGHT = 900;

/** The highest hill's top in the foot image (row 137 of the 225-row scene's skyline). */
export const HILLS_TOP_ROW = 4 * 137;

/** How much sky shows over the highest hill, and how far the scene fades in above that. */
const SKY_ABOVE = 24;

const FADE = 20;

export interface FootLayout extends FootFrame {
  /** The image's top in the horizon's box. */
  readonly top: number;
  /** Where the highest hill's top falls in the box. */
  readonly ridgeTop: number;
  /** The scene fades in from the ground between these, in the box. */
  readonly fadeTop: number;
  readonly fadeBottom: number;
}

export interface FootFrame {
  /** Device pixels to an image pixel: 1, or more on a screen wider than the image. */
  readonly scale: number;
  /** The image's left edge, width and height, in points. */
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

/** The foot image across a box `width` points wide with `ratio` device pixels to a point. */
export const footFrame = (width: number, ratio: number): FootFrame => {
  const pixels = Math.round(width * ratio);
  const scale = Math.max(1, Math.ceil(pixels / FOOT_WIDTH));
  const shown = FOOT_WIDTH * scale;

  return {
    scale,
    // A whole number of device pixels either side, so every image pixel lands on one.
    left: -Math.round((shown - pixels) / 2) / ratio,
    width: shown / ratio,
    height: (FOOT_HEIGHT * scale) / ratio,
  };
};

/** The foot image in the horizon's box, its foot on the box's, on a screen `width` points wide. */
export const footLayout = (width: number, ratio: number): FootLayout => {
  const frame = footFrame(width, ratio);
  const ridgeTop = HORIZON_HEIGHT - ((FOOT_HEIGHT - HILLS_TOP_ROW) * frame.scale) / ratio;
  const fadeTop = Math.max(0, ridgeTop - SKY_ABOVE);

  return {
    ...frame,
    top: HORIZON_HEIGHT - frame.height,
    ridgeTop,
    fadeTop,
    fadeBottom: fadeTop + FADE,
  };
};

/**
 * The image's top for a preview `height` tall whose highest hill stands `sky` points down, raised
 * no further than keeps its foot covered; whole device pixels.
 */
export const previewTop = (frame: FootFrame, ratio: number, height: number, sky: number): number =>
  Math.max(
    Math.round(sky * ratio) - HILLS_TOP_ROW * frame.scale,
    Math.round(height * ratio) - FOOT_HEIGHT * frame.scale
  ) / ratio;

/** The foot scene's colours (scene-*-foot.png): the sky along the hills, then far to near hills. */
export interface Hills {
  readonly sky: string;
  readonly far: string;
  readonly near: string;
}

/** Moonlit draws the Desktop App's night scene, Midnight its midnight scene. */
export const HILLS: Readonly<Record<ThemeName, Hills>> = {
  midnight: { sky: "#040508", far: "#0A0B0F", near: "#040406" },
  moonlit: { sky: "#1C2542", far: "#141A2C", near: "#0B0F1E" },
};
