#!/usr/bin/env python3
"""Draw a 64x64 isometric wall tower/post sprite — compact stone tower with crenellations."""

from PIL import Image
import random

random.seed(77)

W, H = 64, 64
img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
px = img.load()

# --- Palette (warm stone within requested range) ---
STONE_HI      = (162, 148, 122, 255)
STONE_LIGHT   = (148, 135, 112, 255)
STONE_MID     = (132, 120, 100, 255)
STONE_DARK    = (115, 105, 90, 255)
STONE_DARKEST = (90, 82, 70, 255)
WALKWAY       = (140, 128, 108, 255)

MORTAR_LT     = (110, 100, 84, 255)
MORTAR_DK     = (84, 76, 64, 255)

SHADOW_DEEP   = (72, 62, 52, 255)
SHADOW_EDGE   = (62, 54, 46, 255)

MOSS_DK       = (44, 74, 38, 255)
MOSS_MD       = (52, 88, 44, 255)
MOSS_LT       = (58, 94, 48, 255)

GROUND_SHADOW = (40, 34, 28, 50)


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


def pixel(x, y, color):
    if 0 <= x < W and 0 <= y < H:
        px[x, y] = color


def rect(x, y, w, h, color):
    for ry in range(y, y + h):
        for rx in range(x, x + w):
            if 0 <= rx < W and 0 <= ry < H:
                px[rx, ry] = color


# ============================================================
# TOWER GEOMETRY — isometric box
# ============================================================
# Top-face diamond (battlement walkway level)
TN = (32, 28)
TE = (40, 32)
TS = (32, 36)
TW = (24, 32)
BODY_H = 16

BW = (TW[0], TW[1] + BODY_H)   # (24, 48)
BS = (TS[0], TS[1] + BODY_H)    # (32, 52)
BE = (TE[0], TE[1] + BODY_H)    # (40, 48)

# ============================================================
# 1. GROUND SHADOW — soft ellipse under the tower
# ============================================================
for y in range(50, 58):
    for x in range(16, 48):
        dx_f = (x - 32) / 16.0
        dy_f = (y - 54) / 4.0
        if dx_f * dx_f + dy_f * dy_f <= 1.0:
            pixel(x, y, GROUND_SHADOW)

# ============================================================
# 2. TOWER BODY FACES
# ============================================================
fill_poly([TS, TE, BE, BS], STONE_DARK)      # right face (shadow)
fill_poly([TW, TS, BS, BW], STONE_MID)       # left face (lit)

# ============================================================
# 3. BASE TRIM — darker foundation band (bottom 3px of each face)
# ============================================================
fill_poly([(24, 45), (32, 49), (32, 52), (24, 48)], STONE_DARKEST)
fill_poly([(32, 49), (40, 45), (40, 48), (32, 52)], SHADOW_DEEP)
line(24, 48, 32, 52, SHADOW_EDGE)
line(32, 52, 40, 48, SHADOW_EDGE)

# ============================================================
# 4. STONE COURSES — horizontal mortar lines on faces
# ============================================================
for h_off in [3, 7, 11]:
    line(24, 32 + h_off, 32, 36 + h_off, MORTAR_LT)
    line(32, 36 + h_off, 40, 32 + h_off, MORTAR_DK)

# Vertical mortar joints on left face
for course, (h_top, h_bot) in enumerate([(0, 3), (3, 7), (7, 11), (11, 14)]):
    offsets = [0.33, 0.67] if course % 2 == 0 else [0.25, 0.5, 0.75]
    for jt in offsets:
        jx = int(24 + 8 * jt)
        base_y = int(32 + 4 * jt)
        jy = base_y + (h_top + h_bot) // 2
        pixel(jx, jy, MORTAR_LT)

