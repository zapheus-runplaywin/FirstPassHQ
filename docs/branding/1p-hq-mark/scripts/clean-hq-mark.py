"""Cut the 1P HQ mark out of Matt's logo image (dark half) and clean it at 4x."""
import sys
import numpy as np
from PIL import Image

def blur(x, r):
    """Separable gaussian blur of a float array (numpy only)."""
    p = int(3 * r)
    k = np.exp(-0.5 * (np.arange(-p, p + 1) / r) ** 2); k /= k.sum()
    x = np.pad(x, ((p, p), (0, 0)), mode='edge'); x = np.apply_along_axis(lambda c: np.convolve(c, k, 'valid'), 0, x)
    x = np.pad(x, ((0, 0), (p, p)), mode='edge'); return np.apply_along_axis(lambda c: np.convolve(c, k, 'valid'), 1, x)

def box(x):
    p = np.pad(x, 1, mode='edge')
    return sum(p[1 + dy:p.shape[0] - 1 + dy, 1 + dx:p.shape[1] - 1 + dx] for dy in (-1, 0, 1) for dx in (-1, 0, 1)) / 9
src, out = sys.argv[1], sys.argv[2]
UP = 4
im = Image.open(src).convert('RGB').crop((610, 240, 1190, 650))
a = np.asarray(im).astype(float)
bg = np.median(np.concatenate([a[:20].reshape(-1, 3), a[-20:].reshape(-1, 3)]), axis=0)
dist = np.sqrt(((a - bg) ** 2).sum(-1))
alpha = np.clip((dist - 30) / 70, 0, 1)
fg = np.clip((a - (1 - alpha[..., None]) * bg) / np.maximum(alpha[..., None], 1e-3), 0, 255)
valid = (alpha > 0.6).astype(float)
# Spread the solid colours outward so the edges keep the right hue once upscaled.
col = fg * valid[..., None]
w = valid.copy()
for _ in range(12):
    cb = np.dstack([box(col[..., i]) for i in range(3)])
    wb = box(w)
    fill = (w == 0) & (wb > 0)
    col[fill] = cb[fill] / wb[fill][:, None]
    w = np.where(fill, 1.0, w)
W, H = im.width * UP, im.height * UP
colup = np.dstack([np.asarray(Image.fromarray(col[..., i].astype(np.float32), 'F').resize((W, H), Image.BICUBIC)) for i in range(3)])
# Lightly smooth each colour area so JPEG blocks don't show at 4x.
colup = np.dstack([blur(colup[..., i], 3) for i in range(3)])
aup = blur(np.asarray(Image.fromarray(alpha.astype(np.float32), 'F').resize((W, H), Image.BICUBIC)), UP * 0.9)
# Re-sharpen the edge to a crisp, anti-aliased line (about 1.5px wide at 4x).
crisp = np.clip((aup - 0.5) * 0.7 * UP + 0.5, 0, 1)
rgba = np.dstack([np.clip(colup, 0, 255), crisp * 255]).astype(np.uint8)
img = Image.fromarray(rgba, 'RGBA')
img = img.crop(img.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox())
img.save(out, optimize=True)
print(img.size)
