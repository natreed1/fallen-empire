#!/usr/bin/env python3
"""Draw a 64x64 isometric wood/lumber deposit sprite — fallen logs + stump."""

from PIL import Image
import random

random.seed(77)

W, H = 64, 64
img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
px = img.load()

# Palette — bark browns
bark_dark = (48, 34, 22, 255)
bark_mid = (66, 44, 30, 255)
bark_light = (82, 58, 38, 255)

# Wood grain / inner wood
wood_dark = (90, 65, 40, 255)
wood_mid = (105, 78, 50, 255)
wood_light = (120, 85, 55, 255)
wood_center = (135, 100, 62, 255)

# Moss hints
moss_dark = (38, 62, 32, 255)
moss_light = (50, 78, 40, 255)

ring_dark = (70, 50, 32, 255)
ring_light = (110, 82, 52, 255)

ground_shadow = (10, 8, 5, 55)


def safe_px(x, y, color):
    if 0 <= x < W and 0 <= y < H:
        px[x, y] = color


def blend_px(x, y, color):
    if 0 <= x < W and 0 <= y < H:
        if px[x, y][3] == 0:
            px[x, y] = color


def draw_thick_iso_log(cx, cy, half_len, thickness, facing_ne=True):
    """
    Draw a chunky fallen log as a filled iso-aligned parallelogram.
    half_len = number of steps along the iso axis.
    thickness = pixel radius of the log cross-section.
    """
    dx_ax = 1 if facing_ne else -1
    dy_ax_num = -1  # rise per 2 run (iso 2:1)

    segments = []
    for i in range(-half_len, half_len + 1):
        sx = cx + i * dx_ax
        sy = cy + i * dy_ax_num * (1 if i % 2 == 0 else 0)
        actual_sy = cy + (i * dy_ax_num) // 2
        segments.append((cx + i * dx_ax, actual_sy))

    for sx, sy in segments:
        for t in range(-thickness, thickness + 1):
            px_x, px_y = sx, sy + t
            if not (0 <= px_x < W and 0 <= px_y < H):
                continue
            if t == -thickness:
                safe_px(px_x, px_y, bark_dark)
            elif t == -thickness + 1:
                safe_px(px_x, px_y, bark_light)
            elif t >= thickness - 1:
                safe_px(px_x, px_y, bark_dark)
            elif t < 0:
                safe_px(px_x, px_y, bark_light)
            else:
                safe_px(px_x, px_y, bark_mid)

    return segments


def draw_log_end_grain(cx, cy, r):
    """Draw concentric end-grain circles for a cut log."""
    for y in range(cy - r, cy + r + 1):
        for x in range(cx - r, cx + r + 1):
            dx, dy = x - cx, y - cy
            d2 = dx * dx + dy * dy
            r2 = r * r
            if d2 <= r2:
                if d2 > r2 * 0.82:
                    safe_px(x, y, bark_dark)
                elif d2 > r2 * 0.62:
                    safe_px(x, y, bark_mid)
                elif d2 > r2 * 0.42:
                    safe_px(x, y, wood_dark)
                elif d2 > r2 * 0.22:
                    safe_px(x, y, wood_mid)
                elif d2 > r2 * 0.08:
                    safe_px(x, y, wood_light)
                else:
                    safe_px(x, y, wood_center)
                for frac in [0.52, 0.32, 0.15]:
                    if abs(d2 - r2 * frac) < r2 * 0.05:
                        safe_px(x, y, ring_dark if frac > 0.4 else ring_light)


