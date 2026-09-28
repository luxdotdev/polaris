"""Generate Polaris's dither frames (SVG) and state-coloured pixel icons.

The dither is a field of 2pt cells lit by a Bayer 4x4 threshold over a moving
diagonal wave. Each call renders one frame; vary `phase` to animate.
Standard library only:
    python3 design/scripts/gen_dither.py
Writes into design/assets/{dither,icons}.
"""
import math
import os

ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets")
BAYER4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]


def out(sub, name):
    d = os.path.join(ASSETS, sub)
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, name)


def dither(w, h, color, cell=2, phase=0.0, base=0.2, amp=0.6, k=2.2):
    rects = []
    for y in range(h // cell):
        for x in range(w // cell):
            v = base + amp * 0.5 * (1 + math.sin((x * 0.9 + y * 0.6) / k - phase))
            if (BAYER4[y % 4][x % 4] + 0.5) / 16 < v:
                rects.append(
                    f'<rect x="{x * cell}" y="{y * cell}" width="{cell}" height="{cell}" '
                    f'fill="{color}" fill-opacity="{min(0.4 + 0.6 * v, 1):.2f}"/>'
                )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
        f'viewBox="0 0 {w} {h}" shape-rendering="crispEdges">' + "".join(rects) + "</svg>"
    )


FRAMES = {
    "dither-claude-16": dict(w=16, h=16, color="#D97757"),
    "dither-claude-16-light": dict(w=16, h=16, color="#C4562F"),
    "dither-codex-16": dict(w=16, h=16, color="#6FCBA0", phase=1.5),
    "dither-codex-16-light": dict(w=16, h=16, color="#1E8A5C", phase=1.5),
    "dither-claude-24": dict(w=24, h=24, color="#D97757", base=0.15, amp=0.7),
    "dither-claude-band": dict(w=120, h=6, color="#D97757", base=0.1, amp=0.75, k=3.5),
    "dither-codex-band-light": dict(w=120, h=6, color="#1E8A5C", base=0.1, amp=0.75, k=3.5, phase=1),
}

# Nucleo pixel icons (hand, square-terminal, circle-xmark), recoloured per Session State.
HAND = ["M19 21V7", "M16 10V5H17", "M13 10L13 3H14", "M10 10V1H11", "M7 12V3H10", "M4 10V16", "M6 18L6 18.01", "M8 20V21"]
TERM = ["M13 16H17", "M19 3H5", "M19 21H5", "M3 19V5", "M21 19V5", "M11.01 12L11 12", "M9.01 14L9 14", "M7.01 16L7 16", "M7.01 8L7 8", "M9.01 10L9 10"]
XMARK = ["M8 22L16 22", "M18.01 20L18 20", "M6.01 20L6 20", "M20.01 18L20 18", "M4.01 18L4 18", "M16.01 16L16 16", "M8.01 16L8 16",
         "M14.01 14L14 14", "M10.01 14L10 14", "M12.01 12L12 12", "M14.01 10L14 10", "M10.01 10L10 10", "M22 8L22 16", "M16.01 8L16 8",
         "M8.01 8L8 8", "M2 8L2 16", "M20.01 6L20 6", "M4 6L4 6.01", "M18.01 4L18 4", "M6 4L6 4.01", "M8 2L16 2"]
ICONS = {
    "px-hand-needs-dark": (HAND, "#F2C84B"),
    "px-hand-needs-light": (HAND, "#A67C00"),
    "px-term-dark": (TERM, "#9A9CA4"),
    "px-term-light": (TERM, "#74767D"),
    "px-x-failed-dark": (XMARK, "#F0645A"),
    "px-x-failed-light": (XMARK, "#D23B30"),
}


def icon(paths, color):
    body = "".join(f'<path d="{d}"/>' for d in paths)
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" '
        f'stroke="{color}" stroke-width="2" stroke-linecap="square">{body}</svg>'
    )


if __name__ == "__main__":
    for name, kw in FRAMES.items():
        with open(out("dither", f"{name}.svg"), "w") as f:
            f.write(dither(**kw))
    for name, (paths, color) in ICONS.items():
        with open(out("icons", f"{name}.svg"), "w") as f:
            f.write(icon(paths, color))
