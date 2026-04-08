#!/usr/bin/env python3
"""One-off generator for map detail billboards (64x64 RGBA, straight alpha on silhouettes)."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[1] / "public" / "sprites" / "entities"

# Palette — muted, readable on dark green plains; light from top-left
G0 = (32, 44, 30, 255)
G1 = (42, 58, 38, 255)
G2 = (56, 74, 48, 255)
G3 = (70, 92, 62, 255)
G4 = (84, 108, 72, 255)
B0 = (44, 34, 26, 255)
B1 = (58, 44, 34, 255)
B2 = (72, 56, 44, 255)
# Muted accents
FLOWER_MAUVE = (120, 72, 92, 255)
FLOWER_BLUE = (72, 96, 128, 255)
FLOWER_CREAM = (188, 176, 148, 255)
COW_WHITE = (168, 164, 152, 255)
SHADOW = (28, 32, 36, 110)


def new_canvas(w: int, h: int) -> Image.Image:
    return Image.new("RGBA", (w, h), (0, 0, 0, 0))


def oval_shadow(
    img: Image.Image,
    cx: int,
    cy: int,
    rx: int,
    ry: int,
    color: tuple[int, int, int, int] = SHADOW,
) -> None:
    draw = ImageDraw.Draw(img, "RGBA")
    bbox = (cx - rx, cy - ry, cx + rx, cy + ry)
    draw.ellipse(bbox, fill=color)


def put_block(img: Image.Image, pixels: list[tuple[int, int, tuple[int, int, int, int]]]) -> None:
    for x, y, c in pixels:
        if 0 <= x < img.width and 0 <= y < img.height:
            img.putpixel((x, y), c)


def save(img: Image.Image, name: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / name
    img.save(path, "PNG")
    print(f"Wrote {path} ({img.width}x{img.height})")


def make_flower() -> Image.Image:
    img = new_canvas(64, 64)
    oval_shadow(img, 32, 54, 14, 4)
    # Stems & leaves (cluster, center-bottom)
    stems: list[tuple[int, int, tuple[int, int, int, int]]] = [
        (30, 50, G1),
        (31, 49, G2),
        (32, 48, G1),
        (33, 49, G2),
        (34, 50, G1),
        (29, 48, G0),
        (35, 48, G0),
        (30, 47, G2),
        (33, 47, G3),
        (31, 46, G3),
        (32, 45, G2),
        (34, 46, G3),
        (32, 44, G4),
        (31, 43, G2),
        (33, 43, G2),
        (30, 42, G1),
        (34, 42, G1),
        # left flower
        (28, 38, G2),
        (27, 37, G3),
        (28, 36, FLOWER_MAUVE),
        (29, 37, FLOWER_MAUVE),
        (27, 36, FLOWER_MAUVE),
        # center flower
        (32, 34, G2),
        (31, 33, G3),
        (32, 32, FLOWER_CREAM),
        (33, 33, FLOWER_CREAM),
        (32, 33, FLOWER_CREAM),
        # right flower
        (36, 39, G2),
        (37, 38, G3),
        (37, 37, FLOWER_BLUE),
        (36, 37, FLOWER_BLUE),
        (38, 38, FLOWER_BLUE),
        (35, 36, G1),
    ]
    put_block(img, stems)
    return img


def make_grass() -> Image.Image:
    img = new_canvas(64, 64)
    oval_shadow(img, 32, 55, 16, 5)
    # Tuft — jagged blades
    blades: list[tuple[int, int, tuple[int, int, int, int]]] = []
    # outline of tuft
    coords = [
        (24, 54, G0),
        (25, 53, G0),
        (26, 52, G1),
        (27, 50, G1),
        (28, 48, G2),
        (29, 46, G2),
        (30, 44, G3),
        (31, 42, G4),
        (32, 40, G4),
        (33, 42, G4),
        (34, 44, G3),
        (35, 46, G2),
        (36, 48, G2),
        (37, 50, G1),
        (38, 52, G1),
        (39, 53, G0),
        (40, 54, G0),
        (26, 53, G1),
        (27, 52, G2),
        (28, 51, G2),
        (29, 49, G3),
        (30, 47, G3),
        (31, 45, G4),
        (32, 43, G4),
        (33, 45, G4),
        (34, 47, G3),
        (35, 49, G3),
        (36, 51, G2),
        (37, 52, G2),
        (38, 53, G1),
        (29, 50, G1),
        (30, 48, G2),
        (31, 46, G3),
        (32, 44, G3),
        (33, 46, G3),
        (34, 48, G2),
        (35, 50, G1),
        (32, 46, G2),
        (31, 47, G3),
        (33, 47, G3),
        (30, 49, G1),
        (34, 49, G1),
        (32, 48, G4),
        (28, 49, G0),
        (36, 49, G0),
    ]
    blades.extend(coords)
    put_block(img, blades)
    return img


def make_cow() -> Image.Image:
    img = new_canvas(64, 64)
    oval_shadow(img, 34, 56, 18, 5)
    # Side view, head down grazing (facing left), small
    px: list[tuple[int, int, tuple[int, int, int, int]]] = [
        # body
        (38, 44, B1),
        (39, 44, B2),
        (40, 44, B1),
        (41, 45, B1),
        (42, 45, B0),
        (43, 46, B0),
        (37, 45, B1),
        (38, 45, COW_WHITE),
        (39, 45, B1),
        (40, 45, B2),
        (41, 46, B1),
        (42, 46, B1),
        (36, 46, B1),
        (37, 46, B2),
        (38, 46, COW_WHITE),
        (39, 46, B1),
        (40, 46, COW_WHITE),
        (41, 47, B1),
        (42, 47, B0),
        (35, 47, B1),
        (36, 47, B1),
        (37, 47, B2),
        (38, 47, B1),
        (39, 47, B2),
        (40, 47, B1),
        (41, 48, B0),
        # belly line
        (36, 48, B0),
        (37, 48, B1),
        (38, 48, B1),
        (39, 48, B0),
        (40, 48, B0),
        # legs
        (36, 49, B0),
        (37, 49, B0),
        (39, 49, B0),
        (41, 49, B0),
        (36, 50, B0),
        (37, 50, B0),
        (39, 50, B0),
        (41, 50, B0),
        (36, 51, B0),
        (41, 51, B0),
        # neck down
        (34, 46, B1),
        (33, 47, B1),
        (32, 48, B1),
        (31, 49, B2),
        (30, 50, B2),
        # head
        (29, 51, B2),
        (28, 52, B1),
        (27, 52, B1),
        (26, 53, B0),
        (28, 53, B0),
        (29, 52, B1),
        (30, 51, B2),
        # ear
        (33, 45, B2),
        (32, 44, B2),
        # tail
        (44, 45, B0),
        (45, 44, B0),
        (46, 43, B0),
    ]
    put_block(img, px)
    return img


def make_wildlife() -> Image.Image:
    img = new_canvas(64, 64)
    oval_shadow(img, 32, 56, 12, 4)
    # Small deer, 3/4-ish, facing right
    px: list[tuple[int, int, tuple[int, int, int, int]]] = [
        # body
        (28, 48, B0),
        (29, 47, B1),
        (30, 46, B1),
        (31, 45, B2),
        (32, 44, B2),
        (33, 44, B1),
        (34, 44, B1),
        (35, 45, B1),
        (36, 46, B0),
        (29, 48, B1),
        (30, 47, B2),
        (31, 46, B2),
        (32, 45, B2),
        (33, 45, B2),
        (34, 45, B1),
        (35, 46, B1),
        # chest
        (27, 49, B0),
        (28, 49, B1),
        (29, 49, B1),
        # legs (thin)
        (28, 50, B0),
        (28, 51, B0),
        (30, 50, B0),
        (30, 51, B0),
        (33, 50, B0),
        (33, 51, B0),
        (35, 50, B0),
        (35, 51, B0),
        # neck
        (26, 48, B1),
        (25, 47, B1),
        (24, 46, B2),
        # head
        (23, 45, B2),
        (22, 44, B2),
        (21, 43, B2),
        (22, 43, B1),
        (23, 44, B1),
        (24, 45, B1),
        # ear
        (22, 42, B1),
        (21, 41, B0),
        # small antler
        (23, 41, B0),
        (24, 40, B0),
        (25, 39, B0),
        (24, 41, B1),
        # tail
        (37, 46, B0),
        (38, 47, B0),
    ]
    put_block(img, px)
    return img


def main() -> None:
    save(make_flower(), "detail_flower.png")
    save(make_grass(), "detail_grass.png")
    save(make_cow(), "detail_cow.png")
    save(make_wildlife(), "detail_wildlife.png")


if __name__ == "__main__":
    main()
