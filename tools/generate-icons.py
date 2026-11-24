#!/usr/bin/env python3
"""Render BowlBoard's approved SVGs into installation icons and transparent logos."""
from pathlib import Path
from io import BytesIO
import cairosvg
from PIL import Image

root = Path(__file__).resolve().parent.parent
mark = (root / 'brand-mark.svg').read_text()
lockup = (root / 'brand-lockup.svg').read_text()
wordmark = (root / 'brand-wordmark.svg').read_text()

def icon(scale):
    inner = mark[mark.index('>') + 1:mark.rindex('</svg>')]
    offset = (240 - 200 * scale) / 2
    return (f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 240 240">'
            f'<rect width="240" height="240" fill="#F0EAD6"/>'
            f'<g transform="translate({offset:g} {offset:g}) scale({scale:g})">{inner}</g></svg>\n')

def render(svg, width, height, opaque=False):
    if 'xmlns:xlink=' not in svg:
        svg = svg.replace('xmlns="http://www.w3.org/2000/svg"', 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"', 1)
    svg = svg.replace('<use href=', '<use xlink:href=')
    result = Image.open(BytesIO(cairosvg.svg2png(bytestring=svg.encode(), output_width=width * 2, output_height=height * 2))).convert('RGBA')
    result = result.resize((width, height), Image.Resampling.LANCZOS)
    return result.convert('RGB') if opaque else result

(root / 'brand-icon.svg').write_text(icon(.96))
for name, size, scale in [('app-icon.png', 160, .96), ('apple-touch-icon.png', 180, .96), ('favicon.png', 64, 1.04), ('icon-192.png', 192, .96), ('icon-512.png', 512, .96), ('icon-maskable-512.png', 512, .68)]:
    image = render(icon(scale), size, size, True)
    assert image.size == (size, size) and image.getpixel((0, 0)) == (240, 234, 214)
    image.save(root / name, optimize=True)
for name, svg, width, height in [('share-logo.png', lockup, 1000, 343), ('wordmark.png', wordmark, 495, 150)]:
    image = render(svg, width, height)
    assert image.size == (width, height) and image.getpixel((0, 0))[3] == 0
    image.save(root / name, optimize=True)
