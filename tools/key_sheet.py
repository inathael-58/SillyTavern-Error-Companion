"""Cut sprites out of an expression sheet drawn on a plain coloured background.

    python3 tools/key_sheet.py sheet.png out_dir --grid 3x2 --names a,b,c,d,e,f \
        --anchor waist --model isnet-anime.onnx

    needs: pip install numpy pillow scipy onnxruntime
    model: https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-anime.onnx

What made sprites/mint and sprites/hengheng:

    --grid 3x2 --anchor waist                                  (mINT)
    --grid 3x3 --anchor ground --drop-shadows --solid-inside   (เฮงเฮง)

- The body comes from the isnet-anime segmentation model, so hair, white
  clothes and skin that are close to the background colour stay solid.
- Floating effects the model drops (neon hearts, "?", droplets) come from a
  colour key against the background, as do holes inside the body.
- A pale haze painted around the figure (the background lightened) is not
  kept; with --drop-shadows neither are ground shadows (the background
  darkened). Leave that off when the figure has such colours, like peach
  skin on a peach background.
- Edge pixels are unmixed from the background colour, so no tinted fringe.
- Every sprite is placed on one shared canvas so they line up and keep the
  same scale: --anchor waist = flat cut at the bottom (half body),
  --anchor ground = lowest pixel sits on the bottom edge (full body).
"""
import argparse
import os

import numpy as np
import onnxruntime as ort
from PIL import Image
from scipy import ndimage as ndi


def segment(im, cols, rows, model):
    sess = ort.InferenceSession(model, providers=['CPUExecutionProvider'])
    inp = sess.get_inputs()[0].name
    W, H = im.size
    mask = np.zeros((H, W), np.float32)
    pad = 24
    for r in range(rows):
        for c in range(cols):
            x0, y0, x1, y1 = c * W // cols, r * H // rows, (c + 1) * W // cols, (r + 1) * H // rows
            cell = im.crop((x0, y0, x1, y1))
            cw, ch = cell.size
            side = max(cw, ch) + 2 * pad
            sq = Image.new('RGB', (side, side), cell.getpixel((2, 2)))
            ox, oy = (side - cw) // 2, (side - ch) // 2
            sq.paste(cell, (ox, oy))
            x = np.asarray(sq.resize((1024, 1024), Image.BILINEAR)).astype(np.float32) / 255
            x = (x - np.array([0.485, 0.456, 0.406], np.float32)).transpose(2, 0, 1)[None]
            pred = sess.run(None, {inp: x.astype(np.float32)})[0][0, 0]
            pred = (pred - pred.min()) / max(pred.max() - pred.min(), 1e-6)
            m = Image.fromarray((pred * 255).astype(np.uint8)).resize((side, side), Image.BILINEAR)
            mask[y0:y1, x0:x1] = np.asarray(m).astype(np.float32)[oy:oy + ch, ox:ox + cw] / 255
    return mask


def matte(rgb, model_mask, lo, hi, core=80, glow=20, drop_shadows=False, solid_inside=False):
    h, w, _ = rgb.shape
    border = np.concatenate([rgb[:6].reshape(-1, 3), rgb[-6:].reshape(-1, 3),
                             rgb[:, :6].reshape(-1, 3), rgb[:, -6:].reshape(-1, 3)])
    bg = np.median(border, 0)
    diff = rgb - bg
    dist = np.sqrt((diff ** 2).sum(-1))
    # distance off the background->white line: a pale haze painted around the
    # figure (background lightened) does not count as figure
    u = (255 - bg) / max(np.linalg.norm(255 - bg), 1e-6)
    lift = np.maximum(diff @ u, 0)
    off = np.sqrt(np.maximum(dist ** 2 - lift ** 2, 0))
    # at the body's edge, soft ground shadows (background darkened) do not
    # count either. Only there: neon effects can be darker than the background
    v = -bg / max(np.linalg.norm(bg), 1e-6)
    shade = np.maximum(diff @ v, 0)
    off_edge = np.sqrt(np.maximum(dist ** 2 - lift ** 2 - shade ** 2, 0))
    shadow = (lift == 0) & (shade < 140)
    if drop_shadows:
        # ground shadows count as background everywhere. Only for sheets whose
        # figures have no colours that are the background slightly darkened
        # (skin on a peach background has, fur on blue has not)
        off = np.where(shadow, off_edge, off)
    key = np.clip((off - lo) / (hi - lo), 0, 1)
    key = key * key * (3 - 2 * key)

    m = np.clip((model_mask - 0.08) / 0.84, 0, 1)
    body = m > 0.5
    alpha = m.copy()

    # background showing between hair strands: the model is unsure there, so
    # let the colour decide; flat background patches it called solid go too
    soft = np.clip((off_edge - 5) / 20, 0, 1)
    patches, n = ndi.label(dist < 6)
    if n:
        size = ndi.sum(np.ones_like(dist), patches, np.arange(1, n + 1))
        flat = np.isin(patches, 1 + np.nonzero(size >= 400)[0])
    else:
        flat = np.zeros_like(body)
    unsure = (m < 0.98) | ndi.binary_dilation(flat, iterations=3)
    alpha[unsure] = np.minimum(alpha[unsure], soft[unsure])
    if drop_shadows:
        # the model sometimes takes a ground shadow for body
        flat_shade = np.clip((off_edge - 10) / 20, 0, 1)
        alpha[shadow] = np.minimum(alpha[shadow], flat_shade[shadow])

    # holes inside the body (eyes of a squinting face, an open mouth)
    filled = ndi.binary_fill_holes(body)
    holes = filled & ~body & ~flat
    alpha[holes] = np.maximum(alpha[holes], key[holes])
    if solid_inside:
        # deep inside the silhouette, colours close to the background (pale
        # eyes, highlights, teeth) are part of the figure when the model sees
        # anything. Not for long hair: background shows between its strands
        deep = ndi.binary_erosion(filled, iterations=12) & ~ndi.binary_dilation(flat, iterations=3)
        deep &= model_mask > 0.15
        alpha[deep] = 1

    # floating effects (neon heart, "?", droplets): strongly coloured cores
    # away from the body, plus their glow. A pale haze around the hair has no
    # such core, so it is dropped
    near = ndi.binary_dilation(body, iterations=10)
    seeds, n = ndi.label((off > core) & ~near)
    if n:
        size = ndi.sum(np.ones_like(dist), seeds, np.arange(1, n + 1))
        kept = np.isin(seeds, 1 + np.nonzero(size >= 20)[0])
        fx = ndi.binary_dilation(kept, iterations=glow) & ~near
        alpha[fx] = np.maximum(alpha[fx], key[fx])

    alpha[alpha < 0.02] = 0
    a = np.maximum(alpha, 1e-3)[..., None]
    # unmix the background out of semi-transparent pixels; the key is the
    # better estimate of how much background shows through, when it is higher
    est = np.maximum(a, key[..., None])
    fg = np.where(alpha[..., None] < 0.999, bg + (rgb - bg) / est, rgb)
    return np.dstack([np.clip(fg, 0, 255), alpha * 255]).round().astype(np.uint8), bg