# Vertical mortar joints on right face
for course, (h_top, h_bot) in enumerate([(0, 3), (3, 7), (7, 11), (11, 14)]):
    offsets = [0.33, 0.67] if course % 2 == 0 else [0.25, 0.5, 0.75]
    for jt in offsets:
        jx = int(32 + 8 * jt)
        base_y = int(36 - 4 * jt)
        jy = base_y + (h_top + h_bot) // 2
        pixel(jx, jy, MORTAR_DK)

# ============================================================
# 5. ARROW SLITS — one per visible face
# ============================================================
for (cx, cy, col_border, col_inner) in [
    (28, 40, STONE_LIGHT, MORTAR_LT),   # left face
    (36, 40, STONE_DARK,  MORTAR_DK),    # right face
]:
    for dy in range(-2, 3):
        pixel(cx, cy + dy, SHADOW_DEEP)
    pixel(cx - 1, cy, SHADOW_DEEP)
    pixel(cx + 1, cy, SHADOW_DEEP)
    pixel(cx - 1, cy - 1, SHADOW_EDGE)
    pixel(cx + 1, cy - 1, SHADOW_EDGE)
    pixel(cx - 1, cy - 2, col_border)
    pixel(cx + 1, cy + 2, col_inner)

# ============================================================
# 6. TOP FACE + CORNICE
# ============================================================
# Outer cornice ring (1px wider than tower body on each side)
cornice_outer = [(32, 27), (41, 32), (32, 37), (23, 32)]
fill_poly(cornice_outer, STONE_LIGHT)

# Inner walkway (the actual top face, slightly recessed/darker)
inner_top = [(32, 28), (39, 32), (32, 36), (25, 32)]
fill_poly(inner_top, WALKWAY)

# NW rim highlight (light catches the top-left edge)
line(32, 27, 23, 32, STONE_HI)
# NE rim
line(32, 27, 41, 32, STONE_LIGHT)
# SW and SE bottom edges of cornice (underside shadow)
line(23, 33, 31, 37, SHADOW_DEEP)
line(33, 37, 41, 33, SHADOW_EDGE)

# Inner walkway detail lines
line(28, 30, 32, 32, MORTAR_LT)
line(32, 32, 36, 30, MORTAR_DK)

# ============================================================
# 7. MERLONS (crenellations) — alternating raised blocks
# ============================================================

# --- NW edge merlons (lit side) ---
for t in [0.12, 0.42, 0.72]:
    bx = int(32 - 8 * t)
    by = int(28 + 4 * t)
    for dy in range(4):
        pixel(bx - 1, by - 4 + dy, STONE_MID)
        pixel(bx,     by - 4 + dy, STONE_MID)
        pixel(bx + 1, by - 4 + dy, MORTAR_LT)
    pixel(bx - 1, by - 4, STONE_HI)
    pixel(bx,     by - 4, STONE_HI)
    pixel(bx + 1, by - 4, STONE_LIGHT)
    # Inner face pixel (depth cue)
    pixel(bx, by - 1, STONE_DARK)

# --- NE edge merlons (shadow side) ---
for t in [0.12, 0.42, 0.72]:
    bx = int(32 + 8 * t)
    by = int(28 + 4 * t)
    for dy in range(4):
        pixel(bx - 1, by - 4 + dy, STONE_MID)
        pixel(bx,     by - 4 + dy, STONE_DARK)
        pixel(bx + 1, by - 4 + dy, STONE_DARKEST)
    pixel(bx - 1, by - 4, STONE_LIGHT)
    pixel(bx,     by - 4, STONE_LIGHT)
    pixel(bx + 1, by - 4, STONE_MID)
    pixel(bx, by - 1, STONE_DARKEST)

# --- Front-edge merlons (on top face, SW and SE) ---
for t in [0.3, 0.7]:
    mx = int(24 + 8 * t)
    my = int(32 + 4 * t)
    pixel(mx, my - 1, STONE_MID)
    pixel(mx + 1, my - 1, STONE_MID)
    pixel(mx, my - 2, STONE_HI)
    pixel(mx + 1, my - 2, STONE_HI)

