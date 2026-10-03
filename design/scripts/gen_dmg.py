"""Generate the accepted Installer background (DESIGN.md, Installer; Paper I1).

Deterministic 660×400 and 1320×800 PNGs; one scene cell is two points.
    uv run --with numpy --with pillow design/scripts/gen_dmg.py
"""
from pathlib import Path
import sys

import numpy as np
from PIL import Image

sys.dont_write_bytecode = True
from gen_textures import CABIN_NIGHT, hexc, place_cabin, scene

OUT = Path(__file__).resolve().parent.parent / "assets" / "dmg"
SKY = ["#070912", "#0A0D1A", "#0E1325", "#141B33", "#1C2542", "#27304F"]
HILLS = [("#141A2C", 0.70, 0.18, 3), ("#10152A", 0.78, 0.14, 5), ("#0B0F1E", 0.86, 0.10, 9)]


def clear_stars(img, stars, bounds):
    x0, y0, x1, y1 = bounds
    for x, y, colour, under in stars:
        if x0 <= x < x1 and y0 <= y < y1 and np.array_equal(img[y, x], hexc(colour)):
            img[y, x] = hexc(under)


def background():
    img, ground, motion = scene(330, 200, SKY, HILLS, "#BCD3FF", True, 11)
    place_cabin(img, ground, int(330 * 0.14), int(330 * 0.34), CABIN_NIGHT)
    for cx, cy in ((165, 190), (495, 190)):
        clear_stars(img, motion["stars"], ((cx - 58) // 2, (cy - 58) // 2,
                    (cx + 58) // 2 + 1, (cy + 80) // 2 + 1))

    x0, tip, y = 141, 188, 95
    clear_stars(img, motion["stars"], (x0 - 3, y - 7, tip + 4, y + 8))
    arrow = hexc("#C9D0E0")
    for i in range(0, 46, 3):
        img[y, x0 + i:x0 + i + 2] = arrow
    for d in range(1, 6):
        img[y - d, tip - d - 1:tip - d + 1] = arrow
        img[y + d, tip - d - 1:tip - d + 1] = arrow
    img[y, tip - 1:tip + 1] = arrow
    return Image.fromarray(np.clip(img, 0, 255).astype("uint8"))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    native = background()
    for scale, name in ((2, "background.png"), (4, "background@2x.png")):
        native.resize((330 * scale, 200 * scale), Image.Resampling.NEAREST).save(OUT / name)
    print(f"wrote {OUT}: 660×400 and 1320×800")


if __name__ == "__main__":
    main()
