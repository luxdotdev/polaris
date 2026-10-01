"""Generate the Polaris app icon (DESIGN.md, Brand: App icon; Paper Brand deck, 07 · App icon).

The macOS squircle holds the night-sky scene cropped around Polaris with the shaded Starlight
star centred; at 32px and below the sky flattens to Night and the star goes flat. Every size is
drawn natively so the star stays on whole pixels. Deterministic. Requires numpy and pillow:
    uv run --with numpy --with pillow design/scripts/gen_app_icon.py
Writes design/assets/app-icon/{polaris.iconset,linux}/ and, on macOS, Polaris.icns (iconutil).
"""
import os
import shutil
import subprocess
import sys

import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, HERE)
from gen_dither import star_cells  # noqa: E402

ASSETS = os.path.join(HERE, "..", "assets")
OUT = os.path.join(ASSETS, "app-icon")

NIGHT = (0x0A, 0x0D, 0x1A)
# The shaded mark (outline, body, core), as polaris-logo-starlight.svg; flat is Starlight.
SHADED = ((0x7C, 0x9F, 0xE8), (0xBC, 0xD3, 0xFF), (0xFF, 0xFF, 0xFF))
FLAT = (0xBC, 0xD3, 0xFF)

# macOS icon grid: a 1024 canvas with an 824 body, so 100px of margin for the shadow.
BODY = 824 / 1024
# The brand deck's crop of scene-night.png, in the scene's own 1x pixels (360×225).
CROP = (216, 7, 69)
STAR_SHARE = 208 / 360
SQUIRCLE_N = 5.0
FLAT_AT = 32


def squircle_mask(size, n=SQUIRCLE_N, ss=4):
    """An anti-aliased superellipse |x|^n + |y|^n <= 1, the macOS continuous-corner shape."""
    s = size * ss
    c = (np.arange(s) + 0.5) / s * 2 - 1
    inside = (np.abs(c)[None, :] ** n + np.abs(c)[:, None] ** n) <= 1
    img = Image.fromarray((inside * 255).astype(np.uint8), "L")
    return img.resize((size, size), Image.BOX)


def star_layer(cell, flat):
    cells = star_cells()
    img = Image.new("RGBA", (16 * cell, 16 * cell), (0, 0, 0, 0))
    px = img.load()
    for x, y in cells:
        edge = any((x + ox, y + oy) not in cells for ox, oy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
        centre = abs(x - 7.5) + abs(y - 7.5) <= 2
        colour = FLAT if flat else SHADED[2] if centre else SHADED[0] if edge else SHADED[1]
        for dy in range(cell):
            for dx in range(cell):
                px[x * cell + dx, y * cell + dy] = (*colour, 255)
    return img


def compact_star():
    """A 7×7 flat star for 16px, where the 16-cell mark cannot fit on whole pixels."""
    img = Image.new("RGBA", (7, 7), (0, 0, 0, 0))
    px = img.load()
    for i in range(7):
        px[3, i] = px[i, 3] = (*FLAT, 255)
    for x, y in ((2, 2), (4, 2), (2, 4), (4, 4)):
        px[x, y] = (*FLAT, 255)
    return img


def sky(body):
    scene = Image.open(os.path.join(ASSETS, "scenes", "scene-night.png")).convert("RGB")
    base = scene.resize((scene.width // 4, scene.height // 4), Image.NEAREST)
    x, y, side = CROP
    crop = base.crop((x, y, x + side, y + side))
    scale = body / side
    if scale >= 1:
        whole = int(np.ceil(scale))
        big = crop.resize((side * whole, side * whole), Image.NEAREST)
        off = (big.width - body) // 2
        return big.crop((off, off, off + body, off + body))
    return crop.resize((body, body), Image.BOX)


def icon(size):
    body = round(size * BODY) if size > 16 else 14
    flat = size <= FLAT_AT
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    o = (size - body) // 2
    mask = squircle_mask(body)

    if size >= 64:
        # A soft drop shadow inside the margin, as the macOS template draws it.
        shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        shade = Image.new("RGBA", (body, body), (0, 0, 0, 77))
        shadow.paste(shade, (o, o + max(1, size // 100)), mask)
        canvas = Image.alpha_composite(canvas, shadow.filter(ImageFilter.GaussianBlur(size / 100)))

    ground = Image.new("RGBA", (body, body), (*NIGHT, 255)) if flat else sky(body).convert("RGBA")
    if size >= 64:
        # The brand deck's 8% white hairline along the inside of the edge.
        width = max(1, round(body / 360))
        inner = mask.filter(ImageFilter.MinFilter(2 * width + 1))
        edge = Image.fromarray(np.clip(np.asarray(mask, int) - np.asarray(inner, int), 0, 255).astype(np.uint8))
        line = Image.new("RGBA", (body, body), (255, 255, 255, 0))
        line.putalpha(edge.point(lambda v: v * 20 // 255))
        ground = Image.alpha_composite(ground, line)

    if size <= 16:
        star = compact_star()
    else:
        star = star_layer(max(1, round(body * STAR_SHARE / 16)), flat)
    ground.alpha_composite(star, ((body - star.width) // 2, (body - star.height) // 2))

    body_img = Image.new("RGBA", (body, body), (0, 0, 0, 0))
    body_img.paste(ground, (0, 0), mask)
    canvas.alpha_composite(body_img, (o, o))
    return canvas


ICONSET = [(16, 1), (16, 2), (32, 1), (32, 2), (128, 1), (128, 2), (256, 1), (256, 2), (512, 1), (512, 2)]
LINUX = [16, 32, 48, 64, 128, 256, 512, 1024]


def main():
    iconset = os.path.join(OUT, "polaris.iconset")
    linux = os.path.join(OUT, "linux")
    for d in (iconset, linux):
        shutil.rmtree(d, ignore_errors=True)
        os.makedirs(d)
    cache = {}
    def get(px):
        if px not in cache:
            cache[px] = icon(px)
        return cache[px]
    for pt, scale in ICONSET:
        suffix = "" if scale == 1 else "@2x"
        get(pt * scale).save(os.path.join(iconset, f"icon_{pt}x{pt}{suffix}.png"))
    for px in LINUX:
        get(px).save(os.path.join(linux, f"{px}x{px}.png"))
    get(1024).save(os.path.join(OUT, "icon-1024.png"))
    if shutil.which("iconutil"):
        subprocess.run(["iconutil", "-c", "icns", iconset, "-o", os.path.join(OUT, "Polaris.icns")], check=True)


if __name__ == "__main__":
    main()
