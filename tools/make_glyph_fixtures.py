#!/usr/bin/env python3
"""Makes test/fixtures/glyph-masks.json: synthetic lane-screen masks for test/glyphs.test.js.

Each mask is what the photo pipeline hands the glyph reader (black-and-white, about 1600 px wide), drawn from system
fonts squeezed to look like tall condensed scoreboard digits, with thick cell borders that touch the digits and, in
some variants, totals whose digits touch each other. No real photos or personal data. Run:
    python3 tools/make_glyph_fixtures.py
"""
import json, zlib, base64, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

W, H = 1600, 300
# a complete game: X | 9/ | 7 2 | X | X | 5 3 | X | 7 2 | X | 8 1   -> 153
FRAMES = [['X'], ['9', '/'], ['7', '2'], ['X'], ['X'], ['5', '3'], ['X'], ['7', '2'], ['X'], ['8', '1']]
BALLS = [[10], [9, 1], [7, 2], [10], [10], [5, 3], [10], [7, 2], [10], [8, 1]]
TOTALS = [20, 37, 46, 71, 89, 97, 116, 125, 144, 153]
FONTS = [
    ('dejavu-bold', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 0.55, False),
    ('dejavu-bold-touching', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 0.62, True),
    ('weak-inter-extrabold', '/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf', 0.5, False),
    ('dejavu-mono-bold', '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf', 0.5, True),
]

def glyph(ch, path, squeeze, h):
    f = ImageFont.truetype(path, 200)
    im = Image.new('L', (260, 300), 0)
    ImageDraw.Draw(im).text((20, 20), ch, font=f, fill=255)
    a = np.array(im) > 127
    ys, xs = np.where(a); a = a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    g = Image.fromarray((a * 255).astype('uint8'))
    w = max(4, int(g.width * h / g.height * squeeze))
    return np.array(g.resize((w, h), Image.LANCZOS)) > 127

def make(path, squeeze, touching):
    m = np.zeros((H, W), bool)
    bar = 8
    m[0:bar, :] = True; m[148:148 + bar, :] = True; m[H - bar:H, :] = True     # horizontal borders
    cell = 128; x0 = 100
    for i in range(11):                                                         # vertical borders
        x = x0 + i * cell; m[:, x:x + bar] = True
    def put(g, x, y):
        h, w = g.shape; m[y:y + h, x:x + w] |= g
    hm = 92; ht = 96
    for i, balls in enumerate(FRAMES):
        gs = [glyph(c, path, squeeze, hm) for c in balls]
        gap = 14
        total = sum(g.shape[1] for g in gs) + gap * (len(gs) - 1)
        x = x0 + i * cell + bar + (cell - bar - total) // 2
        for g in gs:
            put(g, x, 10 + 14 if False else 24); x += g.shape[1] + gap          # touches no border; centered
        s = str(TOTALS[i]); tg = [glyph(c, path, squeeze, ht) for c in s]
        gap2 = -6 if touching else 10
        total = sum(g.shape[1] for g in tg) + gap2 * (len(tg) - 1)
        x = x0 + i * cell + bar + (cell - bar - total) // 2
        for g in tg:
            put(g, x, 148 + bar + 8); x += g.shape[1] + gap2                    # digits sit on the border below them
    # clutter the reader must ignore: a little frame number tail and a speck
    m[16:30, 60:70] = True; m[250:254, 30:34] = True
    return m

out = {}
for name, path, sq, touching in FONTS:
    if not os.path.exists(path): print('missing font', path, file=sys.stderr); continue
    m = make(path, sq, touching)
    bits = np.packbits(m.flatten(), bitorder='little').tobytes()
    out[name] = {'W': W, 'H': H, 'data': base64.b64encode(zlib.compress(bits, 9)).decode(), 'balls': BALLS, 'total': 153, 'totals': TOTALS}
    Image.fromarray((~m * 255).astype('uint8')).save(os.path.join(os.path.dirname(__file__), '..', 'test', 'fixtures', name + '.png'))
dst = os.path.join(os.path.dirname(__file__), '..', 'test', 'fixtures', 'glyph-masks.json')
json.dump(out, open(dst, 'w'))
print('wrote', dst, len(out), 'masks', os.path.getsize(dst), 'bytes')
