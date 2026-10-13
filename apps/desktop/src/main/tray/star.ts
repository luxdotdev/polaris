/**
 * The menu bar star: the flat 16x16 Polaris mark (DESIGN.md, Brand) at 1x and 2x. On macOS a
 * template image; on Windows drawn in the taskbar's ink with the needs-you dot (pixels.ts).
 */
import { nativeImage, type NativeImage } from "electron";
import { type Bitmap, trayStar } from "./pixels.ts";

/** A 1x and 2x image from one drawing. */
export const imageAt = (draw: (scale: number) => Bitmap): NativeImage => {
  const one = draw(1);
  const two = draw(2);
  const image = nativeImage.createFromBitmap(one.pixels, { width: one.size, height: one.size });

  image.addRepresentation({
    scaleFactor: 2,
    width: two.size,
    height: two.size,
    buffer: two.pixels,
  });

  return image;
};

/** macOS: template images use alpha only, so the star is drawn black and the OS tints it. */
export const starImage = (): NativeImage => {
  const image = imageAt((scale) => trayStar(scale, "#000000", null));

  image.setTemplateImage(true);

  return image;
};

/** Windows: white on a dark taskbar, near-black on a light one, with the needs-you dot. */
export const inkedStarImage = (ink: string, dot: string | null): NativeImage =>
  imageAt((scale) => trayStar(scale, ink, dot));