def draw_stump(cx, cy, rx, ry_top, height):
    """Draw an iso tree stump with visible top rings."""
    # Barrel body
    for row in range(cy - height, cy + 1):
        frac = (cy - row) / max(height, 1)
        for x in range(cx - rx - 1, cx + rx + 2):
            dx = (x - cx) / max(rx, 1)
            if abs(dx) <= 1.0:
                if abs(dx) > 0.85:
                    safe_px(x, row, bark_dark)
                elif dx < -0.3:
                    safe_px(x, row, bark_light if frac > 0.5 else bark_mid)
                elif dx > 0.3:
                    safe_px(x, row, bark_dark if frac < 0.3 else bark_mid)
                else:
                    safe_px(x, row, bark_mid)

    # Top ellipse with rings
    top_cy = cy - height
    for y in range(top_cy - ry_top, top_cy + ry_top + 1):
        for x in range(cx - rx, cx + rx + 1):
            ddx = (x - cx) / max(rx, 1)
            ddy = (y - top_cy) / max(ry_top, 1)
            d2 = ddx * ddx + ddy * ddy
            if d2 <= 1.0:
                if d2 > 0.82:
                    safe_px(x, y, bark_mid)
                elif d2 > 0.58:
                    safe_px(x, y, wood_dark)
                elif d2 > 0.35:
                    safe_px(x, y, wood_mid)
                elif d2 > 0.12:
                    safe_px(x, y, wood_light)
                else:
                    safe_px(x, y, wood_center)
                if abs(d2 - 0.48) < 0.06:
                    safe_px(x, y, ring_dark)
                if abs(d2 - 0.25) < 0.05:
                    safe_px(x, y, ring_light)


# ── Ground shadow (drawn first, underneath everything) ──
for y in range(36, 58):
    for x in range(8, 56):
        dx = (x - 32) / 24
        dy = (y - 47) / 10
        if dx * dx + dy * dy <= 1.0:
            blend_px(x, y, ground_shadow)

# ── Stump — back-left, slightly elevated ──
draw_stump(cx=17, cy=42, rx=6, ry_top=3, height=10)

# ── Log 1 — large, NE-facing, in front ──
draw_thick_iso_log(cx=36, cy=46, half_len=14, thickness=4, facing_ne=True)
draw_log_end_grain(cx=22, cy=49, r=4)

# ── Log 2 — medium, NW-facing, crossing log 1 ──
draw_thick_iso_log(cx=32, cy=40, half_len=12, thickness=3, facing_ne=False)
draw_log_end_grain(cx=44, cy=46, r=3)

# ── Log 3 — small, NE-facing, back area ──
draw_thick_iso_log(cx=40, cy=35, half_len=9, thickness=3, facing_ne=True)
draw_log_end_grain(cx=31, cy=39, r=3)

# ── Moss patches on stump & logs ──
moss_candidates = [
    (15, 34), (16, 34), (17, 33), (18, 34), (14, 36), (16, 35),
    (25, 44), (26, 44), (33, 38), (34, 38), (42, 34), (43, 34),
    (30, 42), (31, 41), (19, 40), (20, 40),
]
for mx, my in moss_candidates:
    if 0 <= mx < W and 0 <= my < H and px[mx, my][3] > 0:
        safe_px(mx, my, moss_dark if random.random() < 0.5 else moss_light)

# ── Sawdust / wood chips scattered on ground ──
for _ in range(35):
    rx = random.randint(10, 54)
    ry = random.randint(44, 57)
    dx = (rx - 32) / 22
    dy = (ry - 50) / 7
    if dx * dx + dy * dy <= 1.0 and 0 <= rx < W and 0 <= ry < H and px[rx, ry][3] == 0:
        c = random.choice([bark_dark, bark_mid, wood_dark, wood_mid])
        px[rx, ry] = (c[0], c[1], c[2], 160)

# ── Bark texture flecks ──
for _ in range(20):
    rx = random.randint(12, 52)
    ry = random.randint(28, 50)
    if 0 <= rx < W and 0 <= ry < H and px[rx, ry][3] > 200:
        cur = px[rx, ry]
        if cur == bark_light:
            px[rx, ry] = bark_mid
        elif cur == bark_mid:
            px[rx, ry] = bark_dark

out_path = "/Users/natreed/fallen-empire/public/sprites/entities/deposit_wood.png"
img.save(out_path)
print(f"Saved deposit_wood sprite to {out_path}")
print(f"Size: {img.size}, Mode: {img.mode}")
