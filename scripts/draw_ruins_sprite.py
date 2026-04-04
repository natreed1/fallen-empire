#!/usr/bin/env python3
"""Draw a 64x64 isometric ruins sprite — low-profile ground-level rubble."""

from PIL import Image
import random

random.seed(42)

W, H = 64, 64
img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
px = img.load()

# --- Palette ---
stone_darkest = (78, 72, 64, 255)
stone_dark    = (100, 92, 80, 255)
stone_mid     = (130, 120, 105, 255)
stone_light   = (148, 138, 120, 255)
stone_hi      = (155, 148, 132, 255)

shadow_deep   = (60, 52, 44, 255)
shadow_mid    = (72, 64, 55, 200)

moss_dark     = (50, 85, 40, 255)
moss_mid      = (58, 105, 48, 255)
moss_light    = (70, 115, 55, 255)

ground_shadow = (40, 34, 28, 50)


def fill_poly(points, color):
    if len(points) < 3:
        return
    ys = [p[1] for p in points]
    for y in range(int(min(ys)), int(max(ys)) + 1):
        xs = []
        n = len(points)
        for i in range(n):
            x1, y1 = points[i]
            x2, y2 = points[(i + 1) % n]
            if y1 == y2:
                continue
            if min(y1, y2) <= y < max(y1, y2):
                xs.append(x1 + (y - y1) * (x2 - x1) / (y2 - y1))
        xs.sort()
        for j in range(0, len(xs) - 1, 2):
            for x in range(int(xs[j]), int(xs[j + 1]) + 1):
                if 0 <= x < W and 0 <= y < H:
                    px[x, y] = color


def rect(x, y, w, h, color):
    for ry in range(y, y + h):
        for rx in range(x, x + w):
            if 0 <= rx < W and 0 <= ry < H:
                px[rx, ry] = color


def line(x0, y0, x1, y1, color):
    dx = abs(x1 - x0)
    dy = abs(y1 - y0)
    sx = 1 if x0 < x1 else -1
    sy = 1 if y0 < y1 else -1
    err = dx - dy
    while True:
        if 0 <= x0 < W and 0 <= y0 < H:
            px[x0, y0] = color
        if x0 == x1 and y0 == y1:
            break
        e2 = 2 * err
        if e2 > -dy:
            err -= dy
            x0 += sx
        if e2 < dx:
            err += dx
            y0 += sy


def ellipse(cx, cy, rx, ry, color):
    for y in range(cy - ry, cy + ry + 1):
        for x in range(cx - rx, cx + rx + 1):
            if 0 <= x < W and 0 <= y < H:
                dx = (x - cx) / max(rx, 1)
                dy = (y - cy) / max(ry, 1)
                if dx * dx + dy * dy <= 1.0:
                    px[x, y] = color


def pixel(x, y, color):
    if 0 <= x < W and 0 <= y < H:
        px[x, y] = color


# ============================================================
# GROUND SHADOW (soft ellipse at the very bottom)
# ============================================================
for y in range(50, 60):
    for x in range(6, 58):
        dx_f = (x - 32) / 26.0
        dy_f = (y - 55) / 5.0
        if dx_f * dx_f + dy_f * dy_f <= 1.0:
            px[x, y] = ground_shadow

# ============================================================
# STONE FOUNDATION FLOOR — isometric diamond-ish footprint
# The main "floor slab" of the ruins, cracked and broken
# ============================================================
floor_poly = [
    (32, 36),   # top (north)
    (52, 43),   # right (east)
    (50, 45),
    (48, 47),
    (32, 54),   # bottom (south)
    (16, 47),
    (14, 45),
    (12, 43),   # left (west)
]
fill_poly(floor_poly, stone_dark)

floor_top_poly = [
    (32, 35),
    (53, 42),
    (52, 43),
    (32, 36),
    (12, 43),
    (13, 42),
]
fill_poly(floor_top_poly, stone_mid)

# Floor edge highlights (top-left lit face)
line(32, 35, 13, 42, stone_light)
line(32, 35, 53, 42, stone_mid)
# Floor bottom shadow edge
line(16, 47, 32, 54, shadow_deep)
line(32, 54, 48, 47, shadow_deep)

# Cracks across the floor
line(26, 38, 22, 44, shadow_mid)
line(22, 44, 24, 48, shadow_mid)
line(36, 39, 40, 45, shadow_mid)
line(40, 45, 38, 50, shadow_mid)
line(30, 42, 34, 48, shadow_mid)

