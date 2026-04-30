#!/usr/bin/env python3
"""
Split a 1024×1024 2×3 building sprite sheet into six PNGs for public/sprites/buildings/.

Top row: factory (blacksmith), barracks, port
Bottom row: market, farm, university

Output: 64×64 RGBA, black keyed to transparent, nearest-neighbor downscale (matches repo convention).
"""
from __future__ import annotations

import os
import sys

try:
    from PIL import Image
except ImportError:
    print("Install Pillow: pip install Pillow", file=sys.stderr)
    sys.exit(1)

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(REPO, "public/sprites/buildings")
OUT_SIZE = 64
# RGBA key: treat near-black sheet background as transparent
BLACK_KEY_MAX = 12

# (row, col) 0-based in a 2×3 grid → output basename
GRID: list[tuple[tuple[int, int], str]] = [
    ((0, 0), "factory"),
    ((0, 1), "barracks"),
    ((0, 2), "port"),
    ((1, 0), "market"),
    ((1, 1), "farm"),
    ((1, 2), "university"),
]


def column_slices(width: int, cols: int) -> list[tuple[int, int]]:
    base = width // cols
    rem = width % cols
    out: list[tuple[int, int]] = []
    x = 0
    for i in range(cols):
        w = base + (1 if i < rem else 0)
        out.append((x, x + w))
        x += w
    return out


def key_black_to_alpha(im: Image.Image) -> Image.Image:
    im = im.convert("RGBA")
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if r <= BLACK_KEY_MAX and g <= BLACK_KEY_MAX and b <= BLACK_KEY_MAX:
                px[x, y] = (0, 0, 0, 0)
    return im


def fit_center_on_square(src: Image.Image, side: int) -> Image.Image:
    src = src.convert("RGBA")
    bbox = src.getbbox()
    if not bbox:
        return Image.new("RGBA", (side, side), (0, 0, 0, 0))
    src = src.crop(bbox)
    w, h = src.size
    scale = min(side / w, side / h)
    nw = max(1, int(round(w * scale)))
    nh = max(1, int(round(h * scale)))
    src = src.resize((nw, nh), Image.Resampling.NEAREST)
    out = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    ox = (side - nw) // 2
    oy = (side - nh) // 2
    out.paste(src, (ox, oy), src)
    return out


def split_sheet(src_path: str) -> None:
    sheet = Image.open(src_path).convert("RGB")
    w, h = sheet.size
    if w != 1024 or h != 1024:
        print(f"Expected 1024×1024 sheet, got {w}×{h}", file=sys.stderr)
        sys.exit(1)

    col_ranges = column_slices(w, 3)
    row_h = h // 2

    os.makedirs(OUT_DIR, exist_ok=True)

    for (row, col), name in GRID:
        x0, x1 = col_ranges[col]
        y0 = row * row_h
        y1 = (row + 1) * row_h
        cell = sheet.crop((x0, y0, x1, y1))
        cell = key_black_to_alpha(cell)
        cell = fit_center_on_square(cell, OUT_SIZE)
        out_path = os.path.join(OUT_DIR, f"{name}.png")
        cell.save(out_path, "PNG")
        print(out_path)


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python3 scripts/split_building_sheet.py <path-to-1024-sheet.png>", file=sys.stderr)
        sys.exit(1)
    split_sheet(sys.argv[1])


if __name__ == "__main__":
    main()
