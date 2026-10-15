"""Trace the cleaned 1P HQ mark into SVG: one path per colour, brand colours."""
import sys, time
import numpy as np
import potrace
from PIL import Image
W = np.load('labels.npy')
S = 4.0  # master is 4x the original artwork
BLUE, ORANGE, GOLD, NAVY = '#2274A5', '#F75C03', '#F1C40F', '#0F172A'
groups = {'blue': [3, 6], 'orange': [2, 5], 'arrow': [4], 'hq': [7, 8]}

def f(v):
    return f'{v / S:.2f}'.rstrip('0').rstrip('.')

def trace(ids):
    bm = potrace.Bitmap(~np.isin(W, ids))
    plist = bm.trace(turdsize=50, alphamax=1.0, opticurve=True, opttolerance=0.2)
    d = []
    for curve in plist:
        p = curve.start_point
        d.append(f'M{f(p.x)} {f(p.y)}')
        for seg in curve.segments:
            if seg.is_corner:
                d.append(f'L{f(seg.c.x)} {f(seg.c.y)}L{f(seg.end_point.x)} {f(seg.end_point.y)}')
            else:
                d.append(f'C{f(seg.c1.x)} {f(seg.c1.y)} {f(seg.c2.x)} {f(seg.c2.y)} {f(seg.end_point.x)} {f(seg.end_point.y)}')
        d.append('Z')
    return ''.join(d)

paths = {}
for k, ids in groups.items():
    t = time.time(); paths[k] = trace(ids); print(k, len(paths[k]), round(time.time() - t, 1), file=sys.stderr)

h, w = W.shape
mw, mh = w / S, h / S
pad = round(mw * 0.12)
vw, vh = round(mw + 2 * pad), round(mh + 2 * pad)

def svg(bg, title):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {vw} {vh}" width="{vw * 2}" height="{vh * 2}" role="img" aria-labelledby="t">
  <title id="t">{title}</title>
  <defs>
    <linearGradient id="arrow" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="{mw:.0f}" y2="0">
      <stop offset="0" stop-color="#F08C10"/>
      <stop offset="0.5" stop-color="{GOLD}"/>
    </linearGradient>
  </defs>
  <rect width="{vw}" height="{vh}" fill="{bg}"/>
  <g transform="translate({pad} {pad})" fill-rule="evenodd">
    <path fill="{BLUE}" d="{paths['blue']}"/>
    <path fill="{ORANGE}" d="{paths['orange']}"/>
    <path fill="url(#arrow)" d="{paths['arrow']}"/>
    <path fill="{GOLD}" d="{paths['hq']}"/>
  </g>
</svg>
'''
open('firstpass-1p-hq-light.svg', 'w').write(svg('#FFFFFF', 'FirstPass HQ 1P HQ mark on white'))
open('firstpass-1p-hq-dark.svg', 'w').write(svg(NAVY, 'FirstPass HQ 1P HQ mark on deep navy'))
print(vw, vh)
