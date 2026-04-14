#!/usr/bin/env python3
"""64×64 RGBA billboard props for named wilds — style-matched to ruins/tree pixel art."""
from __future__ import annotations

from PIL import Image, ImageDraw

OUT = "public/sprites/entities"


def harden_alpha(im: Image.Image) -> None:
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            px[x, y] = (r, g, b, 255 if a > 127 else 0)


def draw_mexca() -> Image.Image:
    """Broken plaza column / arch — desert stone."""
    im = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    o = (42, 38, 34, 255)
    s1 = (200, 184, 150, 255)
    s2 = (160, 142, 118, 255)
    s3 = (120, 100, 82, 255)
    # base
    d.polygon([(18, 52), (46, 52), (44, 58), (20, 58)], fill=s3, outline=o)
    # column shaft
    d.polygon([(26, 52), (28, 22), (36, 22), (38, 52)], fill=s1, outline=o)
    # capital
    d.polygon([(24, 24), (40, 24), (38, 18), (26, 18)], fill=s2, outline=o)
    # broken top
    d.polygon([(28, 18), (34, 14), (36, 20), (30, 22)], fill=s3, outline=o)
    d.line([(30, 22), (34, 10)], fill=o, width=2)
    harden_alpha(im)
    return im


def draw_hills_lost() -> Image.Image:
    """Cairn / stacked stones."""
    im = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    o = (38, 36, 40, 255)
    r1 = (130, 118, 108, 255)
    r2 = (96, 88, 82, 255)
    r3 = (72, 66, 62, 255)
    d.ellipse([22, 40, 42, 52], fill=r3, outline=o)
    d.ellipse([24, 30, 40, 44], fill=r2, outline=o)
    d.ellipse([28, 22, 36, 36], fill=r1, outline=o)
    d.polygon([(30, 22), (34, 22), (32, 14)], fill=r1, outline=o)
    harden_alpha(im)
    return im


def draw_forest_secrets() -> Image.Image:
    """Gnarled stump + sprout — reads with forest trees without full hex paint."""
    im = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    o = (22, 48, 32, 255)
    bark = (86, 62, 44, 255)
    bark_d = (58, 42, 30, 255)
    leaf = (34, 120, 72, 255)
    # stump
    d.polygon([(24, 56), (40, 56), (38, 36), (26, 36)], fill=bark, outline=o)
    d.line([(32, 36), (32, 28)], fill=bark_d, width=3)
    # canopy knot
    d.ellipse([26, 18, 38, 32], fill=leaf, outline=o)
    d.ellipse([20, 24, 30, 34], fill=leaf, outline=o)
    harden_alpha(im)
    return im


def draw_isle_lost() -> Image.Image:
    """Driftwood / rope — reads on coast or shallows."""
    im = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    o = (32, 48, 58, 255)
    wood = (140, 118, 92, 255)
    wood_d = (96, 78, 58, 255)
    rope = (180, 160, 120, 255)
    d.polygon([(12, 44), (52, 36), (50, 42), (14, 50)], fill=wood, outline=o)
    d.polygon([(14, 46), (48, 38), (46, 40), (16, 48)], fill=wood_d, outline=o)
    d.arc([18, 30, 46, 48], start=200, end=340, fill=rope, width=2)
    harden_alpha(im)
    return im


def main() -> None:
    pairs = [
        ("sr_prop_mexca.png", draw_mexca),
        ("sr_prop_hills_lost.png", draw_hills_lost),
        ("sr_prop_forest_secrets.png", draw_forest_secrets),
        ("sr_prop_isle_lost.png", draw_isle_lost),
    ]
    for name, fn in pairs:
        path = f"{OUT}/{name}"
        fn().save(path)
        print("wrote", path)


if __name__ == "__main__":
    main()
