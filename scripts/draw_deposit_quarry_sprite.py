#!/usr/bin/env python3
"""Draw a 64x64 isometric quarry deposit sprite — exposed bedrock with chunky stone blocks."""

from PIL import Image
import random

random.seed(4042)

W, H = 64, 64
img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
px = img.load()

# --- Palette: blue-greys ---
stone_darkest  = (55, 58, 65, 255)
stone_dark     = (75, 80, 90, 255)
stone_mid      = (95, 100, 112, 255)
stone_light    = (115, 120, 130, 255)
stone_highlight= (135, 140, 150, 255)
stone_bright   = (155, 158, 165, 255)
crack_dark     = (50, 52, 60, 255)
crack_deeper   = (40, 42, 50, 255)
shadow_color   = (30, 32, 40, 80)


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


# ============================================================
# GROUND SHADOW — semi-transparent ellipse underneath
# ============================================================
for y in range(50, 59):
    for x in range(6, 58):
        ddx = (x - 32) / 26
        ddy = (y - 55) / 4.5
        if ddx * ddx + ddy * ddy <= 1.0:
            dist = ddx * ddx + ddy * ddy
            alpha = int(60 * (1.0 - dist))
            px[x, y] = (20, 22, 30, max(20, alpha))

# ============================================================
# BLOCK 1 — Large central slab (widest, flattest)
# ============================================================
# Top face (brightest — lit from top-left)
top1 = [
    (18, 38), (32, 32), (48, 36), (34, 42),
]
fill_polygon(px, top1, stone_light)

# Left face
left1 = [
    (18, 38), (34, 42), (34, 50), (18, 48),
]
fill_polygon(px, left1, stone_mid)

# Right face (shadow)
right1 = [
    (34, 42), (48, 36), (48, 46), (34, 50),
]
fill_polygon(px, right1, stone_dark)

# ============================================================
# BLOCK 2 — Smaller block sitting on top-left of Block 1
# ============================================================
top2 = [
    (14, 34), (24, 30), (34, 33), (24, 37),
]
fill_polygon(px, top2, stone_highlight)

left2 = [
    (14, 34), (24, 37), (24, 43), (14, 40),
]
fill_polygon(px, left2, stone_light)

right2 = [
    (24, 37), (34, 33), (34, 40), (24, 43),
]
fill_polygon(px, right2, stone_mid)

# ============================================================
# BLOCK 3 — Small chunk front-right
# ============================================================
top3 = [
    (36, 38), (44, 35), (52, 38), (44, 41),
]
fill_polygon(px, top3, stone_light)

left3 = [
    (36, 38), (44, 41), (44, 47), (36, 45),
]
fill_polygon(px, left3, stone_mid)

right3 = [
    (44, 41), (52, 38), (52, 45), (44, 47),
]
fill_polygon(px, right3, stone_dark)

# ============================================================
# BLOCK 4 — Tiny fragment lower-left
# ============================================================
top4 = [
    (8, 42), (14, 40), (20, 42), (14, 44),
]
fill_polygon(px, top4, stone_light)

left4 = [
    (8, 42), (14, 44), (14, 49), (8, 47),
]
fill_polygon(px, left4, stone_mid)

right4 = [
    (14, 44), (20, 42), (20, 48), (14, 49),
]
fill_polygon(px, right4, stone_dark)

# ============================================================
# BLOCK 5 — Tiny chip top-right
# ============================================================
top5 = [
    (38, 32), (44, 30), (50, 33), (44, 35),
]
fill_polygon(px, top5, stone_highlight)

left5 = [
    (38, 32), (44, 35), (44, 38), (38, 36),
]
fill_polygon(px, left5, stone_light)

right5 = [
    (44, 35), (50, 33), (50, 37), (44, 38),
]
fill_polygon(px, right5, stone_mid)

# ============================================================
# CRACKS — dark lines between and across blocks
# ============================================================
cracks = [
    [(20, 38), (24, 40), (28, 39), (32, 41)],
    [(34, 42), (34, 46), (34, 50)],
    [(26, 34), (28, 36), (30, 35)],
    [(40, 37), (42, 39), (44, 38)],
    [(16, 42), (18, 44), (20, 43)],
    [(44, 40), (46, 42), (48, 41)],
    [(22, 44), (26, 46), (30, 45)],
]
for crack in cracks:
    for i in range(len(crack) - 1):
        draw_line(px, crack[i][0], crack[i][1],
                  crack[i + 1][0], crack[i + 1][1], crack_dark)

# Deeper cracks (fewer, darker)
deep_cracks = [
    [(34, 43), (34, 47)],
    [(24, 38), (24, 42)],
    [(44, 38), (44, 42)],
]
for crack in deep_cracks:
    for i in range(len(crack) - 1):
        draw_line(px, crack[i][0], crack[i][1],
                  crack[i + 1][0], crack[i + 1][1], crack_deeper)

# ============================================================
# CHIPPED EDGES — lighter highlight pixels on top-left edges
# ============================================================
edge_highlights = [
    (18, 37), (19, 37), (14, 33), (15, 33), (24, 29), (25, 30),
    (32, 31), (33, 32), (36, 37), (37, 37), (8, 41), (9, 41),
    (38, 31), (39, 31),
]
for ex, ey in edge_highlights:
    if 0 <= ex < W and 0 <= ey < H and px[ex, ey][3] > 0:
        px[ex, ey] = stone_bright

# ============================================================
# TEXTURE NOISE — subtle rocky variation
# ============================================================
for _ in range(150):
    rx = random.randint(6, 54)
    ry = random.randint(28, 52)
    if 0 <= rx < W and 0 <= ry < H and px[rx, ry][3] > 100:
        base = px[rx, ry]
        shift = random.randint(-8, 8)
        nc = tuple(
            max(0, min(255, base[i] + shift)) if i < 3 else base[3]
            for i in range(4)
        )
        px[rx, ry] = nc

# ============================================================
# EDGE DARKENING — darken pixels adjacent to transparency
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
                px[x, y] = (max(0, r - 25), max(0, g - 25), max(0, b - 25), a)

# ============================================================
# VERIFY & SAVE
# ============================================================
out_path = "/Users/natreed/fallen-empire/public/sprites/entities/deposit_quarry.png"
img.save(out_path)

assert px[0, 0] == (0, 0, 0, 0), f"Top-left not transparent: {px[0, 0]}"
assert px[63, 0] == (0, 0, 0, 0), f"Top-right not transparent: {px[63, 0]}"
assert px[0, 63] == (0, 0, 0, 0), f"Bottom-left not transparent: {px[0, 63]}"
assert px[63, 63] == (0, 0, 0, 0), f"Bottom-right not transparent: {px[63, 63]}"

print(f"Saved quarry deposit sprite to {out_path}")
print(f"Size: {img.size}, Mode: {img.mode}")
print(f"Corner pixels: TL={px[0,0]} TR={px[63,0]} BL={px[0,63]} BR={px[63,63]}")
