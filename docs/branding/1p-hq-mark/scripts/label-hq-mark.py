import numpy as np
from PIL import Image, ImageDraw
m = Image.open('icon/mark-hq-dark.png')
a = np.asarray(m).astype(int)
mask = (a[..., 3] > 127)
lab = Image.fromarray((mask * 255).astype(np.uint8))
comps = []
ys, xs = np.nonzero(mask)
k = 1
arr = np.asarray(lab).copy()
L = np.zeros(mask.shape, int)
img = lab.copy()
# flood each unlabelled pixel with a unique grey via PIL (fast)
work = Image.fromarray(np.where(mask, 1, 0).astype(np.int32), 'I')
k = 2
pts = list(zip(xs[::50], ys[::50]))
for (x, y) in pts:
    if work.getpixel((int(x), int(y))) == 1:
        ImageDraw.floodfill(work, (int(x), int(y)), k)
        k += 1
W = np.asarray(work)
print('labels', k)
for i in range(2, k):
    sel = W == i
    n = sel.sum()
    if n < 500: continue
    col = a[..., :3][sel].mean(0)
    yy, xx = np.nonzero(sel)
    print(i, n, col.round(), xx.min(), xx.max(), yy.min(), yy.max())
np.save('labels.npy', W)
