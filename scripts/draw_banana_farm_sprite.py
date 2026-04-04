#!/usr/bin/env python3
"""Generate public/sprites/buildings/banana_farm.png — 64×64 isometric pixel art."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

OUT_PATH = Path(__file__).resolve().parents[1] / "public" / "sprites" / "buildings" / "banana_farm.png"

# Palette
T = (0, 0, 0, 0)
BLK = (28, 24, 22, 255)
OUTLINE = (45, 40, 38, 255)
GR1 = (52, 140, 72, 255)
GR2 = (76, 176, 98, 255)
GR3 = (110, 206, 130, 255)
SOIL = (120, 92, 58, 255)
SOIL2 = (92, 70, 44, 255)
HUTW1 = (210, 185, 140, 255)
HUTW2 = (175, 145, 105, 255)
ROOF1 = (95, 150, 65, 255)
ROOF2 = (72, 120, 52, 255)
ROOF3 = (55, 95, 42, 255)
ROOF4 = (130, 175, 75, 255)
TRUNK = (95, 65, 38, 255)
TRUNK2 = (70, 48, 30, 255)
LEAF1 = (38, 130, 55, 255)
LEAF2 = (28, 100, 45, 255)
LEAF3 = (55, 165, 75, 255)
BAN = (240, 215, 65, 255)
BAN2 = (210, 175, 40, 255)
BAN3 = (180, 145, 35, 255)


def main() -> None:
    img = Image.new("RGBA", (64, 64), T)
    px = img.load()
    draw = ImageDraw.Draw(img)

    def setp(x: int, y: int, c: tuple[int, int, int, int]) -> None:
        if 0 <= x < 64 and 0 <= y < 64:
            px[x, y] = c

    def line(x0: int, y0: int, x1: int, y1: int, c: tuple[int, int, int, int]) -> None:
        dx, dy = abs(x1 - x0), abs(y1 - y0)
        sx = 1 if x0 < x1 else -1
        sy = 1 if y0 < y1 else -1
        err = dx - dy
        x, y = x0, y0
        while True:
            setp(x, y, c)
            if x == x1 and y == y1:
                break
            e2 = 2 * err
            if e2 > -dy:
                err -= dy
                x += sx
            if e2 < dx:
                err += dx
                y += sy

    # Grass isometric pad
    pad = [(32, 52), (52, 42), (32, 32), (12, 42)]
    draw.polygon(pad, fill=GR2)
    draw.polygon(pad, outline=OUTLINE)
    draw.polygon([(32, 48), (46, 41), (32, 36), (18, 41)], fill=GR3)
    draw.line([(20, 42), (32, 48), (44, 42)], fill=GR1, width=1)

    # Tilled rows (field)
    for row in range(3):
        yy = 40 + row * 2
        line(8, yy, 24, yy + 1, SOIL2)
    line(43, 44, 50, 40, SOIL)
    line(44, 45, 51, 41, SOIL2)

    # Young banana pups in field
    for bx in (9, 14, 19):
        setp(bx, 41, LEAF3)
        setp(bx - 1, 42, LEAF2)
        setp(bx + 1, 42, LEAF2)
        setp(bx, 40, LEAF1)

    # Smaller banana plant (back left)
    for y in range(22, 30):
        setp(8, y, TRUNK2 if y % 2 else TRUNK)
    setp(6, 18, LEAF3)
    setp(7, 17, LEAF1)
    setp(8, 16, LEAF3)
    setp(9, 17, LEAF1)
    setp(10, 18, LEAF2)
    setp(5, 19, LEAF2)
    setp(11, 19, LEAF2)
    setp(7, 20, BAN)
    setp(8, 21, BAN2)
    setp(9, 20, BAN)
    line(5, 17, 3, 19, OUTLINE)
    line(11, 17, 13, 19, OUTLINE)

    # Main banana tree (left of hut)
    for y in range(18, 28):
        setp(18, y, TRUNK2 if y % 2 else TRUNK)
    setp(17, 22, OUTLINE)
    setp(19, 22, OUTLINE)
    for dx, dy, col in [
        (-8, 2, LEAF2), (-6, 0, LEAF1), (-4, -2, LEAF3), (-2, -3, LEAF3),
        (0, -4, LEAF3), (2, -3, LEAF1), (4, -2, LEAF3), (6, 0, LEAF2),
        (8, 2, LEAF2), (-5, 3, LEAF1), (5, 3, LEAF1),
        (-3, -2, LEAF1), (3, -2, LEAF1), (-1, -3, LEAF2), (1, -3, LEAF2),
        (-6, -1, LEAF3), (6, -1, LEAF3), (-4, 1, LEAF2), (4, 1, LEAF2),
    ]:
        setp(18 + dx, 16 + dy, col)
    line(18, 16, 10, 18, LEAF2)
    line(18, 16, 26, 18, LEAF2)
    line(18, 14, 14, 10, LEAF3)
    line(18, 14, 22, 10, LEAF3)
    outline_leaf = [(10, 18), (14, 10), (18, 8), (22, 10), (26, 18), (18, 20)]
    for i in range(len(outline_leaf) - 1):
        line(
            outline_leaf[i][0],
            outline_leaf[i][1],
            outline_leaf[i + 1][0],
            outline_leaf[i + 1][1],
            OUTLINE,
        )

    # Hanging bunches (read at small scale)
    for bx, by in [(14, 20), (15, 21), (13, 21), (14, 22), (16, 20), (17, 21)]:
        setp(bx, by, BAN if (bx + by) % 2 == 0 else BAN2)
    setp(14, 22, BAN3)
    setp(12, 22, OUTLINE)
    setp(16, 22, OUTLINE)
    setp(11, 21, OUTLINE)

    # Tropical hut walls
    hut_base_y = 28
    for y in range(hut_base_y, 36):
        w = 14 - (y - hut_base_y) // 2
        x0 = 34 - w // 2
        for x in range(x0, x0 + w):
            col = HUTW1 if (x + y) % 3 else HUTW2
            setp(x, y, col)
    for y in range(hut_base_y, 36):
        w = 14 - (y - hut_base_y) // 2
        x0 = 34 - w // 2
        setp(x0, y, OUTLINE)
        setp(x0 + w - 1, y, OUTLINE)
    for x in range(27, 42):
        setp(x, 35, OUTLINE)
    setp(33, 33, BLK)
    setp(33, 34, BLK)
    setp(34, 33, BLK)

    # Palm thatch roof (on top of walls)
    roof_pts = [(26, 28), (40, 28), (44, 22), (22, 22)]
    draw.polygon(roof_pts, fill=ROOF1)
    draw.polygon(roof_pts, outline=OUTLINE)
    draw.line([(28, 24), (38, 24)], fill=ROOF4, width=1)
    draw.polygon([(24, 23), (33, 20), (28, 22)], fill=ROOF2)
    draw.polygon([(33, 20), (42, 23), (38, 22)], fill=ROOF3)

    # Blend trunks into grass
    for gx, gy in ((18, 27), (8, 29)):
        setp(gx - 1, gy, GR2)
        setp(gx + 1, gy, GR2)
        setp(gx, gy + 1, GR2)

    img.save(OUT_PATH, "PNG")
    print(f"Wrote {OUT_PATH}")


if __name__ == "__main__":
    main()
