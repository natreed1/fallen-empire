#!/usr/bin/env python3
"""Draw a 64x64 isometric gold deposit sprite — quartz vein with gold nuggets."""

from PIL import Image
import random

random.seed(2026)

W, H = 64, 64
img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
px = img.load()

# --- Palette ---
rock_darkest  = (140, 122, 72, 255)
rock_dark     = (170, 148, 88, 255)
rock_mid      = (185, 162, 100, 255)
rock_light    = (195, 172, 110, 255)
rock_highlight= (210, 190, 128, 255)

gold_dark     = (180, 150, 40, 255)
gold_mid      = (220, 185, 55, 255)
gold_light    = (240, 210, 70, 255)
gold_bright   = (255, 235, 90, 255)
gold_gleam    = (255, 255, 180, 255)

shadow_color  = (90, 78, 48, 180)


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


def draw_ellipse_filled(px, cx, cy, rx, ry, color):
    for y in range(cy - ry, cy + ry + 1):
        for x in range(cx - rx, cx + rx + 1):
            if 0 <= x < W and 0 <= y < H:
                ddx = (x - cx) / max(rx, 1)
                ddy = (y - cy) / max(ry, 1)
                if ddx * ddx + ddy * ddy <= 1.0:
                    px[x, y] = color


# ============================================================
# MAIN ROCK FORMATION — a chunky quartz outcrop
# ============================================================

# Large central rock mass
main_rock = [
    (22, 24),  # top-left
    (32, 18),  # top peak
    (44, 22),  # top-right
    (48, 32),  # right mid
    (46, 44),  # right base
    (34, 48),  # bottom center
    (18, 46),  # left base
    (14, 34),  # left mid
]
fill_polygon(px, main_rock, rock_mid)

# Left face — lit by top-left light
left_face = [
    (22, 24),
    (32, 18),
    (30, 34),
    (18, 46),
    (14, 34),
]
fill_polygon(px, left_face, rock_light)

# Right face — shadowed
right_face = [
    (32, 18),
    (44, 22),
    (48, 32),
    (46, 44),
    (34, 48),
    (30, 34),
]
fill_polygon(px, right_face, rock_dark)

# Top facet — brightest
top_facet = [
    (24, 24),
    (32, 18),
    (40, 22),
    (32, 28),
]
fill_polygon(px, top_facet, rock_highlight)

# Secondary smaller rock chunk (front-left)
chunk2 = [
    (10, 38),
    (16, 34),
    (22, 36),
    (24, 44),
    (18, 50),
    (10, 46),
]
fill_polygon(px, chunk2, rock_mid)

chunk2_lit = [
    (10, 38),
    (16, 34),
    (18, 40),
    (14, 48),
    (10, 46),
]
fill_polygon(px, chunk2_lit, rock_light)

# Small rock chunk (right)
chunk3 = [
    (42, 36),
    (50, 34),
    (54, 40),
    (52, 48),
    (44, 46),
]
fill_polygon(px, chunk3, rock_dark)

chunk3_top = [
    (42, 36),
    (50, 34),
    (48, 38),
    (44, 38),
]
fill_polygon(px, chunk3_top, rock_mid)

# ============================================================
# GOLD VEINS — running through rock surfaces
# ============================================================

# Main diagonal vein across the large rock
vein_points = [
    (20, 30), (23, 32), (26, 31), (29, 33), (32, 32),
    (35, 34), (38, 33), (41, 35), (44, 34),
]
for i in range(len(vein_points) - 1):
    draw_line(px, vein_points[i][0], vein_points[i][1],
              vein_points[i + 1][0], vein_points[i + 1][1], gold_mid)

# Secondary vein (more vertical, left face)
vein2 = [
    (18, 28), (20, 32), (19, 36), (21, 40), (20, 44),
]
for i in range(len(vein2) - 1):
    draw_line(px, vein2[i][0], vein2[i][1],
              vein2[i + 1][0], vein2[i + 1][1], gold_dark)

