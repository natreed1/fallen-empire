#!/usr/bin/env python3
"""Draw a 64x64 isometric ancient arcane deposit sprite — cracked stone with glowing runes."""

from PIL import Image
import random
import math

random.seed(2077)

W, H = 64, 64
img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
px = img.load()

# --- Palette ---
stone_darkest  = (58, 50, 62, 255)
stone_dark     = (72, 62, 76, 255)
stone_mid      = (88, 76, 92, 255)
stone_light    = (100, 88, 105, 255)
stone_highlight= (118, 106, 120, 255)

arcane_deep    = (100, 40, 140, 255)
arcane_dark    = (120, 60, 160, 255)
arcane_mid     = (140, 80, 180, 255)
arcane_light   = (160, 100, 200, 255)
arcane_bright  = (180, 130, 220, 255)
arcane_glow    = (210, 170, 255, 200)
arcane_core    = (230, 200, 255, 255)

shadow_color   = (30, 24, 38, 160)


def fill_polygon(px, points, color):
    if len(points) < 3:
        return
    ys = [p[1] for p in points]
    min_y, max_y = int(min(ys)), int(max(ys))
    for y in range(min_y, max_y + 1):
        intersections = []
        n = len(points)
        for i in range(n):
            x1, y1 = points[i]
            x2, y2 = points[(i + 1) % n]
            if y1 == y2:
                continue
            if min(y1, y2) <= y < max(y1, y2):
                x_int = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
                intersections.append(x_int)
        intersections.sort()
        for j in range(0, len(intersections) - 1, 2):
            x_start = int(intersections[j])
            x_end = int(intersections[j + 1])
            for x in range(x_start, x_end + 1):
                if 0 <= x < W and 0 <= y < H:
                    px[x, y] = color


def draw_line(px, x0, y0, x1, y1, color):
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


def draw_thick_line(px, x0, y0, x1, y1, color, thickness=1):
    """Draw a line with optional thickness by drawing parallel lines."""
    draw_line(px, x0, y0, x1, y1, color)
    for t in range(1, thickness):
        draw_line(px, x0, y0 + t, x1, y1 + t, color)
        draw_line(px, x0 + t, y0, x1 + t, y1, color)


# ============================================================
# BASE PLATFORM — broken stone slabs (iso diamond shape)
# ============================================================

# Main platform — a cracked stone circle/diamond
platform = [
    (32, 20),  # top
    (50, 30),  # right
    (52, 34),  # right-lower
    (46, 44),  # bottom-right
    (32, 50),  # bottom
    (18, 44),  # bottom-left
    (12, 34),  # left-lower
    (14, 30),  # left
]
fill_polygon(px, platform, stone_mid)

# Top surface (brighter, lit)
top_surface = [
    (32, 20),
    (50, 30),
    (32, 40),
    (14, 30),
]
fill_polygon(px, top_surface, stone_light)

# Right face (darker)
right_face = [
    (50, 30),
    (52, 34),
    (46, 44),
    (32, 50),
    (32, 40),
]
fill_polygon(px, right_face, stone_dark)

# Left face (mid shadow)
left_face = [
    (14, 30),
    (12, 34),
    (18, 44),
    (32, 50),
    (32, 40),
]
fill_polygon(px, left_face, stone_darkest)

# ============================================================
# BROKEN STONE SLABS — layered on top
# ============================================================

# Central raised slab
slab1 = [
    (26, 24),
    (38, 24),
    (42, 30),
    (38, 36),
    (26, 36),
    (22, 30),
]
fill_polygon(px, slab1, stone_light)

slab1_top = [
    (26, 24),
    (38, 24),
    (34, 28),
    (28, 28),
]
fill_polygon(px, slab1_top, stone_highlight)

# Tilted slab fragment (left)
slab2 = [
    (16, 30),
    (22, 26),
    (26, 30),
    (24, 36),
    (18, 36),
]
fill_polygon(px, slab2, stone_light)

# Small fragment (right)
slab3 = [
    (40, 28),
    (48, 30),
    (46, 36),
    (40, 34),
]
fill_polygon(px, slab3, stone_mid)

slab3_top = [
    (40, 28),
    (48, 30),
    (44, 30),
    (40, 29),
]
fill_polygon(px, slab3_top, stone_highlight)

# ============================================================
# ARCANE CRACKS / FISSURES — glowing purple lines
# ============================================================

cracks = [
    # Main central crack (runs through platform)
    [(24, 28), (28, 32), (32, 30), (36, 34), (40, 32), (44, 34)],
    # Vertical crack left
    [(20, 26), (22, 30), (20, 34), (22, 38), (20, 42)],
    # Diagonal crack right
    [(38, 26), (42, 30), (44, 36), (46, 40)],
    # Small crack bottom
    [(28, 38), (32, 42), (36, 40), (38, 44)],
    # Radial crack top-left
    [(26, 22), (24, 26), (26, 30)],
    # Radial crack top-right
    [(38, 22), (40, 26), (38, 30)],
]

for crack in cracks:
    for i in range(len(crack) - 1):
        draw_line(px, crack[i][0], crack[i][1],
                  crack[i + 1][0], crack[i + 1][1], arcane_mid)

# Add glow around cracks (softer purple aura)
for crack in cracks:
    for cx, cy in crack:
        for ddx in range(-2, 3):
            for ddy in range(-2, 3):
                gx, gy = cx + ddx, cy + ddy
                if 0 <= gx < W and 0 <= gy < H and px[gx, gy][3] > 0:
                    dist = abs(ddx) + abs(ddy)
                    if dist == 1:
                        r, g, b, a = px[gx, gy]
                        if g < 90:  # only affect stone pixels
                            px[gx, gy] = (
                                min(255, r + 20),
                                max(0, g - 5),
                                min(255, b + 40),
                                a,
                            )
                    elif dist == 2:
                        r, g, b, a = px[gx, gy]
                        if g < 90:
                            px[gx, gy] = (
                                min(255, r + 8),
                                g,
                                min(255, b + 16),
                                a,
                            )

