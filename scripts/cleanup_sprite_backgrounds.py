#!/usr/bin/env python3
"""
Remove flat grey / white backgrounds from pixel-art PNGs.

Pass 1 (fixed): flood from all image edges through **transparent** pixels and
**opaque light neutral matte** (export dither around sprites — academy, mine,
etc.). Strips that matte to alpha-0; saturated / dark art pixels block the flood.

Run from repo root:
  python3 scripts/cleanup_sprite_backgrounds.py

Requires Pillow: pip install Pillow
"""
from __future__ import annotations

import os
import sys
from collections import deque

try:
    from PIL import Image
except ImportError:
    print("Install Pillow: pip install Pillow", file=sys.stderr)
    sys.exit(1)

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIRS = [
    os.path.join(REPO, "public/sprites/units"),
    os.path.join(REPO, "public/sprites/buildings"),
    os.path.join(REPO, "public/sprites/entities"),
    os.path.join(REPO, "public/sprites/meta"),
]

# Skip huge textures and biome overlays (already authored with alpha)
SKIP_NAMES = {"road.png"}


def is_opaque_export_matte(r: int, g: int, b: int, a: int) -> bool:
    """
    Opaque light neutral dither / flat grey frame (academy, mine, etc.).
    Tight band — saturated building pixels and dark rock stay opaque.
    """
    if a < 200:
        return False
    mx, mn = max(r, g, b), min(r, g, b)
    spread = mx - mn
    if spread > 48:
        return False
    if mn < 175:
        return False
    if mx > 238:
        return False
    return True


def is_passable_from_outside(r: int, g: int, b: int, a: int) -> bool:
    """We may walk through full transparency or export-matte (to be deleted)."""
    if a < 16:
        return True
    return is_opaque_export_matte(r, g, b, a)


def cleanup_image(im: Image.Image) -> Image.Image:
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()

    # ── Pass 1: reach opaque light-grey frames from image edge (fixed: expand through alpha-0) ──
    q: deque[tuple[int, int]] = deque()
    seen: set[tuple[int, int]] = set()

    def enqueue(x: int, y: int) -> None:
        if (x, y) in seen:
            return
        seen.add((x, y))
        q.append((x, y))

    for x in range(w):
        enqueue(x, 0)
        enqueue(x, h - 1)
    for y in range(h):
        enqueue(0, y)
        enqueue(w - 1, y)

    while q:
        x, y = q.popleft()
        r, g, b, a = px[x, y]
        if is_opaque_export_matte(r, g, b, a):
            px[x, y] = (r, g, b, 0)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if nx < 0 or ny < 0 or nx >= w or ny >= h:
                continue
            if (nx, ny) in seen:
                continue
            nr, ng, nb, na = px[nx, ny]
            if not is_passable_from_outside(nr, ng, nb, na):
                continue
            enqueue(nx, ny)

    return im


def process_file(path: str) -> bool:
    name = os.path.basename(path)
    if name in SKIP_NAMES:
        return False
    before = Image.open(path)
    if before.mode not in ("RGBA", "RGB", "P"):
        return False
    after = cleanup_image(before)
    # Cheap change detect: compare raw bytes
    import io

    buf = io.BytesIO()
    after.save(buf, format="PNG", optimize=True)
    buf.seek(0)
    new_data = buf.getvalue()
    with open(path, "rb") as f:
        old_data = f.read()
    if new_data == old_data:
        return False
    with open(path, "wb") as f:
        f.write(new_data)
    return True


def main() -> None:
    changed = 0
    checked = 0
    for d in DIRS:
        if not os.path.isdir(d):
            continue
        for name in sorted(os.listdir(d)):
            if not name.endswith(".png"):
                continue
            path = os.path.join(d, name)
            checked += 1
            if process_file(path):
                changed += 1
                print(f"updated: {path}")
    print(f"Done. {changed}/{checked} files changed.")


if __name__ == "__main__":
    main()
