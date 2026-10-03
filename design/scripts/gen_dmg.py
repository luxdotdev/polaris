"""Generate the accepted dawn Installer background (DESIGN.md, Installer; Paper I3).

Deterministic 660×400 and 1320×800 PNGs; one scene cell is two points.
    uv run --with numpy --with pillow design/scripts/gen_dmg.py
"""
from pathlib import Path
import random
import sys

import numpy as np
from PIL import Image

sys.dont_write_bytecode = True
from gen_textures import CABIN_DAWN, hexc, place_cabin, scene

OUT = Path(__file__).resolve().parent.parent / "assets" / "dmg"
SKY = ["#C9D8F2", "#D8E1F4", "#E9E6F0", "#F6E4DA", "#FBE3CC", "#FCE9D2"]
HILLS = [("#B7C9A8", 0.70, 0.18, 3), ("#9DB78F", 0.78, 0.14, 5), ("#7FA074", 0.86, 0.10, 9)]


def background():
    img, ground, _ = scene(330, 200, SKY, HILLS, "#FFFFFF", False, 12)
    flowers = random.Random(4)
    for _ in range(round(260 * 330 * 200 / (360 * 225))):
        x = flowers.randrange(330)
        y = flowers.randrange(int(200 * 0.88), 200)
        img[y, x] = hexc(flowers.choice(["#F4D35E", "#FFFFFF", "#F2B5C4"]))
    place_cabin(img, ground, int(330 * 0.14), int(330 * 0.34), CABIN_DAWN)

    x0, tip, y = 141, 188, 95
    arrow = hexc("#4A4C52")
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
