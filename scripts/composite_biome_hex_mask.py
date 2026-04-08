#!/usr/bin/env python3
"""
Apply the same hex silhouette as createTerrainHexTopGeometry / generate_biome_overlays
to a square PNG (e.g. sprite-smith / AI output). Optionally **align** small or off-center
art by cropping to opaque bounds and scaling with cover to 128×128 before masking.

Usage:
  python3 scripts/composite_biome_hex_mask.py input.png [output.png]
  python3 scripts/composite_biome_hex_mask.py --biomes plains desert
  python3 scripts/composite_biome_hex_mask.py --biomes plains desert --no-align

Flags:
  --align       Force crop-to-content + cover scale (default: auto-detect)
  --no-align    Only resize to 128×128 if needed, then mask
  --biomes A B  Process A_0..A_3, B_0..B_3 in OUT_DIR (writes in place)

Requires: pillow
"""
from __future__ import annotations

import argparse
import os
import sys

try:
    from PIL import Image, ImageOps
except ImportError:
    raise SystemExit("Install Pillow: pip install pillow")

sys.path.insert(0, os.path.dirname(__file__))
from generate_biome_overlays import OUT_DIR, SIZE, make_hex_texture_mask

# If content bbox is smaller than this fraction of the image on either axis, scale up (AI “tiny circle” case).
_ALIGN_SMALL_FRAC = 0.72


def apply_mask(src: Image.Image) -> Image.Image:
    if src.mode != "RGBA":
        src = src.convert("RGBA")
    if src.size != (SIZE, SIZE):
        src = src.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    mask_fn = make_hex_texture_mask(SIZE, 1.0)
    out = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    px = src.load()
    po = out.load()
    for y in range(SIZE):
        for x in range(SIZE):
            if mask_fn(x, y):
                po[x, y] = px[x, y]
    return out


def _should_auto_align(im: Image.Image) -> bool:
    bbox = im.getbbox()
    if not bbox:
        return False
    w, h = im.size
    bw = bbox[2] - bbox[0]
    bh = bbox[3] - bbox[1]
    return bw < w * _ALIGN_SMALL_FRAC or bh < h * _ALIGN_SMALL_FRAC


def prepare_for_mask(src: Image.Image, align: str) -> Image.Image:
    """align: 'auto' | 'yes' | 'no'"""
    src = src.convert("RGBA")
    do_align = align == "yes" or (align == "auto" and _should_auto_align(src))

    if do_align:
        bbox = src.getbbox()
        if bbox:
            src = src.crop(bbox)
        src = ImageOps.fit(
            src,
            (SIZE, SIZE),
            method=Image.Resampling.LANCZOS,
            centering=(0.5, 0.5),
        )
    else:
        if src.size != (SIZE, SIZE):
            src = src.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    return src


def process_one(path: str, align: str) -> Image.Image:
    im = Image.open(path)
    prepared = prepare_for_mask(im, align)
    return apply_mask(prepared)


def main() -> None:
    p = argparse.ArgumentParser(description="Hex-align and mask biome PNGs for Fallen Empire")
    p.add_argument("paths", nargs="*", help="Input PNG paths")
    p.add_argument(
        "--align",
        choices=("auto", "yes", "no"),
        default="auto",
        help="How to scale content before masking (default: auto)",
    )
    p.add_argument(
        "--biomes",
        nargs="+",
        metavar="STEM",
        help=f"Process STEM_0..3 in {OUT_DIR} (e.g. plains desert)",
    )
    args = p.parse_args()

    if args.biomes:
        written = []
        for stem in args.biomes:
            for v in range(4):
                name = f"{stem}_{v}.png"
                full = os.path.join(OUT_DIR, name)
                if not os.path.isfile(full):
                    print(f"Skip missing: {full}", file=sys.stderr)
                    continue
                out = process_one(full, args.align)
                out.save(full, "PNG")
                written.append(full)
        for w in written:
            print(f"Wrote {w}")
        if not written:
            sys.exit(1)
        return

    if not args.paths:
        p.print_help()
        sys.exit(1)
    inp = args.paths[0]
    outp = args.paths[1] if len(args.paths) > 1 else inp
    out = process_one(inp, args.align)
    out.save(outp, "PNG")
    print(f"Wrote {outp}")


if __name__ == "__main__":
    main()
