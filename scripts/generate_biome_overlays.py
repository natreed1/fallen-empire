#!/usr/bin/env python3
"""
Medieval fantasy biome overlays — 4 variants per land/water type + coast + beach.
Run: python3 scripts/generate_biome_overlays.py  |  npm run generate-biomes
Requires: pip install pillow
"""
from __future__ import annotations

import math
import os
import random
from typing import Callable

try:
    from PIL import Image, ImageDraw
except ImportError:
    raise SystemExit("Install Pillow: pip install pillow")

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "sprites", "overlays", "biomes")
SIZE = 128
FEATURE_SIZE = 48
VARIANTS = 4


def _rim_xz_cylinder(radius: float) -> list[tuple[float, float]]:
    """Same 6 rim points as Three.js CylinderGeometry(r,6) + rotateY(π/6)."""
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
    """
    Pixels (px,py) ↔ (u,v) ↔ world (x,z) using the same planar mapping as
    src/lib/hexTopGeometry.ts so PNG art fills the instanced hex cap.
    """
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


def _clamp255(v: float) -> int:
    return max(0, min(255, int(v)))


def _smoothstep(edge0: float, edge1: float, x: float) -> float:
    if edge1 - edge0 < 1e-9:
        return 1.0 if x >= edge0 else 0.0
    t = max(0.0, min(1.0, (x - edge0) / (edge1 - edge0)))
    return t * t * (3.0 - 2.0 * t)


def draw_water(im: Image.Image, draw: ImageDraw.ImageDraw, mask, rng: random.Random) -> None:
    base = (42, 88, 118)
    for y in range(SIZE):
        for x in range(SIZE):
            if not mask(x, y):
                continue
            n = noise2(x, y, rng.randint(0, 9999))
            wave = 0.5 + 0.5 * math.sin((x + y) * (0.1 + rng.random() * 0.04) + n * 3)
            r = int(base[0] + wave * 28 + n * 18)
            g = int(base[1] + wave * 22 + n * 12)
            b = int(base[2] + wave * 20 + n * 14)
            im.putpixel((x, y), (min(255, r), min(255, g), min(255, b), 255))
    for _ in range(160 + rng.randint(0, 120)):
        x = rng.randint(0, SIZE - 1)
        y = rng.randint(0, SIZE - 1)
        if not mask(x, y):
            continue
        if noise2(x, y, rng.randint(0, 255)) > 0.68:
            for dx, dy in ((0, 0), (1, 0), (0, 1), (-1, 0)):
                if mask(x + dx, y + dy):
                    im.putpixel((x + dx, y + dy), (165, 210, 228, 255))


