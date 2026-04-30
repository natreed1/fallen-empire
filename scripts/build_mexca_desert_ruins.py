#!/usr/bin/env python3
"""
Build Mexca scroll-region art from the authored 1024×1024 desert-ruins sheet.

Writes:
  public/sprites/overlays/biomes/sr_mexca_{0..3}.png — 128×128 flat hex caps (masked)
  public/sprites/entities/sr_prop_mexca.png — 64×64 billboard accent

Tile layout (from sheet analysis): 3 + 3 + 4 hexes; large tree occupies the left.
Variant assignment (visual variety): arch, twin pillars, obelisk, giant head.

Run from repo root:
  python3 scripts/build_mexca_desert_ruins.py [path/to/sheet.png]
"""
from __future__ import annotations

import importlib.util
import os
import sys

try:
    from PIL import Image
except ImportError:
    raise SystemExit("Install Pillow: pip install pillow")

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_BIOMES = os.path.join(REPO, "public", "sprites", "overlays", "biomes")
OUT_ENT = os.path.join(REPO, "public", "sprites", "entities")
SIZE = 128
PROP = 64

DEFAULT_SHEET = os.path.join(
    os.path.expanduser("~"),
    ".cursor",
    "projects",
    "Users-natreed-fallen-empire",
    "assets",
    "ChatGPT_Image_Apr_23__2026__09_52_50_PM-369eb56a-58a8-4c72-8eba-5434b780bbc9.png",
)


def _load_gen_overlay_module():
    path = os.path.join(os.path.dirname(__file__), "generate_special_region_overlays.py")
    spec = importlib.util.spec_from_file_location("gen_sr_overlay", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def fit_square(im: Image.Image, side: int) -> Image.Image:
    im = im.convert("RGBA")
    w, h = im.size
    if w == h == side:
        return im
    scale = side / max(w, h)
    nw = max(1, int(round(w * scale)))
    nh = max(1, int(round(h * scale)))
    im = im.resize((nw, nh), Image.Resampling.NEAREST)
    out = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    ox = (side - nw) // 2
    oy = (side - nh) // 2
    out.paste(im, (ox, oy), im)
    return out


def apply_hex_mask(im: Image.Image, mask_fn) -> None:
    w, h = im.size
    px = im.load()
    for y in range(h):
        for x in range(w):
            if not mask_fn(x, y):
                px[x, y] = (0, 0, 0, 0)


def crop_center(sheet: Image.Image, cx: int, cy: int, half: int) -> Image.Image:
    w, h = sheet.size
    x0 = max(0, cx - half)
    y0 = max(0, cy - half)
    x1 = min(w, cx + half)
    y1 = min(h, cy + half)
    cell = sheet.crop((x0, y0, x1, y1))
    cw, ch = cell.size
    side = max(cw, ch)
    pad = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    ox = (side - cw) // 2
    oy = (side - ch) // 2
    pad.paste(cell, (ox, oy))
    return pad


def main() -> None:
    src = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SHEET
    if not os.path.isfile(src):
        print("Sheet not found:", src, file=sys.stderr)
        sys.exit(1)

    mod = _load_gen_overlay_module()
    mask = mod.make_hex_texture_mask(SIZE)

    sheet = Image.open(src).convert("RGB")
    if sheet.size != (1024, 1024):
        print(f"Warning: expected 1024×1024, got {sheet.size[0]}×{sheet.size[1]}", file=sys.stderr)

    # (cx, cy, half) — centers from content-span analysis of the 1024 sheet
    row1 = [(576, 368, 95), (749, 368, 95), (918, 368, 95)]
    row2 = [(519, 598, 95), (719, 598, 95), (911, 598, 95)]
    row3 = [(143, 828, 102), (377, 828, 102), (616, 828, 102), (860, 828, 102)]
    all_tiles = row1 + row2 + row3

    # Variants: arch (row1 mid), twin pillars (row1 right), obelisk (row3 left), giant head (row3 mid-left)
    variant_indices = [1, 2, 6, 7]
    os.makedirs(OUT_BIOMES, exist_ok=True)
    for v, ti in enumerate(variant_indices):
        cell = crop_center(sheet, *all_tiles[ti])
        im128 = fit_square(cell, SIZE)
        apply_hex_mask(im128, mask)
        path = os.path.join(OUT_BIOMES, f"sr_mexca_{v}.png")
        im128.save(path)
        print("wrote", path)

    # Small prop: jars / arch base — tight crop on tile index 1 then downscale
    prop_cell = crop_center(sheet, *all_tiles[1])
    # focus lower-center of that crop (pots near arch)
    pw, ph = prop_cell.size
    sub = prop_cell.crop((pw // 4, ph // 3, 3 * pw // 4, 19 * ph // 20))
    prop = fit_square(sub, PROP)
    # Billboards stay square (no flat-hex mask — would clip the prop silhouette).
    os.makedirs(OUT_ENT, exist_ok=True)
    ppath = os.path.join(OUT_ENT, "sr_prop_mexca.png")
    prop.save(ppath)
    print("wrote", ppath)


if __name__ == "__main__":
    main()
