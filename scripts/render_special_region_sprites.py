#!/usr/bin/env python3
"""
Renders sr_isle_lost_wreck_*.png (128×128 RGBA, hex-masked).
Forest of Secrets PNGs are **authored assets** in public/ — not generated here.
Run: python3 scripts/render_special_region_sprites.py
Requires: pillow
"""
from __future__ import annotations

import math
import os
import random

from PIL import Image

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "sprites", "overlays", "biomes")
SIZE = 128
VARIANTS = 4


def _rim_xz_cylinder(radius: float) -> list[tuple[float, float]]:
    out = []
    for i in range(6):
        th = (math.pi / 3) * i
        x = radius * math.cos(th)
        z = radius * math.sin(th)
        c, s = math.cos(math.pi / 6), math.sin(math.pi / 6)
        x2 = x * c + z * s
        z2 = -x * s + z * c
        out.append((x2, z2))
    return out


def _point_in_poly_xz(x: float, z: float, verts: list[tuple[float, float]]) -> bool:
    n = len(verts)
    inside = False
    j = n - 1
    for i in range(n):
        xi, zi = verts[i]
        xj, zj = verts[j]
        if (zi > z) != (zj > z):
            if x < (xj - xi) * (z - zi) / (zj - zi + 1e-30) + xi:
                inside = not inside
        j = i
    return inside


def make_hex_texture_mask(size: int, radius: float = 1.0):
    rim = _rim_xz_cylinder(radius)
    xs = [p[0] for p in rim]
    zs = [p[1] for p in rim]
    min_x, max_x = min(xs), max(xs)
    min_z, max_z = min(zs), max(zs)
    dx = max_x - min_x
    dz = max_z - min_z
    if dx < 1e-9:
        dx = 1.0
    if dz < 1e-9:
        dz = 1.0

    def inside(px: int, py: int) -> bool:
        u = px / (size - 1) if size > 1 else 0.0
        v = py / (size - 1) if size > 1 else 0.0
        wx = min_x + u * dx
        wz = min_z + (1.0 - v) * dz
        return _point_in_poly_xz(wx, wz, rim)

    return inside


def noise2(x: int, y: int, seed: int = 0) -> float:
    n = ((x * 374761393) ^ (y * 668265263) ^ seed) & 0xFFFFFFFF
    return (n % 10001) / 10001.0


def clamp(v: int) -> int:
    return max(0, min(255, v))


def new_rgba() -> Image.Image:
    return Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))


def apply_mask(im: Image.Image, mask) -> None:
    for y in range(SIZE):
        for x in range(SIZE):
            if not mask(x, y):
                im.putpixel((x, y), (0, 0, 0, 0))


def _blend_mist(
    base_r: int, base_g: int, base_b: int, mist_amt: float
) -> tuple[int, int, int, int]:
    mist = (88, 72, 102)
    r = int(base_r * (1 - mist_amt * 0.42) + mist[0] * mist_amt)
    g = int(base_g * (1 - mist_amt * 0.32) + mist[1] * mist_amt)
    b = int(base_b * (1 - mist_amt * 0.28) + mist[2] * mist_amt)
    a = int(195 + mist_amt * 58)
    return (clamp(r), clamp(g), clamp(b), clamp(a))


