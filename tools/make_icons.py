#!/usr/bin/env python3
"""Draw the Money Quest mark (original: a shield-coin with a rising quest path) as PNGs.

    python3 tools/make_icons.py            # writes icons/*.png next to this repo's index.html

Requires Pillow. Geometry mirrors icons/icon.svg (512-unit grid).
"""
import math
import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "icons")
BG = (0, 0, 0, 255)
CYAN = (127, 227, 255, 255)
VIOLET = (167, 139, 250, 255)
S = 4  # supersampling


def shield_points(cx, top, w, h, r=36, n=40):
    """Heater shield: straight top with rounded corners, straight sides, curving to a point."""
    half = w / 2
    pts = []
    # top-left rounded corner
    for i in range(n + 1):
        a = math.pi + (math.pi / 2) * i / n
        pts.append((cx - half + r + r * math.cos(a), top + r + r * math.sin(a)))
    # top-right rounded corner
    for i in range(n + 1):
        a = 1.5 * math.pi + (math.pi / 2) * i / n
        pts.append((cx + half - r + r * math.cos(a), top + r + r * math.sin(a)))
    side = top + h * 0.42
    # right side straight down then curve to the point
    for i in range(n + 1):
        t = i / n
        pts.append((cx + half * (1 - t ** 2), side + (top + h - side) * math.sin(t * math.pi / 2)))
    for i in range(n, -1, -1):
        t = i / n
        pts.append((cx - half * (1 - t ** 2), side + (top + h - side) * math.sin(t * math.pi / 2)))
    return pts


def draw(size, safe=1.0, bg_full=True):
    U = size * S / 512.0
    im = Image.new("RGBA", (size * S, size * S), BG if bg_full else (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    k = safe

    def P(x, y):
        return ((256 + (x - 256) * k) * U, (256 + (y - 256) * k) * U)

    outer = [P(x, y) for x, y in shield_points(256, 84, 316, 352, r=44)]
    inner = [P(x, y) for x, y in shield_points(256, 84 + 24, 316 - 48, 352 - 58, r=24)]
    d.polygon(outer, fill=CYAN)
    d.polygon(inner, fill=BG)
    # coin ring
    cx, cy = P(256, 186)
    r = 50 * k * U
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=VIOLET, width=int(16 * k * U))
    # rising quest path: three steps
    path = [P(176, 318), P(222, 286), P(262, 300), P(330, 250)]
    d.line(path, fill=CYAN, width=int(20 * k * U), joint="curve")
    for p in path:
        rr = 10 * k * U
        d.ellipse([p[0] - rr, p[1] - rr, p[0] + rr, p[1] + rr], fill=CYAN)
    ex, ey = P(330, 250)
    rr = 18 * k * U
    d.ellipse([ex - rr, ey - rr, ex + rr, ey + rr], fill=CYAN)
    return im.resize((size, size), Image.LANCZOS)


os.makedirs(OUT, exist_ok=True)
draw(192).save(os.path.join(OUT, "icon-192.png"))
draw(512).save(os.path.join(OUT, "icon-512.png"))
draw(512, safe=0.72).save(os.path.join(OUT, "icon-maskable-512.png"))
draw(180).save(os.path.join(OUT, "apple-touch-icon.png"))
print("icons written to", os.path.abspath(OUT))
