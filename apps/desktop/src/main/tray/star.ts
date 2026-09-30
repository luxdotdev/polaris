/**
 * The menu bar star: the flat 16x16 Polaris mark (DESIGN.md, Brand) as a macOS template
 * image, drawn from the same cells as the pixel mark, at 1x and 2x.
 */
import { starCells } from "@polaris/ui/star";
import { nativeImage, type NativeImage } from "electron";

const bitmap = (scale: number) => {
  const size = 16 * scale;
  const pixels = Buffer.alloc(size * size * 4);

  for (const [x, y] of starCells()) {
    for (let dy = 0; dy < scale; dy++) {
      for (let dx = 0; dx < scale; dx++) {
        const at = ((y * scale + dy) * size + (x * scale + dx)) * 4;

        // Template images use alpha only; the colour channels stay black.
        pixels[at + 3] = 255;
      }
    }
  }

  return { size, pixels };
};

export const starImage = (): NativeImage => {
  const one = bitmap(1);
  const two = bitmap(2);
  const image = nativeImage.createFromBitmap(one.pixels, { width: one.size, height: one.size });

  image.addRepresentation({
    scaleFactor: 2,
    width: two.size,
    height: two.size,
    buffer: two.pixels,
  });
  image.setTemplateImage(true);

  return image;
};