# Floor stone block seam lines (isometric grid pattern)
line(22, 38, 32, 43, shadow_mid)
line(42, 38, 32, 43, shadow_mid)
line(17, 42, 32, 49, shadow_mid)
line(47, 42, 32, 49, shadow_mid)

# ============================================================
# BROKEN EDGE — floor doesn't go all the way; rubble edge
# Small missing chunks from the floor slab
# ============================================================
for _ in range(18):
    ex = random.randint(12, 52)
    ey = random.randint(46, 54)
    dx_f = (ex - 32) / 22.0
    dy_f = (ey - 49) / 5.0
    if dx_f * dx_f + dy_f * dy_f > 0.7:
        if 0 <= ex < W and 0 <= ey < H and px[ex, ey][3] > 0:
            px[ex, ey] = (0, 0, 0, 0)

# ============================================================
# LOW WALL STUB — back-left (NW side), 6px tall
# ============================================================
wall1_base_y = 40
wall1_h = 7

# Left face (shadow)
wall1_left = [
    (14, wall1_base_y), (14, wall1_base_y - wall1_h),
    (16, wall1_base_y - wall1_h - 1),
    (16, wall1_base_y - 1),
]
fill_poly(wall1_left, stone_darkest)

# Front face
wall1_front = [
    (16, wall1_base_y - 1), (16, wall1_base_y - wall1_h - 1),
    (26, wall1_base_y - wall1_h + 3),
    (26, wall1_base_y + 4),
]
fill_poly(wall1_front, stone_dark)

# Top face
wall1_top = [
    (14, wall1_base_y - wall1_h),
    (16, wall1_base_y - wall1_h - 1),
    (26, wall1_base_y - wall1_h + 3),
    (24, wall1_base_y - wall1_h + 4),
]
fill_poly(wall1_top, stone_light)

# Jagged broken top edge
for i in range(0, 11, 2):
    jx = 16 + i
    jy = wall1_base_y - wall1_h + int(i * 0.4) + random.randint(-1, 1)
    if 0 <= jx < W and 0 <= jy < H:
        px[jx, jy] = stone_hi
        if jy + 1 < H:
            px[jx, jy + 1] = stone_mid

# Mortar lines on wall front
line(17, wall1_base_y - 3, 25, wall1_base_y + 1, shadow_mid)
line(18, wall1_base_y - 1, 24, wall1_base_y + 3, shadow_mid)

# ============================================================
# LOW WALL STUB — back-right (NE side), 5px tall
# ============================================================
wall2_front = [
    (38, 39), (38, 34),
    (50, 40), (50, 44),
]
fill_poly(wall2_front, stone_dark)

wall2_right = [
    (50, 40), (50, 44),
    (52, 43), (52, 39),
]
fill_poly(wall2_right, stone_darkest)

wall2_top = [
    (38, 34), (40, 33),
    (52, 39), (50, 40),
]
fill_poly(wall2_top, stone_light)

# Broken top edge
for i in range(0, 13, 2):
    jx = 38 + i
    jy = 34 + int(i * 0.46) + random.randint(-1, 1)
    if 0 <= jx < W and 0 <= jy < H:
        px[jx, jy] = stone_hi

# Mortar lines
line(39, 37, 49, 42, shadow_mid)
line(40, 39, 48, 43, shadow_mid)

# ============================================================
# PARTIAL ARCH / DOORWAY FRAGMENT — center-left
# A tiny remnant of a doorway, just 8px tall
# ============================================================
# Left post
rect(20, 35, 3, 7, stone_dark)
rect(20, 35, 3, 1, stone_light)
rect(20, 35, 1, 7, stone_light)

# Right post (shorter, broken)
rect(27, 37, 3, 5, stone_dark)
rect(27, 37, 3, 1, stone_light)
rect(27, 37, 1, 5, stone_light)

# Arch fragment — just a few pixels connecting the tops
line(22, 34, 24, 33, stone_mid)
line(24, 33, 26, 33, stone_mid)
line(26, 33, 28, 35, stone_mid)
# Highlight on top of arch
line(23, 33, 25, 32, stone_hi)
line(25, 32, 27, 33, stone_hi)
# Broken keystone pixel
pixel(25, 32, stone_light)