# Brighten crack centers
for crack in cracks:
    for cx, cy in crack:
        if 0 <= cx < W and 0 <= cy < H:
            px[cx, cy] = arcane_light

# ============================================================
# GLOWING RUNE SPOTS — bright arcane focal points
# ============================================================

rune_positions = [
    (28, 30), (36, 32), (22, 34), (42, 34),
    (32, 26), (32, 38),
]

for rx, ry in rune_positions:
    if 0 <= rx < W and 0 <= ry < H and px[rx, ry][3] > 0:
        px[rx, ry] = arcane_core
        # Glow ring
        for ddx, ddy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            gx, gy = rx + ddx, ry + ddy
            if 0 <= gx < W and 0 <= gy < H:
                px[gx, gy] = arcane_bright
        # Outer glow
        for ddx, ddy in [(-2, 0), (2, 0), (0, -2), (0, 2),
                          (-1, -1), (-1, 1), (1, -1), (1, 1)]:
            gx, gy = rx + ddx, ry + ddy
            if 0 <= gx < W and 0 <= gy < H and px[gx, gy][3] > 0:
                r, g, b, a = px[gx, gy]
                px[gx, gy] = (
                    min(255, r + 25),
                    max(0, g + 5),
                    min(255, b + 45),
                    a,
                )

# ============================================================
# RUNE SYMBOLS — simple geometric marks on the stone
# ============================================================

# Small cross rune at center
draw_line(px, 30, 30, 34, 30, arcane_bright)
draw_line(px, 32, 28, 32, 32, arcane_bright)

# Triangle rune fragment (left slab)
draw_line(px, 20, 32, 22, 28, arcane_mid)
draw_line(px, 22, 28, 24, 32, arcane_mid)
draw_line(px, 20, 32, 24, 32, arcane_mid)

# Arc rune (right slab)
for angle_deg in range(0, 180, 15):
    a = math.radians(angle_deg)
    x = int(44 + 3 * math.cos(a))
    y = int(32 + 2 * math.sin(a))
    if 0 <= x < W and 0 <= y < H and px[x, y][3] > 0:
        px[x, y] = arcane_mid

# ============================================================
# AMBIENT GLOW PARTICLES — floating arcane motes
# ============================================================

mote_positions = [
    (26, 20), (38, 18), (14, 28), (50, 28),
    (20, 46), (44, 46), (32, 16),
]
for mx, my in mote_positions:
    if 0 <= mx < W and 0 <= my < H:
        px[mx, my] = arcane_glow
    # Tiny cross
    for ddx, ddy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
        gx, gy = mx + ddx, my + ddy
        if 0 <= gx < W and 0 <= gy < H and px[gx, gy][3] == 0:
            px[gx, gy] = (arcane_glow[0], arcane_glow[1], arcane_glow[2], 80)

# ============================================================
# TEXTURE NOISE — weathered stone variation
# ============================================================
for _ in range(150):
    rx = random.randint(10, 54)
    ry = random.randint(18, 52)
    if 0 <= rx < W and 0 <= ry < H and px[rx, ry][3] > 100:
        base = px[rx, ry]
        if base[2] > 150:
            continue  # don't disturb arcane glow
        shift = random.randint(-8, 8)
        nc = tuple(
            max(0, min(255, base[i] + shift)) if i < 3 else base[3]
            for i in range(4)
        )
        px[rx, ry] = nc

# ============================================================
# EDGE DARKENING
# ============================================================
for y in range(H):
    for x in range(W):
        if px[x, y][3] > 100:
            neighbors_empty = 0
            for ddx, ddy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                nx, ny = x + ddx, y + ddy
                if nx < 0 or nx >= W or ny < 0 or ny >= H or px[nx, ny][3] < 50:
                    neighbors_empty += 1
            if neighbors_empty >= 2:
                r, g, b, a = px[x, y]
                if b < 150:  # don't darken glow pixels
                    px[x, y] = (max(0, r - 20), max(0, g - 18), max(0, b - 15), a)

# ============================================================
# GROUND SHADOW
# ============================================================
for y in range(46, 56):
    for x in range(10, 54):
        ddx = (x - 32) / 22
        ddy = (y - 51) / 5
        if ddx * ddx + ddy * ddy <= 1.0 and px[x, y][3] == 0:
            px[x, y] = (20, 14, 30, 50)

# Subtle purple ground glow near the base
for y in range(44, 54):
    for x in range(16, 48):
        ddx = (x - 32) / 16
        ddy = (y - 49) / 5
        if ddx * ddx + ddy * ddy <= 1.0 and px[x, y][3] < 80:
            dist = math.sqrt(ddx * ddx + ddy * ddy)
            alpha = int(30 * (1.0 - dist))
            if alpha > 0:
                if px[x, y][3] == 0:
                    px[x, y] = (120, 60, 180, alpha)
                else:
                    r, g, b, a = px[x, y]
                    px[x, y] = (
                        min(255, r + 10),
                        g,
                        min(255, b + 20),
                        min(255, a + alpha),
                    )

out_path = "/Users/natreed/fallen-empire/public/sprites/entities/deposit_ancient.png"
img.save(out_path)
print(f"Saved ancient deposit sprite to {out_path}")
print(f"Size: {img.size}, Mode: {img.mode}")
