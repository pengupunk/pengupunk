#!/usr/bin/env python3
"""Prototipe art Pengupunk v3: visor lebih sempit, kepala lebih jelas, flipper terlihat."""
from PIL import Image, ImageDraw

PAL = {
    "K": (18, 20, 26),
    "W": (242, 240, 232),
    "O": (242, 148, 38),
    "S": (168, 174, 186),
    "G": (212, 175, 55),
    "R": (206, 62, 58),
    "C": (86, 214, 196),
    ".": None,
}

BODY = [
    "................",
    "................",
    "................",
    "................",
    "....KKKKKKK.....",
    "...KKKKKKKKK....",
    "...KKKKKKKKKG...",
    "...KKKKKKKKK....",
    "..KKKKKKKKKKK...",
    "..KKKKKKKKKKK...",
    "..KKWWWWWWWWKK..",
    "..KKWWWWWWWWKK..",
    "...KWWWWWWWWK...",
    "....KWWWWWWK....",
    "....KK....KK....",
    "...OOO....OOO...",
]

MOHAWK = [
    "................",
    "......CC........",
    ".....CCCC.......",
    "....CCCCCC......",
] + ["................"] * 12

SHADES = ["................"] * 5 + [
    "....SSSSSS......",
] + ["................"] * 10

BEAK = ["................"] * 7 + [
    "......OOO.......",
    "......OOO.......",
] + ["................"] * 7

COLLAR = ["................"] * 9 + [
    "..KSKSKSKSKSK...",
] + ["................"] * 6


def draw_grid(layers, size=512, grid=16, bg=(10, 12, 16)):
    img = Image.new("RGB", (size, size), bg)
    d = ImageDraw.Draw(img)
    cell = size // grid
    for layer in layers:
        for y, row in enumerate(layer):
            for x, ch in enumerate(row):
                col = PAL.get(ch)
                if not col:
                    continue
                d.rectangle([x * cell, y * cell, (x + 1) * cell - 1, (y + 1) * cell - 1], fill=col)
    return img


if __name__ == "__main__":
    img = draw_grid([BODY, COLLAR, MOHAWK, SHADES, BEAK])
    img.save("/home/ubuntu/projects/pengupunk/art/pixel_punk3.png")
    print("saved", img.size)
