#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Wrap the existing natively drawn PNG sizes in an ICO without resampling the pixel art. */
export const windowsIcon = (source: string): Buffer => {
  const sizes = [16, 32, 48, 64, 128, 256];
  const images = sizes.map((size) => readFileSync(join(source, `${size}x${size}.png`)));
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;

  for (const [index, size] of sizes.entries()) {
    const entry = 6 + index * 16;
    const png = images[index]!;
    header[entry] = header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  }

  return Buffer.concat([header, ...images]);
};

if (import.meta.main) {
  const icons = join(import.meta.dir, "../../../../design/assets/app-icon");
  writeFileSync(join(icons, "Polaris.ico"), windowsIcon(join(icons, "linux")));
}
