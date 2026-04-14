#!/usr/bin/env python3
"""
Build 64x64 unit sprites by editing existing game sprites (archer, infantry, cavalry)
so palette and scale match shipped assets.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
UNITS = ROOT / "public" / "sprites" / "units"


def _load(name: str) -> Image.Image:
    return Image.open(UNITS / name).convert("RGBA")


def _save(im: Image.Image, name: str) -> None:
    path = UNITS / name
    im.save(path, format="PNG", compress_level=9)
    print("Wrote", path, im.size)


def _lum(r: int, g: int, b: int) -> float:
    return 0.299 * r + 0.587 * g + 0.114 * b


def _steel_from_rgb(r: int, g: int, b: int, a: int) -> tuple[int, int, int, int]:
    """Map any color to a cool steel ramp by luminance (top-left lit)."""
    L = _lum(r, g, b)
    if L < 55:
        t = (48, 54, 62)
    elif L < 85:
        t = (68, 76, 86)
    elif L < 115:
        t = (92, 104, 116)
    elif L < 150:
        t = (122, 136, 148)
    elif L < 190:
        t = (168, 184, 196)
    else:
        t = (210, 222, 230)
    return (*t, a)


def _is_green_cloth(r: int, g: int, b: int) -> bool:
    """Archer hood/cloak — greens and dark teals."""
    if g < 40:
        return False
    # obvious green
    if g > r + 8 and g > b + 8:
        return True
    # dark teal foliage green in shadows
    if g >= r - 3 and g >= b - 3 and r + g + b < 220 and b < 90:
        return True
    return False


def _is_bow_wood(r: int, g: int, b: int, a: int, x: int, y: int) -> bool:
    """Warm wood tones for the original recurve bow (tight bbox — not legs/quiver)."""
    if a < 200:
        return False
    if not (17 <= x <= 42 and 12 <= y <= 34):
        return False
    if r > 95 and g < r and b < r - 5 and g > 45:
        return True
    if r > 110 and 55 < g < 100 and b < 85:
        return True
    return False


def draw_crossbow(im: Image.Image) -> None:
    """Compact horizontal crossbow at chest — stock + short prod (does not span whole torso)."""
    px = im.load()
    w1, w2 = (124, 84, 56, 255), (108, 72, 50, 255)
    s1, s2 = (82, 92, 102, 255), (148, 162, 172, 255)
    y0, y1 = 30, 31
    for x in range(21, 41):
        px[x, y0] = w1 if x % 2 == 0 else w2
        px[x, y1] = w2 if x % 2 == 0 else w1
    for dy in (-1, 2):
        for x in (21, 22, 39, 40):
            px[x, y0 + dy] = s1
    px[20, y0] = s2
    px[41, y0] = s2
    px[30, y0 - 2] = (195, 205, 212, 255)


def draw_vertical_longbow(im: Image.Image) -> None:
    """Tall stave left of figure; lighten string column."""
    px = im.load()
    for y in range(7, 54):
        px[16, y] = (96, 68, 48, 255) if y % 3 else (120, 82, 55, 255)
        px[17, y] = (140, 96, 64, 255)
        px[18, y] = (108, 74, 52, 255)
    px[16, 6] = (88, 60, 44, 255)
    px[17, 5] = (120, 82, 55, 255)
    px[16, 53] = (88, 60, 44, 255)
    for y in range(9, 50):
        px[19, y] = (200, 200, 205, 255)


def make_marksman() -> Image.Image:
    im = _load("archer.png")
    px = im.load()
    for y in range(64):
        for x in range(64):
            r, g, b, a = px[x, y]
            if a < 128:
                continue
            if _is_green_cloth(r, g, b):
                px[x, y] = _steel_from_rgb(r, g, b, a)
            elif _is_bow_wood(r, g, b, a, x, y):
                px[x, y] = (0, 0, 0, 0)
    draw_crossbow(im)
    # Slightly bulkier shoulders: metal flecks
    for x, y in ((22, 21), (41, 21), (23, 22), (40, 22)):
        if px[x, y][3] > 128:
            px[x, y] = (150, 168, 178, 255)
    return im


def make_longbowman() -> Image.Image:
    im = _load("archer.png")
    px = im.load()
    for y in range(64):
        for x in range(64):
            r, g, b, a = px[x, y]
            if a < 128:
                continue
            # Leaner look: shift heavy greens to muted olive-brown
            if _is_green_cloth(r, g, b):
                L = _lum(r, g, b)
                if L < 100:
                    px[x, y] = (58, 72, 58, a)
                else:
                    px[x, y] = (72, 92, 72, a)
            elif _is_bow_wood(r, g, b, a, x, y):
                px[x, y] = (0, 0, 0, 0)
    draw_vertical_longbow(im)
    return im


def make_paladin() -> Image.Image:
    im = _load("infantry.png")
    px = im.load()
    # Boost metal pixels toward plate shine
    for y in range(64):
        for x in range(64):
            r, g, b, a = px[x, y]
            if a < 128:
                continue
            if b > r - 15 and b > g - 10 and r + g + b > 200:
                px[x, y] = (min(255, r + 18), min(255, g + 18), min(255, b + 22), a)
            elif 70 < r < 160 and 70 < g < 160 and 70 < b < 160:
                px[x, y] = (min(255, r + 12), min(255, g + 12), min(255, b + 15), a)
    # Emblem on round shield (keep silhouette — overlay only)
    for (x, y) in ((17, 31), (18, 31), (19, 31), (18, 30), (18, 32)):
        if px[x, y][3] > 128:
            px[x, y] = (168, 52, 52, 255)
    # Longer blade
    for yy in range(11, 22):
        px[44, yy] = (188, 198, 206, 255)
        px[43, yy] = (130, 142, 152, 255)
    return im


def _is_horse_coat(r: int, g: int, b: int) -> bool:
    return 95 < r < 200 and 45 < g < r and b < r and g > 40


def make_knight() -> Image.Image:
    im = _load("cavalry.png")
    px = im.load()
    # Barding: only on horse brown pixels, sparse plate flecks
    for y in (39, 42, 45):
        for x in range(18, 48):
            r, g, b, a = px[x, y]
            if a < 128 or not _is_horse_coat(r, g, b):
                continue
            if (x + y) % 4 == 0:
                px[x, y] = (122, 136, 148, 255)
    for x in range(45, 51):
        r, g, b, a = px[x, 35]
        if a > 128 and _is_horse_coat(r, g, b):
            px[x, 35] = (118, 130, 142, 255)
    # Lance pennon
    px[50, 14] = (200, 60, 60, 255)
    px[51, 13] = (220, 90, 90, 255)
    px[52, 14] = (200, 60, 60, 255)
    return im


def main() -> None:
    _save(make_marksman(), "marksman.png")
    _save(make_longbowman(), "longbowman.png")
    _save(make_paladin(), "paladin.png")
    _save(make_knight(), "knight.png")


if __name__ == "__main__":
    main()
