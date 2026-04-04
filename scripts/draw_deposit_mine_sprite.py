#!/usr/bin/env python3
"""Draw a 64x64 isometric iron ore mine deposit — dark rocky outcrop with metallic ore veins."""

from PIL import Image
import random

random.seed(9091)

W, H = 64, 64
img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
px = img.load()

# --- Palette: dark browns & iron ---
rock_darkest  = (24, 20, 18, 255)
rock_dark     = (44, 36, 30, 255)
rock_mid      = (58, 48, 40, 255)
rock_light    = (70, 58, 50, 255)
rock_highlight= (82, 70, 60, 255)

ore_dark      = (130, 120, 110, 255)
ore_mid       = (160, 148, 138, 255)
ore_light     = (190, 175, 162, 255)
ore_bright    = (210, 195, 180, 255)
ore_gleam     = (235, 225, 215, 255)

shadow_color  = (15, 12, 10, 70)


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
# GROUND SHADOW — semi-transparent ellipse underneath
# ============================================================
for y in range(50, 59):
    for x in range(6, 58):
        ddx = (x - 32) / 26
        ddy = (y - 55) / 4.5
        if ddx * ddx + ddy * ddy <= 1.0:
            dist = ddx * ddx + ddy * ddy
            alpha = int(55 * (1.0 - dist))
            px[x, y] = (10, 8, 6, max(15, alpha))

# ============================================================
# MAIN ROCK MASS — irregular dark outcrop
# ============================================================
main_rock = [
    (20, 30), (28, 26), (38, 28), (46, 32),
    (50, 38), (48, 46), (38, 50), (26, 50),
    (16, 46), (12, 38),
]
fill_polygon(px, main_rock, rock_mid)

# Left face — slightly lighter (lit from top-left)
left_face = [
    (20, 30), (28, 26), (26, 38),
    (26, 50), (16, 46), (12, 38),
]
fill_polygon(px, left_face, rock_light)

# Right face — darker (in shadow)
right_face = [
    (28, 26), (38, 28), (46, 32), (50, 38),
    (48, 46), (38, 50), (26, 50), (26, 38),
]
fill_polygon(px, right_face, rock_dark)

# Top ridge facet — brightest
top_facet = [
    (22, 30), (28, 26), (36, 28), (44, 32),
    (36, 34), (26, 34),
]
fill_polygon(px, top_facet, rock_highlight)

# ============================================================
# SECONDARY CHUNK — front-left
# ============================================================
chunk2 = [
    (8, 40), (14, 36), (22, 38),
    (24, 46), (18, 50), (8, 48),
]
fill_polygon(px, chunk2, rock_mid)

chunk2_lit = [
    (8, 40), (14, 36), (16, 42),
    (14, 48), (8, 48),
]
fill_polygon(px, chunk2_lit, rock_light)

# ============================================================
# SMALL CHUNK — right side
# ============================================================
chunk3 = [
    (44, 38), (52, 36), (56, 42),
    (54, 48), (46, 46),
]
fill_polygon(px, chunk3, rock_dark)

chunk3_top = [
    (44, 38), (52, 36), (50, 40), (46, 40),
]
fill_polygon(px, chunk3_top, rock_mid)

# ============================================================
# ORE VEINS — metallic seams running through the rock
# ============================================================

# Main diagonal vein
vein1 = [
    (16, 36), (20, 38), (24, 37), (28, 39),
    (32, 38), (36, 40), (40, 39), (44, 41),
]
for i in range(len(vein1) - 1):
    draw_line(px, vein1[i][0], vein1[i][1],
              vein1[i + 1][0], vein1[i + 1][1], ore_mid)

# Secondary vein — vertical on left face
vein2 = [
    (18, 32), (20, 36), (19, 40), (21, 44), (20, 48),
]
for i in range(len(vein2) - 1):
    draw_line(px, vein2[i][0], vein2[i][1],
              vein2[i + 1][0], vein2[i + 1][1], ore_dark)

