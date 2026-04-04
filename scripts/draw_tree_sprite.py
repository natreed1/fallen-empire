#!/usr/bin/env python3
"""Draw a 64x64 isometric tree cluster sprite for forest biome tiles."""

from PIL import Image, ImageDraw

W, H = 64, 64
img = Image.new("RGBA", (W, H), (0, 0, 0, 0))

trunk_dark = (48, 34, 22, 255)
trunk_mid = (66, 44, 30, 255)
trunk_light = (82, 58, 38, 255)

leaf_dark = (18, 58, 28, 255)
leaf_mid = (28, 78, 36, 255)
leaf_light = (38, 100, 48, 255)
leaf_highlight = (50, 110, 55, 255)

shadow = (10, 30, 14, 180)

px = img.load()


def draw_ellipse_filled(px, cx, cy, rx, ry, color):
    """Pixel-perfect filled ellipse with no anti-aliasing."""
    for y in range(cy - ry, cy + ry + 1):
        for x in range(cx - rx, cx + rx + 1):
            if 0 <= x < W and 0 <= y < H:
                dx = (x - cx) / max(rx, 1)
                dy = (y - cy) / max(ry, 1)
                if dx * dx + dy * dy <= 1.0:
                    px[x, y] = color


def draw_trunk(px, base_x, base_y, height):
    """Draw a short isometric trunk, 3-4px wide."""
    for y in range(base_y - height, base_y + 1):
        px[base_x - 1, y] = trunk_dark
        px[base_x, y] = trunk_mid
        px[base_x + 1, y] = trunk_light
        if height > 6 and y < base_y - 2:
            px[base_x + 2, y] = trunk_dark


def draw_canopy(px, cx, cy, size="medium"):
    """Draw a blobby canopy cluster with light direction from top-left."""
    if size == "large":
        draw_ellipse_filled(px, cx + 1, cy + 2, 9, 7, shadow)
        draw_ellipse_filled(px, cx, cy, 9, 7, leaf_dark)
        draw_ellipse_filled(px, cx - 1, cy - 1, 8, 6, leaf_mid)
        draw_ellipse_filled(px, cx - 2, cy - 2, 6, 4, leaf_light)
        draw_ellipse_filled(px, cx - 3, cy - 3, 3, 2, leaf_highlight)
    elif size == "medium":
        draw_ellipse_filled(px, cx + 1, cy + 1, 7, 5, shadow)
        draw_ellipse_filled(px, cx, cy, 7, 5, leaf_dark)
        draw_ellipse_filled(px, cx - 1, cy - 1, 6, 4, leaf_mid)
        draw_ellipse_filled(px, cx - 2, cy - 2, 4, 3, leaf_light)
        draw_ellipse_filled(px, cx - 3, cy - 3, 2, 1, leaf_highlight)
    else:  # small
        draw_ellipse_filled(px, cx + 1, cy + 1, 5, 4, shadow)
        draw_ellipse_filled(px, cx, cy, 5, 4, leaf_dark)
        draw_ellipse_filled(px, cx - 1, cy - 1, 4, 3, leaf_mid)
        draw_ellipse_filled(px, cx - 2, cy - 2, 2, 2, leaf_light)


# --- Tree 1: Large center tree ---
t1_base_x, t1_base_y = 32, 48
draw_trunk(px, t1_base_x, t1_base_y, 12)
draw_canopy(px, t1_base_x, t1_base_y - 14, "large")

# --- Tree 2: Medium tree, front-left ---
t2_base_x, t2_base_y = 18, 52
draw_trunk(px, t2_base_x, t2_base_y, 9)
draw_canopy(px, t2_base_x, t2_base_y - 11, "medium")

# --- Tree 3: Small tree, back-right ---
t3_base_x, t3_base_y = 44, 44
draw_trunk(px, t3_base_x, t3_base_y, 8)
draw_canopy(px, t3_base_x, t3_base_y - 10, "small")

# Add a few scattered leaf pixels for organic feel
import random
random.seed(42)
for _ in range(20):
    rx = random.randint(8, 55)
    ry = random.randint(12, 45)
    if px[rx, ry][3] > 0 and px[rx, ry] != trunk_dark and px[rx, ry] != trunk_mid:
        choices = [leaf_dark, leaf_mid, leaf_light]
        px[rx, ry] = random.choice(choices)

# Small ground shadow ellipse under the cluster
for y in range(50, 56):
    for x in range(14, 50):
        dx = (x - 32) / 18
        dy = (y - 53) / 3
        if dx * dx + dy * dy <= 1.0 and px[x, y][3] == 0:
            px[x, y] = (10, 20, 10, 60)

out_path = "/Users/natreed/fallen-empire/public/sprites/entities/tree.png"
img.save(out_path)
print(f"Saved tree sprite to {out_path}")
print(f"Size: {img.size}, Mode: {img.mode}")