def main():
    p = argparse.ArgumentParser()
    p.add_argument('sheet')
    p.add_argument('out_dir')
    p.add_argument('--grid', default='3x2', help='COLSxROWS')
    p.add_argument('--names', required=True, help='comma separated, row by row')
    p.add_argument('--anchor', choices=['waist', 'ground'], default='waist')
    p.add_argument('--model', required=True)
    p.add_argument('--lo', type=float, default=10)
    p.add_argument('--hi', type=float, default=45)
    p.add_argument('--core', type=float, default=80, help='colour distance an effect needs at its centre')
    p.add_argument('--glow', type=int, default=20, help='px of glow kept around an effect')
    p.add_argument('--drop-shadows', action='store_true', help='also remove ground shadows the model kept')
    p.add_argument('--solid-inside', action='store_true', help='fill see-through spots well inside the figure (pale eyes on a pale background)')
    p.add_argument('--max-height', type=int, default=720)
    p.add_argument('--margin', type=int, default=8)
    args = p.parse_args()

    cols, rows = map(int, args.grid.lower().split('x'))
    names = args.names.split(',')
    assert len(names) == cols * rows, 'need one name per cell'
    im = Image.open(args.sheet).convert('RGB')
    rgb = np.asarray(im).astype(np.float32)
    mask = segment(im, cols, rows, args.model)
    rgba, bg = matte(rgb, mask, args.lo, args.hi, args.core, args.glow, args.drop_shadows, args.solid_inside)
    print('background', bg)

    W, H = im.size
    cuts = []
    for i in range(cols * rows):
        r, c = divmod(i, cols)
        x0, y0, x1, y1 = c * W // cols, r * H // rows, (c + 1) * W // cols, (r + 1) * H // rows
        cell = rgba[y0:y1, x0:x1]
        a = cell[..., 3] > 8
        ys, xs = np.nonzero(a)
        top, bottom, left, right = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        if args.anchor == 'waist':
            # centre on the body where it is cut off, not on flying hair
            band = a[bottom - 6:bottom]
            bx = np.nonzero(band.any(0))[0]
            cx = (bx.min() + bx.max() + 1) / 2
        else:
            cx = (left + right) / 2
        cuts.append(dict(name=names[i], img=cell, top=top, bottom=bottom, left=left, right=right, cx=cx))

    half = max(max(k['cx'] - k['left'], k['right'] - k['cx']) for k in cuts) + args.margin
    height = max(k['bottom'] - k['top'] for k in cuts) + args.margin
    cw, ch = int(np.ceil(half * 2)), int(height)
    scale = min(1.0, args.max_height / ch)
    os.makedirs(args.out_dir, exist_ok=True)
    for k in cuts:
        canvas = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
        piece = Image.fromarray(k['img'][k['top']:k['bottom'], k['left']:k['right']], 'RGBA')
        canvas.paste(piece, (int(round(half - (k['cx'] - k['left']))), ch - (k['bottom'] - k['top'])))
        if scale < 1:
            canvas = canvas.resize((round(cw * scale), round(ch * scale)), Image.LANCZOS)
        path = os.path.join(args.out_dir, k['name'] + '.webp')
        canvas.save(path, 'WEBP', quality=90, method=6)
        print(path, canvas.size, os.path.getsize(path) // 1024, 'KB')


if __name__ == '__main__':
    main()
