# FirstPass 1P HQ mark

Matt supplied the 1P HQ mark on 15 October 2026: the FirstPass 1P with a gold "HQ" under the P. It is the app icon, Android adaptive and notification icon, splash and favicon (PR #121). Inside the app, the club logo placeholder still uses the plain 1P mark.

| File | What it is |
| --- | --- |
| `firstpass-1p-hq-light.svg` | Vector mark on white |
| `firstpass-1p-hq-dark.svg` | Vector mark on deep navy (#0F172A) |
| `firstpass-1p-hq-mark.png` | Cleaned raster master, transparent, 2079 × 1392 |
| `source-artwork.jpg` | Matt's original image (1200 × 896, white half and navy half) |
| `app-icons-before-after.png` | The app icons before and after PR #121 |
| `app-icon-screenshots.html` | The PR #121 screenshot page, self-contained (open it in a browser) |
| `scripts/` | The scripts that made all of the above |

The SVGs use the brand colours (pacific blue #2274A5, blaze orange #F75C03, electric gold #F1C40F), with the arrow fading from orange-gold at its tail to gold. They were traced from a small image, so a few corners are slightly rounded. They are fine for screens and print up to about A4, but signage needs a hand redraw.

## Rebuilding

Run from one working folder, with `numpy`, `Pillow` and `potracer` (`pip install potracer`) installed:

1. `python3 scripts/clean-hq-mark.py source-artwork.jpg icon/mark-hq-dark.png` cuts the navy half out and rebuilds it at 4x. The crop box is specific to this image.
2. `python3 scripts/build-hq-icons.py icon/mark-hq-dark.png assets/images` writes `icon.png`, `favicon.png`, the three `android-icon-*.png` files and `splash-logo.png`.
3. `python3 scripts/label-hq-mark.py` splits the master into its pieces (`labels.npy`), then `python3 scripts/trace-hq-svg.py` writes the two SVGs.

If the splash mark's size changes, update `FIRSTPASS_HEIGHT` in `src/components/brand-intro.tsx`.
