#!/usr/bin/env python3
"""Emit 64×64 isometric building sprites: Builder's Hut (academy), barracks, university.

Chunky limited-palette pixel art — matches farm/quarry-style buildings (no glossy/modern look)."""
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
    """Builder's Hut — small stone + timber workshop, thatch roof (not a classical/academy look)."""
    im = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    outline = (36, 32, 28, 255)
    stone_l = (120, 108, 92, 255)
    stone_r = (92, 82, 70, 255)
    stone_d = (68, 60, 52, 255)
    timber_l = (140, 100, 52, 255)
    timber_r = (100, 72, 38, 255)
    timber_d = (78, 54, 28, 255)
    thatch_l = (160, 130, 72, 255)
    thatch_r = (120, 92, 48, 255)
    thatch_d = (88, 68, 36, 255)
    door = (42, 34, 28, 255)

    # Cobble base
    base = [(18, 56), (32, 48), (46, 56), (32, 62)]
    d.polygon(base, fill=stone_d, outline=outline)
    d.line([(32, 48), (32, 62)], fill=outline)

    # Stone skirt
    d.polygon([(14, 52), (32, 42), (32, 48), (18, 56)], fill=stone_l, outline=outline)
    d.polygon([(32, 42), (50, 52), (46, 58), (32, 48)], fill=stone_r, outline=outline)

    # Timber walls
    d.polygon([(16, 48), (32, 40), (32, 46), (16, 52)], fill=timber_l, outline=outline)
    d.polygon([(32, 40), (48, 48), (46, 54), (32, 46)], fill=timber_r, outline=outline)
    # Vertical plank hints
    for vx in (20, 24, 28):
        d.line([(vx, 42), (vx, 50)], fill=timber_d, width=1)
    for vx in (36, 40, 44):
        d.line([(vx, 42), (vx, 50)], fill=timber_d, width=1)

    # Door
    d.rectangle([27, 46, 37, 56], fill=door, outline=outline)
    d.line([(32, 46), (32, 56)], fill=(24, 20, 16, 255), width=1)

    # Crossed tools (builder) — tiny pixel read
    d.line([(20, 44), (24, 48)], fill=(180, 160, 120, 255), width=1)
    d.line([(20, 48), (24, 44)], fill=(180, 160, 120, 255), width=1)

    # Thatch roof (warm brown, not blue tile)
    d.polygon([(18, 40), (32, 30), (46, 40), (32, 36)], fill=thatch_l, outline=outline)
    d.polygon([(32, 30), (46, 40), (50, 36), (38, 26)], fill=thatch_r, outline=outline)
    d.line([(32, 30), (32, 36)], fill=thatch_d)
    # Ridge detail
    d.line([(20, 38), (32, 30), (44, 38)], fill=thatch_d, width=1)

    # Small brick chimney
    d.rectangle([44, 28, 48, 36], fill=stone_l, outline=outline)
    d.line([(45, 30), (47, 32)], fill=stone_d, width=1)

    # Tiny window
    d.rectangle([38, 44, 42, 47], fill=(28, 36, 52, 255), outline=outline)

    harden_alpha(im)
    return im


