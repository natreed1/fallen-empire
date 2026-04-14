#!/usr/bin/env python3
"""Emit 64x64 isometric building sprites for academy + barracks (RGBA, transparent)."""
from __future__ import annotations

from PIL import Image, ImageDraw

OUT = "public/sprites/buildings"


def harden_alpha(im: Image.Image) -> None:
    """Opaque or transparent pixels only — crisp sprite edges."""
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            px[x, y] = (r, g, b, 255 if a > 127 else 0)


def draw_academy() -> Image.Image:
    im = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    # Palette — scholarly stone + sky blue (UI #0ea5e9 family)
    outline = (42, 40, 52, 255)
    wall_l = (212, 196, 168, 255)
    wall_r = (176, 158, 132, 255)
    col = (226, 232, 240, 255)
    col_d = (148, 163, 184, 255)
    roof_l = (56, 189, 248, 255)  # light cyan
    roof_r = (2, 132, 199, 255)
    roof_d = (3, 105, 161, 255)
    ped = (241, 245, 249, 255)
    book = (14, 165, 233, 255)
    step = (100, 116, 139, 255)

    # Stone steps / base (isometric front)
    base = [(18, 56), (32, 48), (46, 56), (32, 62)]
    d.polygon(base, fill=step, outline=outline)
    d.line([(32, 48), (32, 62)], fill=outline)

    # Left wall face
    d.polygon([(14, 50), (32, 40), (32, 48), (18, 54)], fill=wall_l, outline=outline)
    # Right wall face
    d.polygon([(32, 40), (50, 50), (46, 56), (32, 48)], fill=wall_r, outline=outline)
    # Pediment triangle above portico
    d.polygon([(22, 42), (32, 34), (42, 42)], fill=ped, outline=outline)
    # Book glyph on pediment
    d.rectangle([29, 37, 35, 40], fill=book, outline=outline)
    # Columns (simplified)
    for cx in (24, 32, 40):
        d.rectangle([cx - 2, 42, cx + 1, 50], fill=col, outline=outline)
        d.line([(cx, 42), (cx, 50)], fill=col_d)

    # Main roof — gabled, blue tile
    d.polygon([(20, 38), (32, 28), (44, 38), (32, 34)], fill=roof_l, outline=outline)
    d.polygon([(32, 28), (44, 38), (50, 36), (38, 26)], fill=roof_r, outline=outline)
    d.line([(32, 28), (32, 34)], fill=roof_d)
    # Small cupola / dome
    d.ellipse([28, 22, 36, 30], fill=roof_l, outline=outline)
    d.rectangle([30, 26, 34, 28], fill=roof_d, outline=outline)

    # Side window right wall
    d.rectangle([38, 44, 41, 47], fill=(30, 58, 90, 255), outline=outline)

    harden_alpha(im)
    return im


def draw_barracks() -> Image.Image:
    im = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    outline = (42, 40, 52, 255)
    stone_l = (100, 116, 139, 255)
    stone_r = (71, 85, 105, 255)
    stone_d = (51, 65, 85, 255)
    wood = (120, 53, 15, 255)
    wood_d = (88, 38, 10, 255)
    roof_l = (71, 85, 105, 255)
    roof_r = (51, 65, 85, 255)
    red = (239, 68, 68, 255)  # #ef4444
    red_d = (185, 28, 28, 255)
    door = (30, 27, 24, 255)

    # Foundation
    d.polygon([(16, 58), (32, 50), (48, 58), (32, 62)], fill=stone_d, outline=outline)

    # Lower stone block
    d.polygon([(14, 52), (32, 44), (32, 50), (18, 56)], fill=stone_l, outline=outline)
    d.polygon([(32, 44), (50, 52), (46, 58), (32, 50)], fill=stone_r, outline=outline)
    # X brace on left stone
    d.line([(18, 48), (26, 54)], fill=stone_d, width=1)
    d.line([(18, 54), (26, 48)], fill=stone_d, width=1)

    # Upper timber
    d.polygon([(16, 46), (32, 38), (32, 44), (16, 50)], fill=wood, outline=outline)
    d.polygon([(32, 38), (48, 46), (46, 52), (32, 44)], fill=wood_d, outline=outline)
    # Red eaves trim
    d.line([(14, 46), (32, 38), (50, 46)], fill=red, width=2)
    d.line([(16, 46), (48, 46)], fill=red_d, width=1)

    # Door
    d.rectangle([28, 48, 36, 56], fill=door, outline=outline)

    # Small shield on left wall
    d.polygon([(20, 42), (24, 40), (24, 46), (20, 44)], fill=(148, 163, 184, 255), outline=outline)
    d.line([(21, 41), (23, 45)], fill=red, width=1)

    # Roof
    d.polygon([(18, 38), (32, 28), (46, 38), (32, 34)], fill=roof_l, outline=outline)
    d.polygon([(32, 28), (46, 38), (52, 34), (40, 24)], fill=roof_r, outline=outline)
    d.line([(32, 28), (32, 34)], fill=(30, 41, 59, 255))

    # Chimney
    d.rectangle([42, 30, 46, 38], fill=stone_l, outline=outline)

    # Flag pole + red pennant
    d.line([(12, 58), (12, 32)], fill=(30, 27, 24, 255), width=2)
    d.polygon([(12, 32), (22, 36), (12, 40)], fill=red, outline=outline)

    # Window slit right
    d.rectangle([40, 42, 43, 45], fill=(15, 23, 42, 255), outline=outline)

    harden_alpha(im)
    return im


def main() -> None:
    import os

    root = os.path.join(os.path.dirname(__file__), "..")
    os.makedirs(os.path.join(root, OUT), exist_ok=True)
    a = draw_academy()
    b = draw_barracks()
    a.save(os.path.join(root, OUT, "academy.png"), "PNG")
    b.save(os.path.join(root, OUT, "barracks.png"), "PNG")
    print("Wrote", OUT + "/academy.png", a.size)
    print("Wrote", OUT + "/barracks.png", b.size)


if __name__ == "__main__":
    main()
