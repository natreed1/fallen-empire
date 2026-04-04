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
VARIANTS = 4
# Resource deposit overlays: full hex (SIZE×SIZE) so art sits flush on terrain like embedded ore.


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


def _water_palette() -> list[tuple[int, int, int]]:
    """Discrete blues — banded depth, no smooth gradient."""
    return [
        (34, 72, 102),
        (40, 84, 114),
        (46, 94, 124),
        (52, 104, 134),
        (58, 114, 144),
    ]


def _bayer2(x: int, y: int) -> int:
    """2×2 ordered dither for pixel-art bands."""
    m = ((0, 2), (3, 1))
    return m[y & 1][x & 1]


def draw_water(im: Image.Image, draw: ImageDraw.ImageDraw, mask, rng: random.Random) -> None:
    """
    Open water: banded/dithered base + directional wave streaks (crests), not starfield speckles.
    """
    seed_base = rng.randint(1, 60000)
    pal = _water_palette()
    ph1 = rng.random() * 6.28
    ph2 = rng.random() * 6.28
    kx1 = 0.11 + rng.random() * 0.05
    ky1 = 0.018 + rng.random() * 0.028
    kx2 = 0.07 + rng.random() * 0.04
    ky2 = 0.05 + rng.random() * 0.04

    for y in range(SIZE):
        for x in range(SIZE):
            if not mask(x, y):
                continue
            w1 = math.sin(x * kx1 + y * ky1 + ph1)
            w2 = 0.55 * math.sin(x * kx2 + y * ky2 + ph2)
            coarse = noise2(x // 3, y // 3, seed_base)
            # Quantize to bands + tiny dither (readable pixel art)
            t = 0.5 + 0.45 * w1 + 0.25 * w2 + (coarse - 0.5) * 0.12
            t = max(0.0, min(1.0, t))
            bi = int(t * (len(pal) - 1) + (_bayer2(x, y) - 1.5) * 0.08)
            bi = max(0, min(len(pal) - 1, bi))
            r, g, b = pal[bi]
            im.putpixel((x, y), (r, g, b, 255))

    # Crest streaks: short horizontal / gentle-diagonal segments (2–4 px), clustered on wave fronts
    crest_hi = ((88, 148, 178), (108, 172, 202), (128, 188, 218))
    crest_mid = ((62, 118, 148), (72, 132, 162))

    for _ in range(220 + rng.randint(0, 100)):
        cx = rng.randint(1, SIZE - 4)
        cy = rng.randint(1, SIZE - 2)
        if not mask(cx, cy):
            continue
        w1 = math.sin(cx * kx1 + cy * ky1 + ph1)
        if w1 < 0.25:
            continue
        ln = 2 + rng.randint(0, 2)
        ang = rng.random() * 0.12 - 0.06
        col = rng.choice(crest_hi if w1 > 0.65 else crest_mid)
        for i in range(ln):
            xx = cx + i
            yy = cy + int(i * ang + 0.5)
            if 0 <= xx < SIZE and 0 <= yy < SIZE and mask(xx, yy):
                im.putpixel((xx, yy), (*col, 255))

    # Secondary ripples (shorter, more horizontal)
    for _ in range(140 + rng.randint(0, 60)):
        cx = rng.randint(0, SIZE - 3)
        cy = rng.randint(0, SIZE - 1)
        if not mask(cx, cy):
            continue
        w2 = math.sin(cx * kx2 + cy * ky2 + ph2)
        if w2 < 0.4:
            continue
        ln = 2 + rng.randint(0, 1)
        col = rng.choice(crest_mid)
        for i in range(ln):
            xx = cx + i
            if 0 <= xx < SIZE and mask(xx, cy) and rng.random() > 0.15:
                im.putpixel((xx, cy), (*col, 255))


def draw_water_coast(im: Image.Image, draw: ImageDraw.ImageDraw, mask, rng: random.Random) -> None:
    """Shallow water: stepped depth bands toward sand + foam streaks (no white starfield)."""
    seed_c = rng.randint(1, 50000)
    ph = rng.random() * 6.28
    kx = 0.12 + rng.random() * 0.05
    ky = 0.025 + rng.random() * 0.03

    for y in range(SIZE):
        for x in range(SIZE):
            if not mask(x, y):
                continue
            depth = (y / max(SIZE - 1, 1)) ** 0.75
            sand = max(0.0, (depth - 0.32) * 2.0)
            # Stepped bands instead of smooth linear gradient
            band = int(sand * 6 + noise2(x // 2, y // 2, seed_c) * 0.8) % 7
            br = 52 + band * 10 + (noise2(x, y, 7) > 0.72)
            bg = 108 + band * 8 + (noise2(x, y, 8) > 0.72)
            bb = 138 + band * 6
            # Pull toward tan in lower rows (quantized)
            if sand > 0.15:
                t = min(1.0, (sand - 0.15) * 1.4)
                br = int(br * (1 - t * 0.35) + 195 * t * 0.35)
                bg = int(bg * (1 - t * 0.28) + 175 * t * 0.28)
                bb = int(bb * (1 - t * 0.22) + 120 * t * 0.22)
            im.putpixel((x, y), (_clamp255(br), _clamp255(bg), _clamp255(bb), 255))

    foam = ((200, 230, 245), (175, 215, 235), (155, 200, 225))
    for _ in range(200 + rng.randint(0, 80)):
        cx = rng.randint(1, SIZE - 4)
        cy = rng.randint(SIZE // 3, SIZE - 2)
        if not mask(cx, cy):
            continue
        w = math.sin(cx * kx + cy * ky + ph)
        if w < 0.2:
            continue
        ln = 2 + rng.randint(0, 2)
        col = rng.choice(foam)
        for i in range(ln):
            xx = cx + i
            if 0 <= xx < SIZE and mask(xx, cy):
                im.putpixel((xx, cy), (*col, 255))

    for _ in range(36):
        x = rng.randint(0, SIZE - 2)
        y = rng.randint(SIZE // 2, SIZE - 1)
        if mask(x, y):
            im.putpixel((x, y), (200, 185, 145, 255))


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
    """Forest floor / undergrowth only — actual trees are billboard sprites (entities/tree.png)."""
    seed_ground = rng.randint(1, 50)
    for y in range(SIZE):
        for x in range(SIZE):
            if not mask(x, y):
                continue
            n = noise2(x, y, seed_ground)
            r = int(42 + n * 24)
            g = int(78 + n * 30)
            b = int(36 + n * 18)
            a = int(110 + n * 45)
            im.putpixel((x, y), (_clamp255(r), _clamp255(g), _clamp255(b), _clamp255(a)))

    # Undergrowth patches — denser leaf litter clusters
    for _ in range(200 + rng.randint(0, 100)):
        cx = rng.randint(6, SIZE - 7)
        cy = rng.randint(6, SIZE - 7)
        if not mask(cx, cy):
            continue
        rad = 2 + rng.randint(0, 3)
        r = 34 + rng.randint(0, 22)
        g = 65 + rng.randint(0, 35)
        b = 28 + rng.randint(0, 16)
        for dy in range(-rad, rad + 1):
            for dx in range(-rad, rad + 1):
                if dx * dx + dy * dy > rad * rad:
                    continue
                px, py = cx + dx, cy + dy
                if 0 <= px < SIZE and 0 <= py < SIZE and mask(px, py):
                    im.putpixel((px, py), (_clamp255(r), _clamp255(g), _clamp255(b), 165))

    # Mossy highlights and fallen leaves
    for _ in range(60 + rng.randint(0, 40)):
        x = rng.randint(4, SIZE - 5)
        y = rng.randint(4, SIZE - 5)
        if mask(x, y) and rng.random() > 0.4:
            im.putpixel((x, y), (48 + rng.randint(0, 18), 90 + rng.randint(0, 30), 38 + rng.randint(0, 14), 185))
    # Tiny dark root / shadow specks
    for _ in range(40 + rng.randint(0, 30)):
        x = rng.randint(3, SIZE - 4)
        y = rng.randint(3, SIZE - 4)
        if mask(x, y) and rng.random() > 0.5:
            im.putpixel((x, y), (28 + rng.randint(0, 10), 42 + rng.randint(0, 15), 22 + rng.randint(0, 8), 150))


def draw_mountain(im: Image.Image, draw: ImageDraw.ImageDraw, mask, rng: random.Random) -> None:
    """Rocky ground / scree only — actual mountain peaks are billboard sprites (entities/mountain.png)."""
    seed_base = rng.randint(1, 120)
    ridge_angle = rng.random() * math.pi
    ridge_freq = 0.16 + rng.random() * 0.1
    strata_ph = rng.random() * 6.28

    for y in range(SIZE):
        for x in range(SIZE):
            if not mask(x, y):
                continue
            n1 = noise2(x, y, seed_base)
            n2 = noise2(x // 2, y // 2, seed_base + 80)
            fbm = n1 * 0.6 + n2 * 0.4

            dx, dy = x - SIZE / 2, y - SIZE / 2
            rv = (dx * math.cos(ridge_angle) + dy * math.sin(ridge_angle)) * ridge_freq
            ridge = 0.5 + 0.5 * math.sin(rv + fbm * 5.0)
            strata = 0.5 + 0.5 * math.sin(y * 0.12 + strata_ph + n2 * 4.0)

            lit = ridge * 0.22 + strata * 0.15

            br = int(68 + fbm * 42 + lit * 28)
            bg = int(72 + fbm * 36 + lit * 22)
            bb = int(88 + fbm * 34 + lit * 20)

            if fbm < 0.36:
                br += 15
                bg += 8
                bb += 24
            if ridge > 0.75:
                br += 18
                bg += 16
                bb += 14

            a = int(115 + fbm * 50 + ridge * 20)
            im.putpixel((x, y), (_clamp255(br), _clamp255(bg), _clamp255(bb), _clamp255(a)))

    # Gravel / scree clusters
    for _ in range(160 + rng.randint(0, 80)):
        cx = rng.randint(6, SIZE - 7)
        cy = rng.randint(6, SIZE - 7)
        if not mask(cx, cy):
            continue
        rad = 2 + rng.randint(0, 2)
        shade = 58 + rng.randint(0, 30)
        for dy in range(-rad, rad + 1):
            for dx in range(-rad, rad + 1):
                if dx * dx + dy * dy > rad * rad:
                    continue
                px, py = cx + dx, cy + dy
                if 0 <= px < SIZE and 0 <= py < SIZE and mask(px, py):
                    im.putpixel((px, py), (_clamp255(shade), _clamp255(shade + 4), _clamp255(shade + 14), 155))

    # Dark crevice lines
    for _ in range(18 + rng.randint(0, 12)):
        x0 = rng.randint(8, SIZE - 9)
        y0 = rng.randint(8, SIZE - 9)
        ln = 6 + rng.randint(0, 10)
        for t in range(ln):
            xx = x0 + t + rng.randint(-1, 1)
            yy = y0 + t // 2 + rng.randint(-1, 1)
            if 0 <= xx < SIZE and 0 <= yy < SIZE and mask(xx, yy):
                im.putpixel((xx, yy), (48, 50, 58, 165))


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


def _deposit_alpha(x: int, y: int, cx: float, cy: float, rough: float) -> float:
    """Irregular inclusion mask (not a sphere): noise-warped falloff, solid center → transparent rim."""
    dx, dy = x - cx, y - cy
    d = math.hypot(dx, dy) / (SIZE * 0.36)
    n = noise2(x // 2, y // 2, 101) * 0.28 + noise2(x, y, 102) * 0.45 + noise2(x // 4, y // 4, 103) * 0.27
    edge = rough + n * 0.38
    if d > edge + 0.22:
        return 0.0
    # 1 in center, 0 past outer rim
    return float(max(0.0, min(1.0, 1.0 - _smoothstep(edge - 0.1, edge + 0.16, d))))


def draw_feature_quarry(im: Image.Image, draw: ImageDraw.ImageDraw, mask, rng: random.Random) -> None:
    """Exposed bedrock / gravel — large pixel blocks (8px-scale cells), readable cobbles."""
    cx, cy = SIZE / 2, SIZE / 2
    # Base tone ~6px tiles; variation ~9px — reads chunky on hex caps
    C, W = 6, 9
    for y in range(SIZE):
        for x in range(SIZE):
            if not mask(x, y):
                continue
            a = _deposit_alpha(x, y, cx, cy, 0.48)
            if a < 0.04:
                continue
            ai = _clamp255(a * 255)
            bx, by = x // C, y // C
            wx, wy = x // W, y // W
            n1 = noise2(bx, by, 11)
            n2 = noise2(bx // 2 + by // 3, by // 2, 12)
            base = 84 + n1 * 34 + n2 * 22
            r = int(base + noise2(wx, wy, 13) * 9)
            g = int(base - 4 + noise2(wx, wy, 14) * 7)
            b = int(base - 8 + noise2(wx, wy, 15) * 11)
            if noise2(wx + 3, wy + 1, 16) > 0.58:
                r, g, b = int(r * 0.48), int(g * 0.48), int(b * 0.48)
            elif noise2(bx + 7, by + 2, 17) > 0.55:
                r = min(255, r + 24)
                g = min(255, g + 22)
                b = min(255, b + 15)
            im.putpixel((x, y), (_clamp255(r), _clamp255(g), _clamp255(b), ai))
    # Explicit stone lumps (4–7 px) — main readable “rocks”
    for _ in range(22 + rng.randint(0, 14)):
        px = rng.randint(14, SIZE - 15)
        py = rng.randint(14, SIZE - 15)
        if not mask(px, py):
            continue
        rad = 3 + rng.randint(0, 3)
        shade = 72 + rng.randint(0, 40)
        for dy in range(-rad, rad + 1):
            for dx in range(-rad, rad + 1):
                if dx * dx + dy * dy > rad * rad + rng.randint(0, 2):
                    continue
                x, y = px + dx, py + dy
                if 0 <= x < SIZE and 0 <= y < SIZE and mask(x, y):
                    a = _deposit_alpha(x, y, cx, cy, 0.48)
                    if a < 0.08:
                        continue
                    ai = _clamp255(a * 255)
                    ds = rng.randint(-14, 14)
                    im.putpixel(
                        (x, y),
                        (_clamp255(shade + ds), _clamp255(shade - 4 + ds), _clamp255(shade - 14 + ds), ai),
                    )


def draw_feature_mine(im: Image.Image, draw: ImageDraw.ImageDraw, mask, rng: random.Random) -> None:
    """Iron in host rock — ~7px matrix blocks, wide metallic plates, big ore smears."""
    cx, cy = SIZE / 2, SIZE / 2
    C = 7
    for y in range(SIZE):
        for x in range(SIZE):
            if not mask(x, y):
                continue
            a = _deposit_alpha(x, y, cx, cy, 0.46)
            if a < 0.04:
                continue
            ai = _clamp255(a * 255)
            bx, by = x // C, y // C
            stratum = 0.5 + 0.5 * math.sin(y * 0.038 + noise2(bx // 2, by, 21) * 1.8)
            n = noise2(bx, by, 22)
            br = int(44 + stratum * 26 + n * 24)
            bg = int(32 + stratum * 18 + n * 16)
            bb = int(24 + stratum * 12 + n * 14)
            # Large metallic plates (lower threshold → bigger bright regions)
            om = noise2(bx + 3, by + 2, 23)
            if om > 0.48:
                br = min(255, br + 92)
                bg = min(255, bg + 84)
                bb = min(255, bb + 76)
            elif noise2(bx, by, 24) > 0.62:
                br, bg, bb = int(br * 0.52), int(bg * 0.52), int(bb * 0.52)
            im.putpixel((x, y), (_clamp255(br), _clamp255(bg), _clamp255(bb), ai))
    # Big iron smears (4×6-ish rects) — primary readable “ore”
    for _ in range(16 + rng.randint(0, 12)):
        px = rng.randint(16, SIZE - 17)
        py = rng.randint(16, SIZE - 17)
        if not mask(px, py):
            continue
        w, h = 3 + rng.randint(0, 4), 2 + rng.randint(0, 3)
        gleam = 188 + rng.randint(0, 55)
        gr = gleam - rng.randint(5, 25)
        bl = gleam - rng.randint(35, 55)
        for dy in range(-h, h + 1):
            for dx in range(-w, w + 1):
                x, y = px + dx, py + dy
                if 0 <= x < SIZE and 0 <= y < SIZE and mask(x, y):
                    a = _deposit_alpha(x, y, cx, cy, 0.46)
                    if a < 0.08:
                        continue
                    ai = _clamp255(a * 255)
                    # Soften rect edge
                    edge = abs(dx) / max(1, w) + abs(dy) / max(1, h)
                    if edge > 1.15:
                        continue
                    im.putpixel((x, y), (_clamp255(gleam), _clamp255(gr), _clamp255(bl), ai))


def draw_feature_gold(im: Image.Image, draw: ImageDraw.ImageDraw, mask, rng: random.Random) -> None:
    """Pale host rock with gold-bearing quartz veins."""
    cx, cy = SIZE / 2, SIZE / 2
    for y in range(SIZE):
        for x in range(SIZE):
            if not mask(x, y):
                continue
            a = _deposit_alpha(x, y, cx, cy, 0.47)
            if a < 0.04:
                continue
            ai = _clamp255(a * 255)
            vein = abs(math.sin((x * 0.14 + y * 0.09) + noise2(x, y, 31) * 5.0))
            n = noise2(x, y, 32)
            br = int(175 + vein * 35 + n * 30)
            bg = int(148 + vein * 28 + n * 22)
            bb = int(88 + vein * 20 + n * 18)
            if vein > 0.72 or noise2(x, y, 33) > 0.86:
                br = min(255, br + 55)
                bg = min(255, int(bg + 40))
                bb = min(255, int(bb + 8))
            im.putpixel((x, y), (_clamp255(br), _clamp255(bg), _clamp255(bb), ai))


def draw_feature_wood(im: Image.Image, draw: ImageDraw.ImageDraw, mask, rng: random.Random) -> None:
    """Fallen timber half-buried along the ground plane (reads embedded, not stacked)."""
    cx, cy = SIZE / 2, SIZE / 2
    for log_i in range(3):
        ox = int(22 + log_i * 28 + rng.randint(-4, 4))
        oy = int(38 + log_i * 5 + rng.randint(-3, 3))
        for yy in range(10):
            for xx in range(36):
                x, y = ox + xx - 18, oy + yy - 5
                if not (0 <= x < SIZE and 0 <= y < SIZE) or not mask(x, y):
                    continue
                a = _deposit_alpha(x, y, cx, cy, 0.52) * 0.95
                if a < 0.05:
                    continue
                ai = _clamp255(a * 255)
                bark = 62 + log_i * 10 + yy + rng.randint(0, 4)
                gr = 42 + yy // 2
                bl = 28
                if noise2(x, y, 41) > 0.9:
                    bark, gr, bl = bark + 25, gr + 15, bl + 8
                im.putpixel((x, y), (_clamp255(bark), _clamp255(gr), _clamp255(bl), ai))


def draw_feature_ancient(im: Image.Image, draw: ImageDraw.ImageDraw, mask, rng: random.Random) -> None:
    """Weathered ground with arcane fissures — embedded, not a crystal ball."""
    cx, cy = SIZE / 2, SIZE / 2
    for y in range(SIZE):
        for x in range(SIZE):
            if not mask(x, y):
                continue
            a = _deposit_alpha(x, y, cx, cy, 0.5)
            if a < 0.04:
                continue
            ai = _clamp255(a * 255)
            n = noise2(x, y, 51)
            br = int(72 + n * 35)
            bg = int(58 + n * 28)
            bb = int(92 + n * 40)
            fiss = noise2(x // 2, y // 2, 52)
            if fiss > 0.78:
                br = min(255, br + 55)
                bg = min(255, bg + 40)
                bb = min(255, bb + 70)
            im.putpixel((x, y), (_clamp255(br), _clamp255(bg), _clamp255(bb), ai))


def make_feature(name: str, painter: Callable) -> None:
    rng = random.Random(8000 + sum(ord(c) for c in name) * 17)
    im = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(im)
    mask = make_hex_texture_mask(SIZE, 1.0)
    painter(im, draw, mask, rng)
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
