#!/usr/bin/env python3
"""
Special scroll region hex-cap overlays (128×128, same mask as biome overlays).
Run: python3 scripts/generate_special_region_overlays.py
Re-apply flat-hex alpha to authored forest caps (same mask as procedural sr_*):
  python3 scripts/generate_special_region_overlays.py mask-forest
Requires: pip install pillow

Isle of Lost wreck art is generated in `render_special_region_sprites.py`.
**Forest of Secrets** (`sr_forest_secrets_*.png`) are authored in-repo; main generator does not redraw them.
"""
from __future__ import annotations

import math
import os
import random

try:
    from PIL import Image, ImageDraw
except ImportError:
    raise SystemExit("Install Pillow: pip install pillow")

from render_special_region_sprites import draw_isle_wreck

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


def new_rgba() -> Image.Image:
    return Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))


def apply_mask(im: Image.Image, mask) -> None:
    for y in range(SIZE):
        for x in range(SIZE):
            if not mask(x, y):
                im.putpixel((x, y), (0, 0, 0, 0))


def draw_mexca(im: Image.Image, draw: ImageDraw.ImageDraw, mask, rng: random.Random, variant: int) -> None:
    """Warm sand + stepped pyramid + glyph hints."""
    for y in range(SIZE):
        for x in range(SIZE):
            if not mask(x, y):
                continue
            n = noise2(x, y, variant + 101)
            r = int(195 + n * 35)
            g = int(155 + n * 28)
            b = int(88 + n * 22)
            im.putpixel((x, y), (min(255, r), min(255, g), min(255, b), 255))

    cx, cy = 64, 72 + variant * 2
    # Stepped pyramid (filled rects)
    for step, (half_w, y0) in enumerate([(36, 55), (28, 48), (20, 42), (12, 36)]):
        col = (140 - step * 12, 100 - step * 8, 55 - step * 5, 255)
        x0 = cx - half_w
        x1 = cx + half_w
        for yy in range(y0, y0 + 7):
            for xx in range(x0, x1):
                if 0 <= xx < SIZE and 0 <= yy < SIZE and mask(xx, yy):
                    im.putpixel((xx, yy), col[:3] + (255,))
    # Glyphs (short lines)
    for i in range(4):
        gx = 30 + i * 22 + variant * 3
        gy = 28 + rng.randint(0, 8)
        for k in range(6):
            if mask(gx + k, gy) and mask(gx + k, gy + 4):
                im.putpixel((gx + k, gy), (85, 55, 35, 255))
                im.putpixel((gx + k, gy + 4), (85, 55, 35, 255))


def draw_hills_lost(im: Image.Image, draw: ImageDraw.ImageDraw, mask, rng: random.Random, variant: int) -> None:
    """Rocky highland + standing stones."""
    for y in range(SIZE):
        for x in range(SIZE):
            if not mask(x, y):
                continue
            n = noise2(x, y, variant + 404)
            r = int(95 + n * 45)
            g = int(88 + n * 38)
            b = int(82 + n * 35)
            im.putpixel((x, y), (min(255, r), min(255, g), min(255, b), 255))

    # Standing stones — positions vary by variant
    posts = [
        (38 + variant * 5, 48, 4, 28),
        (78 - variant * 3, 52, 3, 32),
        (58, 38, 5, 22),
    ]
    for px, py, w, h in posts:
        for dy in range(h):
            for dx in range(-w // 2, w // 2 + 1):
                x, y = px + dx, py - dy
                if mask(x, y):
                    shade = 70 + dy * 2
                    im.putpixel((x, y), (shade, shade + 5, shade + 3, 255))
        # capstone hint
        for dx in range(-w // 2 - 2, w // 2 + 3):
            x, y = px + dx, py - h
            if 0 <= x < SIZE and 0 <= y < SIZE and mask(x, y):
                im.putpixel((x, y), (78, 76, 74, 255))


def draw_isle_land(im: Image.Image, draw: ImageDraw.ImageDraw, mask, rng: random.Random, variant: int) -> None:
    """Bleak rock / scrub."""
    for y in range(SIZE):
        for x in range(SIZE):
            if not mask(x, y):
                continue
            n = noise2(x, y, variant + 707)
            r = int(72 + n * 40)
            g = int(78 + n * 35)
            b = int(82 + n * 30)
            im.putpixel((x, y), (min(255, r), min(255, g), min(255, b), 255))
    for _ in range(120):
        x = rng.randint(4, SIZE - 5)
        y = rng.randint(4, SIZE - 5)
        if mask(x, y) and rng.random() > 0.5:
            im.putpixel((x, y), (48, 52, 58, 255))


def draw_isle_water(im: Image.Image, draw: ImageDraw.ImageDraw, mask, rng: random.Random, variant: int) -> None:
    """Bleak grey chop + fog at top."""
    for y in range(SIZE):
        for x in range(SIZE):
            if not mask(x, y):
                continue
            n = noise2(x, y, variant + 808)
            fog = (1.0 - y / SIZE) ** 1.2
            wave = 0.5 + 0.5 * math.sin((x + y) * 0.12 + variant)
            r = int(38 + wave * 18 + n * 15 + fog * 25)
            g = int(48 + wave * 20 + n * 12 + fog * 22)
            b = int(58 + wave * 22 + n * 14 + fog * 28)
            a = int(175 + fog * 80)
            im.putpixel((x, y), (min(255, r), min(255, g), min(255, b), min(255, a)))


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    mask = make_hex_texture_mask(SIZE)

    for v in range(VARIANTS):
        rng = random.Random(9000 + v * 1337)

        im = new_rgba()
        d = ImageDraw.Draw(im)
        draw_mexca(im, d, mask, rng, v)
        apply_mask(im, mask)
        im.save(os.path.join(OUT_DIR, f"sr_mexca_{v}.png"))

        im = new_rgba()
        draw_hills_lost(im, d, mask, rng, v)
        apply_mask(im, mask)
        im.save(os.path.join(OUT_DIR, f"sr_hills_lost_{v}.png"))

        im = new_rgba()
        draw_isle_land(im, d, mask, rng, v)
        apply_mask(im, mask)
        im.save(os.path.join(OUT_DIR, f"sr_isle_lost_land_{v}.png"))

        im = new_rgba()
        draw_isle_water(im, d, mask, rng, v)
        apply_mask(im, mask)
        im.save(os.path.join(OUT_DIR, f"sr_isle_lost_water_{v}.png"))

        im = new_rgba()
        draw_isle_wreck(im, mask, rng, v)
        apply_mask(im, mask)
        im.save(os.path.join(OUT_DIR, f"sr_isle_lost_wreck_{v}.png"))

    print(f"Wrote {VARIANTS * 5} files to {OUT_DIR} (forest PNGs are authored separately)")


def mask_authored_forest_secrets() -> None:
    """Strip square-canvas pixels outside the flat hex cap so forest matches other sr_* decals."""
    mask_fn = make_hex_texture_mask(SIZE)
    for v in range(VARIANTS):
        path = os.path.join(OUT_DIR, f"sr_forest_secrets_{v}.png")
        im = Image.open(path).convert("RGBA")
        apply_mask(im, mask_fn)
        im.save(path)
        print("Masked hex alpha:", path)


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "mask-forest":
        mask_authored_forest_secrets()
    else:
        main()