for t in [0.3, 0.7]:
    mx = int(32 + 8 * t)
    my = int(36 - 4 * t)
    pixel(mx, my - 1, STONE_DARK)
    pixel(mx + 1, my - 1, STONE_DARK)
    pixel(mx, my - 2, STONE_LIGHT)
    pixel(mx + 1, my - 2, STONE_LIGHT)

# ============================================================
# 8. CORNER PILASTERS — subtle darker vertical bands at tower corners
# ============================================================
# Left face, left edge (near W vertex going down)
for dy in range(BODY_H - 3):
    pixel(24, 32 + dy, STONE_DARKEST)
# Left face, right edge (near S vertex going down)
for dy in range(BODY_H - 3):
    pixel(32, 36 + dy, SHADOW_EDGE)
# Right face, right edge (near E vertex going down)
for dy in range(BODY_H - 3):
    pixel(40, 32 + dy, STONE_DARKEST)

# ============================================================
# 9. MOSS & WEATHERING
# ============================================================
moss_spots = [
    (25, 46), (26, 45), (24, 44),
    (39, 46), (38, 45), (40, 44),
    (27, 43), (34, 43), (35, 44),
    (30, 49), (31, 50),
    (26, 34), (25, 33),
    (38, 33), (39, 34),
    (29, 47), (34, 48),
]
for mx, my in moss_spots:
    if 0 <= mx < W and 0 <= my < H and px[mx, my][3] > 0:
        pixel(mx, my, random.choice([MOSS_DK, MOSS_MD, MOSS_LT]))

# Small moss clusters
for cx, cy in [(25, 48), (37, 47), (30, 44)]:
    if 0 <= cx < W and 0 <= cy < H and px[cx, cy][3] > 0:
        pixel(cx, cy, MOSS_MD)
        pixel(cx + 1, cy, MOSS_DK)
        if cy + 1 < H and px[cx, cy + 1][3] > 0:
            pixel(cx, cy + 1, MOSS_LT)

# ============================================================
# 10. TEXTURE NOISE — subtle stone variation
# ============================================================
for _ in range(80):
    rx = random.randint(22, 42)
    ry = random.randint(26, 52)
    if 0 <= rx < W and 0 <= ry < H and px[rx, ry][3] > 100:
        base = px[rx, ry]
        if base[0] < 60 or base == GROUND_SHADOW:
            continue
        shift = random.randint(-6, 6)
        nc = tuple(
            max(0, min(255, base[i] + shift)) if i < 3 else base[3]
            for i in range(4)
        )
        px[rx, ry] = nc

# ============================================================
# 11. EDGE DARKENING — darken outermost visible pixels
# ============================================================
edge_img = img.copy()
edge_px = edge_img.load()
for y in range(H):
    for x in range(W):
        if px[x, y][3] > 100:
            neighbors = 0
            for ddx, ddy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                nx, ny = x + ddx, y + ddy
                if 0 <= nx < W and 0 <= ny < H and px[nx, ny][3] > 100:
                    neighbors += 1
            if neighbors < 4:
                c = px[x, y]
                edge_px[x, y] = (
                    max(0, c[0] - 14),
                    max(0, c[1] - 14),
                    max(0, c[2] - 14),
                    c[3],
                )
img = edge_img
px = img.load()

# ============================================================
# VERIFY: all 4 corners must be fully transparent
# ============================================================
for cx, cy in [(0, 0), (63, 0), (0, 63), (63, 63)]:
    assert px[cx, cy] == (0, 0, 0, 0), f"Corner ({cx},{cy}) not transparent: {px[cx, cy]}"

# ============================================================
# SAVE
# ============================================================
out_path = "/Users/natreed/fallen-empire/public/sprites/buildings/wall.png"
img.save(out_path)
print(f"Saved wall tower sprite to {out_path}")
print(f"Size: {img.size}, Mode: {img.mode}")

# Quick stats
opaque = sum(1 for y in range(H) for x in range(W) if px[x, y][3] > 0)
print(f"Non-transparent pixels: {opaque} / {W*H}")