# ============================================================
# SCATTERED STONE BLOCKS — small rectangles on/around floor
# ============================================================
blocks = [
    (30, 47, 4, 2, stone_mid, stone_light),
    (36, 49, 3, 2, stone_dark, stone_mid),
    (10, 44, 3, 2, stone_mid, stone_light),
    (44, 46, 4, 2, stone_dark, stone_mid),
    (24, 50, 3, 2, stone_mid, stone_light),
    (18, 48, 2, 2, stone_dark, stone_mid),
    (42, 48, 3, 2, stone_mid, stone_light),
    (52, 44, 3, 2, stone_dark, stone_mid),
    (33, 44, 3, 2, stone_dark, stone_mid),
    # Tiny single blocks
    (48, 45, 2, 1, stone_mid, stone_light),
    (15, 46, 2, 1, stone_mid, stone_light),
    (28, 52, 2, 1, stone_dark, stone_mid),
]

for bx, by, bw, bh, c_body, c_top in blocks:
    rect(bx, by, bw, bh, c_body)
    rect(bx, by, bw, 1, c_top)
    if bh > 1 and by + bh - 1 < H:
        for rx in range(bx, bx + bw):
            if 0 <= rx < W:
                pixel(rx, by + bh - 1, shadow_deep)

# A couple of toppled/angled block pieces
fill_poly([(34, 46), (37, 45), (39, 46), (36, 47)], stone_mid)
pixel(36, 45, stone_hi)
fill_poly([(46, 43), (48, 42), (50, 43), (48, 44)], stone_mid)
pixel(48, 42, stone_hi)

# ============================================================
# MOSS & OVERGROWTH
# ============================================================
# Moss on wall 1 (base)
moss_spots = [
    (15, 40), (16, 41), (17, 40), (18, 41),
    (24, 43), (25, 44), (26, 43),
    # Moss on wall 2
    (39, 38), (40, 39), (41, 38), (48, 43), (49, 42),
    # Moss on floor cracks
    (23, 44), (24, 45), (35, 46), (36, 47),
    (31, 43), (32, 44),
    # Moss on arch posts
    (20, 41), (21, 40), (28, 41), (29, 40),
    # Moss on scattered blocks
    (30, 47), (44, 46), (42, 48),
    # Ground moss patches
    (18, 49), (19, 50), (26, 51), (38, 51), (39, 50),
    (45, 47), (14, 47), (33, 52),
]
for mx, my in moss_spots:
    pixel(mx, my, random.choice([moss_dark, moss_mid, moss_light]))

# Small moss cluster (a couple of 2-3 pixel patches)
for cx, cy in [(22, 48), (40, 46), (16, 44)]:
    pixel(cx, cy, moss_mid)
    pixel(cx + 1, cy, moss_dark)
    pixel(cx, cy + 1, moss_light)

# ============================================================
# TEXTURE NOISE — subtle variation on stone surfaces
# ============================================================
for _ in range(90):
    rx = random.randint(10, 54)
    ry = random.randint(32, 55)
    if 0 <= rx < W and 0 <= ry < H and px[rx, ry][3] > 100:
        base = px[rx, ry]
        if base in (moss_dark, moss_mid, moss_light, ground_shadow):
            continue
        shift = random.randint(-8, 8)
        nc = tuple(
            max(0, min(255, base[i] + shift)) if i < 3 else base[3]
            for i in range(4)
        )
        px[rx, ry] = nc

# ============================================================
# EDGE DARKENING — darken the outermost visible pixels slightly
# ============================================================
edge_img = img.copy()
edge_px = edge_img.load()
for y in range(H):
    for x in range(W):
        if px[x, y][3] > 100:
            neighbors = 0
            for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                nx, ny = x + dx, y + dy
                if 0 <= nx < W and 0 <= ny < H and px[nx, ny][3] > 100:
                    neighbors += 1
            if neighbors < 4:
                c = px[x, y]
                edge_px[x, y] = (
                    max(0, c[0] - 15),
                    max(0, c[1] - 15),
                    max(0, c[2] - 15),
                    c[3],
                )
img = edge_img
px = img.load()

# ============================================================
# SAVE
# ============================================================
out_path = "/Users/natreed/fallen-empire/public/sprites/entities/ruins.png"
img.save(out_path)
print(f"Saved ruins sprite to {out_path}")
print(f"Size: {img.size}, Mode: {img.mode}")
