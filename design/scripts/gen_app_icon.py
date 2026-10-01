"""Generate the Polaris app icon (DESIGN.md, Brand: App icon; Paper Brand deck, 07 · App icon).

The macOS squircle holds the night-sky scene cropped around Polaris with the shaded Starlight
star centred; at 32px and below the sky flattens to Night and the star goes flat. Every size is
drawn natively so the star stays on whole pixels. Deterministic. Requires numpy and pillow:
    uv run --with numpy --with pillow design/scripts/gen_app_icon.py
Writes design/assets/app-icon/{polaris.iconset,linux}/ and, on macOS, Polaris.icns (iconutil).

The dev variant ("dusk", for Polaris Dev) keeps the squircle, star and size ladder but swaps the
sky for a dithered pixel sunset: deep night at the top, violet behind the star, rose and a
lamplight horizon under a dark ridge. It goes to design/assets/app-icon/dusk/ (PolarisDev.icns).
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


# Dusk, top to bottom: Night, the night scene's navy, violet behind the star, rose, ember, Lamplight.
DUSK = ["#0A0D1A", "#161B36", "#2A2350", "#4A2D63", "#7A3A6E", "#B5577A", "#E07F5F", "#F2C27A"]
# Where each colour sits down the sky (0 top, 1 horizon); the star's centre stays on violet.
DUSK_STOPS = [0.0, 0.18, 0.40, 0.58, 0.70, 0.80, 0.89, 0.97]
RIDGE = (0x0D, 0x10, 0x22)
BAYER4 = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]) / 16 + 1 / 32


def hexc(h):
    return tuple(int(h.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))


def dusk_index(v, t):
    """The palette index for depth v (0 top, 1 horizon), dithered across each band by threshold t."""
    i = int(np.searchsorted(DUSK_STOPS, v, side="right")) - 1
    i = min(max(i, 0), len(DUSK) - 2)
    span = DUSK_STOPS[i + 1] - DUSK_STOPS[i]
    frac = min(max((v - DUSK_STOPS[i]) / span, 0.0), 1.0)
    return i + 1 if frac > t else i


def dusk_cells(n, flat):
    """An n×n pixel sunset: dithered bands (flat: plain bands), a ridge, and early stars up top."""
    img = Image.new("RGB", (n, n))
    px = img.load()
    ridge = [0.88 + 0.035 * np.sin(x / n * 7.1) + 0.02 * np.sin(x / n * 17.3 + 1.2) for x in range(n)]
    for y in range(n):
        v = y / (n - 1) * 1.04
        for x in range(n):
            if not flat and y / (n - 1) >= ridge[x]:
                px[x, y] = RIDGE
                continue
            t = 0.5 if flat else BAYER4[y % 4][x % 4]
            px[x, y] = hexc(DUSK[dusk_index(v, t)])
    if flat and n >= 24:
        for y in range(n - max(2, n // 10), n):
            for x in range(n):
                px[x, y] = RIDGE
    if not flat:
        rng = np.random.default_rng(11)
        for _ in range(n // 6):
            x, y = int(rng.integers(0, n)), int(rng.integers(1, int(n * 0.3)))
            if abs(x - n / 2) > n * 0.22:
                px[x, y] = (0xFF, 0xFF, 0xFF) if rng.random() < 0.5 else FLAT
    return img


def dusk_sky(body, flat):
    side = body if flat else CROP[2]
    cells = dusk_cells(side, flat)
    if flat:
        return cells
    whole = int(np.ceil(body / side))
    big = cells.resize((side * whole, side * whole), Image.NEAREST)
    off = (big.width - body) // 2
    return big.crop((off, off, off + body, off + body))


def icon(size, dusk=False):
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

    if dusk:
        ground = dusk_sky(body, flat).convert("RGBA")
    elif flat:
        ground = Image.new("RGBA", (body, body), (*NIGHT, 255))
    else:
        ground = sky(body).convert("RGBA")
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


def write_set(out, iconset_name, icns_name, dusk):
    iconset = os.path.join(out, iconset_name)
    linux = os.path.join(out, "linux")
    for d in (iconset, linux):
        shutil.rmtree(d, ignore_errors=True)
        os.makedirs(d)
    cache = {}

    def get(px):
        if px not in cache:
            cache[px] = icon(px, dusk)
        return cache[px]

    for pt, scale in ICONSET:
        suffix = "" if scale == 1 else "@2x"
        get(pt * scale).save(os.path.join(iconset, f"icon_{pt}x{pt}{suffix}.png"))
    for px in LINUX:
        get(px).save(os.path.join(linux, f"{px}x{px}.png"))
    get(1024).save(os.path.join(out, "icon-1024.png"))
    if shutil.which("iconutil"):
        subprocess.run(["iconutil", "-c", "icns", iconset, "-o", os.path.join(out, icns_name)], check=True)


def main():
    write_set(OUT, "polaris.iconset", "Polaris.icns", False)
    write_set(os.path.join(OUT, "dusk"), "polaris-dev.iconset", "PolarisDev.icns", True)


if __name__ == "__main__":
    main()