def draw_barracks() -> Image.Image:
    """Barracks — stone + timber; muted rust trim (not bright UI red)."""
    im = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    outline = (36, 32, 28, 255)
    stone_l = (96, 104, 112, 255)
    stone_r = (72, 78, 86, 255)
    stone_d = (52, 58, 64, 255)
    wood = (112, 68, 36, 255)
    wood_d = (82, 48, 24, 255)
    roof_l = (78, 86, 94, 255)
    roof_r = (58, 64, 72, 255)
    rust = (130, 48, 40, 255)
    rust_d = (92, 36, 30, 255)
    door = (28, 24, 20, 255)

    d.polygon([(16, 58), (32, 50), (48, 58), (32, 62)], fill=stone_d, outline=outline)
    d.polygon([(14, 52), (32, 44), (32, 50), (18, 56)], fill=stone_l, outline=outline)
    d.polygon([(32, 44), (50, 52), (46, 58), (32, 50)], fill=stone_r, outline=outline)
    d.line([(18, 48), (26, 54)], fill=stone_d, width=1)
    d.line([(18, 54), (26, 48)], fill=stone_d, width=1)

    d.polygon([(16, 46), (32, 38), (32, 44), (16, 50)], fill=wood, outline=outline)
    d.polygon([(32, 38), (48, 46), (46, 52), (32, 44)], fill=wood_d, outline=outline)
    d.line([(14, 46), (32, 38), (50, 46)], fill=rust, width=2)
    d.line([(16, 46), (48, 46)], fill=rust_d, width=1)

    d.rectangle([28, 48, 36, 56], fill=door, outline=outline)

    d.polygon([(20, 42), (24, 40), (24, 46), (20, 44)], fill=(120, 128, 136, 255), outline=outline)
    d.line([(21, 41), (23, 45)], fill=rust, width=1)

    d.polygon([(18, 38), (32, 28), (46, 38), (32, 34)], fill=roof_l, outline=outline)
    d.polygon([(32, 28), (46, 38), (52, 34), (40, 24)], fill=roof_r, outline=outline)
    d.line([(32, 28), (32, 34)], fill=(40, 44, 52, 255))

    d.rectangle([42, 30, 46, 38], fill=stone_l, outline=outline)

    d.line([(12, 58), (12, 32)], fill=(28, 24, 20, 255), width=2)
    d.polygon([(12, 32), (22, 36), (12, 40)], fill=rust, outline=outline)

    d.rectangle([40, 42, 43, 45], fill=(18, 22, 32, 255), outline=outline)

    harden_alpha(im)
    return im


def draw_university() -> Image.Image:
    """University — taller stone hall + small tower; slate + warm window (distinct from hut)."""
    im = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    outline = (36, 32, 28, 255)
    wall_l = (148, 138, 124, 255)
    wall_r = (118, 108, 98, 255)
    wall_d = (88, 82, 74, 255)
    slate_l = (72, 78, 88, 255)
    slate_r = (52, 58, 68, 255)
    slate_d = (40, 44, 52, 255)
    win = (200, 170, 90, 255)

    base = [(14, 58), (32, 48), (50, 58), (32, 62)]
    d.polygon(base, fill=wall_d, outline=outline)
    d.line([(32, 48), (32, 62)], fill=outline)

    # Main hall block
    d.polygon([(12, 54), (30, 42), (30, 50), (14, 56)], fill=wall_l, outline=outline)
    d.polygon([(30, 42), (50, 54), (48, 58), (30, 50)], fill=wall_r, outline=outline)

    # Tower (right) — taller
    d.polygon([(38, 50), (50, 42), (50, 34), (38, 42)], fill=wall_r, outline=outline)
    d.polygon([(50, 42), (54, 44), (54, 32), (50, 34)], fill=wall_l, outline=outline)

    # Arched window main (left)
    d.rectangle([18, 46, 22, 50], fill=(32, 40, 58, 255), outline=outline)
    d.line([(19, 46), (21, 46)], fill=win, width=1)

    # Tower window
    d.rectangle([46, 38, 49, 42], fill=(32, 40, 58, 255), outline=outline)
    d.rectangle([46, 38, 49, 40], fill=win, outline=outline)

    # Slate roof main
    d.polygon([(14, 44), (32, 30), (46, 44), (32, 38)], fill=slate_l, outline=outline)
    d.polygon([(32, 30), (46, 44), (52, 40), (36, 24)], fill=slate_r, outline=outline)
    d.line([(32, 30), (32, 38)], fill=slate_d)

    # Tower roof (small peak)
    d.polygon([(38, 34), (46, 28), (54, 34), (46, 30)], fill=slate_l, outline=outline)
    d.polygon([(46, 28), (54, 34), (56, 32), (48, 26)], fill=slate_r, outline=outline)

    # Bell hint (1 pixel nub)
    d.rectangle([44, 24, 46, 28], fill=(160, 150, 90, 255), outline=outline)

    harden_alpha(im)
    return im


def main() -> None:
    import os

    root = os.path.join(os.path.dirname(__file__), "..")
    os.makedirs(os.path.join(root, OUT), exist_ok=True)
    a = draw_academy()
    b = draw_barracks()
    u = draw_university()
    a.save(os.path.join(root, OUT, "academy.png"), "PNG")
    b.save(os.path.join(root, OUT, "barracks.png"), "PNG")
    u.save(os.path.join(root, OUT, "university.png"), "PNG")
    print("Wrote", OUT + "/academy.png (Builder's Hut)", a.size)
    print("Wrote", OUT + "/barracks.png", b.size)
    print("Wrote", OUT + "/university.png", u.size)


if __name__ == "__main__":
    main()
