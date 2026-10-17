"""App icon set from the 1P HQ mark (mark-hq-dark.png, from clean.py)."""
import sys
import numpy as np
from PIL import Image
mark_path, out = sys.argv[1], sys.argv[2]
NAVY = (15, 23, 42)
mark = Image.open(mark_path).convert('RGBA')

def reach(im):
    """Furthest visible pixel from the mark's own centre, in pixels."""
    a = np.asarray(im.getchannel('A')) > 40
    ys, xs = np.nonzero(a)
    return np.sqrt((xs - im.width / 2) ** 2 + (ys - im.height / 2) ** 2).max()

def sized(width):
    return mark.resize((width, round(mark.height * width / mark.width)), Image.LANCZOS)

def within(radius):
    """The mark scaled so every visible pixel sits inside a circle of this radius."""
    return sized(int(mark.width * radius / reach(mark)))

def centre(canvas, im):
    canvas.alpha_composite(im, ((canvas.width - im.width) // 2, (canvas.height - im.height) // 2))
    return canvas

# iOS / store icon: 1P HQ on deep navy, about 70% of the tile wide.
icon = centre(Image.new('RGBA', (1024, 1024), NAVY + (255,)), sized(720)).convert('RGB')
icon.save(f'{out}/icon.png', optimize=True)
# Favicon: a little larger in its tile so it reads at 48px.
centre(Image.new('RGBA', (1024, 1024), NAVY + (255,)), sized(860)).convert('RGB').resize((48, 48), Image.LANCZOS).save(f'{out}/favicon.png', optimize=True)
# Android adaptive: the safe circle is 66 of 108 units (radius 313 of 1024); stay inside 300.
Image.new('RGB', (1024, 1024), NAVY).save(f'{out}/android-icon-background.png', optimize=True)
fg = centre(Image.new('RGBA', (1024, 1024), (0, 0, 0, 0)), within(300))
fg.save(f'{out}/android-icon-foreground.png', optimize=True)
# Monochrome (themed icons and the notification icon): white silhouette, gaps kept.
mono = Image.new('RGBA', (1024, 1024), (255, 255, 255, 0)); mono.putalpha(fg.getchannel('A'))
mono.save(f'{out}/android-icon-monochrome.png', optimize=True)
# Splash: Android 12 shows a circle 2/3 of the 1152 image (radius 384); stay inside 360.
centre(Image.new('RGBA', (1152, 1152), (0, 0, 0, 0)), within(360)).save(f'{out}/splash-logo.png', optimize=True)
s = within(360); print('splash mark', s.size, 'fg mark', within(300).size)
