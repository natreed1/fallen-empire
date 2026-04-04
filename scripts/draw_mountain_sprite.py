#!/usr/bin/env python3
"""Draw a 64x64 isometric mountain sprite for mountain biome hex tiles."""

from PIL import Image
import random

random.seed(77)

W, H = 64, 64
img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
px = img.load()

# --- Palette ---
rock_darkest = (52, 48, 62, 255)      # violet-shadow base
rock_dark = (72, 76, 90, 255)         # slate blue dark
rock_mid = (92, 96, 110, 255)         # slate blue mid
rock_light = (112, 116, 130, 255)     # slate blue light
rock_highlight = (130, 134, 148, 255) # light ridge highlight

snow_dark = (200, 206, 216, 255)
snow_mid = (220, 226, 236, 255)
snow_light = (238, 242, 250, 255)
snow_bright = (248, 250, 255, 255)

shadow_base = (38, 34, 48, 200)       # deep violet ground shadow


def fill_polygon(px, points, color):
    """Scanline fill a polygon defined by a list of (x, y) tuples."""
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
    """Bresenham's line for ridgelines."""
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
# MAIN PEAK (taller, left-of-center)
# ============================================================
peak1_tip = (26, 11)
peak1_poly = [
    (26, 11),   # tip
    (18, 22),   # left shoulder
    (12, 36),   # left mid
    (8, 50),    # left base
    (30, 54),   # center base
    (44, 50),   # right base
    (38, 34),   # right mid
    (33, 22),   # right shoulder
]

# ============================================================
# SECONDARY PEAK (shorter, right)
# ============================================================
peak2_tip = (42, 20)
peak2_poly = [
    (42, 20),   # tip
    (36, 30),   # left shoulder
    (32, 44),   # left base
    (34, 54),   # center-left base
    (52, 54),   # right base
    (54, 44),   # right lower
    (48, 30),   # right shoulder
]

# --- Fill base layers (back to front: peak2 behind, peak1 in front) ---
fill_polygon(px, peak2_poly, rock_dark)
fill_polygon(px, peak1_poly, rock_mid)

# --- Add shading facets to main peak ---
# Left face (lit side - lighter)
left_face = [
    (26, 11), (18, 22), (12, 36), (8, 50), (30, 54), (28, 36),
]
fill_polygon(px, left_face, rock_light)

# Right face (shadow side - darker)
right_face = [
    (26, 11), (33, 22), (38, 34), (44, 50), (30, 54), (28, 36),
]
fill_polygon(px, right_face, rock_dark)

# Deep shadow strip on far right of main peak
deep_shadow = [
    (33, 22), (38, 34), (44, 50), (40, 52), (36, 36), (31, 24),
]
fill_polygon(px, deep_shadow, rock_darkest)

# --- Shading on secondary peak ---
# Left face (partially lit)
p2_left = [
    (42, 20), (36, 30), (32, 44), (34, 54), (43, 54), (42, 38),
]
fill_polygon(px, p2_left, rock_mid)

# Right face (shadow)
p2_right = [
    (42, 20), (48, 30), (54, 44), (52, 54), (43, 54), (42, 38),
]
fill_polygon(px, p2_right, rock_darkest)

# --- Ridgeline details ---
draw_line(px, 26, 11, 28, 36, rock_highlight)  # main peak center ridge
draw_line(px, 26, 11, 18, 22, rock_highlight)   # main peak left ridge
draw_line(px, 42, 20, 42, 38, rock_light)       # secondary peak center ridge
draw_line(px, 42, 20, 48, 30, rock_mid)         # secondary right ridge

# Additional crag ridgelines
draw_line(px, 20, 24, 14, 40, rock_highlight)
draw_line(px, 30, 26, 36, 40, rock_dark)
draw_line(px, 44, 28, 50, 42, rock_dark)

# --- Snow caps ---
# Main peak snow
snow_main = [
    (26, 11),   # tip
    (20, 20),   # left
    (24, 22),   # inner left
    (26, 16),   # mid
    (29, 22),   # inner right
    (32, 20),   # right
]
fill_polygon(px, snow_main, snow_mid)

# Snow highlight on left (lit) side
snow_hl = [
    (26, 11),
    (20, 20),
    (23, 19),
    (25, 14),
]
fill_polygon(px, snow_hl, snow_light)

# Bright tip pixels
for dx in range(-1, 2):
    if 0 <= 26 + dx < W:
        px[26 + dx, 11] = snow_bright
        px[26 + dx, 12] = snow_light
px[26, 10] = snow_bright

# Secondary peak snow
snow_p2 = [
    (42, 20),
    (39, 26),
    (42, 27),
    (45, 26),
]
fill_polygon(px, snow_p2, snow_dark)
px[42, 20] = snow_light
px[42, 21] = snow_mid
px[41, 21] = snow_light

# --- Rocky texture noise ---
for _ in range(180):
    rx = random.randint(6, 56)
    ry = random.randint(10, 55)
    if 0 <= rx < W and 0 <= ry < H and px[rx, ry][3] > 100:
        base = px[rx, ry]
        if base[0] > 200:
            continue  # don't disturb snow
        shift = random.randint(-12, 12)
        nc = tuple(
            max(0, min(255, base[i] + shift)) if i < 3 else base[3]
            for i in range(4)
        )
        px[rx, ry] = nc

# --- A few dark crevice pixels for depth ---
crevice_spots = [
    (22, 30), (23, 32), (24, 34), (21, 38), (20, 40),
    (35, 32), (36, 34), (37, 38), (36, 42),
    (46, 34), (47, 36), (48, 40), (49, 42),
    (14, 42), (15, 44), (16, 46),
]
for cx, cy in crevice_spots:
    if 0 <= cx < W and 0 <= cy < H and px[cx, cy][3] > 0:
        px[cx, cy] = (40, 36, 52, 255)
        if cx + 1 < W and px[cx + 1, cy][3] > 0:
            px[cx + 1, cy] = rock_darkest

# --- Highlight pixels on left ridges (top-left light) ---
highlights = [
    (18, 22), (19, 23), (17, 25), (16, 28), (15, 30),
    (14, 33), (13, 36), (12, 38), (11, 42), (10, 46),
    (26, 13), (25, 14), (24, 15),
    (39, 24), (40, 23), (41, 22),
]
for hx, hy in highlights:
    if 0 <= hx < W and 0 <= hy < H and px[hx, hy][3] > 0:
        px[hx, hy] = rock_highlight

# --- Ground shadow ellipse ---
for y in range(52, 58):
    for x in range(6, 58):
        dx = (x - 32) / 26
        dy = (y - 55) / 3
        if dx * dx + dy * dy <= 1.0 and px[x, y][3] == 0:
            px[x, y] = (20, 16, 30, 50)

out_path = "/Users/natreed/fallen-empire/public/sprites/entities/mountain.png"
img.save(out_path)
print(f"Saved mountain sprite to {out_path}")
print(f"Size: {img.size}, Mode: {img.mode}")
