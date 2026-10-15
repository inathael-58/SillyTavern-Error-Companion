"""Slice a 3x2 expression sheet into aligned, transparent WebP sprites.

    python3 tools/slice_sheet.py sheet.png sprites/tawan [LO HI]

The sheet is read row by row, left to right, in this order:
    neutral  tired      pious
    exhausted shocked   confused

What it does to each sprite:
  * alpha below LO (default 150) -> fully transparent, above HI (default 235) ->
    fully opaque. AI background removers often leave a grey haze around the
    figure and make the figure itself 98-99% opaque; this cleans both.
  * keeps only pixels near a solid area (drops stray specks of haze) and chokes
    the soft edge by about 1px so a light matte fringe doesn't glow on dark themes
  * every sprite goes on the same canvas, bottom-aligned, with the middle of the
    waist cut on the centre line, so swapping expressions doesn't make him jump

Needs Pillow and numpy.
"""
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

NAMES = ['neutral', 'tired', 'pious', 'exhausted', 'shocked', 'confused']


def clean_alpha(im, lo, hi):
    a = np.array(im.convert('RGBA')).astype(np.float32)
    na = np.clip((a[..., 3] - lo) / (hi - lo), 0, 1)
    solid = Image.fromarray(((na > 0.9) * 255).astype(np.uint8))
    solid = solid.filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MaxFilter(5))
    na *= np.array(solid.filter(ImageFilter.MaxFilter(25))) > 0
    choked = np.array(Image.fromarray((na * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3))) / 255
    na = np.minimum(na, (na + choked) / 2)
    a[..., 3] = na * 255
    return Image.fromarray(a.astype(np.uint8), 'RGBA')


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    src, out = sys.argv[1], sys.argv[2]
    lo = float(sys.argv[3]) if len(sys.argv) > 3 else 150
    hi = float(sys.argv[4]) if len(sys.argv) > 4 else 235
    os.makedirs(out, exist_ok=True)

    clean = clean_alpha(Image.open(src), lo, hi)
    w, h = clean.size
    sprites = []
    for top, bottom in [(0, h // 2), (h // 2, h)]:
        for left, right in [(0, w // 3), (w // 3, 2 * w // 3), (2 * w // 3, w)]:
            cell = clean.crop((left, top, right, bottom))
            ys, xs = np.nonzero(np.array(cell)[..., 3] > 8)
            sprite = cell.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
            # anchor: middle of the lowest solid rows (the waist cut)
            body = np.array(sprite)[..., 3] > 128
            cols = np.nonzero(body[-6:].any(axis=0))[0]
            sprites.append((sprite, (cols.min() + cols.max()) / 2))

    half = int(np.ceil(max(max(cx, s.width - cx) for s, cx in sprites))) + 8
    height = max(s.height for s, _ in sprites) + 8
    for name, (sprite, cx) in zip(NAMES, sprites):
        canvas = Image.new('RGBA', (half * 2, height), (0, 0, 0, 0))
        canvas.paste(sprite, (int(round(half - cx)), height - sprite.height))
        canvas.save(os.path.join(out, f'{name}.webp'), 'WEBP', quality=90, method=6)
    print(f'{len(sprites)} sprites, {half * 2}x{height}, in {out}')


if __name__ == '__main__':
    main()