# Branch vein on right face
vein3 = [
    (38, 30), (40, 34), (42, 38), (44, 42),
]
for i in range(len(vein3) - 1):
    draw_line(px, vein3[i][0], vein3[i][1],
              vein3[i + 1][0], vein3[i + 1][1], ore_mid)

# Short vein on chunk2
vein4 = [
    (12, 42), (14, 44), (18, 43),
]
for i in range(len(vein4) - 1):
    draw_line(px, vein4[i][0], vein4[i][1],
              vein4[i + 1][0], vein4[i + 1][1], ore_dark)

# Thicken veins (add parallel pixels only where rock exists)
for vein in [vein1, vein2, vein3]:
    for vx, vy in vein:
        if 0 <= vx + 1 < W and 0 <= vy < H and px[vx + 1, vy][3] > 100:
            px[vx + 1, vy] = ore_dark
        if 0 <= vx < W and 0 <= vy + 1 < H and px[vx, vy + 1][3] > 100:
            px[vx, vy + 1] = ore_dark

# ============================================================
# ORE CHUNKS — small bright metallic spots
# ============================================================
ore_spots = [
    (22, 37, 3), (30, 39, 2), (36, 40, 2),
    (18, 40, 2), (42, 40, 2), (26, 44, 2),
    (34, 34, 2), (48, 42, 2), (14, 44, 2),
]
for ox, oy, size in ore_spots:
    if size >= 3:
        draw_ellipse_filled(px, ox, oy, 2, 1, ore_mid)
        if 0 <= ox < W and 0 <= oy < H:
            px[ox, oy] = ore_light
        if 0 <= ox - 1 < W and 0 <= oy - 1 < H:
            px[ox - 1, oy - 1] = ore_bright
    else:
        for ddx in range(-1, 2):
            for ddy in range(-1, 1):
                cx, cy = ox + ddx, oy + ddy
                if 0 <= cx < W and 0 <= cy < H and px[cx, cy][3] > 100:
                    px[cx, cy] = ore_mid
        if 0 <= ox < W and 0 <= oy < H:
            px[ox, oy] = ore_light

# ============================================================
# METALLIC GLEAMS — bright highlights on ore
# ============================================================
gleam_spots = [
    (22, 36), (30, 38), (36, 39), (34, 33),
    (18, 39), (42, 39), (48, 41),
]
for gx, gy in gleam_spots:
    if 0 <= gx < W and 0 <= gy < H and px[gx, gy][3] > 0:
        px[gx, gy] = ore_gleam
    for d in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
        sx, sy = gx + d[0], gy + d[1]
        if 0 <= sx < W and 0 <= sy < H and px[sx, sy][3] > 100:
            r, g, b, a = px[sx, sy]
            px[sx, sy] = (min(255, r + 30), min(255, g + 28), min(255, b + 25), a)

# ============================================================
# TEXTURE NOISE — subtle rocky variation
# ============================================================
for _ in range(160):
    rx = random.randint(6, 56)
    ry = random.randint(24, 52)
    if 0 <= rx < W and 0 <= ry < H and px[rx, ry][3] > 100:
        base = px[rx, ry]
        if base[0] > 120:
            continue  # don't disturb ore highlights
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
                px[x, y] = (max(0, r - 20), max(0, g - 18), max(0, b - 15), a)

# ============================================================
# VERIFY & SAVE
# ============================================================
out_path = "/Users/natreed/fallen-empire/public/sprites/entities/deposit_mine.png"
img.save(out_path)

assert px[0, 0] == (0, 0, 0, 0), f"Top-left not transparent: {px[0, 0]}"
assert px[63, 0] == (0, 0, 0, 0), f"Top-right not transparent: {px[63, 0]}"
assert px[0, 63] == (0, 0, 0, 0), f"Bottom-left not transparent: {px[0, 63]}"
assert px[63, 63] == (0, 0, 0, 0), f"Bottom-right not transparent: {px[63, 63]}"

print(f"Saved mine deposit sprite to {out_path}")
print(f"Size: {img.size}, Mode: {img.mode}")
print(f"Corner pixels: TL={px[0,0]} TR={px[63,0]} BL={px[0,63]} BR={px[63,63]}")