def _draw_tree(
    im: Image.Image,
    mask,
    rng: random.Random,
    cx: int,
    ground_y: int,
    height: int,
    trunk_w: int,
    lean: float,
) -> None:
    """Gnarled trunk (wobble + taper) + lumpy canopy blobs — readable silhouette, not a black bar."""
    trunk_c = [(22, 38, 30), (18, 32, 26), (26, 44, 34)]
    leaf_c = [(14, 52, 40), (18, 58, 44), (12, 46, 36), (24, 62, 48)]

    for dy in range(height):
        y = ground_y - dy
        if y < 0:
            break
        lean_x = int(lean * dy * 0.08)
        wobble = int(2.2 * math.sin(dy * 0.31) + rng.randint(-1, 1))
        tw = max(2, trunk_w - dy // 18)
        shade = min(14, dy // 6)
        ci = dy % 3
        tr, tg, tb = trunk_c[ci]
        tr, tg, tb = tr - shade, tg - shade // 2, tb - shade // 2
        for dx in range(-tw, tw + 1):
            xx = cx + lean_x + wobble + dx
            if 0 <= xx < SIZE and mask(xx, y):
                im.putpixel((xx, y), (clamp(tr), clamp(tg), clamp(tb), 255))

    # Crook / branch stubs (short horizontal pixels)
    for br in range(2):
        by = ground_y - height // 2 - br * 8
        dir_ = 1 if br % 2 == 0 else -1
        for k in range(4 + rng.randint(0, 3)):
            xx = cx + dir_ * k + br * 2
            yy = by + rng.randint(-1, 1)
            if 0 <= xx < SIZE and mask(xx, yy):
                im.putpixel((xx, yy), (20, 36, 28, 255))

    # Canopy: several overlapping filled-ish blobs
    top_y = ground_y - height - 4
    n_blobs = 5 + rng.randint(0, 2)
    for b in range(n_blobs):
        bx = cx + rng.randint(-20, 20)
        by = top_y + rng.randint(-14, 10)
        brx = 5 + rng.randint(0, 9)
        bry = 4 + rng.randint(0, 7)
        lr, lg, lb = leaf_c[b % len(leaf_c)]
        for py in range(by - bry, by + bry + 1):
            for px in range(bx - brx, bx + brx + 1):
                if (px - bx) ** 2 / max(1, brx**2) + (py - by) ** 2 / max(1, bry**2) > 1.0:
                    continue
                n = noise2(px, py, b * 997)
                if n > 0.88:
                    continue
                if 0 <= px < SIZE and 0 <= py < SIZE and mask(px, py):
                    d = abs(px - bx) + abs(py - by)
                    dark = d // 5
                    im.putpixel(
                        (px, py),
                        (clamp(lr - dark), clamp(lg - dark), clamp(lb - dark), 255),
                    )


def draw_forest_secrets(im: Image.Image, mask, rng: random.Random, variant: int) -> None:
    """Dark teal / deep forest + purple-grey mist (stronger toward top); gnarled trees."""
    # Per-variant palette jitter (same family)
    jr = variant * 2 - 3
    jg = (variant % 2) * 2
    jb = -variant

    for y in range(SIZE):
        for x in range(SIZE):
            if not mask(x, y):
                continue
            n = noise2(x, y, variant * 9973 + 11)
            mist_amt = (1.0 - (y / max(1, SIZE - 1))) ** 1.35 * 0.88 + n * 0.1
            base_r = 14 + jr + int(n * 8)
            base_g = 48 + jg + int(n * 10)
            base_b = 36 + jb + int(n * 8)
            r, g, b, a = _blend_mist(base_r, base_g, base_b, mist_amt)
            im.putpixel((x, y), (r, g, b, a))

    # Tree layouts per variant (ground contact y near bottom of hex)
    layouts = [
        [(42, 108, 44, 5, -0.9), (78, 104, 40, 4, 0.6), (58, 98, 36, 4, 0.0)],
        [(34, 102, 42, 5, 0.7), (88, 106, 38, 4, -0.8), (62, 94, 34, 3, 0.2)],
        [(50, 110, 46, 5, 0.0), (72, 100, 41, 4, -0.5), (92, 108, 32, 3, 1.0)],
        [(38, 106, 43, 5, 0.5), (68, 112, 45, 5, -0.4), (86, 96, 35, 4, 0.3)],
    ]
    trees = layouts[variant % len(layouts)]
    for tid, (tcx, tgy, th, tw, lean) in enumerate(trees):
        tr = random.Random(8100 + variant * 100 + tid * 17)
        _draw_tree(im, mask, tr, tcx, tgy, th, tw, lean)

    # Ground litter / roots (sparse darker pixels)
    for _ in range(160):
        px = rng.randint(8, SIZE - 9)
        py = rng.randint(SIZE // 2, SIZE - 6)
        if mask(px, py) and rng.random() > 0.55:
            im.putpixel((px, py), (20, 44, 34, 235))

    # Mist softens alpha at top of hex
    for y in range(SIZE // 3):
        for x in range(SIZE):
            if not mask(x, y):
                continue
            r, g, b, a = im.getpixel((x, y))
            fade = 0.52 + (y / max(1, SIZE / 3)) * 0.48
            im.putpixel((x, y), (r, g, b, int(a * fade)))


def _line_pixels(x0: int, y0: int, x1: int, y1: int) -> list[tuple[int, int]]:
    """Integer Bresenham — crisp 1px lines."""
    pts: list[tuple[int, int]] = []
    dx = abs(x1 - x0)
    dy = abs(y1 - y0)
    sx = 1 if x0 < x1 else -1
    sy = 1 if y0 < y1 else -1
    err = dx - dy
    x, y = x0, y0
    while True:
        pts.append((x, y))
        if x == x1 and y == y1:
            break
        e2 = 2 * err
        if e2 > -dy:
            err -= dy
            x += sx
        if e2 < dx:
            err += dx
            y += sy
    return pts


def _scatter_debris(
    im: Image.Image, mask, rng: random.Random, cx: int, cy: int, n: int
) -> None:
    for _ in range(n):
        px = cx + rng.randint(-18, 18)
        py = cy + rng.randint(-10, 10)
        if 0 <= px < SIZE and mask(px, py):
            im.putpixel((px, py), (42, 36, 32, 240))


def draw_isle_wreck(im: Image.Image, mask, rng: random.Random, variant: int) -> None:
    """Warm dark sand + weathered shipwreck; lower edge fades for water blend."""
    for y in range(SIZE):
        for x in range(SIZE):
            if not mask(x, y):
                continue
            n = noise2(x, y, variant * 909 + 3)
            r = int(88 + n * 22 + (variant % 2) * 3)
            g = int(82 + n * 18)
            b = int(72 + n * 16)
            # Slight wet darker toward bottom (beach into water)
            wet = (y / max(1, SIZE - 1)) ** 0.9
            r = int(r * (1 - wet * 0.12))
            g = int(g * (1 - wet * 0.1))
            b = int(b * (1 - wet * 0.08))
            base_a = 215
            im.putpixel((x, y), (clamp(r), clamp(g), clamp(b), base_a))

    wood_dark = (32, 28, 26, 255)
    wood_mid = (48, 40, 34, 255)
    wood_barn = (58, 52, 46, 255)
    rope = (38, 34, 30, 255)

    rng.seed(4200 + variant * 31)

    # Variant-specific hull geometry
    if variant == 0:
        hull_x0, hull_y0, ang, plen = 22, 72, 0.42, 52
    elif variant == 1:
        hull_x0, hull_y0, ang, plen = 30, 78, 0.28, 48
    elif variant == 2:
        hull_x0, hull_y0, ang, plen = 18, 68, 0.55, 50
    else:
        hull_x0, hull_y0, ang, plen = 26, 76, 0.35, 54

    # Broken hull main spine + offset planks (gaps)
    ca, sa = math.cos(ang), math.sin(ang)
    for i in range(plen):
        if rng.random() < 0.06:
            continue
        x = int(hull_x0 + ca * i)
        y = int(hull_y0 - sa * i)
        thick = 3 if i % 7 < 5 else 2
        for t in range(-thick, thick + 1):
            ox = int(-sa * t * 0.35)
            oy = int(ca * t * 0.35)
            xx, yy = x + ox, y + oy
            if 0 <= xx < SIZE and 0 <= yy < SIZE and mask(xx, yy):
                col = wood_mid if (i + t) % 3 else wood_dark
                im.putpixel((xx, yy), col)

    # Second broken section (snapped)
    off = 8 + variant * 3
    for i in range(plen // 2):
        if i % 9 < 2:
            continue
        x = int(hull_x0 + ca * i + sa * off + rng.randint(-1, 1))
        y = int(hull_y0 - sa * i + ca * off + rng.randint(0, 1))
        for w in range(2):
            if 0 <= x + w < SIZE and mask(x + w, y):
                im.putpixel((x + w, y), wood_barn if i % 4 else wood_dark)

    # Snapped mast (angled)
    mast_x = 48 + variant * 4
    mast_y = 58 - variant * 2
    mast_ang = 1.15 + variant * 0.08
    for i in range(18 + variant * 2):
        x = int(mast_x + math.cos(mast_ang) * i * 0.85)
        y = int(mast_y - math.sin(mast_ang) * i)
        for dx in range(-1, 2):
            if 0 <= x + dx < SIZE and 0 <= y < SIZE and mask(x + dx, y):
                im.putpixel((x + dx, y), wood_dark)

    # Rope / rigging lines (crisp pixels)
    for _ in range(14):
        x1 = rng.randint(30, 90)
        y1 = rng.randint(52, 78)
        x2 = x1 + rng.randint(-8, 8)
        y2 = y1 + rng.randint(2, 8)
        for px, py in _line_pixels(x1, y1, x2, y2):
            if 0 <= px < SIZE and 0 <= py < SIZE and mask(px, py):
                im.putpixel((px, py), rope)

    _scatter_debris(im, mask, rng, 56 + variant * 2, 82, 45)

    # Barnacle / char specks
    for _ in range(35):
        px = rng.randint(20, 100)
        py = rng.randint(58, 95)
        if mask(px, py):
            im.putpixel((px, py), (62, 58, 52, 250))

    # Ocean-side alpha fade: bottom of texture = more transparent
    for y in range(SIZE):
        edge_f = (y / max(1, SIZE - 1)) ** 1.1
        fade = 1.0 - edge_f * 0.42
        for x in range(SIZE):
            if not mask(x, y):
                continue
            r, g, b, a = im.getpixel((x, y))
            im.putpixel((x, y), (r, g, b, int(a * fade)))


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    mask = make_hex_texture_mask(SIZE)

    for v in range(VARIANTS):
        rng = random.Random(9000 + v * 1337)

        im = new_rgba()
        draw_forest_secrets(im, mask, rng, v)
        apply_mask(im, mask)
        im.save(os.path.join(OUT_DIR, f"sr_forest_secrets_{v}.png"))

        im = new_rgba()
        draw_isle_wreck(im, mask, rng, v)
        apply_mask(im, mask)
        im.save(os.path.join(OUT_DIR, f"sr_isle_lost_wreck_{v}.png"))

    print(f"Wrote {VARIANTS * 2} files to {OUT_DIR}")


if __name__ == "__main__":
    main()