def draw_water_coast(im: Image.Image, draw: ImageDraw.ImageDraw, mask, rng: random.Random) -> None:
    """Shallow water: lighter, foam, sand bleed from bottom of hex."""
    for y in range(SIZE):
        for x in range(SIZE):
            if not mask(x, y):
                continue
            depth = (y / SIZE) ** 0.7
            sand = max(0, (depth - 0.35) * 2.2)
            r = int(55 + sand * 85 + noise2(x, y, 1) * 20)
            g = int(120 + sand * 40 + noise2(x, y, 2) * 25)
            b = int(155 + sand * 25 + noise2(x, y, 3) * 20)
            im.putpixel((x, y), (min(255, r), min(255, g), min(255, b), 255))
    for _ in range(280 + rng.randint(0, 100)):
        x = rng.randint(0, SIZE - 1)
        y = rng.randint(0, SIZE - 1)
        if not mask(x, y):
            continue
        if noise2(x, y, 4) > 0.45:
            im.putpixel((x, y), (235, 248, 252, 255))
    for _ in range(40):
        x = rng.randint(0, SIZE - 2)
        y = rng.randint(SIZE // 2, SIZE - 1)
        if mask(x, y):
            im.putpixel((x, y), (210, 195, 150, 255))


def draw_beach(im: Image.Image, draw: ImageDraw.ImageDraw, mask, rng: random.Random) -> None:
    """Warm sand strip with wet edge — sits on land hexes by water."""
    for y in range(SIZE):
        for x in range(SIZE):
            if not mask(x, y):
                continue
            edge = abs(y - SIZE * 0.55) / (SIZE * 0.45)
            wet = max(0, 1.0 - edge * 1.4) * 0.35
            n = noise2(x, y, 5)
            r = int(195 + n * 25 - wet * 40)
            g = int(165 + n * 20 - wet * 35)
            b = int(110 + n * 15 - wet * 25)
            im.putpixel((x, y), (min(255, r), min(255, g), min(255, b), 255))
    for _ in range(100):
        x = rng.randint(0, SIZE - 1)
        y = rng.randint(SIZE // 2, SIZE - 1)
        if mask(x, y):
            im.putpixel((x, y), (140, 150, 160, 255))


def draw_plains(im: Image.Image, draw: ImageDraw.ImageDraw, mask, rng: random.Random) -> None:
    base = (118, 138, 72)
    for y in range(SIZE):
        for x in range(SIZE):
            if not mask(x, y):
                continue
            n = noise2(x, y, rng.randint(1, 99))
            g = int(base[1] + n * 38 - 12)
            r = int(base[0] + n * 22)
            b = int(base[2] + n * 18)
            im.putpixel((x, y), (min(255, r), min(255, g), min(255, b), 255))
    tufts = 320 + rng.randint(0, 200)
    for _ in range(tufts):
        x = rng.randint(2, SIZE - 3)
        y = rng.randint(2, SIZE - 3)
        if not mask(x, y):
            continue
        c = (48 + rng.randint(0, 45), 88 + rng.randint(0, 45), 28 + rng.randint(0, 30))
        h = rng.randint(2, 4)
        for dy in range(h):
            if mask(x, y - dy):
                im.putpixel((x, y - dy), (*c, 255))
            if rng.random() > 0.3 and mask(x - 1, y - dy):
                im.putpixel((x - 1, y - dy), (*c, 255))
    for _ in range(25 + rng.randint(0, 25)):
        x = rng.randint(4, SIZE - 5)
        y = rng.randint(4, SIZE - 5)
        if mask(x, y) and rng.random() > 0.4:
            im.putpixel((x, y), (215, 75, 85, 255))
            if rng.random() > 0.5:
                im.putpixel((x + 1, y), (255, 215, 90, 255))


def draw_forest(im: Image.Image, draw: ImageDraw.ImageDraw, mask, rng: random.Random) -> None:
    dark = (32, 68, 36)
    for y in range(SIZE):
        for x in range(SIZE):
            if not mask(x, y):
                continue
            n = noise2(x, y, rng.randint(1, 50))
            r = int(dark[0] + n * 28)
            g = int(dark[1] + n * 32)
            b = int(dark[2] + n * 22)
            im.putpixel((x, y), (min(255, r), min(255, g), min(255, b), 255))
    trees = 95 + rng.randint(0, 80)
    for _ in range(trees):
        x = rng.randint(8, SIZE - 9)
        y = rng.randint(8, SIZE - 9)
        if not mask(x, y):
            continue
        trunk = (58, 40, 26)
        top = (22 + rng.randint(0, 28), 72 + rng.randint(0, 45), 28 + rng.randint(0, 22))
        h = 4 + rng.randint(0, 3)
        for dy in range(h):
            w = max(1, 4 - dy // 2)
            for dx in range(-w, w + 1):
                px, py = x + dx, y - dy
                if 0 <= px < SIZE and 0 <= py < SIZE and mask(px, py):
                    im.putpixel((px, py), (*top, 255))
        th = 2 + rng.randint(0, 2)
        for dy in range(th):
            if mask(x, y + dy):
                im.putpixel((x, y + dy), (*trunk, 255))
    for _ in range(35):
        x = rng.randint(4, SIZE - 5)
        y = rng.randint(4, SIZE - 5)
        if mask(x, y) and rng.random() > 0.65:
            im.putpixel((x, y), (50, 110, 55, 255))


def draw_mountain(im: Image.Image, draw: ImageDraw.ImageDraw, mask, rng: random.Random) -> None:
    """
    Mystical range tile: layered rock, diagonal ridges, strata, violet-shadow hollows,
    and a soft snow cap toward the hex top (reads as summit on the parchment map).
    """
    cx, cy = SIZE / 2, SIZE / 2
    ridge_angle = rng.random() * math.pi
    ridge_freq = 0.16 + rng.random() * 0.1
    strata_ph = rng.random() * 6.28
    cross_ridge = rng.random() * math.pi

    for y in range(SIZE):
        for x in range(SIZE):
            if not mask(x, y):
                continue
            peak_t = 1.0 - (y / max(SIZE - 1, 1))

            n1 = noise2(x, y, rng.randint(1, 120))
            n2 = noise2(x // 2, y // 2, rng.randint(121, 200))
            n3 = noise2(x // 4, y // 4, rng.randint(201, 280))
            fbm = n1 * 0.5 + n2 * 0.33 + n3 * 0.17

            dx, dy = x - cx, y - cy
            rv = (dx * math.cos(ridge_angle) + dy * math.sin(ridge_angle)) * ridge_freq
            ridge = 0.5 + 0.5 * math.sin(rv + fbm * 6.0)
            cross = 0.5 + 0.5 * math.sin(
                (dx * math.cos(cross_ridge) + dy * math.sin(cross_ridge)) * (ridge_freq * 1.4) + n2 * 4.0
            )
            strata = 0.5 + 0.5 * math.sin(y * 0.12 + strata_ph + n3 * 4.5)

            shadow = (1.0 - peak_t) ** 1.12
            lit = peak_t * 0.38 + ridge * 0.22 + cross * 0.1 + strata * 0.1

            br = 72 + fbm * 48 + lit * 32 - shadow * 58
            bg = 76 + fbm * 42 + lit * 26 - shadow * 50
            bb = 94 + fbm * 38 + lit * 24 - shadow * 42

            if fbm < 0.36 and shadow > 0.22:
                br += 20
                bg += 10
                bb += 32
            if ridge > 0.75:
                br += 26
                bg += 22
                bb += 20
            if cross > 0.82:
                br += 12
                bg += 12
                bb += 14

            br = max(38, min(230, br))
            bg = max(40, min(228, bg))
            bb = max(52, min(245, bb))

            ss = 0.52 + n1 * 0.07
            sf = 0.76 + n2 * 0.1
            snow_w = _smoothstep(ss, sf, peak_t)

            sr, sg, sb = 236, 240, 252
            if snow_w > 0.03:
                r = br * (1 - snow_w) + sr * snow_w
                g = bg * (1 - snow_w) + sg * snow_w
                b = bb * (1 - snow_w) + sb * snow_w
                mid = 0.55 < snow_w < 0.88
                if mid:
                    r -= 5.0 * (1.0 - abs(snow_w - 0.72))
                    g -= 3.0 * (1.0 - abs(snow_w - 0.72))
                    b += 10.0 * (1.0 - abs(snow_w - 0.72))
                if snow_w > 0.9 and noise2(x, y, 444) > 0.93:
                    r, g, b = 255, 255, 255
                elif snow_w > 0.85 and noise2(x, y, 445) > 0.97:
                    r, g, b = 248, 250, 255
            else:
                r, g, b = br, bg, bb

            im.putpixel((x, y), (_clamp255(r), _clamp255(g), _clamp255(b), 255))

    for _ in range(28 + rng.randint(0, 35)):
        x0 = rng.randint(8, SIZE - 9)
        y0 = rng.randint(8, SIZE - 9)
        ln = 12 + rng.randint(0, 22)
        for t in range(ln):
            xx = x0 + t + rng.randint(-1, 1)
            yy = y0 + t // 2 + rng.randint(-1, 1)
            if 0 <= xx < SIZE and 0 <= yy < SIZE and mask(xx, yy):
                im.putpixel((xx, yy), (52, 54, 62, 255))
    for _ in range(14 + rng.randint(0, 18)):
        x0 = rng.randint(6, SIZE - 7)
        y0 = rng.randint(6, SIZE - 7)
        for t in range(8 + rng.randint(0, 10)):
            xx = x0 + rng.randint(-1, 1)
            yy = y0 - t
            if 0 <= xx < SIZE and 0 <= yy < SIZE and mask(xx, yy):
                im.putpixel((xx, yy), (88, 92, 108, 255))


def draw_desert(im: Image.Image, draw: ImageDraw.ImageDraw, mask, rng: random.Random) -> None:
    sand = (195, 162, 98)
    ph = rng.random() * 2.5
    for y in range(SIZE):
        for x in range(SIZE):
            if not mask(x, y):
                continue
            n = noise2(x, y, rng.randint(1, 60))
            rip = math.sin(x * 0.07 + y * 0.04 + ph) * 14
            r = int(sand[0] + n * 22 + rip)
            g = int(sand[1] + n * 18 + rip * 0.45)
            b = int(sand[2] + n * 14)
            im.putpixel((x, y), (min(255, r), min(255, g), min(255, b), 255))
    for y in range(0, SIZE, 3 + rng.randint(0, 2)):
        for x in range(SIZE):
            if mask(x, y) and (x + y + rng.randint(0, 3)) % 6 < 2:
                im.putpixel((x, y), (150, 118, 72, 255))
    for _ in range(60 + rng.randint(0, 60)):
        x = rng.randint(2, SIZE - 3)
        y = rng.randint(2, SIZE - 3)
        if mask(x, y) and rng.random() > 0.65:
            im.putpixel((x, y), (125, 100, 58, 255))


def make_biome_variant(stem: str, painter: Callable, variant: int, biome_id: int) -> None:
    rng = random.Random(10_007 * variant + 1_003 * biome_id + 42)
    im = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(im)
    mask = make_hex_texture_mask(SIZE, 1.0)
    painter(im, draw, mask, rng)
    path = os.path.join(OUT_DIR, f"{stem}_{variant}.png")
    im.save(path, "PNG")
    print(f"Wrote {path}")


def make_single(name: str, painter: Callable, biome_id: int) -> None:
    rng = random.Random(9000 + biome_id)
    im = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(im)
    mask = make_hex_texture_mask(SIZE, 1.0)
    painter(im, draw, mask, rng)
    path = os.path.join(OUT_DIR, f"{name}.png")
    im.save(path, "PNG")
    print(f"Wrote {path}")


def draw_feature_quarry(im: Image.Image, draw: ImageDraw.ImageDraw) -> None:
    rng = random.Random(11)
    for y in range(FEATURE_SIZE):
        for x in range(FEATURE_SIZE):
            d = math.hypot(x - FEATURE_SIZE // 2, y - FEATURE_SIZE // 2)
            if d < 20:
                n = noise2(x, y, 11)
                c = (110 + int(n * 30), 108 + int(n * 25), 105 + int(n * 20), 255)
                im.putpixel((x, y), c)
    for _ in range(35):
        x = rng.randint(8, FEATURE_SIZE - 9)
        y = rng.randint(8, FEATURE_SIZE - 9)
        im.putpixel((x, y), (72, 76, 80, 255))


def draw_feature_mine(im: Image.Image, draw: ImageDraw.ImageDraw) -> None:
    rng = random.Random(12)
    cx, cy = FEATURE_SIZE // 2, FEATURE_SIZE // 2
    for y in range(FEATURE_SIZE):
        for x in range(FEATURE_SIZE):
            d = math.hypot(x - cx, y - cy)
            if d < 18:
                n = noise2(x, y, 12)
                c = (52 + int(n * 25), 38 + int(n * 20), 28 + int(n * 15), 255)
                im.putpixel((x, y), c)
    for (px, py) in ((16, 14), (22, 20), (18, 24)):
        im.putpixel((px, py), (195, 205, 215, 255))


def draw_feature_gold(im: Image.Image, draw: ImageDraw.ImageDraw) -> None:
    rng = random.Random(13)
    for y in range(FEATURE_SIZE):
        for x in range(FEATURE_SIZE):
            d = math.hypot(x - FEATURE_SIZE // 2, y - FEATURE_SIZE // 2)
            if d < 19:
                n = noise2(x, y, 13)
                c = (205 + int(n * 40), 155 + int(n * 35), 40 + int(n * 25), 255)
                im.putpixel((x, y), c)
    for _ in range(18):
        x = rng.randint(10, FEATURE_SIZE - 11)
        y = rng.randint(10, FEATURE_SIZE - 11)
        im.putpixel((x, y), (255, 250, 210, 255))


def draw_feature_wood(im: Image.Image, draw: ImageDraw.ImageDraw) -> None:
    rng = random.Random(14)
    for log in range(4):
        ox = 8 + log * 6 + rng.randint(-1, 1)
        oy = 18 + (log % 2) * 3
        for yy in range(8):
            for xx in range(22):
                x, y = ox + xx, oy + yy
                if 0 <= x < FEATURE_SIZE and 0 <= y < FEATURE_SIZE:
                    c = (92 + log * 6 + rng.randint(0, 8), 58 + yy, 36, 255)
                    im.putpixel((x, y), c)


def draw_feature_ancient(im: Image.Image, draw: ImageDraw.ImageDraw) -> None:
    rng = random.Random(15)
    for y in range(FEATURE_SIZE):
        for x in range(FEATURE_SIZE):
            d = math.hypot(x - FEATURE_SIZE // 2, y - FEATURE_SIZE // 2)
            if d < 21:
                n = noise2(x, y, 14)
                c = (88 + int(n * 30), 68 + int(n * 25), 125 + int(n * 40), 255)
                im.putpixel((x, y), c)
    for _ in range(45):
        x = rng.randint(6, FEATURE_SIZE - 7)
        y = rng.randint(6, FEATURE_SIZE - 7)
        if rng.random() > 0.55:
            im.putpixel((x, y), (210, 190, 255, 255))


def make_feature(name: str, painter: Callable) -> None:
    im = Image.new("RGBA", (FEATURE_SIZE, FEATURE_SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(im)
    painter(im, draw)
    path = os.path.join(OUT_DIR, f"feature_{name}.png")
    im.save(path, "PNG")
    print(f"Wrote {path}")


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    for v in range(VARIANTS):
        make_biome_variant("water", draw_water, v, 1)
        make_biome_variant("plains", draw_plains, v, 2)
        make_biome_variant("forest", draw_forest, v, 3)
        make_biome_variant("mountain", draw_mountain, v, 4)
        make_biome_variant("desert", draw_desert, v, 5)
    make_single("water_coast", draw_water_coast, 6)
    make_single("beach", draw_beach, 7)
    make_feature("quarry", draw_feature_quarry)
    make_feature("mine", draw_feature_mine)
    make_feature("gold", draw_feature_gold)
    make_feature("wood", draw_feature_wood)
    make_feature("ancient", draw_feature_ancient)
    print("Done.")


if __name__ == "__main__":
    main()
