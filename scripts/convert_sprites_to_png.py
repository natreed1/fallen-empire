#!/usr/bin/env python3
"""Convert building sprites to PNG with transparency (straight alpha).
Makes white/light-gray backgrounds transparent so sprites blend with the hex grid."""
from PIL import Image
import os

BUILDINGS = "/Users/natreed/fallen-empire/public/sprites/buildings"
# All building sprites — many were RGB with opaque white backgrounds
ALL_BUILDINGS = [
    "academy.png", "barracks.png", "factory.png", "farm.png",
    "market.png", "mine.png", "quarry.png", "scout.png", "silo.png", "wall.png"
]

# Pixels this light or lighter become transparent (white, off-white, light blue/gray)
# Tuned to avoid eating into light-colored sprite features (stone, wood, etc.)
LIGHT_THRESHOLD = 215


def convert_to_png_with_alpha(path: str) -> bool:
    img = Image.open(path)
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    data = list(img.getdata())
    new_data = []
    for item in data:
        r, g, b = item[0], item[1], item[2]
        # Uniformly light pixels -> transparent background
        if r >= LIGHT_THRESHOLD and g >= LIGHT_THRESHOLD and b >= LIGHT_THRESHOLD:
            new_data.append((255, 255, 255, 0))
        else:
            a = item[3] if len(item) == 4 else 255
            new_data.append((r, g, b, a))
    img.putdata(new_data)
    img.save(path, "PNG", compress_level=6)
    return True


def main():
    for f in ALL_BUILDINGS:
        p = os.path.join(BUILDINGS, f)
        if os.path.exists(p):
            convert_to_png_with_alpha(p)
            print(f"Converted {f}")


if __name__ == "__main__":
    main()