# Branch vein on right
vein3 = [
    (36, 26), (38, 30), (40, 34), (42, 38),
]
for i in range(len(vein3) - 1):
    draw_line(px, vein3[i][0], vein3[i][1],
              vein3[i + 1][0], vein3[i + 1][1], gold_mid)

# Thicken veins slightly (add parallel pixels)
for vein in [vein_points, vein2, vein3]:
    for vx, vy in vein:
        if 0 <= vx + 1 < W and 0 <= vy < H and px[vx + 1, vy][3] > 0:
            px[vx + 1, vy] = gold_dark
        if 0 <= vx < W and 0 <= vy + 1 < H and px[vx, vy + 1][3] > 0:
            px[vx, vy + 1] = gold_dark

# ============================================================
# GOLD NUGGETS — small bright clusters
# ============================================================

nugget_positions = [
    (24, 32, 3), (30, 34, 2), (38, 33, 2),
    (19, 38, 2), (42, 36, 2), (26, 42, 2),
    (34, 28, 2), (46, 40, 2),
]
for nx, ny, size in nugget_positions:
    if size >= 3:
        draw_ellipse_filled(px, nx, ny, 2, 1, gold_mid)
        px[nx, ny] = gold_light
        if 0 <= nx - 1 < W and 0 <= ny - 1 < H:
            px[nx - 1, ny - 1] = gold_bright
    else:
        for ddx in range(-1, 2):
            for ddy in range(-1, 1):
                cx, cy = nx + ddx, ny + ddy
                if 0 <= cx < W and 0 <= cy < H and px[cx, cy][3] > 0:
                    px[cx, cy] = gold_mid
        px[nx, ny] = gold_light

# ============================================================
# SPARKLE / GLEAM EFFECT
# ============================================================

gleam_spots = [
    (24, 31), (30, 33), (38, 32), (34, 27),
    (20, 37), (42, 35), (46, 39),
]
for gx, gy in gleam_spots:
    if 0 <= gx < W and 0 <= gy < H:
        px[gx, gy] = gold_gleam
    # Cross gleam pattern
    for d in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
        sx, sy = gx + d[0], gy + d[1]
        if 0 <= sx < W and 0 <= sy < H and px[sx, sy][3] > 0:
            r, g, b, a = px[sx, sy]
            px[sx, sy] = (min(255, r + 40), min(255, g + 40), min(255, b + 20), a)

# Extra bright sparkle pixels (star pattern)
star_spots = [(24, 31), (38, 32), (34, 27)]
for sx, sy in star_spots:
    for d in [(-2, 0), (2, 0), (0, -2), (0, 2)]:
        cx, cy = sx + d[0], sy + d[1]
        if 0 <= cx < W and 0 <= cy < H and px[cx, cy][3] > 0:
            px[cx, cy] = gold_bright

# ============================================================
# TEXTURE NOISE — rocky variation
# ============================================================
for _ in range(120):
    rx = random.randint(8, 56)
    ry = random.randint(16, 50)
    if 0 <= rx < W and 0 <= ry < H and px[rx, ry][3] > 100:
        base = px[rx, ry]
        if base[1] > 150 and base[0] > 180:
            continue  # don't disturb gold
        shift = random.randint(-10, 10)
        nc = tuple(
            max(0, min(255, base[i] + shift)) if i < 3 else base[3]
            for i in range(4)
        )
        px[rx, ry] = nc

# ============================================================
# EDGE DARKENING — subtle outline via darker border pixels
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
                px[x, y] = (max(0, r - 30), max(0, g - 25), max(0, b - 20), a)

# ============================================================
# GROUND SHADOW
# ============================================================
for y in range(48, 56):
    for x in range(8, 56):
        ddx = (x - 32) / 24
        ddy = (y - 52) / 4
        if ddx * ddx + ddy * ddy <= 1.0 and px[x, y][3] == 0:
            px[x, y] = (60, 50, 30, 50)

out_path = "/Users/natreed/fallen-empire/public/sprites/entities/deposit_gold.png"
img.save(out_path)
print(f"Saved gold deposit sprite to {out_path}")
print(f"Size: {img.size}, Mode: {img.mode}")
